# UI screenshot harness

Visual verification scripts run against the dev servers (API on 127.0.0.1:8080, web on 127.0.0.1:5173).
They use the locally installed Google Chrome via Playwright's `channel: 'chrome'` (no browser download).

```sh
node tools/shots/phase1-foods.mjs      # writes /tmp/plate-shots/*.png
```

Conventions for new scripts: one file per phase (`phaseN-<topic>.mjs`), iPhone 14 device preset for
phone shots and a 1440×900 viewport for desktop, both colour schemes where the screen has notable
colour, `page.on('pageerror')` logged, labels matched with `{ exact: true }`. Open the PNGs and look
at them; a screenshot nobody inspects proves nothing.

```sh
node tools/shots/phase2-diary.mjs      # Today: empty day, log flow, entries, edit, swipe, meal slots, desktop
```

`phase2-diary.mjs` seeds a small library through the API when needed and clears today's and yesterday's
entries first so the shots are deterministic. Run it against a dev database you do not mind touching.

```sh
node tools/shots/phase3-goals.mjs      # Today ring under/on/over target, log sheet with goal, goal editor + calculator, More goal card, first-run checklist, desktop
```

`phase3-goals.mjs` resets settings (tolerance 10 %, Monday), replaces all goals with one effective a
week ago (2,000 kcal), clears today's entries and logs food to reach each status in turn. It saves a
goal and the profile through the editor, so it writes a profile into the dev database.

```sh
node tools/shots/phase4-recipes.mjs    # Dishes/Meals tabs, dish editor (ingredients, stale banner, recalculate), save-as-meal sheet, picker shelves, template review step, deep link, desktop editors
```

`phase4-recipes.mjs` seeds the recipe ingredients when missing, deletes every meal template, clears
today's entries and frees the dish name "Dal" (renaming and archiving an old one that history still
references). It edits and restores the "Red lentils" kcal to show the stale banner.

```sh
node tools/shots/phase5-water-weight.mjs  # Weight empty state, Today water card (+250/+500, custom sheet, undo), Weight page 1M/All, log sheet with the "replaces" notice, edit sheet, swipe-to-delete, delete + undo, goal editor weight group, More goal card, desktop
```

`phase5-water-weight.mjs` deletes every weigh-in, today's water and all goals first (for the empty
states), then seeds ~45 days of weigh-ins ending today (a gentle downward trend with four skipped
days), the Phase 3 goal with a 74 kg goal weight, and five diary entries for today. It leaves the
seeded weights and goal in the dev database.

```sh
node tools/seed-demo.mjs                  # ~35 days of meals, weigh-ins and water ending today, through the API (re-runnable; keeps the food library; deletes every goal and the window's entries; needs --yes against a non-loopback PLATE_API)
node tools/shots/phase6-insights.mjs      # Insights: week, last month (full page), macros split, heatmap (month, week, 3-day custom), weight vs intake, top foods by kcal, by meal, custom range sheet, 3M, year (weekly bars + year strip), empty range, desktop month/3M/year, tooltip
```

`phase6-insights.mjs` runs `tools/seed-demo.mjs` first (skip with `SKIP_SEED=1` when the database is already
seeded; a full seed waits out the API rate limit and takes about two and a half minutes). The seed clears
every day of its window and that window's weigh-ins, replaces all goals (2,000 kcal from the window start,
1,900 from day 20) and leaves the data in the dev database for demos. The script also logs the URL after
each range change, that › is disabled on the current period, that a heatmap cell opens that day in Today
and that ArrowLeft moves the range.

```sh
node tools/shots/phase7-data.mjs          # More page order (phone full page + desktop), Data card, the three downloads, import backup sheet (empty, not a backup, preview with file-vs-server counts, REPLACE typed, restored toast), diary CSV range sheet + download, About card (loaded, skeleton, error + retry), desktop import dialog
```

`phase7-data.mjs` exports the dev database through the Data card (`page.waitForEvent('download')`,
asserting each suggested file name: `plate-backup-<date>.json`, `plate-<date>.sqlite`,
`plate-foods-<date>.csv`, `plate-diary-<from>_<to>.csv`), saves the backup to
`/tmp/plate-shots/backup.json`, then **restores it over the dev database** through the sheet and checks
that `GET /api/about` reports the same counts afterwards (a no-op round trip; ids and the session
survive). The About error state is produced by aborting `/api/about` with `page.route`, so the two or
three `Failed to load resource: net::ERR_FAILED` console lines are expected; any other `CONSOLE` or
`PAGEERROR` line is a defect.

```sh
node tools/shots/phase8-lookup.mjs          # Food editor "Search online": button, sheet idle, one real OFF search, loading skeleton, mocked results, empty, error + retry, barcode lookup, prefilled editor (full page) + saved provenance, hidden when disabled, desktop results + prefilled drawer
```

`phase8-lookup.mjs` runs **one real search** ("oat milk") through the API to Open Food Facts and logs
`real search: <status> <n> items` (or `real search skipped (network)`); every other sheet state comes
from `page.route()` mocks of `/api/off/**` answering in the API's mapped `{ items }` shape (nothing is
mocked inside the app), and the disabled state from a mocked `/api/about` with `offEnabled: false`. It
saves the prefilled "Twix glacé" through the editor, checks `source`/`offCode` on the server, and
deletes that food again. The one `Failed to load resource: ... 502` console line comes from the mocked
upstream error and is expected.

```sh
SKIP_BUILD=1 node tools/shots/phase9-polish.mjs   # shortcuts help (desktop light + dark), focus ring back on "Log food" after Escape, "Can't reach Plate" (phone dark + desktop), Today cold-load skeleton, "update available" toast (phone dark + desktop light) + Update reload
```

`phase9-polish.mjs` runs the first four groups against the dev servers. The update toast needs a real
service worker, which only the production build registers, so the script also starts a throw-away
production API on a free port serving a **copy** of `apps/web/dist` (temp database, password
`password`), waits for the worker to control the page, appends a comment to the copy's `sw.js`, calls
`registration.update()` and screenshots the toast; it then presses **Update** and logs whether the page
reloaded. Without `SKIP_BUILD=1` it runs `pnpm -r build` first. The `net::ERR_CONNECTION_FAILED`
console lines come from the aborted requests of the unreachable-shell shots and are expected.

```sh
SKIP_BUILD=1 node tools/shots/phase9-states.mjs   # empty / loading / error audit of every screen (phone), Today/Foods/Insights also on desktop, unreachable shell, login error, 404; ~55 PNGs
```

`phase9-states.mjs` never touches the dev database: it starts its own production API with a fresh
temp database, logs in once and reuses the cookie. "Loading" holds every `/api` request except the
session probe open (`page.route` without a response); "error" aborts them. It seeds one food, one dish
and one meal template at the end for the existing-item editors, prints `MISSING RETRY on <screen>` if
an error state has no Try again button, and uses a 2× device scale factor to keep the files small.
Only `net::ERR_FAILED` console lines are expected. The table of what each screen shows per state is in
DECISIONS.md (Phase 9 section).

```sh
node tools/shots/phase10-followups.mjs    # reviewer follow-ups: food editor portions (drag handles + move buttons, one move, one pointer drag; phone + desktop), picker Meals shelf error + the notice while searching, "Copy to another day…" from an archived meal, summary card over the goal but on target, lazy-chunk error page in the shell (phone + desktop) + Reload, adherence headline while settings load, profile Sex radiogroup, Insights year (first weekly tick = 1 Jan) and the year view with a goal on every day (goal band must start at the plot edge, phone + desktop); PNGs 100–113
```

`phase10-followups.mjs` creates a food with three portions ("Followups banana") and a meal slot
("Followups supper") with one entry, archives the slot and deletes the food and the entry again at the
end (the archived, empty slot stays: slots are never deleted). The failing templates request, the
over-but-on-target day, the lazy chunk failure, the slow settings request and the "goal on every day"
insights data are `page.route()` mocks (nothing is mocked in the app). It logs the portion order after
the move button and after the drag, the Into-meal options for the archived source, the "over" line's
classes, the chunk-error text, the Sex group's `aria-labelledby`, the first weekly tick and the goal
band geometry (`BAND MISPLACED` if the band's `x` is not the plot's `x`). The `Failed to load resource`
/ `dynamically imported module` console lines come from the mocks and are expected.
