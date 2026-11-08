import { ActionError, defineAction } from 'astro:actions';
import { z } from 'zod';
import { clearLoginAttempts, consumeLoginAttempt } from '../domains/data/service';
import {
  checkPassword,
  requireSameOrigin,
  safeNext,
  securityConfig,
  setSessionCookie,
} from '../lib/auth';

export const server = {
  login: defineAction({
    accept: 'form',
    input: z.object({
      password: z.string().min(1).max(1024),
      next: z.string().max(2048).optional(),
    }),
    handler: async (input, context) => {
      requireSameOrigin(context.request);
      const config = securityConfig();
      const attempt = await consumeLoginAttempt('single-user-login');
      if (!attempt.allowed) {
        throw new ActionError({
          code: 'TOO_MANY_REQUESTS',
          message: `Demasiados intentos. Vuelve a intentarlo en ${Math.max(1, Math.ceil(attempt.retryAfter / 60))} minutos.`,
        });
      }
      if (!checkPassword(input.password, config)) {
        throw new ActionError({ code: 'UNAUTHORIZED', message: 'La contraseña no es correcta.' });
      }
      await clearLoginAttempts('single-user-login');
      setSessionCookie(context.cookies, context.request);
      return { redirectTo: safeNext(input.next) };
    },
  }),
};
