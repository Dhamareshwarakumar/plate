import {
  apiErrorSchema,
  idSchema,
  mealSlotInputSchema,
  mealSlotSchema,
  reorderSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { MealSlotService } from '../mealSlots/service.js';

export interface MealSlotRouteOptions {
  mealSlots: MealSlotService;
}

const idParams = z.object({ id: z.coerce.number().pipe(idSchema) });
const listQuery = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export async function mealSlotRoutes(
  app: FastifyInstance,
  options: MealSlotRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { mealSlots } = options;

  r.get(
    '/meal-slots',
    { schema: { querystring: listQuery, response: { 200: z.array(mealSlotSchema) } } },
    async (request) => mealSlots.list(request.query.includeArchived ?? false),
  );

  r.post(
    '/meal-slots',
    {
      schema: {
        body: mealSlotInputSchema,
        response: { 201: mealSlotSchema, 400: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => reply.status(201).send(mealSlots.create(request.body)),
  );

  r.patch(
    '/meal-slots/:id',
    {
      schema: {
        params: idParams,
        body: mealSlotInputSchema,
        response: {
          200: mealSlotSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request) => mealSlots.update(request.params.id, request.body),
  );

  r.post(
    '/meal-slots/:id/archive',
    {
      schema: {
        params: idParams,
        response: { 200: mealSlotSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request) => mealSlots.setArchived(request.params.id, true),
  );

  r.post(
    '/meal-slots/:id/unarchive',
    { schema: { params: idParams, response: { 200: mealSlotSchema, 404: apiErrorSchema } } },
    async (request) => mealSlots.setArchived(request.params.id, false),
  );

  r.put(
    '/meal-slots/order',
    {
      schema: {
        body: reorderSchema,
        response: { 200: z.array(mealSlotSchema), 400: apiErrorSchema },
      },
    },
    async (request) => mealSlots.reorder(request.body.ids),
  );
}
