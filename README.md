# Plate

A personal diet ledger you run yourself: log what you eat, track calories and macros against a goal, watch your weight trend. One Docker container, one SQLite file, phone-first PWA with a full desktop layout.

Plan and design: [REQUIREMENTS.md](REQUIREMENTS.md) · [DESIGN.md](DESIGN.md) · [TECH.md](TECH.md) · [DECISIONS.md](DECISIONS.md)

## Run it on a Raspberry Pi 5

Tested layout: Raspberry Pi OS (64-bit, Bookworm), Docker from Docker's own repository, the app in
`~/plate`. The image is Alpine-based and about 315 MB; it builds on the Pi itself in a few minutes
(no compiler toolchain, the native modules ship prebuilt binaries).

1. **Install Docker** (once):

   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER"      # then log out and back in
   docker compose version                # Compose v2 comes with the install
   ```

2. **Clone and configure:**

   ```sh
   git clone <this repo> ~/plate && cd ~/plate/docker
   cp .env.example .env
   nano .env                             # APP_INITIAL_PASSWORD at least; the rest can stay
   ```

3. **Create the data directory** so the container (user `node`, uid 1000) can write to it. Docker
   would otherwise create it as root on first start and SQLite could not open the file:

   ```sh
   mkdir -p data && sudo chown 1000:1000 data
   ```

4. **Build and start:**

   ```sh
   docker compose up -d --build          # builds for the Pi's architecture (arm64)
   docker compose ps                     # wait for "healthy"
   curl -i http://127.0.0.1:8080/api/health
   ```

5. **Sign in** at `http://127.0.0.1:8080` (or through the proxy below) with the initial password,
   then **change it in More → Security**. Your data lives in `docker/data/plate.db` (plus the
   `-wal`/`-shm` files SQLite keeps next to it while running).

### Reaching it from your phone

By default the app is published on `127.0.0.1` only. Pick one:

1. **Reverse proxy with HTTPS (recommended).** Uncomment the `caddy` service in `docker-compose.yml`, set `PLATE_DOMAIN` in `.env` to a DNS name that points at your static IP, set `TRUST_PROXY=true`, delete the `ports:` block on `plate`, forward 80/443 on your router to the Pi, then `docker compose up -d`. Caddy obtains and renews the certificate. HTTPS is also what makes the home-screen install (PWA) work, and it sets the `Secure` flag on the session cookie.
2. **Plain HTTP on your network.** Set `PLATE_BIND=0.0.0.0` in `.env`. Every device that can reach the Pi can reach the login page; the password is sent over plain HTTP, and the browser will not offer "Add to Home Screen" as an app.

### Backups

The database is one file. Take a consistent copy with SQLite's own `.backup` command, which is safe while the app is running (WAL mode allows a concurrent reader):

```sh
sudo apt install sqlite3
mkdir -p ~/plate-backups
crontab -e
```

```cron
# nightly at 03:00, keep 30 days
0 3 * * * sqlite3 /home/pi/plate/docker/data/plate.db ".backup '/home/pi/plate-backups/plate-$(date +\%F).db'"
30 3 * * * find /home/pi/plate-backups -name 'plate-*.db' -mtime +30 -delete
```

Copy `~/plate-backups` somewhere else now and then (another machine, a USB stick). The in-app
exports (More → Data: JSON backup, SQLite snapshot, CSVs) are a second, hand-driven route.

**Restore:** stop the app, replace the file, start again:

```sh
cd ~/plate/docker && docker compose down
rm -f data/plate.db-wal data/plate.db-shm
cp ~/plate-backups/plate-2026-01-31.db data/plate.db && sudo chown 1000:1000 data/plate.db
docker compose up -d
```

### Upgrade

```sh
cd ~/plate/docker
sqlite3 data/plate.db ".backup '/home/pi/plate-backups/pre-upgrade.db'"   # just in case
git pull
docker compose up -d --build
```

Database migrations run automatically on startup. Open the app afterwards: the "A new version of
Plate is available" toast appears on devices that still run the old build; tap **Update**.

### Forgot the password

```sh
# set APP_INITIAL_PASSWORD in .env to the password you want, then:
docker compose run --rm plate node /app/dist/cli.js reset-password
```

This overwrites the stored password and signs out every device.

### Building the image elsewhere (multi-arch)

The Pi builds natively with `docker compose up -d --build`. To build on a laptop for both the Pi and
amd64 machines, push a multi-arch image to a registry (a local `docker build` can only hold one
platform) and point `docker-compose.yml` at it:

```sh
docker buildx create --use --name plate-builder          # once
docker buildx build --platform linux/arm64,linux/amd64 \
  -f docker/Dockerfile -t registry.example.com/plate:latest --push .
```

Then on the Pi replace the `build:` block in `docker-compose.yml` with
`image: registry.example.com/plate:latest` and run `docker compose pull && docker compose up -d`.

## Develop

Requirements: Node 24, pnpm 11, Google Chrome (for the e2e and screenshot scripts).

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm dev                 # API on http://127.0.0.1:8080, web on http://127.0.0.1:5173 (proxies /api)
pnpm check               # typecheck + lint + format check + unit/API tests + bundle budget
pnpm e2e                 # Playwright flows against the production build (not part of check)
pnpm bundle:check        # web build + eager JavaScript ≤ 250 kB gzip (also runs inside check)
```

`pnpm e2e` builds shared, API and web, starts `node apps/api/dist/server.js` on a free loopback port
with a temporary SQLite file, and runs `apps/web/e2e` in the installed Chrome (`channel: 'chrome'`),
once as a phone (iPhone 14 viewport) and once as a desktop. `SKIP_BUILD=1 pnpm e2e` reuses the
existing builds; extra arguments go to Playwright (`pnpm e2e -- --grep import`).

`tools/shots/*.mjs` are the visual verification scripts (one per phase); see
[tools/shots/README.md](tools/shots/README.md).

Layout: `apps/api` (Fastify + SQLite), `apps/web` (React PWA; `apps/web/e2e` holds the Playwright tests), `packages/shared` (zod schemas and pure calculations shared by both).

Database changes: edit `apps/api/src/db/schema.ts`, then `pnpm --filter @plate/api db:generate` and give the new file in `apps/api/drizzle/` a descriptive name (update `meta/_journal.json` to match). Migrations run automatically on startup.
