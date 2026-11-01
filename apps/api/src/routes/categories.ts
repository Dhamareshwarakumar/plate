import {
  apiErrorSchema,
  categoryInputSchema,
  categorySchema,
  idSchema,
  okResponseSchema,
  reorderSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CategoryService } from '../categories/service.js';

export interface CategoryRouteOptions {
  categories: CategoryService;
}

const idParams = z.object({ id: z.coerce.number().pipe(idSchema) });
const listQuery = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export async function categoryRoutes(
  app: FastifyInstance,
  options: CategoryRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { categories } = options;

  r.get(
    '/categories',
    { schema: { querystring: listQuery, response: { 200: z.array(categorySchema) } } },
    async (request) => categories.list(request.query.includeArchived ?? false),
  );

  r.post(
    '/categories',
    {
      schema: { body: categoryInputSchema, response: { 201: categorySchema, 409: apiErrorSchema } },
    },
    async (request, reply) => reply.status(201).send(categories.create(request.body.name)),
  );

  r.patch(
    '/categories/:id',
    {
      schema: {
        params: idParams,
        body: categoryInputSchema,
        response: { 200: categorySchema, 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request) => categories.rename(request.params.id, request.body.name),
  );

  r.post(
    '/categories/:id/archive',
    { schema: { params: idParams, response: { 200: categorySchema, 404: apiErrorSchema } } },
    async (request) => categories.setArchived(request.params.id, true),
  );

  r.post(
    '/categories/:id/unarchive',
    { schema: { params: idParams, response: { 200: categorySchema, 404: apiErrorSchema } } },
    async (request) => categories.setArchived(request.params.id, false),
  );

  r.delete(
    '/categories/:id',
    {
      schema: {
        params: idParams,
        response: { 200: okResponseSchema, 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request) => {
      categories.delete(request.params.id);
      return { ok: true as const };
    },
  );

  r.put(
    '/categories/order',
    {
      schema: {
        body: reorderSchema,
        response: { 200: z.array(categorySchema), 400: apiErrorSchema },
      },
    },
    async (request) => categories.reorder(request.body.ids),
  );
}
