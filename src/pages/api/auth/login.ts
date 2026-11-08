import type { APIRoute } from 'astro';
import { clearLoginAttempts, consumeLoginAttempt } from '../../../domains/data/service';
import {
  apiOperation,
  checkPassword,
  HttpError,
  json,
  readBody,
  readJSON,
  requireSameOrigin,
  safeNext,
  securityConfig,
  setSessionCookie,
} from '../../../lib/auth';

export const prerender = false;
export const POST: APIRoute = (context) =>
  apiOperation(async () => {
    requireSameOrigin(context.request);
    const contentType = context.request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    const isJSON = contentType === 'application/json';
    let password: unknown;
    let next: unknown;
    if (isJSON) {
      const input = await readJSON(context.request, 8192);
      if (!input || typeof input !== 'object')
        throw new HttpError(400, 'Faltan los datos de acceso.');
      password = (input as Record<string, unknown>).password;
      next = (input as Record<string, unknown>).next;
    } else {
      if (contentType !== 'application/x-www-form-urlencoded') {
        throw new HttpError(415, 'Formato de acceso no admitido.');
      }
      const form = new URLSearchParams(await readBody(context.request, 8192));
      password = form.get('password');
      next = form.get('next');
    }
    if (typeof password !== 'string' || !password || password.length > 1024)
      throw new HttpError(400, 'Introduce una contraseña válida.');
    const config = securityConfig();
    const attempt = await consumeLoginAttempt('single-user-login');
    if (!attempt.allowed) {
      if (!isJSON) return context.redirect('/login?error=rate', 303);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Demasiados intentos. Espera antes de volver a intentarlo.',
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Retry-After': String(attempt.retryAfter),
          },
        },
      );
    }
    if (!checkPassword(password, config)) {
      if (!isJSON)
        return context.redirect(
          `/login?error=password&next=${encodeURIComponent(safeNext(next))}`,
          303,
        );
      throw new HttpError(401, 'La contraseña no es correcta.');
    }
    await clearLoginAttempts('single-user-login');
    setSessionCookie(context.cookies, context.request);
    return isJSON ? json({ redirectTo: safeNext(next) }) : context.redirect(safeNext(next), 303);
  });
