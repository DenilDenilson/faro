import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

export const SESSION_COOKIE = 'faro_session';
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
// Leave room for the import wrapper above a 4 MiB file, below Vercel's 4.5 MB cap.
const MAX_JSON_BYTES = 4 * 1024 * 1024 + 16 * 1024;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface SecurityConfig {
  password: string;
  secret: string;
}

function environmentValue(name: string): string | undefined {
  return process.env[name] ?? (import.meta.env?.[name] as string | undefined);
}

/** Runtime lookup keeps Vercel environment values on the server exclusively. */
export function securityConfig(): SecurityConfig {
  const password = environmentValue('FARO_PASSWORD');
  const secret = environmentValue('FARO_SESSION_SECRET');
  if (!password || password.length < 12 || !secret || secret.length < 32) {
    throw new HttpError(
      503,
      'Configura FARO_PASSWORD (12 caracteres como mínimo) y FARO_SESSION_SECRET (32 como mínimo) en el servidor.',
    );
  }
  return { password, secret };
}

function constantEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

export function checkPassword(candidate: string, config = securityConfig()): boolean {
  return constantEqual(candidate, config.password);
}

function passwordFingerprint(config: SecurityConfig): string {
  return createHmac('sha256', config.secret).update(config.password).digest('base64url');
}

export function createSession(config = securityConfig(), now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      iat: now,
      exp: now + SESSION_SECONDS * 1000,
      nonce: randomBytes(16).toString('base64url'),
      password: passwordFingerprint(config),
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', config.secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySession(
  token: string | undefined,
  config = securityConfig(),
  now = Date.now(),
): boolean {
  if (!token || token.length > 2048) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = createHmac('sha256', config.secret).update(payload).digest('base64url');
  if (!constantEqual(signature, expected)) return false;
  try {
    const session: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session || typeof session !== 'object') return false;
    const value = session as Record<string, unknown>;
    return (
      value.v === 1 &&
      typeof value.iat === 'number' &&
      typeof value.exp === 'number' &&
      typeof value.password === 'string' &&
      value.iat <= now + 30_000 &&
      value.exp > now &&
      value.exp - value.iat === SESSION_SECONDS * 1000 &&
      constantEqual(value.password, passwordFingerprint(config))
    );
  } catch {
    return false;
  }
}

export function setSessionCookie(cookies: AstroCookies, request: Request): void {
  cookies.set(SESSION_COOKIE, createSession(), {
    path: '/',
    httpOnly: true,
    secure:
      import.meta.env?.PROD ||
      process.env.NODE_ENV === 'production' ||
      new URL(request.url).protocol === 'https:',
    sameSite: 'strict',
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookie(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    throw new HttpError(403, 'Solicitud rechazada: el origen no coincide con FARO.');
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'Solicitud rechazada: abre FARO desde su dirección habitual.');
  }
}

export function safeNext(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return '/';
  }
  try {
    const target = new URL(value, 'https://faro.invalid');
    return target.origin === 'https://faro.invalid' && !target.pathname.startsWith('/login')
      ? `${target.pathname}${target.search}${target.hash}`
      : '/';
  } catch {
    return '/';
  }
}

export async function readBody(request: Request, limit = MAX_JSON_BYTES): Promise<string> {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit)
    throw new HttpError(413, 'El archivo o la solicitud supera el límite permitido.');
  if (!request.body) throw new HttpError(400, 'La solicitud está vacía.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new HttpError(413, 'El archivo o la solicitud supera el límite permitido.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJSON(request: Request, limit = MAX_JSON_BYTES): Promise<unknown> {
  requireSameOrigin(request);
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/json'
  ) {
    throw new HttpError(415, 'Envía los datos como application/json.');
  }
  const text = await readBody(request, limit);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'El contenido no es un JSON válido.');
  }
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function errorResponse(error: unknown): Response {
  let status = 500;
  let message = 'No se pudo completar la operación. Reintenta en un momento.';
  if (error instanceof HttpError) {
    status = error.status;
    message = error.message;
  } else if (error instanceof Error && error.name === 'ZodError' && 'issues' in error) {
    status = 400;
    const issues = error.issues as { message: string; path?: PropertyKey[] }[];
    message = issues
      .slice(0, 3)
      .map((issue) => `${issue.path?.join('.') || 'Datos'}: ${issue.message}`)
      .join(' · ');
  } else if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
    status = error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status < 500) message = error.message;
  }
  if (status === 500)
    console.error(
      '[FARO] Falló una operación del servidor.',
      error instanceof Error ? error.name : 'UnknownError',
    );
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function apiOperation(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    return errorResponse(error);
  }
}
