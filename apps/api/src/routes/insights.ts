import {
  apiErrorSchema,
  bySlotSchema,
  dailyAggregateSchema,
  insightsRangeSchema,
  insightsSummaryQuerySchema,
  insightsSummarySchema,
  topFoodsSchema,
  weightVsIntakePointSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { InsightsService } from '../insights/service.js';

export interface InsightsRouteOptions {
  insights: InsightsService;
}

/** Read-only range aggregations for the Insights screen (FR-I1–I7); every range is capped at 731 days. */
export async function insightsRoutes(
  app: FastifyInstance,
  options: InsightsRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { insights } = options;

  r.get(
    '/insights/daily',
    {
      schema: {
        querystring: insightsRangeSchema,
        response: { 200: z.array(dailyAggregateSchema), 400: apiErrorSchema },
      },
    },
    async (request) => insights.daily(request.query.from, request.query.to),
  );

  r.get(
    '/insights/summary',
    {
      schema: {
        querystring: insightsSummaryQuerySchema,
        response: { 200: insightsSummarySchema, 400: apiErrorSchema },
      },
    },
    async (request) => insights.summary(request.query.from, request.query.to, request.query.today),
  );

  r.get(
    '/insights/top-foods',
    {
      schema: {
        querystring: insightsRangeSchema,
        response: { 200: topFoodsSchema, 400: apiErrorSchema },
      },
    },
    async (request) => insights.topFoods(request.query.from, request.query.to),
  );

  r.get(
    '/insights/by-slot',
    {
      schema: {
        querystring: insightsRangeSchema,
        response: { 200: bySlotSchema, 400: apiErrorSchema },
      },
    },
    async (request) => insights.bySlot(request.query.from, request.query.to),
  );

  r.get(
    '/insights/weight-vs-intake',
    {
      schema: {
        querystring: insightsRangeSchema,
        response: { 200: z.array(weightVsIntakePointSchema), 400: apiErrorSchema },
      },
    },
    async (request) => insights.weightVsIntake(request.query.from, request.query.to),
  );
}
