import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkPassword,
  createSession,
  errorResponse,
  HttpError,
  readBody,
  readJSON,
  requireSameOrigin,
  safeNext,
  securityConfig,
  SESSION_SECONDS,
  verifySession,
} from '../src/lib/auth';

const config = {
  password: 'test-password-with-enough-length',
  secret: 'test-signing-secret-with-more-than-thirty-two-characters',
};
const now = Date.parse('2026-11-07T14:00:00Z');

afterEach(() => vi.unstubAllEnvs());

describe('private single-user sessions', () => {
  it('checks the complete password, including length and unicode characters', () => {
    expect(checkPassword(config.password, config)).toBe(true);
    expect(checkPassword(`${config.password}x`, config)).toBe(false);
    expect(checkPassword(config.password.slice(0, -1), config)).toBe(false);
    expect(checkPassword('contraseña🔒', config)).toBe(false);
  });

  it('accepts a signed session only within its lifetime', () => {
    const session = createSession(config, now);
    expect(verifySession(session, config, now)).toBe(true);
    expect(verifySession(session, config, now + SESSION_SECONDS * 1000 - 1)).toBe(true);
    expect(verifySession(session, config, now + SESSION_SECONDS * 1000)).toBe(false);
    expect(verifySession(session, config, now - 60_000)).toBe(false);
  });

  it('rejects altered payloads, signatures, malformed tokens and secret rotation', () => {
    const session = createSession(config, now);
    const [payload, signature] = session.split('.');
    const changed = Buffer.from(JSON.stringify({ v: 1, iat: now, exp: now + 1e12 })).toString(
      'base64url',
    );
    expect(verifySession(`${changed}.${signature}`, config, now)).toBe(false);
    expect(verifySession(`${payload}.${signature?.slice(0, -2)}aa`, config, now)).toBe(false);
    expect(verifySession(`${session}.extra`, config, now)).toBe(false);
    expect(verifySession('not-json.not-a-signature', config, now)).toBe(false);
    expect(verifySession(undefined, config, now)).toBe(false);
    expect(verifySession('x'.repeat(3000), config, now)).toBe(false);
    expect(verifySession(session, { ...config, secret: `${config.secret}new` }, now)).toBe(false);
  });

  it('invalidates existing sessions when the access password changes', () => {
    const session = createSession(config, now);
    expect(
      verifySession(session, { ...config, password: 'a-new-password-for-this-owner' }, now),
    ).toBe(false);
  });

  it('fails closed when credentials are absent or weak', () => {
    vi.stubEnv('FARO_PASSWORD', '');
    vi.stubEnv('FARO_SESSION_SECRET', '');
    expect(() => securityConfig()).toThrow(HttpError);
    vi.stubEnv('FARO_PASSWORD', 'short');
    vi.stubEnv('FARO_SESSION_SECRET', config.secret);
    expect(() => securityConfig()).toThrow('FARO_PASSWORD');
    vi.stubEnv('FARO_PASSWORD', config.password);
    vi.stubEnv('FARO_SESSION_SECRET', 'short');
    expect(() => securityConfig()).toThrow('FARO_SESSION_SECRET');
    vi.stubEnv('FARO_SESSION_SECRET', config.secret);
    expect(securityConfig()).toEqual(config);
  });
});

describe('request and redirect protection', () => {
  it('accepts same-origin mutations and rejects missing or foreign origins', () => {
    const request = (origin?: string, site?: string) =>
      new Request('https://faro.example/api/records', {
        method: 'POST',
        headers: {
          ...(origin ? { Origin: origin } : {}),
          ...(site ? { 'Sec-Fetch-Site': site } : {}),
        },
      });
    expect(() => requireSameOrigin(request('https://faro.example', 'same-origin'))).not.toThrow();
    expect(() => requireSameOrigin(request())).toThrow(HttpError);
    expect(() => requireSameOrigin(request('https://other.example'))).toThrow(HttpError);
    expect(() => requireSameOrigin(request('https://faro.example', 'cross-site'))).toThrow(
      HttpError,
    );
    expect(() => requireSameOrigin(request('http://faro.example'))).toThrow(HttpError);
  });

  it('does not trust client-supplied forwarded headers when checking the request origin', () => {
    const spoofed = new Request('https://faro.example/api/settings', {
      method: 'PUT',
      headers: {
        origin: 'https://attacker.example',
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-proto': 'https',
      },
    });
    expect(() => requireSameOrigin(spoofed)).toThrow(HttpError);
    const valid = new Request('https://faro.example/api/settings', {
      method: 'PUT',
      headers: {
        origin: 'https://faro.example',
        'x-forwarded-host': 'attacker.example',
        'x-forwarded-proto': 'http',
      },
    });
    expect(() => requireSameOrigin(valid)).not.toThrow();
  });

  it('keeps return destinations inside the app', () => {
    expect(safeNext('/interests?area=health#one')).toBe('/interests?area=health#one');
    for (const value of [
      'https://other.example',
      '//other.example',
      '/\\other.example',
      '/login',
      '/login?next=x',
      null,
      123,
    ]) {
      expect(safeNext(value)).toBe('/');
    }
  });

  it('validates the JSON content type and rejects malformed or cross-origin JSON', async () => {
    const request = (
      body: string,
      origin = 'https://faro.example',
      contentType = 'application/json',
    ) =>
      new Request('https://faro.example/api/settings', {
        method: 'POST',
        headers: { origin, 'content-type': contentType },
        body,
      });
    await expect(readJSON(request('{"theme":"dark"}'))).resolves.toEqual({ theme: 'dark' });
    await expect(readJSON(request('{broken'))).rejects.toMatchObject({ status: 400 });
    await expect(readJSON(request('{}', 'https://other.example'))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      readJSON(request('{}', 'https://faro.example', 'text/plain')),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('limits streamed bodies even without a content-length header', async () => {
    const request = new Request('https://faro.example/api/data/import', {
      method: 'POST',
      body: '0123456789',
    });
    await expect(readBody(request, 5)).rejects.toMatchObject({ status: 413 });
    const fakeLength = new Request('https://faro.example/api/data/import', {
      method: 'POST',
      headers: { 'content-length': '1000' },
      body: 'x',
    });
    await expect(readBody(fakeLength, 5)).rejects.toMatchObject({ status: 413 });
  });

  it('does not expose internal database or credential errors to the browser', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = errorResponse(new Error('SQL with private-token-super-secret'));
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).not.toContain('private-token');
    expect(response.headers.get('cache-control')).toBe('no-store');
    log.mockRestore();
  });
});
