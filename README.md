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

### Reminders

**More → Reminders** nudges you when a meal is still unlogged at the end of its window, to weigh in
(07:30 by default), and optionally to drink up when you are below the water goal. Turn the master
switch on, set the times (they follow the phone's time zone; the footer says which), then **Enable on
this device** on every phone or computer that should get them. The browser asks for notification
permission once; after that **Send test notification** shows what a reminder looks like, and
**Turn off on this device** (or the bin icon next to a device) stops them there.

- **iPhone and iPad:** notifications only reach Plate when it is installed to the Home Screen
  (Safari → Share → **Add to Home Screen**, iOS 16.4 or newer). Open Plate from that icon, then
  enable reminders. In a Safari tab the page tells you the same.
- **Android (Chrome, Edge, Samsung Internet, Firefox) and desktop browsers** work from the installed
  app or a normal tab.
- The server checks every minute; a reminder goes out once per day, only if its condition still
  holds (nothing logged in that meal, no weigh-in today, below the water goal). Nothing is sent while
  the master switch is off or no device is enabled.

**What leaves the Pi.** Delivery uses your browser's push service (Google for Chrome and friends,
Mozilla for Firefox, Apple for Safari); that is the only way to reach a closed app. For each
reminder the Pi makes one HTTPS request to the endpoint your browser handed over when you enabled
reminders, carrying a short message encrypted to that device (the push service cannot read it) and a
signed token identifying this server. The message is generic ("Dinner not logged yet", "Time to
weigh in", "Below your water goal"); your foods, amounts, weights and goals never leave the Pi.
Together with the Open Food Facts lookup and the opt-in AI assistance below, this is the only
outbound traffic the app makes. `PUSH_VAPID_SUBJECT` (optional, `mailto:` or `https:`) is the
contact the token names; the default `mailto:plate@localhost` works, push services do not write to it.

### AI assistance (optional)

Off by default: without an API key no AI button exists anywhere in the app. With one, Plate gains
three **confirm-first** helpers and a weekly digest. The model proposes, you edit and confirm, and
only then is anything saved.

- **Describe or photograph a meal.** In the log sheet (**+**) tap the sparkles button next to the
  barcode button, then type ("2 rotis, a bowl of dal, one banana"), dictate, or take a photo.
  **Analyse** returns a review list: each line is matched to a food in your library or proposed as a
  new estimated food, with an editable quantity and a confidence pill. Remove what is wrong, fix the
  amounts, **Log N items**. New foods are created tagged "Estimated".
- **Estimate with AI.** In the food editor, next to **Search online**: type a name (and optionally a
  brand or a hint like "restaurant style"), and the model fills nutrition per 100 g/ml plus typical
  portions. The food carries an "Estimated by AI; verify against a label when you can" notice until
  you edit its nutrition.
- **Paste a recipe.** In the dish editor: paste a recipe text, and the model returns a dish name,
  the ingredients matched to your library or proposed as new foods, the cooked weight and the number
  of servings, prefilled in the editor for you to check and save.
- **Weekly digest.** In Insights, with the **Week** range: **Generate** turns the week's numbers into
  three to five plain sentences and one suggestion for next week. The result is kept per week;
  **Regenerate** asks again.

**Get a key.** Open [Google AI Studio](https://aistudio.google.com/apikey), sign in with a Google
account and choose **Create API key**. The key is a long string; keep it like a password. The
[free tier](https://ai.google.dev/gemini-api/docs/pricing) covers light personal use (a small daily
request quota per model); enable billing on the key's Google Cloud project if you hit it.

**Turn it on.** Add to `.env` (the one next to `docker-compose.yml`), then `docker compose up -d`:

```ini
AI_PROVIDER=gemini
AI_API_KEY=<your key>
# AI_MODEL=gemini-3.8-flash   # optional; this is the default
```

**More → AI assistant** then shows the provider and model, the requests made today and over the
last 30 days, and the sparkles buttons appear. All variables:

| Variable             | Default                         | Meaning                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PROVIDER`        | `none`                          | `none` (off), `gemini`, or `openai_compatible`. The server refuses to start if the chosen provider lacks the variables it needs.                                                                                                                                                   |
| `AI_API_KEY`         | —                               | Required for `gemini` and `openai_compatible`. Stays on the server: never sent to the browser, never written to logs.                                                                                                                                                              |
| `AI_MODEL`           | `gemini-3.8-flash` for `gemini` | Model id. Required for `openai_compatible`. Any [Gemini model](https://ai.google.dev/gemini-api/docs/models) id works; a vision model is needed for photos. `gemini-3.5-flash-lite` is the lighter fallback that kept answering while Flash reported "high demand" during testing. |
| `AI_BASE_URL`        | Gemini's own endpoint           | Required for `openai_compatible` (see below). For `gemini`, only to route through a Gemini-compatible proxy.                                                                                                                                                                       |
| `AI_TIMEOUT_MS`      | `60000`                         | How long to wait for an answer (1 000–300 000). A slow answer becomes "The AI provider did not respond within 60 s". Behind a reverse proxy keep it at or below the proxy's read timeout (nginx and Nginx Proxy Manager default to 60 s), or raise that too.                       |
| `AI_MAX_IMAGE_BYTES` | `4194304` (4 MB)                | Largest photo accepted. Phones resize photos to 1280 px JPEG before upload, so a photo is usually 200–500 kB.                                                                                                                                                                      |

**Using Qwen, Kimi or another OpenAI-compatible API instead.** Any service that speaks the OpenAI
`chat/completions` protocol works. Set the base URL and a model id from the provider's model list:

```ini
AI_PROVIDER=openai_compatible
AI_API_KEY=<your key>
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=google/gemini-3.8-flash    # whatever the provider calls the model
```

| Provider                                                                              | `AI_BASE_URL`                                            | Notes                                                                                                                              |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [OpenRouter](https://openrouter.ai/docs/quick-start)                                  | `https://openrouter.ai/api/v1`                           | One key, hundreds of models (Gemini, Qwen, Kimi, GPT…). Model ids look like `google/gemini-3.8-flash`.                             |
| [Alibaba Cloud Model Studio](https://help.aliyun.com/en/model-studio/base-url) (Qwen) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | Singapore endpoint; the page lists the Beijing, US and Hong Kong ones. `qwen3.5-plus` is multimodal; check the current model list. |
| [Moonshot](https://platform.kimi.ai/docs/guide/migrating-from-openai-to-kimi) (Kimi)  | `https://api.moonshot.ai/v1`                             | `kimi-k3` understands images; the [model list](https://platform.kimi.ai/docs/api/list-models) has the current ids.                 |

Plate asks these servers for schema-constrained JSON (`response_format: json_schema`) and falls back
to plain JSON mode when a server rejects that, so most gateways work unchanged. Text-only models
still handle descriptions, estimates, recipes and the digest; only photos need a vision model.

**What it costs.** Plate makes one request per tap, never in the background. Gemini 3.8 Flash on the
paid tier is listed at $0.75 per million input tokens and $3.75 per million output tokens
([pricing](https://ai.google.dev/gemini-api/docs/pricing); introductory rate until 31 December 2026,
after which Google has announced $1.50 / $7.50). A meal description costs roughly 2–5 k input tokens
(the prompt plus the index of your library) and about 500–1 500 output tokens including the model's
reasoning: ≈ $0.003–0.01. A photo adds about 1–2 k input tokens (≈ +$0.001). At ten requests a day,
300 a month, that is about $1–3 per month at the introductory price, $2–6 after it; the free tier
costs nothing within its quota. The usage counter in **More → AI assistant** shows how many requests
you actually make; the request log in the server output includes the token counts.

**Exactly what is sent, and when.** Nothing leaves the Pi until you tap **Analyse**, **Estimate**,
**Parse recipe** or **Generate**; the sheets say which provider and model they talk to.

- Meal parsing sends your text and/or the photo (resized in the browser to at most 1280 px), the
  meal slot's name and the day, and a compact index of your library: for each active food and dish
  its id, name, brand, g/ml basis and kcal per 100 (up to 1 500 rows; beyond that the 300 most
  recently logged plus rows matching words of your text). So the **names of your foods** reach the
  provider with every parse.
- The estimate sends the name, brand and hint you typed. The recipe import sends the pasted text and
  the same food index.
- The weekly digest sends only the numbers Insights already shows for that week: days logged,
  adherence, average kcal and macros, one line per logged day (kcal, protein, carbs, fat, goal,
  status), which weekdays were not logged, average kcal per meal slot, your five most-logged food
  names and the logging streak.
- Never sent: your password, diary entries, notes, weights, goals history, profile, or anything
  from other weeks. The provider's own data-retention terms apply to what is sent; Google's are
  [here](https://ai.google.dev/gemini-api/terms).
- Plate validates every answer against a strict schema, asks once more when it is unusable, and
  rejects the rest with a readable error. All AI routes share a limit of 30 requests per minute.

**Turn it off.** Remove `AI_PROVIDER` from `.env` (or set it to `none`) and `docker compose up -d`.
Every AI button disappears; foods and digests created with it stay.

`AI_PROVIDER=fake` is a **development-only** driver: canned answers, no key, no network. The
screenshot scripts and automated tests use it. Do not use it on the Pi: it "estimates" every food as
the same sambar.

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

AI features in development: set `AI_PROVIDER=fake` in `apps/api/.env` for canned answers without a
key or network access (`tools/shots/phase11-ai.mjs` and the e2e suite start their own API instance
that way). To exercise a real provider, put `AI_PROVIDER=gemini` and `AI_API_KEY` in that same
git-ignored file; the dev server reads it, nothing else does.

Layout: `apps/api` (Fastify + SQLite), `apps/web` (React PWA; `apps/web/e2e` holds the Playwright tests), `packages/shared` (zod schemas and pure calculations shared by both).

Database changes: edit `apps/api/src/db/schema.ts`, then `pnpm --filter @plate/api db:generate` and give the new file in `apps/api/drizzle/` a descriptive name (update `meta/_journal.json` to match). Migrations run automatically on startup.
