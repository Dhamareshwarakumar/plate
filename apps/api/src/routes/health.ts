import { healthResponseSchema } from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type Database from 'better-sqlite3';
import { pingDb } from '../db/index.js';
import { APP_VERSION } from '../version.js';

export interface HealthRouteOptions {
  sqlite: Database.Database;
}

export async function healthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: { response: { 200: healthResponseSchema, 503: healthResponseSchema } },
      config: { rateLimit: false },
    },
    async (_request, reply) => {
      const dbOk = pingDb(options.sqlite);
      const body = { ok: dbOk, version: APP_VERSION, dbOk };
      return reply.status(dbOk ? 200 : 503).send(body);
    },
  );
}
