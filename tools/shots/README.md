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
