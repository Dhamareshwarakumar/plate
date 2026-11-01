# Plate — Requirements

> Working name: **Plate** (a personal diet ledger). Rename any time; nothing depends on the name.

## 1. Purpose

A single-user web app for logging everything you eat every day, so you stay consistent with a calorie and macro goal you set. It runs on your own Raspberry Pi 5 in Docker, stores data in a local SQLite file, and is used mostly from a phone, with a full desktop layout.

The one thing the app must excel at: **logging a known food takes three taps and under five seconds.** Everything else exists to make that habit stick (goals, streaks, insights).

## 2. Users and context

- One person. No accounts, no sharing. Access is protected by a single app password.
- Primary device: phone (iOS Safari / Android Chrome), installed to the home screen as a PWA. Secondary: laptop browser.
- Network: home LAN; you may expose it further via your static IP at your own discretion (see TECH.md §7 for the HTTPS implications).
- Connectivity: online-only in v1. The app shell loads offline, but logging needs the Pi reachable.

## 3. Functional requirements

Requirement IDs are referenced by DESIGN.md and TECH.md.

### 3.1 Food library (FR-F)

- **FR-F1** A food has: name (required), brand (optional), category (optional, from an editable list), basis (`g` or `ml`), and nutrition **per 100 g / 100 ml**: kcal, protein g, carbs g, fat g (required); fiber g, sugar g, saturated fat g, sodium mg (optional).
- **FR-F2** A food can have zero or more **portions**: a label and a gram/ml amount (e.g. "1 medium = 50 g", "1 cup = 240 ml"). Portions are only shortcuts; the stored quantity is always grams/ml.
- **FR-F3** Create, edit, archive and (if unused) delete foods. A food referenced by any diary entry, dish or meal template cannot be hard-deleted; it is archived (hidden from search, kept for history).
- **FR-F4** Search foods instantly by name/brand with typo tolerance; filter by category; sort by name, recently used, most used.
- **FR-F5** Optional online prefill from **Open Food Facts** when creating a food: search by name or barcode, pick a result, fields are prefilled, you can edit before saving. Must be disable-able; the app is fully functional without it.
- **FR-F6** Import and export the library as CSV (format in TECH.md §5.3). Import previews rows and reports errors before committing.
- **FR-F7** Soft sanity check on save: if 4·protein + 4·carbs + 9·fat deviates more than 25 % from kcal, show a warning (not a block).
- **FR-F8** Categories are user-editable: add, rename, reorder, archive. Default list: Fruit, Vegetable, Grain & Bread, Protein, Dairy, Legume, Nuts & Seeds, Snack, Beverage, Cooked dish, Condiment, Other.

### 3.2 Dishes and meal templates (FR-R)

- **FR-R1** A **dish** (recipe) is built from ingredient foods with gram amounts plus a cooked total weight (defaults to the sum of raw weights; editable). Its per-100 g nutrition is computed from the ingredients and it is logged exactly like a food ("250 g of my dal").
- **FR-R2** Dish nutrition is recomputed when the dish is saved. Editing an ingredient food later does not silently change the dish; the dish page offers "Recalculate from ingredients".
- **FR-R3** A **meal template** is a named list of (food or dish, grams). Logging it creates one diary entry per item in one tap, with quantities editable before confirming. Templates can be created from an existing logged meal ("Save as meal").

### 3.3 Diary (FR-D)

- **FR-D1** Each diary entry records: day (local date), meal slot, time, food (or ad-hoc), quantity in g/ml, optional portion label and count, optional note, and the nutrition at the time of logging.
- **FR-D2** Meal slots default to Breakfast, Lunch, Snacks, Dinner. They are editable: rename, reorder, add, archive, and each has a time window used to preselect the slot when logging.
- **FR-D3** Log flow: open log, pick a food (recent/frequent/search), enter quantity (type grams or tap a portion with a count), confirm. Time defaults to now; meal slot defaults from the time window. "Log & add another" keeps the sheet open.
- **FR-D4** Ad-hoc entry: name + kcal (+ optional macros) for food not in the library, with a "save to library" toggle.
- **FR-D5** Backdating: switch to any past (or future) day and log into it. When logging on a day other than today, the time defaults to the middle of the chosen slot's window.
- **FR-D6** Edit any entry (quantity, portion, slot, time, day, note), delete with 6-second undo, duplicate.
- **FR-D7** Copy: a meal from another day into this day; a whole day from another day; a meal to another day.
- **FR-D8** Day view shows per-meal subtotals and day totals (kcal, protein, carbs, fat; fiber if goal set), each against the day's goal.
- **FR-D9** Water: log ml with quick buttons (+250, +500, custom) against a daily water goal; remove the last addition.
- **FR-D10** Editing a food in the library does not change historical entries. Changing an entry's quantity recomputes from the values captured when it was logged.

### 3.4 Goals (FR-G)

- **FR-G1** A goal has: daily kcal, protein g, carbs g, fat g (required); fiber g and water ml (optional); an **effective-from date**. Each day is judged against the goal in effect on that day, so changing a goal does not rewrite history.
- **FR-G2** The app shows the macro split as % of kcal alongside grams.
- **FR-G3** Adherence tolerance: a day is "on target" when kcal eaten is within ± tolerance % of the kcal goal (default 10 %, editable).
- **FR-G4** Calculator: from sex, birth date, height, latest weight and activity level, estimate BMR (Mifflin-St Jeor) and TDEE, and suggest kcal for maintain / lose 0.25 / lose 0.5 / gain 0.25 kg per week, plus macro presets (balanced, high-protein, custom). The user always confirms; nothing is applied automatically. Show a caution when the suggestion is below 1200 kcal.

### 3.5 Weight (FR-W)

- **FR-W1** Log body weight in kg, one value per day (re-logging a day replaces it), with an optional note.
- **FR-W2** Show latest weight, change vs 7 and 30 days ago, 7-day moving average, rate in kg/week over the last 4 weeks, goal weight with remaining kg, and a projected date at the current rate (only when trending toward the goal).
- **FR-W3** Chart with raw points and moving average over 1M / 3M / 6M / 1Y / All.

### 3.6 Insights (FR-I)

For a selectable range (week, month, 3 months, year, custom) with previous/next navigation:

- **FR-I1** Summary: average kcal/day, average protein/carbs/fat, adherence % (on-target days ÷ logged days), days logged, current and best logging streak, current and best on-target streak.
- **FR-I2** Calories per day bars with goal line and tolerance band; bars colored on-target / under / over.
- **FR-I3** Macros per day (stacked grams) and average macro split (donut).
- **FR-I4** Calendar heatmap by day status: not logged / on target / under / over.
- **FR-I5** Weight trend (7-day MA) overlaid with weekly average kcal.
- **FR-I6** Top foods by times logged and by total kcal contributed.
- **FR-I7** Average kcal by meal slot.

### 3.7 Settings and data (FR-S)

- **FR-S1** Appearance: System / Light / Dark.
- **FR-S2** Meal slots and categories management (see FR-D2, FR-F8). Adherence tolerance. Week start (Monday default).
- **FR-S3** Full backup export (single JSON) and restore (replace all data; requires typed confirmation). Consistent SQLite snapshot download.
- **FR-S4** Food library CSV import/export (FR-F6); diary CSV export.
- **FR-S5** Profile for the calculator (sex, birth date, height, activity level).
- **FR-S6** About: version, database size.

### 3.8 Access (FR-A)

- **FR-A1** Every data endpoint requires a logged-in session. Login is a single app password. The password hash is stored in the database; on first start it is seeded from the deployment config (`APP_INITIAL_PASSWORD`, initially `password`). The app refuses to start if there is neither a stored hash nor a bootstrap value.
- **FR-A2** Sessions persist across browser restarts (30 days, sliding). Logout available in Settings.
- **FR-A3** Login attempts are rate-limited.
- **FR-A4** The password can be changed in Settings → Security (current password, new password ≥ 8 chars, confirmation). Changing it signs out every other session. A documented command resets the password from the bootstrap value if it is forgotten.

### 3.9 First run (FR-O)

- **FR-O1** On an empty database the Today screen shows a three-step checklist: set a goal, add foods, log a meal. It disappears once all three are done (or is dismissed).

## 4. Non-functional requirements

- **NFR-1 Speed.** Day view renders in under 300 ms on the Pi over LAN after first load; food search filters as you type with no visible lag for a library of several thousand foods.
- **NFR-2 Mobile-first, desktop-complete.** Every screen is designed for a 360–430 px wide phone with thumb-reachable actions, and has a purpose-built layout at ≥ 1024 px (sidebar navigation, multi-column), not a stretched phone layout.
- **NFR-3 Visual quality.** Modern, polished: animated progress rings, spring-based sheets, skeleton loaders, designed empty and error states, consistent spacing and typography, dark and light themes. Details in DESIGN.md §6.
- **NFR-4 PWA.** Installable to the home screen with icon, splash and standalone display; app shell cached for instant startup. (Requires HTTPS; see TECH.md §7.3.)
- **NFR-5 Accessibility.** Keyboard navigable, visible focus, ARIA on rings and charts, WCAG AA contrast, respects reduced-motion.
- **NFR-6 Data safety.** No destructive action without confirmation; deletes have undo where cheap; restore requires typed confirmation; SQLite in WAL mode; backup export always available.
- **NFR-7 Privacy / locality.** No analytics, no fonts or scripts from third parties. The only outbound call is the optional Open Food Facts lookup, made from the server, disable-able.
- **NFR-8 Security.** See TECH.md §7: authenticated API, hashed password compare, HttpOnly SameSite cookies, security headers, input validation on every endpoint, parameterized queries, non-root container, no secrets in the repo.
- **NFR-9 Deployability.** `docker compose up -d` on the Pi with a `.env` file is the whole install. Multi-arch image (arm64 + amd64). Data in one bind-mounted directory.
- **NFR-10 Maintainability.** TypeScript end to end, shared schemas between API and UI, unit tests for all nutrition math, integration tests for the API.

## 5. Out of scope for v1

- Multi-user, sharing, social features.
- Offline write queue / sync.
- Push notifications or reminders.
- Barcode scanning via camera (barcode text lookup is in via FR-F5).
- Imperial units.
- Micronutrients beyond the eight fields in FR-F1.
- Exercise / activity logging.
- Native apps.
