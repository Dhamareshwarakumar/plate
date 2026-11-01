import {
  apiErrorSchema,
  profileInputSchema,
  profileSchema,
  settingsPatchSchema,
  settingsSchema,
} from '@plate/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { SettingsService } from '../settings/service.js';

export interface SettingsRouteOptions {
  settings: SettingsService;
}

export async function settingsRoutes(
  app: FastifyInstance,
  options: SettingsRouteOptions,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const { settings } = options;

  r.get('/settings', { schema: { response: { 200: settingsSchema } } }, async () => settings.get());

  r.put(
    '/settings',
    {
      schema: { body: settingsPatchSchema, response: { 200: settingsSchema, 400: apiErrorSchema } },
    },
    async (request) => settings.update(request.body),
  );

  // `null` until the profile has been set up; the calculator needs it (FR-G4).
  r.get('/profile', { schema: { response: { 200: profileSchema.nullable() } } }, async () =>
    settings.getProfile(),
  );

  r.put(
    '/profile',
    { schema: { body: profileInputSchema, response: { 200: profileSchema, 400: apiErrorSchema } } },
    async (request) => settings.putProfile(request.body),
  );
}
