import { aboutResponseSchema, type AiAbout } from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BackupService } from '../backup/service.js';

export interface AboutRouteOptions {
  backup: BackupService;
  /** `OFF_LOOKUP_ENABLED`; the web hides "Search online" when false. */
  offEnabled: boolean;
  /** AI assistance (Phase 11): enabled flag, provider and model; the web hides every AI entry point when disabled. */
  ai: AiAbout;
}

/** More → About (FR-S6). Behind the session guard, unlike `/health`, because it describes the data. */
export async function aboutRoutes(app: FastifyInstance, options: AboutRouteOptions): Promise<void> {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/about', { schema: { response: { 200: aboutResponseSchema } } }, async () => ({
      ...options.backup.stats(),
      offEnabled: options.offEnabled,
      ai: options.ai,
    }));
}
