import {
  apiErrorSchema,
  idSchema,
  logTemplateResultSchema,
  logTemplateSchema,
  mealTemplateInputSchema,
  mealTemplateSchema,
  okResponseSchema,
  templateFromMealResultSchema,
  templateFromMealSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { MealTemplateService } from '../mealTemplates/service.js';

export interface MealTemplateRouteOptions {
  mealTemplates: MealTemplateService;
}

const idParams = z.object({ id: z.coerce.number().pipe(idSchema) });

export async function mealTemplateRoutes(
  app: FastifyInstance,
  options: MealTemplateRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { mealTemplates } = options;

  r.get(
    '/meal-templates',
    { schema: { response: { 200: z.array(mealTemplateSchema) } } },
    async () => mealTemplates.list(),
  );

  r.post(
    '/meal-templates',
    {
      schema: {
        body: mealTemplateInputSchema,
        response: { 201: mealTemplateSchema, 400: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => reply.status(201).send(mealTemplates.create(request.body)),
  );

  // Literal segment before `/meal-templates/:id`.
  r.post(
    '/meal-templates/from-meal',
    {
      schema: {
        body: templateFromMealSchema,
        response: { 201: templateFromMealResultSchema, 400: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => reply.status(201).send(mealTemplates.fromMeal(request.body)),
  );

  r.get(
    '/meal-templates/:id',
    { schema: { params: idParams, response: { 200: mealTemplateSchema, 404: apiErrorSchema } } },
    async (request) => mealTemplates.get(request.params.id),
  );

  r.put(
    '/meal-templates/:id',
    {
      schema: {
        params: idParams,
        body: mealTemplateInputSchema,
        response: {
          200: mealTemplateSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request) => mealTemplates.update(request.params.id, request.body),
  );

  r.delete(
    '/meal-templates/:id',
    { schema: { params: idParams, response: { 200: okResponseSchema, 404: apiErrorSchema } } },
    async (request) => {
      mealTemplates.delete(request.params.id);
      return { ok: true as const };
    },
  );

  r.post(
    '/meal-templates/:id/log',
    {
      schema: {
        params: idParams,
        body: logTemplateSchema,
        response: { 201: logTemplateResultSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) =>
      reply.status(201).send(mealTemplates.log(request.params.id, request.body)),
  );
}
