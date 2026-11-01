# Plate

A personal diet ledger you run yourself: log what you eat, track calories and macros against a goal, watch your weight trend. One Docker container, one SQLite file, phone-first PWA with a full desktop layout.

Plan and design: [REQUIREMENTS.md](REQUIREMENTS.md) · [DESIGN.md](DESIGN.md) · [TECH.md](TECH.md) · [DECISIONS.md](DECISIONS.md)

## Run it (Docker, e.g. on a Raspberry Pi 5)

```sh
git clone <this repo> plate && cd plate/docker
cp .env.example .env            # edit APP_INITIAL_PASSWORD etc.
docker compose up -d --build    # builds for the host's architecture (arm64 on the Pi)
curl -i http://127.0.0.1:8080/api/health
```

Open `http://127.0.0.1:8080`, sign in with the initial password, then **change it in More → Security**.

Data lives in `docker/data/plate.db`. Back it up by copying the directory while the container is stopped, or use the in-app export (later phase).

### Reaching it from your phone

By default the app is published on `127.0.0.1` only. Pick one:

1. **Reverse proxy with HTTPS (recommended).** Uncomment the `caddy` service in `docker-compose.yml`, set `PLATE_DOMAIN`, set `TRUST_PROXY=true`, delete the `ports:` block on `plate`, and forward 80/443 to the Pi. HTTPS is also what makes the home-screen install (PWA) work.
2. **Plain HTTP on your network.** Set `PLATE_BIND=0.0.0.0` in `.env`. Every device that can reach the Pi can reach the login page; the password is sent over plain HTTP, and the browser will not offer "Add to Home Screen" as an app.

### Forgot the password

```sh
# set APP_INITIAL_PASSWORD in .env to the password you want, then:
docker compose run --rm plate node /app/dist/cli.js reset-password
```

This overwrites the stored password and signs out every device.

## Develop

Requirements: Node 24, pnpm 11.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm dev                 # API on http://127.0.0.1:8080, web on http://127.0.0.1:5173 (proxies /api)
pnpm check               # typecheck + lint + format check + tests
```

Layout: `apps/api` (Fastify + SQLite), `apps/web` (React PWA), `packages/shared` (zod schemas and pure calculations shared by both).

Database changes: edit `apps/api/src/db/schema.ts`, then `pnpm --filter @plate/api db:generate` and give the new file in `apps/api/drizzle/` a descriptive name (update `meta/_journal.json` to match). Migrations run automatically on startup.
