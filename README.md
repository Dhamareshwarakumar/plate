# Plate

A personal diet ledger you run yourself: log what you eat, track calories and macros against a goal, watch your weight trend. One Docker container, one SQLite file, phone-first PWA with a full desktop layout.

Plan and design: [REQUIREMENTS.md](REQUIREMENTS.md) · [DESIGN.md](DESIGN.md) · [TECH.md](TECH.md) · [DECISIONS.md](DECISIONS.md)

## Quick start (Raspberry Pi 5 or any Docker host)

Everything happens in the repository root. You need Docker with Compose v2
(`curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker "$USER"`, then log out and in).

```sh
git clone https://github.com/Dhamareshwarakumar/plate.git
cd plate
cp .env.example .env            # set APP_INITIAL_PASSWORD; set PLATE_BIND=0.0.0.0 to use it from your phone
docker compose up -d --build    # builds for the Pi's own architecture, takes a few minutes the first time
docker compose ps               # wait until plate shows "healthy"
```

Open `http://<pi-address>:8080` (with `PLATE_BIND=0.0.0.0`) or `http://127.0.0.1:8080` on the Pi
itself, sign in with the initial password, then **change it in More → Security**.

What you get: one container, your data in `./data/plate.db` next to this README, the SQLite
`-wal`/`-shm` companions beside it while the app runs. The `data` folder is created on first start
and the container makes it writable for its own non-root user; nothing to `chown` by hand.

The only file you edit is `.env` (`apps/api/.env.example` is for local development, not for Docker).

### Reaching it from your phone

By default the app is published on `127.0.0.1` only. Pick one:

1. **Behind a reverse proxy you already run in Docker** (Nginx Proxy Manager, Traefik, Caddy):
   see the next section. Plate joins the proxy's network and publishes no port at all.
2. **Reverse proxy with the bundled Caddy.** Uncomment the `caddy` service at the bottom of
   `docker-compose.yml`, set `PLATE_DOMAIN` in `.env` to a DNS name that points at your static IP,
   set `TRUST_PROXY=true`, delete the `ports:` block on `plate`, forward 80/443 on your router to
   the Pi, then `docker compose up -d`. Caddy obtains and renews the certificate.
3. **Plain HTTP on your network.** Set `PLATE_BIND=0.0.0.0` in `.env` and `docker compose up -d`.
   Every device that can reach the Pi can reach the login page; the password travels in clear text,
   and the browser will not offer "Add to Home Screen" as an app. Only for a trusted home network.

HTTPS (options 1 and 2) is what makes the home-screen install (PWA) work and sets the `Secure` flag
on the session cookie.

### Barcode scanning

Open the log sheet (**+**) and tap the barcode button next to the search box, or use **Scan barcode**
in the food editor's "Search online" sheet. The browser asks for the camera once; Plate reads EAN-13,
EAN-8, UPC-A and UPC-E, matches the code against your library first (so a product you have scanned
before goes straight to the quantity step) and otherwise fetches it from Open Food Facts through the
same proxy as "Search online". Products Open Food Facts does not know can be created by hand with
the barcode kept, so the next scan finds them. Decoding happens on the phone: Chrome on Android uses
the built-in detector, everything else (iPhone Safari, Firefox, desktop Chrome) downloads a ~400 kB
WebAssembly decoder from your Plate server the first time. The camera needs HTTPS (or `localhost`),
which the deployment already has; if you denied the permission the sheet explains where to turn it
back on for your browser.

### Behind Nginx Proxy Manager (or another proxy container)

The proxy container cannot reach a port bound to the Pi's `127.0.0.1`, so instead of publishing a
port, Plate joins the proxy's Docker network and the proxy talks to it by container name.

1. Find the proxy's network name:

   ```sh
   docker network ls                                   # e.g. npm_default, nginx-proxy-manager_default, proxy
   docker inspect <npm-container> --format '{{range $k,$_ := .NetworkSettings.Networks}}{{$k}} {{end}}'
   ```

2. In `.env`, uncomment and fill in:

   ```ini
   COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml
   PROXY_NETWORK=npm_default        # the name from step 1
   TRUST_PROXY=true                 # required: lets Plate see https and the real client address
   ```

3. `docker compose up -d`. `docker port plate` now prints nothing: the proxy is the only way in.

4. In Nginx Proxy Manager, add a Proxy Host: domain `plate.example.com`, scheme `http`, forward
   hostname `plate`, forward port `8080`, "Block Common Exploits" on. On the SSL tab request a
   Let's Encrypt certificate and enable "Force SSL" and "HTTP/2". Nginx Proxy Manager forwards the
   `Host` and `X-Forwarded-Proto` headers by default, which is all Plate needs.

Why `TRUST_PROXY=true` matters: Plate rejects sign-in requests whose `Origin` does not match the
scheme and host it believes it is serving. Behind a proxy it only learns the real `https://...`
origin from the forwarded headers, and the login throttle keys on the real client address instead of
the proxy's.

### Backups

The database is one file. Take a consistent copy with SQLite's own `.backup` command, which is safe while the app is running (WAL mode allows a concurrent reader):

```sh
sudo apt install sqlite3
mkdir -p ~/plate-backups
crontab -e
```

```cron
# nightly at 03:00, keep 30 days
0 3 * * * sqlite3 /home/pi/plate/data/plate.db ".backup '/home/pi/plate-backups/plate-$(date +\%F).db'"
30 3 * * * find /home/pi/plate-backups -name 'plate-*.db' -mtime +30 -delete
```

Copy `~/plate-backups` somewhere else now and then (another machine, a USB stick). The in-app
exports (More → Data: JSON backup, SQLite snapshot, CSVs) are a second, hand-driven route.

**Restore:** stop the app, replace the file, start again:

```sh
cd ~/plate && docker compose down
rm -f data/plate.db-wal data/plate.db-shm
cp ~/plate-backups/plate-2026-01-31.db data/plate.db
docker compose up -d            # ownership of the restored file is fixed on start
```

### Upgrade

```sh
cd ~/plate
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
