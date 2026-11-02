# Plate — Design (how the app looks and flows)

This document walks through the app the way you will experience it. Wireframes are phone-width; each screen also describes its desktop layout. Requirement IDs (FR-…) refer to REQUIREMENTS.md.

## 1. Navigation

**Phone (< 1024 px):** a bottom tab bar with five tabs, plus a floating **+** button on the Today screen.

```
┌──────────────────────────────────┐
│                                  │
│          screen content          │
│                                  │
│                           (+)    │  ← FAB, Today only
├──────────────────────────────────┤
│  Today   Foods   Insights  Weight  More │
└──────────────────────────────────┘
```

**Desktop (≥ 1024 px):** a fixed left sidebar (240 px) with the same five destinations, app name and theme toggle at the top, "Log food" primary button under the name. Content area max 1200 px, centered.

Tabs:

| Tab      | Purpose                                                                  |
| -------- | ------------------------------------------------------------------------ |
| Today    | The diary. Where you spend 90 % of your time.                            |
| Foods    | Library: Foods / Dishes / Meals.                                         |
| Insights | Trends and adherence.                                                    |
| Weight   | Body weight log and trend.                                               |
| More     | Goals, meal slots, categories, appearance, data, profile, logout, about. |

Routes are real URLs (`/today/2025-10-19`, `/foods/42`, `/insights?range=month`) so the browser back button and desktop deep links behave.

## 2. Today (diary) — FR-D, FR-G, FR-O

### 2.1 Phone layout

```
┌──────────────────────────────────┐
│ ‹  Oct 2025        [📅] [Today]   │  ← header: month, calendar jump, back-to-today (hidden when on today)
│ Mo14 Tu15 We16 Th17 Fr18 [Sa19] Su20 │  ← day strip, swipeable; dot under days that have entries
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │        ◯ 1,420 / 2,000       │ │  ← calorie ring, animated fill; center: eaten, under it "580 left"
│ │          580 left            │ │
│ │  Protein  Carbs    Fat       │ │  ← three slim bars with g / goal g
│ │  86/150g  150/220g 48/65g    │ │
│ │  Fiber 18/30g · Water 1.25/2.5L │  ← chips, only if those goals are set
│ └──────────────────────────────┘ │
│                                  │
│ Breakfast            420 kcal  ⋯ │  ← meal header: name, subtotal, menu
│  Oats               80 g   304   │  ← entry rows: name · quantity · kcal
│   07:40 · P 11 C 54 F 6          │     second line: time · macros (muted)
│  Milk 2%           200 ml  100   │
│  Banana         1 medium (118 g) 105 │
│  + Add to Breakfast              │  ← ghost button
│                                  │
│ Lunch                 — kcal  ⋯ │
│  ┆ Nothing yet · Add to Lunch ┆  │  ← dashed empty state
│                                  │
│ Snacks … Dinner …                │
│                                  │
│ Water  1.25 L / 2.5 L            │
│  [+250] [+500] [+…]  (undo last) │
│                                  │
│                           (+)    │
└──────────────────────────────────┘
```

Interactions:

- **Swipe** left/right anywhere on the strip or the content changes the day. The header "Today" pill returns to today.
- **Tap an entry** → edit sheet (quantity, portion, slot, time, day, note; Delete at the bottom).
- **Swipe an entry** left → Delete (with a 6 s "Undo" toast); right → Duplicate.
- **Meal ⋯ menu**: Add food · Copy from yesterday · Copy from another day… · Copy to another day… · Save as meal template… · Clear meal.
- **Calorie ring color**: accent while under goal; green when inside the tolerance band; red when over the band. Macro bars use fixed macro colors (see §6) and fill past 100 % with a hatched overflow segment rather than clipping.
- **Empty day** shows a friendly illustration-free empty card: "Nothing logged on Sat 19 Oct" with "Log food" and "Copy from yesterday".
- **First run** (FR-O1): a checklist card above the summary: ① Set your goal ② Add some foods ③ Log your first meal, each linking to the right place, with checkmarks as they complete.

### 2.2 Desktop layout

Two columns. Left (sticky, 360 px): the day strip becomes a month mini-calendar with dots on logged days; under it the summary card (ring + bars) and the water card. Right: the meal list, full width, each entry a row with columns name · quantity · time · P · C · F · kcal · actions (edit, duplicate, delete appear on hover). Keyboard: `←`/`→` change day, `T` today, `N` opens the log dialog, `/` focuses search inside the dialog.

## 3. Log flow — FR-D3, FR-D4, FR-R3

Opened by the **+** FAB, any "Add to <meal>" button, or `N` on desktop. Phone: a bottom sheet that springs up to 92 % height with a drag handle. Desktop: a centered dialog, 640 px wide.

### Step 1 — pick

```
┌──────────────────────────────────┐
│ ━━━                              │
│ Log to  [Breakfast ▾]  Sat 19 Oct│  ← slot preselected from the time window; tap to change
│ 🔍 Search foods…            [▯▯▯] │  ← autofocused, numeric-free keyboard; ▯▯▯ scans a barcode (Phase 10b)
│ [Recent] [Frequent] [Dishes] [Meals] [All] │
│                                  │
│  Oats              389 kcal/100g │  ← each row: name · kcal/100 · tiny P/C/F
│   P 17 · C 66 · F 7              │
│  Milk 2%            50 kcal/100ml│
│  Banana             89 kcal/100g │
│  …                               │
│                                  │
│  ＋ Create "<typed text>" as new food │  ← appears when the search has no exact match
│  ✎ Quick ad-hoc entry            │
└──────────────────────────────────┘
```

- **Recent** = last 20 distinct foods logged, newest first. **Frequent** = top 20 by count in the last 60 days. The default list on open is Recent (or Frequent if Recent is empty, or All if the library is tiny).
- Search is instant and typo-tolerant ("bananna" finds Banana), matches name and brand, shows category as a muted tag.
- Picking a **meal template** jumps to a review list (each item with editable grams) and a single "Log 4 items" button.
- **Quick ad-hoc entry**: name, kcal, optional P/C/F, quantity label (free text, e.g. "1 slice"), toggle "Also save to library as per-100 g values" (asks for the weight when on).

**Scan barcode** (Phase 10b): the ▯▯▯ button right of the search box opens a camera sheet (rear camera, viewfinder with corner brackets and a sweeping line, torch toggle when the camera has one, Cancel). Reads EAN-13, EAN-8, UPC-A and UPC-E; a code counts once two frames agree, the brackets turn green with "Found <code>", and the sheet closes.

- Library food with that barcode → straight to Step 2 for it.
- Otherwise a **Barcode <code>** step: the Open Food Facts product (name, brand · size, kcal/P/C/F per 100) with **Add to library and log** (creates the food with the barcode, then Step 2) and **Create food manually**; "Not on Open Food Facts" when there is none, with Create food manually (the editor opens with the barcode already kept); when the online lookup is turned off on the server the step says so and still offers the manual path.
- Camera problems have their own screens: starting (spinner, "choose Allow"), denied (how to re-enable, per browser, with Try again), no camera, camera busy, unsupported browser or plain-http page. Each points at typing the barcode into Search online instead.

### Step 2 — quantity

```
┌──────────────────────────────────┐
│ ‹ Banana                         │
│                                  │
│          [  450  ] g             │  ← big numeric field, inputmode=decimal, prefilled with last-used amount for this food
│   [1 small 100g] [1 medium 118g] [1 large 136g] │  ← portion chips; tapping one shows a count stepper
│                       ( − 2 + )  │
│                                  │
│  ┌────────────────────────────┐  │
│  │ 400 kcal  P 4.9  C 103  F 1.5 │  ← live preview, updates per keystroke
│  │ Day after: 1,820 / 2,000     │  ← what the day total becomes
│  └────────────────────────────┘  │
│                                  │
│  Meal   [Breakfast ▾]   Time [07:42] │
│  Note   ………………………………………          │
│                                  │
│ [ Log & add another ]  [  Log  ] │
└──────────────────────────────────┘
```

Fast path for a known food: **+ → tap Banana → type 450 → Log**. Three taps plus the number. "Log" closes the sheet with a subtle check animation and the ring animates to its new value. "Log & add another" returns to Step 1 with the slot kept.

## 4. Foods (library) — FR-F, FR-R

### 4.1 List

```
┌──────────────────────────────────┐
│ Foods                      [⋯]   │  ← ⋯: Import CSV · Export CSV · Manage categories
│ [ Foods | Dishes | Meals ]        │  ← segmented control
│ 🔍 Search       Sort: Recent ▾   │
│ [All] [Fruit] [Vegetable] [Grain] …  │  ← category chips, horizontally scrollable
│                                  │
│  Banana · Fruit        89 kcal   │
│   P 1.1 · C 23 · F 0.3  per 100 g │
│  Chicken breast · Protein 165    │
│  …                               │
│                                  │
│                          (+ New) │
└──────────────────────────────────┘
```

Desktop: a data table with sortable columns (Name, Category, kcal, P, C, F, fiber, last used, times used), sticky header, inline search, 50 rows per page. Row click opens the editor as a right-side drawer so the list stays visible.

### 4.2 Food editor

Sections top to bottom: **Basics** (name, brand, category, basis g/ml) · **Nutrition per 100 g** (kcal, protein, carbs, fat required; expandable "More" for fiber, sugar, saturated fat, sodium) with the live sanity hint "4P+4C+9F = 396 kcal, matches" or a warning when off by > 25 % (FR-F7) · **Portions** (list of label + grams rows, add/remove/reorder) · **Usage** (times logged, last logged) · actions Save / Archive / Delete (delete only when unused).

The **Search online** button (FR-F5) opens a sub-sheet: type a name or barcode → results from Open Food Facts with brand and kcal → tap one to prefill all nutrition fields and the brand; the source is remembered on the food. Hidden entirely when the lookup is disabled in deployment.

The sub-sheet's footer has **Scan barcode** (Phase 10b): a camera sheet (see §3, "Scan barcode") reads the package's EAN/UPC and runs the same product lookup. When Open Food Facts has no product for a typed or scanned barcode, the sheet offers **Keep barcode on this food**, so a local product typed in by hand can still be logged by scanning later. The editor then shows "Barcode <code> · scanning it logs this food" under the Nutrition heading.

### 4.3 Dish editor (FR-R1, FR-R2)

Name · category · ingredients list (each: food picker + grams, with the per-ingredient kcal) · "Raw total 1,240 g" · "Cooked weight [ 980 ] g" · optional "Servings [ 4 ]" which creates a portion "1 serving = 245 g" · live computed card: "per 100 g: 142 kcal · P 7.1 · C 20 · F 3.2" · Save. A banner "Ingredients changed since last calculation — Recalculate" appears when relevant.

### 4.4 Meal template editor (FR-R3)

Name · items (food/dish picker + grams) · total preview · Save · "Log now" button.

## 5. Insights — FR-I

```
┌──────────────────────────────────┐
│ Insights                          │
│ [Week | Month | 3M | Year | Custom]   ‹ 13–19 Oct › │
│                                  │
│ ┌ Avg 1,860 kcal ┐ ┌ On target 71% ┐ │  ← stat tiles, 2×2 on phone, 4-up on desktop
│ │ P 118 C 190 F 62│ │ 5 of 7 logged │ │
│ └────────────────┘ └──────────────┘ │
│ ┌ Streak 🔥 12 days ┐ ┌ Best 23 ┐    │
│                                  │
│ Calories per day                 │
│  ▇ ▇ ▇ ░ ▇ ▇ ▇  ─── goal 2,000   │  ← bars colored by status; shaded tolerance band; dashed goal line
│                                  │
│ Macros                 [grams|split] │
│  stacked bars per day  /  donut  │
│                                  │
│ Calendar                         │
│  M T W T F S S                   │  ← heatmap: muted = not logged, green = on target, amber = under, red = over
│  ▪ ▪ ▪ ▪ ▪ ▪ ▪                   │
│                                  │
│ Weight vs intake                 │
│  weight MA line · weekly avg kcal bars (dual axis) │
│                                  │
│ Top foods          [count|kcal]  │
│  1. Oats · 18× · 5,470 kcal      │
│                                  │
│ By meal                          │
│  Breakfast 420 · Lunch 610 · …   │
└──────────────────────────────────┘
```

Desktop: a 2-column card grid; charts get hover tooltips with exact values; clicking a day bar or heatmap cell navigates to that day in Today.

## 6. Weight — FR-W

```
┌──────────────────────────────────┐
│ Weight                  [+ Log]  │
│                                  │
│      78.4 kg                     │  ← latest, large
│  ▾ 0.6 kg vs 7d · ▾ 1.9 kg vs 30d │
│  Goal 74.0 kg · 4.4 to go        │
│  Rate −0.45 kg/week · ETA ~ 2 Jan │  ← ETA only when trending toward goal
│                                  │
│ [1M | 3M | 6M | 1Y | All]        │
│  ·  ·    · ·  ·   ─── 7-day avg  │  ← dots = entries, line = moving average, dashed = goal
│                                  │
│ Sat 19 Oct   78.4   "post-run"   │  ← entries list, tap to edit, swipe to delete
│ Fri 18 Oct   78.9                │
└──────────────────────────────────┘
```

"+ Log" opens a small sheet: date (default today), kg with one decimal, note. Logging an existing date replaces it (with a note saying so).

## 7. More — FR-S, FR-G

A list of sections:

- **Goal** — card with the active goal (kcal; P/C/F in g and %; fiber; water; "since 1 Oct"). "Edit goal" opens the goal editor: fields plus an effective-from date (default today); a "Calculate for me" expander shows the Mifflin-St Jeor estimate with activity level and the four suggestions as tappable chips, and macro presets (Balanced 30/40/30, High protein 40/30/30, Custom) that fill the gram fields from the chosen kcal. "Goal history" lists past goals.
- **Reminders** (FR-N) — a one-row link card ("Off" / "On · 2 devices") that opens **More → Reminders**, two cards (side by side on desktop):
  - _Schedule_: master switch with a status line; **Meals**: one row per active meal slot with a switch, the slot name, a time field (default: the slot's window end) and a checkbox "Only if nothing is logged in this meal"; **Body and water**: Weigh-in (default 07:30, "only when no weight is logged for the day") and Water ("only when you are below the water goal"); footer "Times are in <zone>" with a one-tap switch to the device's zone when it differs. Every change saves at once.
  - _Devices_: this browser's state with one action — **Enable on this device** (asks permission, subscribes), or **Send test notification** · **Turn off on this device** once enabled — and clear copy for the dead ends: notifications blocked (where to re-allow, Check again), iPhone/iPad in a Safari tab ("Add Plate to your Home Screen first": Share → Add to Home Screen), browser without push, no secure connection, service worker not running. Below it the list of enabled devices ("Chrome on Android", "This device" tag, added date, last delivery or failed-delivery count, remove with confirmation).
  - Notifications themselves are generic ("Dinner not logged yet", "Time to weigh in", "Below your water goal"); tapping one opens Today (or Weight for the weigh-in).
- **Adherence tolerance** — slider 0–25 %, default 10 %.
- **Meal slots** — reorderable list; each row: name, window (e.g. 05:00–10:30); add / rename / archive.
- **Categories** — same pattern.
- **Appearance** — System / Light / Dark segmented control.
- **Profile** — sex, birth date, height, activity level (for the calculator only).
- **Data** — Export backup (JSON) · Import backup… · Download database snapshot · Export foods CSV · Import foods CSV… · Export diary CSV. Import backup shows what it will replace and requires typing REPLACE.
- **Security** — Change password (current, new, confirm; signs out other devices) · Sign out.
- **About** — version, database size, build date.

## 8. Login

A centered card: app mark, "Enter password", a password field, Sign in. Error states for wrong password and for rate-limiting ("Too many attempts, try again in 5 minutes"). Nothing else is reachable without a session; the PWA shell loads, then redirects here.

## 9. Visual system

- **Typography:** Inter Variable, self-hosted (no external font requests). Numbers use tabular figures so columns align. Scale: 12 / 14 / 16 / 20 / 28 / 40 px; large ring number at 40 px semibold.
- **Color:** neutral surfaces (zinc scale) with a single warm accent (`#F97316` orange) for primary actions and the calorie ring while under goal. Status: green `#22C55E` on target, amber `#F59E0B` under, red `#EF4444` over. Fixed macro colors everywhere: protein blue `#3B82F6`, carbs amber `#F59E0B`, fat pink `#EC4899`, fiber green `#10B981`, water cyan `#06B6D4`. Dark theme uses the same hues on `#0B0B0F`-ish surfaces with slightly lifted cards. Theme follows the system by default; the toggle persists in local storage and sets `theme-color` for the phone status bar.
- **Shape and depth:** 16 px card radius, 12 px controls, 1 px hairline borders in dark mode, soft 2-layer shadows in light mode. Cards on the Today summary have a subtle gradient tint.
- **Motion:** Framer Motion springs (stiffness 400, damping 30). Rings animate fill on mount and on change; numbers count up; sheets slide with a drag handle and rubber-band; list rows fade/slide on add and collapse on delete. All motion disabled under `prefers-reduced-motion`.
- **Touch:** 44 px minimum targets; FAB and primary actions in the bottom third of the screen; safe-area insets for notch and home indicator.
- **States, every screen:** skeleton loaders shaped like the final content; designed empty states with one primary action; error state with the message and a Retry button; success feedback as a toast or inline check; destructive actions confirm (or offer undo).
- **Desktop affordances:** hover reveals row actions; keyboard shortcuts listed under `?`; focus rings visible on every interactive element.

## 10. Accessibility checklist

- Rings and bars carry `role="progressbar"` with `aria-valuenow/min/max` and a text alternative ("1,420 of 2,000 kcal").
- Charts have an adjacent accessible table (visually hidden) with the plotted values.
- All sheets trap focus, close on Escape, and return focus to the opener.
- Color is never the only signal: status is also conveyed by label text or icon.
- Contrast AA in both themes, verified on the status colors against both surfaces.
