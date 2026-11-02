import { apiErrorSchema, remindersConfigSchema, remindersSchema } from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ReminderService } from '../reminders/service.js';

export interface ReminderRouteOptions {
  reminders: ReminderService;
}

/** Reminder configuration (FR-N1). Device enrolment lives under `push/` (routes/push.ts). */
export async function reminderRoutes(
  app: FastifyInstance,
  options: ReminderRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { reminders } = options;

  r.get('/reminders', { schema: { response: { 200: remindersSchema } } }, async () =>
    reminders.get(),
  );

  r.put(
    '/reminders',
    {
      schema: {
        body: remindersConfigSchema,
        response: { 200: remindersSchema, 400: apiErrorSchema },
      },
    },
    async (request) => reminders.update(request.body),
  );
}
