import {
  apiErrorSchema,
  idSchema,
  okResponseSchema,
  waterEntryInputSchema,
  waterEntrySchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { WaterService } from '../water/service.js';

export interface WaterRouteOptions {
  water: WaterService;
}

const idParams = z.object({ id: z.coerce.number().pipe(idSchema) });

export async function waterRoutes(app: FastifyInstance, options: WaterRouteOptions): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { water } = options;

  r.post(
    '/water',
    {
      schema: {
        body: waterEntryInputSchema,
        response: { 201: waterEntrySchema, 400: apiErrorSchema },
      },
    },
    async (request, reply) => reply.status(201).send(water.add(request.body)),
  );

  r.delete(
    '/water/:id',
    { schema: { params: idParams, response: { 200: okResponseSchema, 404: apiErrorSchema } } },
    async (request) => {
      water.remove(request.params.id);
      return { ok: true as const };
    },
  );
}
