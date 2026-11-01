# Plate — Decisions Log

Format: decision · why · alternatives considered · status. "Agreed" = you said so in the interview; "Recommended" = my default you accepted with "take recommended"; "Assumed" = my inference, please confirm.

## Interview round 1

| # | Decision | Why / alternatives | Status |
|---|---|---|---|
| D1 | Full stack: Node API + SQLite + React, Dockerized for a Raspberry Pi 5 (arm64) | You asked for it; multi-arch image also covers amd64 for your Mac. | Agreed |
| D2 | Mobile is primary; desktop gets its own layouts, not a stretched phone view | Your requirement. | Agreed |
| D3 | Single user | Your requirement. | Agreed |
| D4 | All nutrition stored per 100 g / 100 ml; quantity logged in g/ml; portions are shortcuts to grams | Your example (450 g watermelon). Alternative (per-serving storage) rejected: it makes mixed units messy. | Agreed |
| D5 | Library starts empty | Your choice. CSV import exists so you can bulk-load if you want. | Agreed |
| D6 | Recipes supported | Your choice; split into dishes and meal templates (D14). | Agreed |
| D7 | "When" = meal slot and timestamp | Your choice. | Agreed |
| D8 | Backdating and editing past days allowed | Your choice. | Agreed |
| D9 | Recent/frequent foods shown first when logging | You left it to me. | Recommended |
| D10 | Ad-hoc entries allowed, with optional save-to-library | Your choice. | Agreed |
| D11 | Daily calorie + macro goals with progress rings; adherence is the main purpose | Your statement of the main goal. | Agreed |
| D12 | Insights: "everything" → the seven views in FR-I | Your choice; list is mine. Trim later if any is noise. | Agreed (scope mine) |
| D13 | Body weight tracking included | Your choice. | Agreed |
| D14 | Theme follows system with a manual toggle | Your choice. | Agreed |
| D15 | SQLite over Postgres | One file, trivial backup, no second container, light on a Pi; single user means no concurrency pressure. Postgres would only pay off with multiple writers or remote DB access. | Agreed ("SQLite!?") |

## Interview round 2 (recommendations accepted)

| # | Decision | Why / alternatives | Status |
|---|---|---|---|
| D16 | Multi-arch image: linux/arm64 + linux/amd64 | Pi 5 is arm64; amd64 for local runs. armv7 not built. | Agreed |
| D17 | Network access is yours to manage (static IP). Compose publishes to `127.0.0.1` by default; you opt in to a wider bind or put a reverse proxy in front | Private-by-default policy I'm bound to; your "I can manage that myself" is honored by making the bind a one-line `.env` choice and documenting the trade-off. | Agreed + policy |
| D18 | Single app password protects all data endpoints; server refuses to start without one | My recommendation in Q2; also required by the private-by-default policy once anything is reachable from other machines. You confirmed, noting the app will be exposed to the internet. | Agreed |
| D19 | Online-only in v1 (no offline write queue) | Offline sync is a large complexity jump; you reach the Pi when you need it. | Recommended |
| D20 | Nutrient fields: kcal, protein, carbs, fat required; fiber, sugar, saturated fat, sodium optional | Covers labels without making entry tedious. | Recommended |
| D21 | Portion presets per food (0..n) | Makes "2 eggs" one tap while keeping grams canonical. | Recommended |
| D22 | Editable categories with a default list | Filtering and a tidy library. | Recommended |
| D23 | Optional Open Food Facts lookup, proxied by the server, disable-able by env; default on | Saves typing labels. The only outbound call in the app; OFF requires a custom User-Agent, which only a server can set. | Recommended |
| D24 | Food CSV import/export | Bulk edits and a human-readable escape hatch. | Recommended |
| D25 | Two recipe types: dish (cooked weight → per-100 food) and meal template (multi-entry shortcut) | They solve different problems; dishes matter most for home cooking. | Recommended |
| D26 | Dish nutrition recomputed only on save, with an explicit Recalculate | What you cooked doesn't change when you fix a typo in an ingredient later. | Recommended |
| D27 | Meal slots editable with time windows; defaults Breakfast/Lunch/Snacks/Dinner | Slot preselection makes logging faster. | Recommended |
| D28 | Copy yesterday / copy day / duplicate entry | Repetitive diets log in seconds. | Recommended |
| D29 | Water tracking with quick-add buttons | Cheap and commonly wanted. | Recommended |
| D30 | Ad-hoc entry = name + kcal (+ optional macros) with save-to-library toggle | As discussed. | Recommended |
| D31 | No reminders / push notifications in v1 | Needs browser push infrastructure; not worth it yet. | Recommended |
| D32 | Goals in grams (with % shown), effective-from dates | Grams are what labels show; effective dates keep history honest. | Recommended |
| D33 | Adherence = within ± tolerance % of kcal goal, default 10 %, configurable | "Within band" is a healthier target than "under". | Recommended |
| D34 | Calorie calculator (Mifflin-St Jeor) suggests, never applies | Avoids the app silently deciding your intake. | Recommended |
| D35 | Weight only (no other body measurements); metric units everywhere | Keeps v1 focused; imperial is out of scope. | Recommended |
| D36 | Tailwind + Radix (shadcn pattern) + Framer Motion + Recharts instead of Cloudscape | Your Steering.md names Cloudscape, but it targets desktop consoles and is weak on phones. This is an explicit, agreed exception for this project. | Recommended |
| D37 | Node 22 + Fastify + Drizzle + better-sqlite3 + Zod; React 18 + Vite + TanStack Query + React Router; pnpm monorepo; single image serving API + static UI | See TECH.md §2. | Recommended |
| D38 | Process: docs first (these four files), then feature-by-feature with your approval after each; unit + API integration tests; git monorepo here | Your Steering.md workflow. | Recommended |
| D39 | Dates in browser locale, week starts Monday (configurable), day boundaries from the device's time zone | Stated as defaults; nobody objected. | Recommended |

## Decisions made while writing the plan

| # | Decision | Why / alternatives | Status |
|---|---|---|---|
| D40 | Working name "Plate" | Short, food-related. Alternatives: Tally, Fuel, Ledger. Rename any time. | Agreed |
| D41 | Diary entries store a per-100 snapshot and quantity; totals are always derived | Keeps history immutable under library edits while letting quantity edits recompute correctly; SQL and UI share one formula. | Assumed |
| D42 | Dishes are rows in `foods` with `kind='dish'` | No special casing in search, portions, logging or insights. | Assumed |
| D43 | Food search runs client-side on a cached library | Instant feedback; library size is small. Server search exists for completeness. | Assumed |
| D44 | Both a logging streak and an on-target streak | Your stated goal is consistency in logging *and* against the goal; one number would hide the other. | Assumed |
| D45 | Deletes use undo toasts instead of confirmation dialogs; destructive bulk actions (restore, clear meal) confirm | Faster for the frequent case, safe for the rare one. | Assumed |
| D46 | Session key auto-generated into `/data` on first start | One less secret for you to manage; the password remains the only configured secret. | Assumed |
| D47 | Optional Caddy service in compose for HTTPS | PWA install needs HTTPS; you said you manage access, so it is included but commented out. | Assumed |
| D49 | Password hash stored in the database, seeded from `APP_INITIAL_PASSWORD` (`password` to start) on first start, changeable in Settings → Security; `reset-password` CLI for recovery | You asked for `password` initially and an in-app way to change it. Keeping the hash in the DB (not in config) is what makes in-app change possible; the bootstrap value is ignored once a hash exists. | Agreed |
| D48 | Phase order: scaffold+auth → foods → diary → goals → dishes/meals → water/weight → insights → data/settings → lookup → polish | Each phase is usable on its own; auth is in phase 0 so the Pi deployment is never unprotected. | Assumed |

## Open items for you

None. Plan approved on 19 Oct 2025; build started with Phase 0.
