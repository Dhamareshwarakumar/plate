# AGENTS.md — how to work in this repository

Plate is a self-hosted, single-user diet ledger: Fastify + SQLite API, React PWA, pnpm monorepo.
Read these before changing anything: `REQUIREMENTS.md` (what), `DESIGN.md` (screens and flows),
`TECH.md` (architecture, data model, API, security), `DECISIONS.md` (why), `PHASES.md` (what to build
next and how to know it is done). The user approved these documents; follow them. When they are
silent, choose the option most consistent with DESIGN.md and record the choice in DECISIONS.md.

## Commands

```sh
pnpm install                       # once
pnpm dev                           # API 127.0.0.1:8080 (tsx watch) + web 127.0.0.1:5173 (vite, proxies /api)
pnpm check                         # typecheck + lint + prettier check + all tests. MUST be green before every commit.
pnpm format                        # prettier --write
pnpm --filter @plate/api test      # vitest, in-memory SQLite per test file
pnpm --filter @plate/api db:generate   # drizzle-kit: generate a migration from src/db/schema.ts (see "Migrations")
pnpm --filter @plate/web build     # production build (also runs the PWA plugin)
node tools/shots/<script>.mjs      # Playwright screenshots → /tmp/plate-shots (see tools/shots/README.md)
```

Dev servers may already be running (another session started them): check with
`lsof -nP -iTCP:8080 -sTCP:LISTEN` / `:5173`. Reuse them, they hot-reload on file changes. If you start
your own, run them in the background with logs redirected to `/tmp/plate-api.log` / `/tmp/plate-web.log`.
Dev database: `apps/api/data/plate.db` (git-ignored; safe to delete for a clean start). Bootstrap
password in dev: `password` (`apps/api/.env`).

## Layout

```
packages/shared/src   zod schemas + pure calculation logic, exported from index.ts. Used by API and web.
apps/api/src          config.ts, app.ts (plugin/route registration), server.ts, cli.ts, errors.ts
  db/schema.ts        drizzle tables         db/index.ts  openDb() + migrations
  <domain>/service.ts business logic (class with a Db)   routes/<domain>.ts  Fastify routes (zod-typed)
  auth/               password, sessions, throttle, plugin (requireSession)
apps/api/test         *.test.ts using test/helpers.ts (createTestApp, login)
apps/web/src
  app/                router.tsx, App.tsx, layout/AppShell.tsx (tab bar + sidebar), providers
  features/<domain>/  api.ts (TanStack Query hooks), pages, components
  components/ui/      primitives (see below)   components/  page-header, placeholder-page, brand-mark
  lib/                api.ts (apiRequest/ApiClientError), theme.tsx, search.ts, cn.ts
  styles/globals.css  Tailwind 4 tokens, dark mode class, utilities, keyframes
docker/               Dockerfile, docker-compose.yml, .env.example, healthcheck.mjs, Caddyfile
tools/shots/          screenshot scripts
```

## Conventions that must hold

**Shared schemas first.** Every request/response shape is a zod schema in `packages/shared` with an
inferred type, used by the API for validation/serialization and by the web for parsing. Never duplicate
a shape by hand.

**API.** Routes are thin: validate with `schema: { body, params, querystring, response }` (zod via
`fastify-type-provider-zod`), call a service, return. Services throw `AppError(status, code, message,
details?)` (`apps/api/src/errors.ts`); codes come from `apiErrorCodeSchema` in shared. Validation
errors carry `details: [{ path, message }]`. Register routes in `app.ts` inside the guarded scope
(`requireSession`) unless the route is genuinely public (only health and login are). Literal segments
before params (`/foods/export.csv` before `/foods/:id`). Day keys are `YYYY-MM-DD` strings computed by
the client; timestamps are ISO-8601 strings. Aggregations are done in SQL, not by loading rows into JS.
Diary entries store a per-100 snapshot plus quantity; totals are derived (`value_100 * quantity / 100`).

**Migrations.** Edit `apps/api/src/db/schema.ts`, run `pnpm --filter @plate/api db:generate`, then
rename the generated `NNNN_<random>.sql` to `NNNN_<descriptive>.sql` and change the `tag` in
`drizzle/meta/_journal.json` to match. Avoid commas inside expression indexes (drizzle-kit mangles
them); prefer NOT NULL + default '' over NULL when a unique index needs the column. Migrations run on
startup and in tests; never edit an existing migration that has been committed.

**Tests (API).** Every route gets: anonymous → 401, validation failure → 400 with the right `path`,
happy path, and the domain edge cases listed in PHASES.md. Use `createTestApp()` + `login()` from
`test/helpers.ts`; use `res.json<T>()` not `res.json() as T` (lint). Pure logic in `packages/shared`
gets unit tests next to the file (`*.test.ts`).

**Web.** Data access only through hooks in `features/<domain>/api.ts` built on `apiRequest(path,
{ method, body, schema })`; query keys are small factories (`foodKeys.list(...)`). Mutations invalidate
or set caches; use optimistic updates where DESIGN.md asks for instant feedback (logging an entry, water,
reorder). Forms: react-hook-form + `zodResolver`; numeric inputs are strings in the form (`NumberField` +
`parseDecimal`) and converted at the boundary (see `features/foods/food-form-schema.ts`). Server field
errors map back via `ApiClientError.fieldErrors()`. Toasts via `sonner` (`toast.success/error`).
Destructive actions use `ConfirmDialog`; cheap deletes may use an undo toast instead.

**UI primitives** (`components/ui`): `Button` (variants primary/secondary/outline/ghost/destructive/link,
sizes sm/md/lg/icon/icon-sm, `loading`), `Input`, `PasswordInput`, `NumberField` (+`parseDecimal`),
`Select` (native), `Field` (label + description/error render-prop wiring), `Segmented`, `Chip`, `Tag`,
`Card`/`CardTitle`/`CardDescription`, `Sheet` (bottom sheet on phones, dialog on ≥sm; `title`,
`description`, `footer`, `locked`), `ConfirmDialog`, `Menu`/`MenuItem`/`MenuSeparator`, `Skeleton`,
`Spinner`, `EmptyState`, `ErrorState`. Also `PageHeader`, `PlaceholderPage` (remove usages as phases
land), `BrandMark`. Add new primitives there when a pattern repeats; keep them accessible (Radix
underneath, keyboard operable, aria labels).

**Design tokens** (globals.css, Tailwind 4): colours `bg surface surface-2 surface-3 border
border-strong fg fg-muted fg-faint accent accent-hover accent-soft accent-fg ring overlay`, fixed
`protein carbs fat fiber water on-target under over danger success`; radii `rounded-card`
`rounded-control`; utilities `tabular`, `gutter`/`gutter-lg` (page side padding incl. safe area),
`pb-safe`/`pt-safe`, `scrollbar-none`, animation utilities for sheets/dialogs/menus. Dark mode is the
`.dark` class on `<html>`. Phone-first: 44 px targets, actions in the bottom third, FAB where
DESIGN.md says. Desktop (`lg:`) gets real layouts (sidebar exists; use two-column where DESIGN.md
says). Use container queries (`@container`, `@3xl:`) when a component's layout depends on its own
width (see `FoodRows`). Every screen: skeleton, designed empty state, error state with retry.
Motion: `motion/react` springs; respect reduced motion (globals.css already disables animations).

**Lint rules you will hit.** `react-hooks` v7: no `setState` inside `useEffect` (derive state, use
event handlers, or remount with a `key`); no conditional hooks. `exactOptionalPropertyTypes`: build
option objects conditionally or use `NonNullable<...>`. `no-unnecessary-type-assertion`: use generics
(`res.json<T>()`). Unused vars must start with `_`. Run `pnpm format` before `pnpm check`.

**Security (do not weaken).** All data routes behind `requireSession`; API binds `127.0.0.1` outside
Docker; compose publishes `127.0.0.1` by default; no secrets in the repo; cookies stay
HttpOnly/SameSite=Strict; CSP stays strict (no inline scripts); the only outbound call is the optional
Open Food Facts proxy (Phase 8) behind `OFF_LOOKUP_ENABLED`.

**Git.** Work on `main` in this checkout (no worktrees; phases are sequential). Before committing:
`git status`, then `pnpm check` must exit 0. Conventional commits (`feat(api): …`, `feat(web): …`,
`fix: …`, `docs: …`, `chore: …`), one or a few logical commits per phase. Never commit `.env`,
`apps/api/data`, screenshots.

## Definition of done for any phase

1. Scope in PHASES.md implemented end to end (shared → API with tests → web with states).
2. `pnpm check` exits 0.
3. New/changed screens screenshotted with a `tools/shots/phaseN-*.mjs` script at phone + desktop
   and the PNGs inspected; layout defects fixed (overlaps, clipped text, missing padding, unreadable
   contrast).
4. Manual API smoke with curl for anything not covered by tests.
5. `PlaceholderPage` usage for the phase's screen removed; DESIGN.md flows match what was built;
   deviations and decisions appended to DECISIONS.md.
6. Committed.
