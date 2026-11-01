import {
  apiErrorSchema,
  dayKeySchema,
  okResponseSchema,
  weightBodySchema,
  weightRangeQuerySchema,
  weightSchema,
  weightStatsSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { WeightService } from '../weights/service.js';

export interface WeightRouteOptions {
  weights: WeightService;
}

const dayParams = z.object({ day: dayKeySchema });

export async function weightRoutes(
  app: FastifyInstance,
  options: WeightRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { weights } = options;

  // Literal segment first so it wins over `/weights/:day`.
  r.get('/weights/stats', { schema: { response: { 200: weightStatsSchema } } }, async () =>
    weights.stats(),
  );

  r.get(
    '/weights',
    {
      schema: {
        querystring: weightRangeQuerySchema,
        response: { 200: z.array(weightSchema), 400: apiErrorSchema },
      },
    },
    async (request) => weights.list(request.query.from, request.query.to),
  );

  // Creates or replaces the day's weigh-in (FR-W1); 200 either way, the row id is stable.
  r.put(
    '/weights/:day',
    {
      schema: {
        params: dayParams,
        body: weightBodySchema,
        response: { 200: weightSchema, 400: apiErrorSchema },
      },
    },
    async (request) => weights.upsert(request.params.day, request.body),
  );

  r.delete(
    '/weights/:day',
    {
      schema: {
        params: dayParams,
        response: { 200: okResponseSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request) => {
      weights.remove(request.params.day);
      return { ok: true as const };
    },
  );
}
