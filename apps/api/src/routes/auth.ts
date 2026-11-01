import {
  apiErrorSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  okResponseSchema,
  sessionInfoSchema,
} from '@plate/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FailureThrottle } from '../auth/throttle.js';
import { AppError } from '../errors.js';

/** 5 wrong passwords per 15 minutes per client, then a cool-down. Correct passwords never count. */
export const PASSWORD_THROTTLE = { maxFailures: 5, windowMs: 15 * 60 * 1000 } as const;

const changePasswordResponseSchema = okResponseSchema.extend({
  signedOutOtherDevices: z.number().int().nonnegative(),
});

export interface AuthRouteOptions {
  throttle: FailureThrottle;
}

function assertNotThrottled(
  throttle: FailureThrottle,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const retryAfterMs = throttle.retryAfterMs(request.ip);
  if (retryAfterMs > 0) {
    void reply.header('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    throw new AppError(
      429,
      'RATE_LIMITED',
      `Too many incorrect passwords. Try again in ${Math.ceil(retryAfterMs / 60_000)} minute(s).`,
    );
  }
}

/** Public: login. */
export async function publicAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/auth/login',
    {
      schema: {
        body: loginRequestSchema,
        response: { 200: sessionInfoSchema, 401: apiErrorSchema, 429: apiErrorSchema },
      },
    },
    async (request, reply) => {
      assertNotThrottled(options.throttle, request, reply);
      const ok = await app.authService.verify(request.body.password);
      if (!ok) {
        options.throttle.recordFailure(request.ip);
        request.log.info({ ip: request.ip }, 'failed login attempt');
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect password');
      }
      options.throttle.recordSuccess(request.ip);
      const { token, session } = app.sessionStore.create(request.headers['user-agent']);
      app.setSessionCookie(reply, request, token, session.expiresAt);
      return reply.send({
        authenticated: true as const,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        passwordIsInitial: app.authService.isPasswordInitial(),
      });
    },
  );
}

/** Protected: everything that needs a live session. Register inside the guarded scope. */
export async function protectedAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/auth/session',
    { schema: { response: { 200: sessionInfoSchema } } },
    async (request, reply) => {
      const session = request.session!;
      // Refresh the cookie's own expiry alongside the sliding server-side expiry.
      app.setSessionCookie(reply, request, request.sessionToken!, session.expiresAt);
      return reply.send({
        authenticated: true as const,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        passwordIsInitial: app.authService.isPasswordInitial(),
      });
    },
  );

  r.post(
    '/auth/logout',
    { schema: { response: { 200: okResponseSchema } } },
    async (request, reply) => {
      app.sessionStore.revoke(request.session!.id);
      app.clearSessionCookie(reply, request);
      return reply.send({ ok: true as const });
    },
  );

  r.post(
    '/auth/change-password',
    {
      schema: {
        body: changePasswordRequestSchema,
        response: { 200: changePasswordResponseSchema, 400: apiErrorSchema, 429: apiErrorSchema },
      },
    },
    async (request, reply) => {
      assertNotThrottled(options.throttle, request, reply);
      const result = await app.authService.changePassword(
        request.body.currentPassword,
        request.body.newPassword,
        request.session!.id,
      );
      if (!result.changed) {
        options.throttle.recordFailure(request.ip);
        // 400 rather than 401: the caller is signed in; only the typed current password is wrong.
        throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect', [
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }
      options.throttle.recordSuccess(request.ip);
      request.log.info({ signedOutOtherDevices: result.revokedSessions }, 'password changed');
      return reply.send({ ok: true as const, signedOutOtherDevices: result.revokedSessions });
    },
  );
}
