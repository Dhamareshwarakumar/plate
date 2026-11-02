import {
  apiErrorSchema,
  idSchema,
  okResponseSchema,
  pushSendResultSchema,
  pushSubscribeRequestSchema,
  pushSubscriptionInfoSchema,
  pushTestRequestSchema,
  reminderKeys,
  vapidPublicKeyResponseSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PushService } from '../push/service.js';

export interface PushRouteOptions {
  push: PushService;
}

const idParams = z.object({ id: z.coerce.number().pipe(idSchema) });
/** A test message is only useful right away. */
const TEST_TTL_SECONDS = 60;

/** Device enrolment for Web Push reminders (FR-N2) and the test notification. */
export async function pushRoutes(app: FastifyInstance, options: PushRouteOptions): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { push } = options;

  r.get(
    '/push/vapid-public-key',
    { schema: { response: { 200: vapidPublicKeyResponseSchema } } },
    async () => ({ publicKey: push.publicKey() }),
  );

  r.get(
    '/push/subscriptions',
    { schema: { response: { 200: z.array(pushSubscriptionInfoSchema) } } },
    async () => push.list(),
  );

  r.post(
    '/push/subscriptions',
    {
      schema: {
        body: pushSubscribeRequestSchema,
        response: { 201: pushSubscriptionInfoSchema, 400: apiErrorSchema },
      },
    },
    async (request, reply) => reply.status(201).send(push.subscribe(request.body)),
  );

  r.delete(
    '/push/subscriptions/:id',
    { schema: { params: idParams, response: { 200: okResponseSchema, 404: apiErrorSchema } } },
    async (request) => {
      push.remove(request.params.id);
      return { ok: true as const };
    },
  );

  r.post(
    '/push/test',
    {
      schema: {
        // Optional body (`curl -X POST` sends none; Fastify then passes null).
        body: pushTestRequestSchema.nullish(),
        response: { 200: pushSendResultSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request) => {
      const endpoint = request.body?.endpoint;
      return push.send(
        {
          title: 'Test notification',
          body: 'Reminders are working on this device.',
          tag: reminderKeys.test,
          url: '/more/reminders',
        },
        endpoint === undefined
          ? { ttlSeconds: TEST_TTL_SECONDS }
          : { ttlSeconds: TEST_TTL_SECONDS, endpoint },
      );
    },
  );
}
