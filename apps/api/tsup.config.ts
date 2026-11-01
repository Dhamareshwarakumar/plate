import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: { server: 'src/server.ts', cli: 'src/cli.ts' },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Workspace packages are bundled so the runtime image only needs node_modules for real deps.
  noExternal: ['@plate/shared'],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
