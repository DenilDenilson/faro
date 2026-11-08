import { defineMiddleware } from 'astro:middleware';
import {
  errorResponse,
  HttpError,
  requireSameOrigin,
  securityConfig,
  SESSION_COOKIE,
  verifySession,
} from './lib/auth';

const publicPaths = new Set(['/login', '/api/auth/login', '/_actions/login']);

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname.replace(/\/$/, '') || '/';
  const asset = pathname.startsWith('/_astro/') || pathname === '/favicon.svg';
  let response: Response;
  try {
    if (!asset) {
      const config = securityConfig();
      context.locals.authenticated = verifySession(
        context.cookies.get(SESSION_COOKIE)?.value,
        config,
      );
      if (!['GET', 'HEAD'].includes(context.request.method)) requireSameOrigin(context.request);
      if (!publicPaths.has(pathname) && !context.locals.authenticated) {
        if (pathname.startsWith('/api/') || pathname.startsWith('/_actions/')) {
          throw new HttpError(401, 'La sesión terminó. Inicia sesión de nuevo.');
        }
        return context.redirect(
          `/login?next=${encodeURIComponent(context.url.pathname + context.url.search)}`,
          303,
        );
      }
    }
    response = await next();
  } catch (error) {
    if (pathname.startsWith('/api/') || pathname.startsWith('/_actions/'))
      return errorResponse(error);
    const message =
      error instanceof HttpError && error.status === 503
        ? error.message
        : 'No se pudo abrir FARO. Revisa la configuración del servidor.';
    response = new Response(
      `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FARO · Configuración pendiente</title><body style="font-family:system-ui;max-width:38rem;margin:15vh auto;padding:2rem;background:#101715;color:#edf5ef"><h1>FARO</h1><h2>Configuración pendiente</h2><p>${message}</p><p>El acceso permanece cerrado hasta completar la configuración privada.</p></body></html>`,
      {
        status: error instanceof HttpError ? error.status : 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'same-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return response;
});
