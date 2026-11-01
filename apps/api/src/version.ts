/** Build-time version injected by tsup; falls back to "dev" under tsx/vitest without a define. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
