import type { APIRoute } from 'astro';
import { apiOperation, clearSessionCookie, json, requireSameOrigin } from '../../../lib/auth';

export const prerender = false;
export const POST: APIRoute = (context) =>
  apiOperation(async () => {
    requireSameOrigin(context.request);
    clearSessionCookie(context.cookies);
    return context.request.headers.get('accept')?.includes('application/json')
      ? json({ signedOut: true })
      : context.redirect('/login', 303);
  });
