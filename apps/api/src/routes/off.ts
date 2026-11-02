import {
  apiErrorSchema,
  offCodeSchema,
  offResultSchema,
  offSearchQuerySchema,
  offSearchResponseSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { OffLookupService } from '../off/service.js';

export interface OffRouteOptions {
  off: OffLookupService;
}

/** Per-route cap on top of the global limit: every call here is a third-party request. */
const OFF_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

/** Open Food Facts proxy (FR-F5). Behind the session guard; 404 on both routes when disabled. */
export async function offRoutes(app: FastifyInstance, options: OffRouteOptions): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { off } = options;

  r.get(
    '/off/search',
    {
      schema: {
        querystring: offSearchQuerySchema,
        response: { 200: offSearchResponseSchema, 404: apiErrorSchema, 502: apiErrorSchema },
      },
      config: { rateLimit: OFF_RATE_LIMIT },
    },
    async (request) => ({ items: await off.search(request.query.q) }),
  );

  r.get(
    '/off/product/:code',
    {
      schema: {
        params: z.object({ code: offCodeSchema }),
        response: { 200: offResultSchema, 404: apiErrorSchema, 502: apiErrorSchema },
      },
      config: { rateLimit: OFF_RATE_LIMIT },
    },
    async (request) => off.product(request.params.code),
  );
}
