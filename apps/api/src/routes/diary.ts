import {
  apiErrorSchema,
  copyDaySchema,
  copyResultSchema,
  dayKeySchema,
  dayRangeQuerySchema,
  diaryDaySchema,
  diaryDaySummarySchema,
  diaryEntryInputSchema,
  diaryEntryPatchSchema,
  diaryEntrySchema,
  duplicateEntrySchema,
  foodUsageSchema,
  idSchema,
  okResponseSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { diaryToCsv } from '../diary/export.js';
import type { DiaryService } from '../diary/service.js';

export interface DiaryRouteOptions {
  diary: DiaryService;
}

const idParams = z.object({ id: z.coerce.number().pipe(idSchema) });
const dayParams = z.object({ day: dayKeySchema });

export async function diaryRoutes(app: FastifyInstance, options: DiaryRouteOptions): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { diary } = options;

  // Literal segments first so they win over `/diary/:day`.
  r.get(
    '/diary/days',
    {
      schema: {
        querystring: dayRangeQuerySchema,
        response: { 200: z.array(diaryDaySummarySchema), 400: apiErrorSchema },
      },
    },
    async (request) => diary.daysSummary(request.query.from, request.query.to),
  );

  r.get(
    '/diary/recent-foods',
    { schema: { response: { 200: z.array(foodUsageSchema) } } },
    async () => diary.recentFoods(),
  );

  r.get(
    '/diary/frequent-foods',
    { schema: { response: { 200: z.array(foodUsageSchema) } } },
    async () => diary.frequentFoods(),
  );

  r.get(
    '/diary/export.csv',
    { schema: { querystring: dayRangeQuerySchema } },
    async (request, reply) => {
      const { from, to } = request.query;
      const csv = diaryToCsv(diary.exportRows(from, to));
      return reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="plate-diary-${from}_${to}.csv"`)
        .header('Cache-Control', 'no-store')
        .send(csv);
    },
  );

  r.post(
    '/diary/entries',
    {
      schema: {
        body: diaryEntryInputSchema,
        response: { 201: diaryEntrySchema, 400: apiErrorSchema },
      },
    },
    async (request, reply) => reply.status(201).send(diary.addEntry(request.body)),
  );

  r.patch(
    '/diary/entries/:id',
    {
      schema: {
        params: idParams,
        body: diaryEntryPatchSchema,
        response: { 200: diaryEntrySchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request) => diary.patchEntry(request.params.id, request.body),
  );

  r.delete(
    '/diary/entries/:id',
    { schema: { params: idParams, response: { 200: okResponseSchema, 404: apiErrorSchema } } },
    async (request) => {
      diary.deleteEntry(request.params.id);
      return { ok: true as const };
    },
  );

  r.post(
    '/diary/entries/:id/duplicate',
    {
      schema: {
        params: idParams,
        body: duplicateEntrySchema.nullish(),
        response: { 201: diaryEntrySchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) =>
      reply.status(201).send(diary.duplicateEntry(request.params.id, request.body?.loggedAt)),
  );

  r.post(
    '/diary/copy',
    {
      schema: {
        body: copyDaySchema,
        response: { 200: copyResultSchema, 400: apiErrorSchema },
      },
    },
    async (request) => diary.copy(request.body),
  );

  r.get(
    '/diary/:day',
    {
      schema: {
        params: dayParams,
        response: { 200: diaryDaySchema, 400: apiErrorSchema },
      },
    },
    async (request) => diary.getDay(request.params.day),
  );
}
