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
