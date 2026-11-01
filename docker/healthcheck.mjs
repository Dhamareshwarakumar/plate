// Exit 0 when the API answers /api/health with ok=true; anything else fails the container healthcheck.
const port = process.env.PORT ?? '8080';
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 4000);
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
  const body = await res.json();
  process.exit(res.ok && body?.ok === true ? 0 : 1);
} catch {
  process.exit(1);
} finally {
  clearTimeout(timer);
}
