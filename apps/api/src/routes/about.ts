import { aboutResponseSchema } from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BackupService } from '../backup/service.js';

export interface AboutRouteOptions {
  backup: BackupService;
}

/** More → About (FR-S6). Behind the session guard, unlike `/health`, because it describes the data. */
export async function aboutRoutes(app: FastifyInstance, options: AboutRouteOptions): Promise<void> {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/about', { schema: { response: { 200: aboutResponseSchema } } }, async () =>
      options.backup.stats(),
    );
}
