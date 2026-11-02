// Bundle budget gate: node tools/check-bundle.mjs apps/web/dist
// Sums the gzip size of the JavaScript the browser must download before the shell can render:
// the module entry script plus every <link rel="modulepreload"> in dist/index.html. Lazy route
// chunks are excluded by construction. Fails when the total exceeds BUNDLE_BUDGET_BYTES
// (default 250,000 bytes, Vite's "kB" unit) or when no entry script is found.
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const distDir = resolve(process.argv[2] ?? 'apps/web/dist');
const budget = Number(process.env.BUNDLE_BUDGET_BYTES ?? 250_000);

let html;
try {
  html = readFileSync(join(distDir, 'index.html'), 'utf8');
} catch {
  console.error(`check-bundle: ${join(distDir, 'index.html')} not found; build the web app first.`);
  process.exit(1);
}

const entry = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map(
  (m) => m[1],
);
if (entry.length === 0) {
  console.error('check-bundle: no <script type="module"> entry found in index.html');
  process.exit(1);
}

const kb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;
const rows = [...entry.map((f) => [f, 'entry']), ...preloads.map((f) => [f, 'modulepreload'])].map(
  ([file, kind]) => {
    const path = join(distDir, file.replace(/^\//, ''));
    const raw = statSync(path).size;
    const gzip = gzipSync(readFileSync(path)).length;
    return { file, kind, raw, gzip };
  },
);
const total = rows.reduce((sum, r) => sum + r.gzip, 0);

const width = Math.max(...rows.map((r) => r.file.length));
console.log('Eager JavaScript payload (gzip):');
for (const r of rows) {
  console.log(
    `  ${r.file.padEnd(width)}  ${r.kind.padEnd(13)}  ${kb(r.raw).padStart(10)} raw  ${kb(r.gzip).padStart(10)} gzip`,
  );
}
console.log(
  `  total ${kb(total)} gzip of ${kb(budget)} budget (${((total / budget) * 100).toFixed(0)}%)`,
);

if (total > budget) {
  console.error(
    `check-bundle: eager payload ${kb(total)} exceeds the ${kb(budget)} budget. Move code behind React.lazy or drop a dependency.`,
  );
  process.exit(1);
}
