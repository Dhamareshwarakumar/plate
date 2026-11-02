import {
  aiEstimateFoodRequestSchema,
  aiEstimateFoodResponseSchema,
  aiParseMealRequestSchema,
  aiParseMealResponseSchema,
  aiRecipeRequestSchema,
  aiRecipeResponseSchema,
  aiUsageQuerySchema,
  aiUsageSchema,
  aiWeeklyDigestCachedSchema,
  aiWeeklyDigestQuerySchema,
  aiWeeklyDigestRequestSchema,
  aiWeeklyDigestResponseSchema,
  apiErrorSchema,
} from '@plate/shared';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { imageTooLargeError, type AiMeta, type AiService } from '../ai/service.js';
import { errorHandler, type AppError } from '../errors.js';

export interface AiRouteOptions {
  ai: AiService;
  /** `AI_MAX_IMAGE_BYTES`; sizes the parse-meal body limit. */
  maxImageBytes: number;
}

/**
 * Per-client cap on top of the global limit, shared by every AI route: 30 provider calls a minute
 * in total, because every call here costs money at the provider. One hook with one counter (a
 * `config.rateLimit` per route would give each route its own 30).
 */
const AI_RATE_LIMIT = { max: 30, timeWindow: '1 minute' };

const errorResponses = { 400: apiErrorSchema, 404: apiErrorSchema, 502: apiErrorSchema };

/**
 * What the response carries about the call besides the answer: the model, whether the one retry
 * was needed and how long it took. Nothing secret; lets a curl smoke test judge a live model.
 */
function withMeta(reply: FastifyReply, meta: AiMeta): void {
  void reply
    .header('x-ai-model', meta.model)
    .header('x-ai-retried', meta.retried ? '1' : '0')
    .header('x-ai-duration-ms', String(meta.durationMs));
}

/**
 * AI assistance (Phase 11). Behind the session guard; 404 on every route when `AI_PROVIDER=none`.
 * A meal photo that exceeds the body limit is reported like one that exceeds `AI_MAX_IMAGE_BYTES`
 * (400 at `image`), not as Fastify's 413, so the client has one error to handle.
 */
export async function aiRoutes(app: FastifyInstance, options: AiRouteOptions): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { ai, maxImageBytes } = options;

  // Runs after the session guard (parent hooks first), so anonymous requests never spend budget.
  app.addHook('onRequest', app.rateLimit(AI_RATE_LIMIT));

  // Plugin-scoped: Fastify encapsulation keeps this handler to the AI routes.
  app.setErrorHandler<FastifyError | AppError | Error>((error, request, reply) => {
    if ('code' in error && error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      const mapped = imageTooLargeError(maxImageBytes);
      void reply
        .status(mapped.statusCode)
        .send({ error: { code: mapped.code, message: mapped.message, details: mapped.details } });
      return;
    }
    errorHandler(error, request, reply);
  });

  r.post(
    '/ai/parse-meal',
    {
      // Base64 inflates by 4/3; the rest of the body (text, day, slot) fits in 64 KiB.
      bodyLimit: Math.ceil((maxImageBytes * 4) / 3) + 64 * 1024,
      schema: {
        body: aiParseMealRequestSchema,
        response: { 200: aiParseMealResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { result, meta } = await ai.parseMeal(request.body);
      withMeta(reply, meta);
      return result;
    },
  );

  r.post(
    '/ai/estimate-food',
    {
      schema: {
        body: aiEstimateFoodRequestSchema,
        response: { 200: aiEstimateFoodResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { result, meta } = await ai.estimateFood(request.body);
      withMeta(reply, meta);
      return result;
    },
  );

  r.post(
    '/ai/parse-recipe',
    {
      schema: {
        body: aiRecipeRequestSchema,
        response: { 200: aiRecipeResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { result, meta } = await ai.parseRecipe(request.body);
      withMeta(reply, meta);
      return result;
    },
  );

  r.post(
    '/ai/weekly-digest',
    {
      schema: {
        body: aiWeeklyDigestRequestSchema,
        querystring: aiWeeklyDigestQuerySchema,
        response: { 200: aiWeeklyDigestResponseSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { result, meta } = await ai.weeklyDigest(request.body, request.query.refresh);
      withMeta(reply, meta);
      return result;
    },
  );

  // Cache-only read, so the Insights card can show the digest (or "Generate") without spending a call.
  r.get(
    '/ai/weekly-digest',
    {
      schema: {
        querystring: aiWeeklyDigestRequestSchema,
        response: { 200: aiWeeklyDigestCachedSchema, ...errorResponses },
      },
    },
    async (request) => ({ digest: ai.cachedDigest(request.query.weekStart) }),
  );

  r.get(
    '/ai/usage',
    {
      schema: {
        querystring: aiUsageQuerySchema,
        response: { 200: aiUsageSchema, ...errorResponses },
      },
    },
    async (request) => ai.usage(request.query.dayStart),
  );
}
