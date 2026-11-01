import {
  apiErrorSchema,
  calculatorResultSchema,
  dayKeySchema,
  goalCalculateInputSchema,
  goalInputSchema,
  goalSchema,
  idSchema,
  okResponseSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { GoalService } from '../goals/service.js';
import type { SettingsService } from '../settings/service.js';

export interface GoalRouteOptions {
  goals: GoalService;
  settings: SettingsService;
}

const idParams = z.object({ id: z.coerce.number().pipe(idSchema) });
const activeQuery = z.object({ day: dayKeySchema });

export async function goalRoutes(app: FastifyInstance, options: GoalRouteOptions): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { goals, settings } = options;

  r.get('/goals', { schema: { response: { 200: z.array(goalSchema) } } }, async () => goals.list());

  // Literal segments first so they win over `/goals/:id`.
  r.get(
    '/goals/active',
    {
      schema: {
        querystring: activeQuery,
        response: { 200: goalSchema.nullable(), 400: apiErrorSchema },
      },
    },
    async (request) => goals.activeFor(request.query.day),
  );

  r.post(
    '/goals/calculate',
    {
      schema: {
        body: goalCalculateInputSchema,
        response: { 200: calculatorResultSchema, 400: apiErrorSchema },
      },
    },
    async (request) => goals.calculate(settings.getProfile(), request.body.weightKg),
  );

  r.post(
    '/goals',
    { schema: { body: goalInputSchema, response: { 201: goalSchema, 400: apiErrorSchema } } },
    async (request, reply) => reply.status(201).send(goals.create(request.body)),
  );

  r.delete(
    '/goals/:id',
    { schema: { params: idParams, response: { 200: okResponseSchema, 404: apiErrorSchema } } },
    async (request) => {
      goals.delete(request.params.id);
      return { ok: true as const };
    },
  );
}
