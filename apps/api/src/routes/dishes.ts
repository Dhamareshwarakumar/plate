import { apiErrorSchema, dishInputSchema, dishSchema, idSchema } from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { DishService } from '../dishes/service.js';

export interface DishRouteOptions {
  dishes: DishService;
}

const idParams = z.object({ id: z.coerce.number().pipe(idSchema) });

/**
 * Recipe side of dishes. Listing, archiving and deleting go through `/foods` (a dish is a food
 * with `kind: 'dish'`); these routes carry the ingredients and the recalculation.
 */
export async function dishRoutes(app: FastifyInstance, options: DishRouteOptions): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { dishes } = options;

  r.post(
    '/dishes',
    {
      schema: {
        body: dishInputSchema,
        response: { 201: dishSchema, 400: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => reply.status(201).send(dishes.create(request.body)),
  );

  r.get(
    '/dishes/:id',
    { schema: { params: idParams, response: { 200: dishSchema, 404: apiErrorSchema } } },
    async (request) => dishes.get(request.params.id),
  );

  r.put(
    '/dishes/:id',
    {
      schema: {
        params: idParams,
        body: dishInputSchema,
        response: {
          200: dishSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request) => dishes.update(request.params.id, request.body),
  );

  r.post(
    '/dishes/:id/recalculate',
    {
      schema: {
        params: idParams,
        response: { 200: dishSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request) => dishes.recalculate(request.params.id),
  );
}
