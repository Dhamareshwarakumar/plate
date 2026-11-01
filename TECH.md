# Plate — Technical Design

## 1. Architecture

```
 phone / laptop browser
        │  HTTPS (reverse proxy you manage) or HTTP on the LAN
        ▼
 ┌───────────────────────────────── Docker container: plate ─────────────────────────────────┐
 │  Node 22 · Fastify                                                                        │
 │   ├── /api/*          JSON API (session-cookie auth, Zod-validated)                       │
 │   ├── /api/off/*      server-side proxy to Open Food Facts (optional, env-gated)          │
 │   └── /*              static React build (PWA), SPA fallback                              │
 │  better-sqlite3 (WAL) ──► /data/plate.db   (bind-mounted volume)                           │
 └───────────────────────────────────────────────────────────────────────────────────────────┘
```

One process, one image, one volume. The API and the UI ship together so there is no CORS and one URL to remember.

### Monorepo layout (pnpm workspaces)

```
plate/
├── apps/
│   ├── api/            Fastify server, Drizzle schema + migrations, services, tests
│   └── web/            React + Vite PWA
├── packages/
│   └── shared/         Zod schemas, TS types, nutrition math, date helpers (used by both)
├── docker/             Dockerfile, docker-compose.yml, .env.example
├── REQUIREMENTS.md  DESIGN.md  DECISIONS.md  TECH.md  README.md
└── package.json  pnpm-workspace.yaml  tsconfig.base.json
```

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 22 LTS | Current LTS; arm64 prebuilt binaries available for every native dependency used. |
| HTTP | Fastify 5 | Fast, schema-first, small footprint on a Pi; plugins for cookies, rate-limit, static, helmet. |
| Validation | Zod (shared) via `fastify-type-provider-zod` | One schema per entity drives API validation, TS types and the UI forms. |
| DB | SQLite via `better-sqlite3`, Drizzle ORM + drizzle-kit migrations | Single file, synchronous and fast, trivial backup, no second container. |
| Frontend | React 18, TypeScript, Vite | Standard; Vite builds are fast and produce a static bundle. |
| Styling | Tailwind CSS + Radix UI primitives (shadcn/ui pattern) | Full visual control for a mobile-first design; accessible primitives for dialogs, sheets, menus, tabs. |
| Motion | Framer Motion | Springs, layout animations, gesture (swipe, drag) support. |
| Charts | Recharts | Composable SVG charts, responsive, good enough for bars/lines/donut; heatmap is hand-built with CSS grid. |
| Data fetching | TanStack Query | Caching, optimistic updates (log → ring animates instantly), retries, invalidation. |
| Routing | React Router 6 | URL-driven screens. |
| Forms | react-hook-form + Zod resolver | Shared schemas validate on the client identically to the server. |
| Dates | date-fns | Tree-shakable, works with plain `YYYY-MM-DD` day keys. |
| Fuzzy search | small in-house scorer (normalize, prefix/substring/typo distance) | Avoids a dependency; the library is a few thousand rows at most and is searched in memory on the client. |
| PWA | `vite-plugin-pwa` (Workbox) | Precache app shell; network-only for `/api`. |
| Tests | Vitest (unit + API integration), Playwright (a few e2e smoke flows) | |
| Lint/format | ESLint + Prettier, strict TS | |

## 3. Data model (SQLite, Drizzle)

All timestamps are ISO-8601 strings with offset. Day keys are `YYYY-MM-DD` **as computed by the client in its own time zone**; the server never derives a day from a timestamp (so a phone in a different zone than the Pi still files food under the right day). Money-free, so REAL is fine for nutrition values.

```
categories        id, name, sort_order, archived_at
meal_slots        id, name, sort_order, window_start_min, window_end_min, archived_at
foods             id, kind ('food'|'dish'), name, brand, category_id→categories, basis ('g'|'ml'),
                  kcal, protein, carbs, fat, fiber, sugar, saturated_fat, sodium_mg      -- per 100 basis
                  cooked_weight_g (dishes), source ('manual'|'off'|'dish'), off_code,
                  archived_at, created_at, updated_at
portions          id, food_id→foods, label, grams, sort_order
dish_ingredients  id, dish_food_id→foods, ingredient_food_id→foods, grams, sort_order
meal_templates    id, name, created_at, updated_at
meal_template_items id, template_id→meal_templates, food_id→foods, grams, sort_order
diary_entries     id, day, slot_id→meal_slots, logged_at, food_id→foods (null = ad-hoc),
                  name_snapshot, quantity, basis, portion_label, portion_count, note,
                  kcal_100, protein_100, carbs_100, fat_100, fiber_100, sugar_100, saturated_fat_100, sodium_mg_100,
                  created_at, updated_at
water_entries     id, day, ml, logged_at
weights           id, day (unique), kg, note, created_at, updated_at
goals             id, effective_from (unique), kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, created_at
profile           id=1, sex, birth_date, height_cm, activity_level
settings          key (pk), value_json          -- tolerance_pct, week_start, off_enabled_override…
auth              id=1, password_hash (argon2id), updated_at
sessions          id (random 256-bit), created_at, last_seen_at, expires_at, user_agent
```

Indexes: `diary_entries(day)`, `diary_entries(food_id)`, `diary_entries(logged_at)`, `water_entries(day)`, `foods(name)`, `goals(effective_from)`.

Design points:
- **Snapshots, not references, for history.** An entry stores the per-100 values and name as they were when logged (FR-D10). Editing the quantity recomputes from the entry's own snapshot. The library can change freely.
- **Entry totals are derived**, never stored: `kcal = kcal_100 * quantity / 100`. SQL aggregates do the same arithmetic, so the day view, insights and exports can never disagree.
- **Goal for a day** = the goal with the greatest `effective_from ≤ day`. Days before the first goal have no goal (shown as "no goal set", excluded from adherence).
- **Dishes are foods** (`kind = 'dish'`) so they appear in search, can have portions and are logged by grams with no special casing. Their per-100 values are written on save from `dish_ingredients` and `cooked_weight_g`.
- **Archiving over deleting.** Foods referenced anywhere are archived; hard delete is allowed only when unreferenced. Meal slots and categories archive the same way.

## 4. Calculations (in `packages/shared`, unit-tested)

- Entry nutrient: `per100 × quantity / 100`. Portion → quantity: `portion.grams × count`.
- Dish per-100 (for each nutrient): `Σ(ingredient_per100 × grams / 100) / cooked_weight_g × 100`.
- Day totals: Σ entries. Remaining: `goal − eaten` (can be negative).
- Macro %: `P×4 / kcal`, `C×4 / kcal`, `F×9 / kcal` (display only).
- Sanity check (FR-F7): `|4P + 4C + 9F − kcal| / kcal > 0.25` → warning.
- Day status: `not_logged` (0 entries) · `no_goal` · `on_target` (|eaten − goal| ≤ tol × goal) · `under` · `over`.
- Adherence % = on_target days ÷ (logged days with a goal) in range.
- Logging streak: consecutive days ending today (or yesterday if today has nothing yet) with ≥ 1 entry. On-target streak: same, requiring `on_target`.
- Weight MA: trailing 7-day mean over available entries (gaps allowed). Rate: least-squares slope of the MA over the last 28 days, ×7 → kg/week. ETA: `(goal − latestMA) / rate` days, only if sign agrees and |rate| ≥ 0.05 kg/week.
- Calculator (FR-G4): Mifflin-St Jeor BMR = `10·kg + 6.25·cm − 5·age + (male ? 5 : −161)`; TDEE = BMR × {1.2, 1.375, 1.55, 1.725, 1.9}; suggestions at TDEE, TDEE − 275, TDEE − 550, TDEE + 275 (7700 kcal per kg). Presets: balanced 30/40/30, high-protein 40/30/30 (P/C/F % of kcal → grams via 4/4/9).
- Rounding: store full precision; display kcal as integers, grams to one decimal.

## 5. API

All routes under `/api`, JSON, Zod-validated request and response, session cookie required except `auth/login` and `health`. Errors are `{ error: { code, message, details? } }` with proper status codes.

| Area | Routes |
|---|---|
| Auth | `POST auth/login` · `POST auth/logout` · `GET auth/session` |
| Foods | `GET foods?query&category&sort&includeArchived` · `POST foods` · `GET/PATCH/DELETE foods/:id` · `POST foods/:id/archive` · `PUT foods/:id/portions` · `GET foods/export.csv` · `POST foods/import` (multipart CSV, `?dryRun=1` for preview) |
| Dishes | `POST dishes` · `PATCH dishes/:id` (ingredients + cooked weight; recomputes) · `POST dishes/:id/recalculate` |
| Meal templates | `GET/POST meal-templates` · `PATCH/DELETE meal-templates/:id` · `POST meal-templates/:id/log { day, slotId, overrides[] }` · `POST meal-templates/from-meal { day, slotId, name }` |
| Diary | `GET diary/:day` → entries grouped by slot, totals, goal, status, water · `POST diary/entries` · `PATCH/DELETE diary/entries/:id` · `POST diary/entries/:id/duplicate` · `POST diary/copy { fromDay, toDay, slotId? }` · `GET diary/recent-foods` · `GET diary/frequent-foods` · `GET diary/export.csv?from&to` |
| Water | `POST water { day, ml }` · `DELETE water/:id` |
| Weights | `GET weights?from&to` · `PUT weights/:day` · `DELETE weights/:day` |
| Goals | `GET goals` · `GET goals/active?day` · `POST goals` · `DELETE goals/:id` · `POST goals/calculate` |
| Insights | `GET insights/daily?from&to` (one row per day: totals, goal, status) · `GET insights/top-foods?from&to` · `GET insights/by-slot?from&to` · `GET insights/weight?from&to` (entries + MA) |
| Config | `GET/PUT settings` · `GET/POST/PATCH meal-slots` · `PUT meal-slots/order` · same for `categories` · `GET/PUT profile` |
| Data | `GET backup.json` · `POST backup/restore` (multipart JSON, `confirm: "REPLACE"`) · `GET backup.sqlite` (uses `VACUUM INTO` for a consistent snapshot) |
| Lookup | `GET off/search?q` · `GET off/product/:code` (404 if disabled) |
| Ops | `GET health` → `{ ok, version, dbOk }` |

Write endpoints are idempotency-safe where it matters (`PUT weights/:day`, `PUT portions`). Large reads are paginated or range-bounded (insights ranges capped at 2 years).

### 5.3 CSV formats

Foods: `name,brand,category,basis,kcal,protein,carbs,fat,fiber,sugar,saturated_fat,sodium_mg,portions` where `portions` is `label=grams;label=grams`. Import matches existing foods by (name, brand) case-insensitively and asks update / skip / create-duplicate per conflict in the preview.

Diary: `day,time,slot,food,brand,quantity,basis,portion,kcal,protein,carbs,fat,fiber,sugar,saturated_fat,sodium_mg,note`.

## 6. Frontend structure

```
apps/web/src/
├── app/            router, providers (query, theme, auth), layout shells (phone tabs / desktop sidebar)
├── features/
│   ├── today/      DayStrip, SummaryCard (rings), MealSection, EntryRow, WaterCard, LogSheet (pick + quantity), EntryEditSheet
│   ├── foods/      FoodList, FoodEditor, PortionsEditor, DishEditor, MealTemplateEditor, OffLookupSheet, CsvImportDialog
│   ├── insights/   RangePicker, StatTiles, CaloriesChart, MacrosChart, CalendarHeatmap, WeightVsIntake, TopFoods, BySlot
│   ├── weight/     WeightSummary, WeightChart, WeightLogSheet, WeightList
│   ├── settings/   GoalEditor + Calculator, SlotsManager, CategoriesManager, Appearance, Profile, DataTools, About
│   └── auth/       LoginPage, session guard
├── components/ui/  Button, Sheet, Dialog, Tabs, Chip, Ring, Bar, Skeleton, Toast, EmptyState, ErrorState, NumberField…
├── lib/            api client (typed from shared), fuzzy search, formatters, theme, keyboard shortcuts, haptics (vibrate API where available)
└── pwa/            manifest, icons, service-worker config
```

- The food library is fetched once and cached (TanStack Query, `staleTime` 5 min, invalidated on edits); search and filtering happen client-side for instant response.
- Logging uses **optimistic updates**: the entry appears and the ring animates before the server confirms; on failure it rolls back with a toast.
- Theme: `class="dark"` on `<html>` driven by `prefers-color-scheme` unless overridden; stored in `localStorage`.
- Day key comes from the device clock via `date-fns` `format(new Date(), 'yyyy-MM-dd')`; `logged_at` is `new Date().toISOString()` plus the device offset, sent together.

## 7. Security and exposure

This section follows the "private by default, authenticate restricted audiences, verify denial before exposing content" policy I'm required to apply to anything that opens a listener.

### 7.1 Authentication (FR-A)

- Single app password whose **argon2id hash is stored in the database** (`auth` table, one row). On startup, if no hash exists, the server seeds it from `APP_INITIAL_PASSWORD_FILE` or `APP_INITIAL_PASSWORD` (your `.env` sets this to `password` to begin with). **The server refuses to start if there is neither a stored hash nor a bootstrap value** (fail closed; there is no "no-auth" mode). Once a hash exists the bootstrap value is ignored, so later edits to `.env` do not silently reset the password.
- Change password: `POST auth/change-password { currentPassword, newPassword }` verifies the current one, stores the new hash and deletes every session except the caller's. New passwords: 8–128 characters. Reset when forgotten: `docker compose exec plate node dist/cli.js reset-password` re-seeds from the bootstrap value and deletes all sessions.
- Login creates a random 256-bit session id stored in `sessions`; cookie `plate_session` is `HttpOnly; SameSite=Strict; Path=/; Secure` (Secure is automatic when the request arrived over HTTPS or `TRUST_PROXY` says so). Sliding 30-day expiry; logout deletes the row.
- Rate limit: 5 login attempts per 15 minutes per IP (`@fastify/rate-limit`), same for change-password; general API limit 300 req/min.
- CSRF: `SameSite=Strict` plus an `Origin`/`Sec-Fetch-Site` check on mutating requests; the API only accepts JSON bodies (no form posts).
- Every `/api` route except `auth/login` and `health` runs the session preHandler. The static shell is served without auth (it contains no data), and the SPA redirects to `/login` when `auth/session` returns 401.

### 7.2 Binds and ports

- Inside the container the server listens on `0.0.0.0:8080` because the container network is the boundary; **the publish is what decides exposure**.
- `docker-compose.yml` publishes `"${PLATE_BIND:-127.0.0.1}:${PLATE_PORT:-8080}:8080"`. The default is loopback-only on the Pi. To reach it from your phone you either put a reverse proxy (Caddy/nginx) in front on the Pi, or set `PLATE_BIND=0.0.0.0` in `.env` knowingly: that makes the app reachable by every device on your LAN (and beyond, if you forward the port on your router), protected only by the app password over plain HTTP. The README states this trade-off and the recommended Caddy setup.
- Local dev: the API binds `127.0.0.1`, Vite dev server binds `127.0.0.1` and proxies `/api`.
- Release gate (Phase 0 acceptance): with the container running and an empty database, `curl` as an anonymous client must return `401` with `WWW-Authenticate: Session` on `/api/diary/<today>` and `/api/foods`, and `200` on `/api/health` and `/`. Only after that denial is observed does any data go in.

### 7.3 HTTPS

PWA installation (service worker, home-screen app) and the `Secure` cookie flag require HTTPS from the phone's point of view, except on `localhost`. Since you manage network access yourself, the compose file includes an optional, commented-out Caddy service that terminates TLS (Let's Encrypt via your static IP and a DNS name, or a local CA) and forwards to `plate:8080` over the compose network with nothing else published. Without HTTPS the app still works over HTTP on the LAN; you lose home-screen install and the cookie is sent in clear on your LAN.

### 7.4 Other hardening

- `@fastify/helmet` headers with a strict CSP (`default-src 'self'`; no inline scripts; images `self data:`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`.
- Body limit 1 MB on JSON, 20 MB on CSV/JSON imports; multipart limited to one file.
- All DB access through Drizzle's parameterized queries; CSV cells are typed and bounded; names capped at 120 chars.
- Open Food Facts proxy: server-side only, 5 s timeout, 60 req/min cap, results cached in memory for 10 min, sends the User-Agent OFF asks for. Disabled by `OFF_LOOKUP_ENABLED=false` (default **true** because you accepted the feature; flip it if you want zero egress).
- Container runs as a non-root user; read-only root filesystem except `/data` and `/tmp`; `no-new-privileges`.
- Logs (pino) never include the password, cookies or request bodies.
- No secrets in the repo: `.env.example` documents variables; `.env` and `data/` are git-ignored.

## 8. Deployment

### 8.1 Image

Multi-stage Dockerfile: `node:22-bookworm-slim` builder (pnpm install, build shared → api → web, prune to production deps) → runtime stage copies `apps/api/dist`, `apps/web/dist`, `node_modules` (with the arm64 `better-sqlite3` binary). Built for `linux/arm64` and `linux/amd64` with `docker buildx`; also buildable directly on the Pi with `docker compose build`.

### 8.2 Compose

```yaml
services:
  plate:
    image: plate:latest          # or build: { context: .., dockerfile: docker/Dockerfile }
    restart: unless-stopped
    ports:
      - "${PLATE_BIND:-127.0.0.1}:${PLATE_PORT:-8080}:8080"
    environment:
      DATABASE_PATH: /data/plate.db
      APP_INITIAL_PASSWORD: ${APP_INITIAL_PASSWORD:?set in .env (used only until the first start)}
      TRUST_PROXY: "false"
      OFF_LOOKUP_ENABLED: "true"
    volumes:
      - ./data:/data
    read_only: true
    tmpfs: [/tmp]
    security_opt: [no-new-privileges:true]
    healthcheck: { test: ["CMD", "node", "healthcheck.js"], interval: 30s, timeout: 5s, retries: 3 }
```

`.env.example` ships with `APP_INITIAL_PASSWORD=password` as you asked; change the password from Settings → Security after the first login. The session-signing material is generated on first start and stored in `/data/session.key` (mode 600) so sessions survive restarts without you managing another secret.

### 8.3 Operations

- Migrations run automatically on startup (drizzle-kit generated SQL, applied in a transaction, logged).
- Backups: in-app JSON export and `backup.sqlite` snapshot; README includes a one-line cron for a nightly `sqlite3 /data/plate.db ".backup /backups/plate-$(date +%F).db"` via `docker compose exec`.
- Upgrade: pull/build new image, `docker compose up -d`; migrations are forward-only and tested against a copy of a real database before release.
- Resource footprint target on the Pi 5: < 150 MB RSS, idle CPU ≈ 0.

## 9. Testing

- `packages/shared`: unit tests for every function in §4 with edge cases (zero quantity, zero kcal, missing optional nutrients, empty ranges, dish with cooked weight 0 rejected, timezone day boundaries).
- `apps/api`: integration tests with an in-memory SQLite per test file, covering each route's happy path, validation failures, auth denial (every protected route returns 401 without a cookie), archive/delete rules, copy-day, goal-by-day resolution, CSV import preview and conflicts, backup round-trip.
- `apps/web`: component tests for the LogSheet quantity math and the fuzzy search; Playwright smoke: login → add food → log 450 g → ring shows the right number → edit → delete → undo.
- CI script `pnpm check` = typecheck + lint + all tests; it runs before every commit per the project's commit policy.

## 10. Build phases and acceptance

Each phase follows infra → backend → frontend → your approval. Nothing starts the next phase until you sign off.

| # | Phase | Delivered | You verify |
|---|---|---|---|
| 0 | Scaffold & gate | Monorepo, shared package, API skeleton with auth + health, web shell (tabs, sidebar, theme, login), Dockerfile + compose, multi-arch build. | `docker compose up` on your Mac; anonymous `curl` gets 401; login works; theme toggles. |
| 1 | Food library | Foods, portions, categories, search/sort/filter, archive/delete rules, CSV import/export. | Add a dozen foods on your phone; import a CSV. |
| 2 | Diary core | Meal slots, log sheet (pick + quantity), day view, edit/delete/undo/duplicate, backdating, ad-hoc entry, recent/frequent. | Log a full day in under a minute; edit yesterday. |
| 3 | Goals & summary | Goals with effective dates, calculator, tolerance, summary card with rings, day status. | Set a goal; ring and colors behave. |
| 4 | Dishes & meals | Dish editor with computed per-100, recalculate, meal templates, save-as-meal, copy meal/day. | Build a dish, log 250 g of it. |
| 5 | Water & weight | Water card and goal; weight log, stats, chart. | Log water and a week of weights. |
| 6 | Insights | All seven insight views, range navigation, click-through to days. | Review a month of data. |
| 7 | Data & settings | Backup/restore, SQLite snapshot, diary CSV, slots/categories managers, profile, about. | Export, wipe, restore; everything is back. |
| 8 | Lookup | Open Food Facts search/barcode prefill, disable switch. | Prefill "oats" from OFF. |
| 9 | Polish | PWA install assets, animation pass, empty/loading/error audit on every screen, desktop pass, accessibility pass, Playwright smoke, Pi deployment runbook in README. | Install to home screen; run on the Pi. |

Rough size: this is a medium-large build; expect it to be delivered over many sessions, one phase at a time.
