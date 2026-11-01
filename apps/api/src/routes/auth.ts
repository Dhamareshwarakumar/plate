import {
  apiErrorSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  okResponseSchema,
  sessionInfoSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors.js';

/** 5 attempts per 15 minutes per client: brute force is pointless, typos are forgiven. */
export const LOGIN_RATE_LIMIT = { max: 5, timeWindow: '15 minutes' } as const;

const changePasswordResponseSchema = okResponseSchema.extend({
  signedOutOtherDevices: z.number().int().nonnegative(),
});

/** Public: login. */
export async function publicAuthRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/auth/login',
    {
      schema: {
        body: loginRequestSchema,
        response: { 200: sessionInfoSchema, 401: apiErrorSchema },
      },
      config: { rateLimit: LOGIN_RATE_LIMIT },
    },
    async (request, reply) => {
      const ok = await app.authService.verify(request.body.password);
      if (!ok) {
        request.log.info({ ip: request.ip }, 'failed login attempt');
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect password');
      }
      const { token, session } = app.sessionStore.create(request.headers['user-agent']);
      app.setSessionCookie(reply, request, token, session.expiresAt);
      return reply.send({
        authenticated: true as const,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      });
    },
  );
}

/** Protected: everything that needs a live session. Register inside the guarded scope. */
export async function protectedAuthRoutes(app: FastifyInstance): Promise<void> {
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
        response: { 200: changePasswordResponseSchema, 400: apiErrorSchema },
      },
      config: { rateLimit: LOGIN_RATE_LIMIT },
    },
    async (request, reply) => {
      const result = await app.authService.changePassword(
        request.body.currentPassword,
        request.body.newPassword,
        request.session!.id,
      );
      if (!result.changed) {
        // 400 rather than 401: the caller is signed in; only the typed current password is wrong.
        throw new AppError(400, 'INVALID_CREDENTIALS', 'Current password is incorrect', [
          { path: 'currentPassword', message: 'Current password is incorrect' },
        ]);
      }
      request.log.info({ signedOutOtherDevices: result.revokedSessions }, 'password changed');
      return reply.send({ ok: true as const, signedOutOtherDevices: result.revokedSessions });
    },
  );
}
