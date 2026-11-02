import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': a new build is installed only after the user accepts the "update available"
      // toast (src/pwa/register.ts), never under their feet mid-edit.
      registerType: 'prompt',
      // Our own worker (src/sw.ts): the same precache + navigation fallback the generated one
      // had, plus the Web Push handlers for reminders (D176). The plugin injects the precache
      // manifest and builds the worker with its own Vite build (no app plugins, no aliases).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Plate',
        short_name: 'Plate',
        description: 'Your personal diet ledger.',
        start_url: '/today',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#f97316',
        background_color: '#0b0b0f',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        // The shell is precached; every /api call goes to the network (see src/sw.ts).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The worker is served as one classic script; the ES module flag is not needed.
        rollupFormat: 'iife',
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Loopback only; the API is reached through this proxy so cookies stay same-origin in dev.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } },
  },
  preview: { host: '127.0.0.1', port: 4173 },
  build: {
    sourcemap: false,
    target: 'es2022',
    // The vendor floor (react-dom, motion, router, query, zod + shared schemas) is ~720 kB raw in
    // the entry chunk; the gate that matters is the gzip budget on the eager payload, enforced by
    // tools/check-bundle.mjs (pnpm bundle:check).
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
