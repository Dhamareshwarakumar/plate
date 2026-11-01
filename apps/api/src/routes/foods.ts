import {
  apiErrorSchema,
  foodInputSchema,
  foodListQuerySchema,
  foodListSchema,
  foodSchema,
  idSchema,
  importConflictStrategySchema,
  importResultSchema,
  okResponseSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CategoryService } from '../categories/service.js';
import { AppError } from '../errors.js';
import { FoodImporter, foodsToCsv } from '../foods/import-export.js';
import type { FoodService } from '../foods/service.js';

export interface FoodRouteOptions {
  foods: FoodService;
  categories: CategoryService;
}

const idParams = z.object({ id: z.coerce.number().pipe(idSchema) });

const importQuery = z.object({
  dryRun: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
  onConflict: importConflictStrategySchema.default('skip'),
});

const IMPORT_BODY_LIMIT = 20 * 1024 * 1024;

export async function foodRoutes(app: FastifyInstance, options: FoodRouteOptions): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { foods, categories } = options;
  const importer = new FoodImporter(foods, categories);

  r.get(
    '/foods',
    { schema: { querystring: foodListQuerySchema, response: { 200: foodListSchema } } },
    async (request) => foods.list(request.query),
  );

  // Declared before /foods/:id so the literal segment wins over the parameter.
  r.get('/foods/export.csv', async (request, reply) => {
    const { items } = foods.list({ includeArchived: true });
    const csv = foodsToCsv(items, categories.list(true));
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="plate-foods-${stamp}.csv"`)
      .header('Cache-Control', 'no-store')
      .send(csv);
  });

  r.post(
    '/foods/import',
    {
      bodyLimit: IMPORT_BODY_LIMIT,
      schema: {
        querystring: importQuery,
        response: { 200: importResultSchema, 400: apiErrorSchema },
      },
    },
    async (request) => {
      if (typeof request.body !== 'string') {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Send the CSV file as the request body with content-type text/csv',
        );
      }
      return importer.run(request.body, {
        dryRun: request.query.dryRun,
        onConflict: request.query.onConflict,
      });
    },
  );

  r.post(
    '/foods',
    {
      schema: {
        body: foodInputSchema,
        response: { 201: foodSchema, 400: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => reply.status(201).send(foods.create(request.body)),
  );

  r.get(
    '/foods/:id',
    { schema: { params: idParams, response: { 200: foodSchema, 404: apiErrorSchema } } },
    async (request) => foods.get(request.params.id),
  );

  r.put(
    '/foods/:id',
    {
      schema: {
        params: idParams,
        body: foodInputSchema,
        response: {
          200: foodSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request) => foods.update(request.params.id, request.body),
  );

  r.post(
    '/foods/:id/archive',
    { schema: { params: idParams, response: { 200: foodSchema, 404: apiErrorSchema } } },
    async (request) => foods.setArchived(request.params.id, true),
  );

  r.post(
    '/foods/:id/unarchive',
    { schema: { params: idParams, response: { 200: foodSchema, 404: apiErrorSchema } } },
    async (request) => foods.setArchived(request.params.id, false),
  );

  r.delete(
    '/foods/:id',
    {
      schema: {
        params: idParams,
        response: { 200: okResponseSchema, 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request) => {
      foods.delete(request.params.id);
      return { ok: true as const };
    },
  );
}
