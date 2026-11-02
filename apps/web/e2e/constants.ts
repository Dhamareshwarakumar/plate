/**
 * Shared between `playwright.config.ts` (which hands it to the API as `APP_INITIAL_PASSWORD`) and
 * the fixtures. Kept apart from the config so importing it does not run the config's module-level
 * temp-directory setup once per worker.
 */
export const E2E_PASSWORD = 'e2e-password';
