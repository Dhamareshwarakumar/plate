# PHASES.md — build plan for the remaining phases

Phases 0 (scaffold, auth, shell, Docker) and 1 (food library, categories, CSV) are done and committed.
Phases below run **strictly in order**; each depends on the previous one. Requirement IDs refer to
REQUIREMENTS.md, screen descriptions to DESIGN.md, data model/API to TECH.md §3–§5. AGENTS.md holds
the conventions and the definition of done. Where this file and TECH.md disagree, this file wins (it is
newer); record the deviation in DECISIONS.md.

Already-decided details that are not in the older docs:

- Brand is stored as `''` (not NULL) and (name, brand) is unique case-insensitively (migration 0001).
- `FoodService.countReferences(id)` currently returns 0; **Phase 2 must make it count diary entries,
  Phase 4 must add dish ingredients and meal-template items.** Delete stays refused (409) when > 0.
- `foods.kind` already exists (`'food' | 'dish'`); `FoodService.update` already rejects dishes.
- `sessionInfoSchema.passwordIsInitial` + `InitialPasswordBanner` exist; keep the banner at the top of
  Today.
- `settings` table exists (`key`, `value_json`, `updated_at`); use it for tolerance, week start, etc.
- Current placeholders to replace: `features/today/TodayPage.tsx` (Phase 2/3), Dishes/Meals tabs inside
  `features/foods/FoodsPage.tsx` (Phase 4), `features/weight/WeightPage.tsx` (Phase 5),
  `features/insights/InsightsPage.tsx` (Phase 6). Delete `components/placeholder-page.tsx` once unused.

---

## Phase 2 — Diary core (FR-D1–D8, D10; DESIGN §2, §3)

### Shared

- `mealSlots.ts`: `mealSlotSchema { id, name, sortOrder, windowStartMin, windowEndMin, archivedAt }`,
  `mealSlotInputSchema { name 1–40, windowStartMin 0–1439, windowEndMin 0–1439 }` (a window may wrap
  past midnight, e.g. 22:00–02:00), `DEFAULT_MEAL_SLOTS` = Breakfast 05:00–10:30, Lunch 10:30–14:30,
  Snacks 14:30–17:30, Dinner 17:30–22:00 (the gap 22:00–05:00 resolves to the nearest slot by distance),
  `pickSlotForTime(slots, minutesSinceMidnight)` with unit tests (inside window, wrap-around, gap, all
  archived → first active).
- `diary.ts`: `dayKeySchema` (`/^\d{4}-\d{2}-\d{2}$/` and a real calendar date), `diaryEntryInputSchema
{ day, slotId, loggedAt (ISO), foodId | null, name (required when foodId is null), quantity > 0 ≤
100000, basis 'g'|'ml', portionLabel?, portionCount?, note ≤ 280, per100? (required for ad-hoc,
ignored when foodId is set) }`, `diaryEntrySchema` (stored shape incl. `per100` snapshot and derived
  `totals: Nutrients`), `diaryEntryPatchSchema` (quantity, portionLabel/Count, slotId, loggedAt, day,
  note), `diaryDaySchema { day, slots: [{ slot, entries[], totals }], totals, goal: null (Phase 3 fills),
status: 'not_logged' | 'no_goal' | ... (Phase 3), water: { ml: 0 } (Phase 5) }` — define the fields
  now with Phase-3/5 values as nullable so the shape does not churn.
- `copyDaySchema { fromDay, toDay, slotId?: number (copy one meal) , targetSlotId? }`.
- `entryTotals(per100, quantity)` = `scaleNutrients`; `dayTotals(entries)` = `sumNutrients`. Tests.

### API

- Tables: `meal_slots(id, name, sort_order, window_start_min, window_end_min, archived_at)`,
  `diary_entries(id, day, slot_id→meal_slots, logged_at, food_id→foods nullable, name_snapshot,
quantity, basis, portion_label, portion_count, note, kcal_100, protein_100, carbs_100, fat_100,
fiber_100, sugar_100, saturated_fat_100, sodium_mg_100, created_at, updated_at)` with indexes on
  `day`, `food_id`, `(day, slot_id)`. Migration `0002_meal_slots_diary`.
- `MealSlotService`: seed defaults once (settings flag like categories), list/create/rename+window/
  archive/unarchive/reorder; archiving the last active slot is refused (400).
- `DiaryService`: `getDay(day)` grouped by active slots in order (plus any archived slot that still
  has entries that day, listed last), totals per slot and day computed in SQL; `addEntry` (snapshots
  per-100 and name from the food; for ad-hoc uses the provided per100/name; portion → quantity =
  portion.amount × count when `portionLabel` matches a food portion, otherwise quantity is taken as
  given); `patchEntry` (recomputes nothing but quantity-dependent totals; snapshot stays);
  `deleteEntry`; `duplicateEntry` (same day/slot, loggedAt = now); `copy({ fromDay, toDay, slotId?,
targetSlotId? })` copying snapshots (not re-reading foods) and keeping times; `recentFoods(limit=20)`
  = distinct food ids by latest `logged_at`; `frequentFoods(limit=20, days=60)` = by count.
  `FoodService.countReferences` now counts `diary_entries.food_id`.
- Routes (`routes/mealSlots.ts`, `routes/diary.ts`), all guarded: `GET/POST meal-slots`,
  `PATCH meal-slots/:id`, `POST meal-slots/:id/archive|unarchive`, `PUT meal-slots/order`;
  `GET diary/:day`, `POST diary/entries`, `PATCH diary/entries/:id`, `DELETE diary/entries/:id`,
  `POST diary/entries/:id/duplicate`, `POST diary/copy`, `GET diary/recent-foods`,
  `GET diary/frequent-foods`, `GET diary/export.csv?from&to` (columns per TECH §5.3).
- Tests: everything above, plus: editing a food after logging does not change the entry; patching
  quantity recomputes from the entry snapshot; copying a day twice does not duplicate the source;
  deleting a logged food is refused with 409 while archiving works; invalid day keys (2025-02-30) → 400.

### Web (DESIGN §2 Today, §3 Log flow)

- Route `/today` → redirects to `/today/<todayKey>`; `/today/:day` renders the day. Day key from the
  device clock (`date-fns` `format(new Date(), 'yyyy-MM-dd')`).
- `DayStrip` (7 visible days, swipe/scroll, dot on logged days — fetch a lightweight
  `GET diary/days?from&to` → `[{ day, entryCount, kcal }]` (add this route), calendar jump via native
  `<input type="date">` in a Sheet, "Today" pill when not on today). Keyboard ←/→/T on desktop.
- `SummaryCard` showing totals (kcal + P/C/F) — without goals yet it shows eaten values with "Set a
  goal" link (Phase 3 adds rings).
- `MealSection` per slot: header (name, subtotal, ⋯ menu: Add food, Copy from yesterday, Copy from
  another day…, Copy to another day…, Clear meal (confirm)), entry rows (name · quantity/portion ·
  kcal; second line time · P/C/F), empty slot ghost button, tap → `EntryEditSheet`. Swipe gestures on
  phones (motion drag): left reveals Delete, right Duplicate; on desktop hover shows the icons.
  Delete = optimistic removal + 6 s undo toast (re-POST the snapshot on undo).
- `LogSheet` (FAB and Add buttons): step 1 pick (search with `lib/search.ts`, chips Recent | Frequent
  | All, "Create 'x' as new food" → `/foods/new?name=x&returnTo=/today/<day>`, "Quick ad-hoc entry");
  step 2 quantity (big `NumberField` prefilled with the last-used quantity for that food — remember in
  localStorage per food id, portion chips with a stepper, live totals preview and "day after" line,
  slot select preselected by `pickSlotForTime`, time input (defaults now; when the day is not today,
  default to the middle of the chosen slot window), note). Buttons "Log & add another" and "Log".
  Optimistic insert → ring/summary animates (count-up via `motion`'s `animate`/`useSpring`).
- Ad-hoc: name, kcal, optional P/C/F, quantity label, toggle "Also save to library" (asks for the
  weight when on; creates the food then logs it).
- Empty day state, loading skeleton shaped like the final layout, error state with retry.
- Desktop (`lg:`): two columns — left sticky summary + mini calendar (month grid with dots), right
  meals with hover actions; `N` opens the log sheet, `/` focuses its search.
- Meal-slot manager under More → Library → "Meal slots" (`/more/meal-slots`): same pattern as
  categories (rename, time window with two `<input type="time">`, reorder, archive).
- Screenshots: phone dark (empty day, day with entries, log sheet step 1 and 2, entry edit, swipe
  revealed), desktop light (day with entries, log dialog). Script `tools/shots/phase2-diary.mjs`.

---

## Phase 3 — Goals & day status (FR-G1–G4, FR-O1; DESIGN §2.1 summary card, §7 Goal)

### Shared

- `goals.ts`: `goalInputSchema { effectiveFrom day, kcal 500–10000, proteinG, carbsG, fatG 0–1000,
fiberG?, waterMl? }`, `goalSchema`, `dayStatusSchema = enum not_logged | no_goal | on_target | under
| over`, `computeDayStatus(eatenKcal, goalKcal | null, entryCount, tolerancePct)`,
  `macroTargetsFromPreset(kcal, preset: 'balanced' | 'high_protein' | { p, c, f } %)`,
  `mifflinStJeor({ sex, birthDate, heightCm, weightKg, activity, today })` → `{ bmr, tdee, suggestions:
{ maintain, lose025, lose05, gain025 } }` using 7700 kcal/kg (275 and 550 kcal/day), `caution` when
  < 1200. Settings schema `{ tolerancePct 0–25 (default 10), weekStart 'monday' | 'sunday' }`. Profile
  schema `{ sex 'male' | 'female', birthDate, heightCm 100–250, activity sedentary | light | moderate |
active | very_active }`. Unit tests for all three calculators incl. edge cases (no goal, zero entries,
  exactly on the band edge, leap-day birthday).

### API

- Tables `goals(id, effective_from unique, kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml,
created_at)`, `profile(id=1, sex, birth_date, height_cm, activity)`. Migration `0003_goals_profile`.
- `GoalService`: list, `activeFor(day)` (latest `effective_from ≤ day`), create (upsert on same
  effective_from), delete (cannot delete the only goal if days depend on it? — allowed; days before the
  next goal become `no_goal`), `calculate(profile, weightKg)`.
- Settings routes `GET/PUT settings`, `GET/PUT profile`, `GET goals`, `GET goals/active?day`,
  `POST goals`, `DELETE goals/:id`, `POST goals/calculate { weightKg? }` (weight from Phase 5 later;
  accept it in the body now).
- `GET diary/:day` now fills `goal` (the active goal, or null), `status`, and `remaining`.
- Tests: goal-by-day resolution across several effective dates, status for each branch, tolerance
  from settings, calculator numbers against hand-computed values.

### Web

- `SummaryCard` becomes the ring + bars from DESIGN §2.1: `Ring` component (SVG, animated stroke
  with `motion`, `role="progressbar"`, colour accent/under-goal → on-target green inside the band →
  red over), three macro `Bar`s with hatched overflow past 100 %, chips for fiber/water goals when set.
- More → Goal card + `GoalEditorSheet` (fields, effective-from date, "Calculate for me" expander with
  the profile fields inline, suggestion chips, macro presets filling grams, % shown next to grams),
  Goal history list, Adherence tolerance slider (0–25), week start, Profile section.
- First-run checklist card on Today (FR-O1): set goal / add foods / log a meal, with checkmarks, hidden
  once done or dismissed (localStorage).
- Screenshots `tools/shots/phase3-goals.mjs`: Today with ring under/on/over target, goal editor with
  calculator, first-run checklist.

---

## Phase 4 — Dishes & meal templates (FR-R1–R3; DESIGN §4.3, §4.4, §2.1 "Save as meal")

### Shared

- `dishes.ts`: `dishInputSchema { name, brand?, categoryId?, ingredients: [{ foodId, amount }] (1–50),
cookedWeight > 0, servings?: int ≥ 1 }`, `dishSchema = foodSchema + { ingredients[], cookedWeight,
servings, staleSince: string | null }`; `computeDishPer100(ingredients: [{ per100, amount }],
cookedWeight)` (tests: dal example, cooked weight < raw sum, zero cooked weight rejected).
- `mealTemplates.ts`: `mealTemplateInputSchema { name, items: [{ foodId, amount }] (1–30) }`,
  `mealTemplateSchema` (with each item's current food name/per100 for preview), `logTemplateSchema
{ day, slotId, loggedAt?, overrides?: [{ index, amount }] }`.

### API

- Tables `dish_ingredients(id, dish_food_id→foods cascade, ingredient_food_id→foods, amount,
sort_order)`, `meal_templates(id, name, created_at, updated_at)`, `meal_template_items(id,
template_id cascade, food_id→foods, amount, sort_order)`; add `foods.cooked_weight_g`,
  `foods.servings`, `foods.stale_since` (nullable). Migration `0004_dishes_templates`.
- `DishService`: create/update (recomputes per-100 and writes a `1 serving = cooked/servings g`
  portion when servings set), `recalculate(id)`, and a hook: when a food that is an ingredient is
  updated (`FoodService.update`), set `stale_since = now` on the dishes using it (do not recompute).
  Deleting a food used as an ingredient → 409 (`countReferences`). Dishes appear in `GET foods`
  (kind 'dish') and are logged like foods.
- `MealTemplateService`: CRUD, `log(id, { day, slotId, overrides })` → N diary entries via
  `DiaryService.addEntry`, `fromMeal({ day, slotId, name })` (snapshot the current entries' food ids
  and quantities; ad-hoc entries are skipped with a 400 explaining why if all are ad-hoc).
- Routes per TECH §5 (Dishes, Meal templates). Tests: per-100 math via API, stale flag set and cleared
  by recalculate, template logging creates the right entries, fromMeal round trip, deletion rules.

### Web

- Foods → Dishes tab: list (same rows; a "Dish" tag, stale banner dot), `DishEditorPage`
  (`/foods/dishes/new`, `/foods/dishes/:id`): ingredient rows with a food picker (reuse the LogSheet
  pick list as a `FoodPickerSheet`), amount, per-ingredient kcal; raw total; cooked weight; servings;
  live computed per-100 card; "Ingredients changed since last calculation — Recalculate" banner.
- Foods → Meals tab: list, `MealTemplateEditorPage` (`/foods/meals/new`, `/foods/meals/:id`) with items
  and total preview and a "Log now" button that opens the LogSheet in template mode.
- LogSheet: "Dishes" and "Meals" chips; picking a meal shows the review list with editable amounts and
  one "Log N items" button. Meal section ⋯ menu gets "Save as meal template…" (name prompt in a Sheet).
- Screenshots `tools/shots/phase4-recipes.mjs`.

---

## Phase 5 — Water & weight (FR-D9, FR-W1–W3; DESIGN §2.1 water card, §6)

### Shared

- `water.ts`: `waterEntryInputSchema { day, ml 1–5000 }`; `weight.ts`: `weightInputSchema { day, kg
20–400 (one decimal), note? ≤ 120 }`, `weightSchema`, `weightStatsSchema { latest, change7d,
change30d, movingAverage[], ratePerWeek, goalKg?, remaining?, eta? }`; functions `movingAverage7`,
  `weeklyRate(last28DaysOfMA)` (least squares), `projectEta(current, goal, rate)` with tests (gaps in
  data, fewer than 2 points, rate toward/away from goal, |rate| < 0.05 → null).
- Goal gets `goalWeightKg?` and `goalWeightDate?` (extend `goalInputSchema`; migration adds columns).

### API

- Tables `water_entries(id, day, ml, logged_at)` index on day; `weights(id, day unique, kg, note,
created_at, updated_at)`. Migration `0005_water_weights`.
- Routes: `POST water`, `DELETE water/:id` (undo last), `GET weights?from&to`, `PUT weights/:day`
  (replace), `DELETE weights/:day`, `GET weights/stats`. `GET diary/:day` fills `water: { ml,
entries[] }`. `POST goals/calculate` uses the latest weight when `weightKg` is omitted.
- Tests: water sums per day; weight upsert per day; stats on a synthetic series with known slope.

### Web

- Water card on Today (+250, +500, custom amount Sheet, undo last; progress against goal if set).
- Weight page per DESIGN §6: stats block, chart (Recharts: dots + 7-day MA line + goal dashed line,
  range 1M/3M/6M/1Y/All via `Segmented`), entries list (tap → edit sheet, swipe/hover delete), "+ Log"
  sheet (date default today, kg, note; replacing an existing day says so).
- Add `recharts` to apps/web (check the current version on npm; peer with React 19). Charts need an
  adjacent visually-hidden table for accessibility (DESIGN §10) — build a `ChartTable` helper once.
- Screenshots `tools/shots/phase5-water-weight.mjs`.

---

## Phase 6 — Insights (FR-I1–I7; DESIGN §5)

### Shared

- `insights.ts`: `rangeSchema { from, to }` (≤ 731 days), `dailyAggregateSchema { day, entryCount,
totals, goalKcal | null, status }`, `insightsSummarySchema { avgKcal, avgProtein, avgCarbs, avgFat,
daysLogged, daysOnTarget, adherencePct | null, loggingStreak { current, best }, onTargetStreak {
current, best } }`, `computeStreaks(dailyStatuses, today)` and `summarize(daily)` with tests (today
  not yet logged does not break a streak, gaps break, best streak within range).

### API

- `InsightsService` with SQL aggregation: `daily(from, to)` (one row per day in range incl. days with
  no entries), `topFoods(from, to)` (by count and by kcal, top 10 each), `bySlot(from, to)` (avg kcal
  per slot over logged days), `weightVsIntake(from, to)` (weekly avg kcal + weight MA per week).
  Routes `GET insights/daily`, `insights/summary`, `insights/top-foods`, `insights/by-slot`,
  `insights/weight-vs-intake`. Tests on a seeded fortnight with known numbers.

### Web (DESIGN §5)

- Range picker (`Segmented` Week | Month | 3M | Year | Custom) + ‹ › navigation; URL state `?range=&from=`.
- Stat tiles; calories-per-day bar chart with goal line and shaded tolerance band, bars coloured by
  status; macros chart with grams | split toggle (stacked bars / donut); calendar heatmap (CSS grid,
  month view in Week/Month, year view in Year); weight vs intake dual-axis; top foods list with count |
  kcal toggle; by-meal bars. Click a day bar or heatmap cell → `/today/<day>`. Each chart has the
  hidden data table. Desktop: two-column card grid. Empty state when the range has no data; skeletons.
- Screenshots `tools/shots/phase6-insights.mjs` using a seeded month (write a small seeding script
  `tools/seed-demo.mjs` that logs ~30 days of entries + weights through the API; keep it for demos).

---

## Phase 7 — Data & settings (FR-S1–S6; DESIGN §7)

### Shared

- `backup.ts`: `backupSchema { format: 'plate-backup', version: 1, exportedAt, appVersion, data: {
settings, profile, categories, mealSlots, foods, portions, dishIngredients, mealTemplates,
mealTemplateItems, goals, diaryEntries, waterEntries, weights } }` (raw table rows, snake_case keys
  as stored, ids preserved). `restoreRequestSchema { confirm: 'REPLACE' }`.

### API

- `GET backup.json` (streams one JSON document; `Content-Disposition` with date), `POST backup/restore`
  (JSON body up to 50 MB; validates schema; refuses `version` newer than supported; in one transaction:
  delete all rows of the listed tables in FK-safe order, insert the backup rows, keep `auth` and
  `sessions` untouched; then re-run category/slot seeding guards so defaults are not re-added),
  `GET backup.sqlite` (`VACUUM INTO` a temp file in `os.tmpdir()`, stream it, delete it),
  `GET diary/export.csv` exists from Phase 2 — verify it covers all columns.
- `GET about` → `{ version, dbSizeBytes, dbPath (basename only), counts: { foods, entries, days } }`.
- Tests: backup → wipe → restore round trip equals original (compare table dumps); restore of an
  invalid file is refused and leaves data intact; sqlite snapshot opens with `better-sqlite3` and has
  the same row counts.

### Web

- More → Data card: Export backup (JSON), Import backup… (Sheet: file picker, shows what will be
  replaced with current counts, requires typing REPLACE, progress, then reloads queries), Download
  database snapshot, Export foods CSV, Import foods CSV…, Export diary CSV (range sheet).
- More → About shows version, database size, counts. Make sure Meal slots and Categories managers are
  linked from More → Library. Appearance/Profile/Goal/Tolerance already exist — tidy the page order to
  DESIGN §7.
- Screenshots `tools/shots/phase7-data.mjs`.

---

## Phase 8 — Open Food Facts lookup (FR-F5; DESIGN §4.2)

### API

- Config: `OFF_LOOKUP_ENABLED` (default true), `OFF_USER_AGENT` default `Plate/<version>
(self-hosted diet ledger)`. Service `OffLookupService` with 5 s timeout (`AbortSignal.timeout`),
  in-memory LRU cache (10 min, 200 entries), 60 req/min cap (reuse `@fastify/rate-limit` per route).
  `GET off/search?q=` → `https://world.openfoodfacts.org/cgi/search.pl?search_terms=<q>&search_simple=1
&action=process&json=1&page_size=20&fields=code,product_name,brands,nutriments,quantity`;
  `GET off/product/:code` → `https://world.openfoodfacts.org/api/v2/product/<code>.json?fields=...`.
  Map `nutriments`: `energy-kcal_100g` (fallback `energy_100g` kJ ÷ 4.184), `proteins_100g`,
  `carbohydrates_100g`, `fat_100g`, `fiber_100g`, `sugars_100g`, `saturated-fat_100g`, `sodium_100g`
  (grams → mg ×1000; if absent but `salt_100g` present, sodium = salt ÷ 2.5). Return the shared
  `offResultSchema { code, name, brand, per100, quantity }`; skip products without kcal. When disabled
  → 404 `NOT_FOUND` with message "Online lookup is disabled". Unit-test the mapping with fixture JSON;
  integration-test the routes with `fetch` mocked (`vi.stubGlobal`).
- `foods.source = 'off'` and `off_code` set when a food is created from a lookup result.

### Web

- "Search online" button in the food editor (hidden when `GET about` reports `offEnabled: false` —
  add that flag to the about response). Sheet: search box (name or barcode digits → product lookup),
  results list (name, brand, kcal/100), tap → prefill all nutrition fields + brand + name (editable),
  remember `offCode`. Loading/empty/error states; "Powered by Open Food Facts" attribution line.
- Screenshots `tools/shots/phase8-lookup.mjs` with the API mocked by pointing at a local stub? — simpler:
  run against the real API once if the network allows; otherwise screenshot states with a
  `?offMock=1` dev-only hook. Do not ship mock code in production bundles.

---

## Phase 9 — Polish, PWA, e2e, deployment (NFR-2–NFR-9; DESIGN §9–§10)

- Route-level code splitting (`React.lazy` per feature) and a bundle check: main chunk < 250 kB gzip.
- Empty/loading/error audit of every screen (list them in the PR notes); keyboard shortcuts help (`?`)
  on desktop; focus management after sheets close; `aria-live` for toasts (sonner does) and for the
  ring value changes.
- PWA: verify manifest/icons/`theme-color`; add an "update available" toast via `virtual:pwa-register`
  (`registerType: 'prompt'`); offline shell renders the error state with retry when the API is
  unreachable.
- Docker: try `node:24-alpine` runtime stage (if `better-sqlite3`/`argon2` prebuilds load) to cut the
  565 MB image; otherwise keep bookworm-slim and document why. Multi-arch build command in README
  (`docker buildx build --platform linux/arm64,linux/amd64 …`). Verify `docker compose up` from
  `docker/` with `.env.example` copied: anonymous `curl` to `/api/foods` → 401, `/api/health` → 200,
  login works, static assets cached, `read_only` FS fine (SQLite WAL in `/data`).
- Playwright e2e (`apps/web/e2e`, `@playwright/test`, `channel: 'chrome'`): login → add food → log
  450 g → summary shows the right kcal → edit → delete → undo; goal set → ring colour; CSV import
  preview. Script `pnpm e2e` builds the web app, starts the API with a temp DB on a free port, runs the
  tests. Add to `pnpm check`? No (slow); document `pnpm e2e` in README and run it once here.
- Docs: README Pi runbook (install Docker on Pi OS, clone, `.env`, `compose up`, backups cron with
  `sqlite3 .backup`, upgrade, reset password, Caddy/HTTPS option); update TECH.md where reality
  differs; DECISIONS.md final deviations list; delete `PlaceholderPage` if still present.
- Final: `pnpm check` green, `pnpm e2e` green, Docker smoke green, everything committed on `main`.
