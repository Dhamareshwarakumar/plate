#!/usr/bin/env node
// Seeds a demo month through the API: ~35 days of meals, weigh-ins and water ending today.
//   node tools/seed-demo.mjs [--days=35] [--yes]
// Env: PLATE_API (default http://127.0.0.1:8080/api), PLATE_PASSWORD (default "password").
// Re-runnable, but destructive inside its window: it deletes EVERY goal, then each day's diary
// entries, water and weigh-in before logging them again. The food library is kept. Against anything
// other than a loopback API (a real deployment) it refuses to run without --yes.

const API = process.env.PLATE_API ?? 'http://127.0.0.1:8080/api';
const PASSWORD = process.env.PLATE_PASSWORD ?? 'password';
const DAYS = Number(process.argv.find((a) => a.startsWith('--days='))?.slice(7) ?? 35);
const CONFIRMED = process.argv.includes('--yes');

const apiHost = new URL(API).hostname;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(apiHost) && !CONFIRMED) {
  console.error(
    `Refusing to seed ${API}: this deletes every goal and the diary, water and weigh-ins of the last ${DAYS} days.\n` +
      'Pass --yes if that is really what you want.',
  );
  process.exit(2);
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = dayKey(now);
const daysAgo = (n) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
function offsetOf(d) {
  const m = -d.getTimezoneOffset();
  const sign = m >= 0 ? '+' : '-';
  return `${sign}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`;
}
const at = (day, hhmm) => `${day}T${hhmm}:00${offsetOf(now)}`;

// Deterministic noise so the demo looks the same on every run.
let seed = 20251019;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const between = (lo, hi) => lo + (hi - lo) * rand();
const pick = (list) => list[Math.floor(rand() * list.length)];

// ---------- API ----------

let cookie = '';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(method, path, data) {
  for (;;) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    if (res.status === 429) {
      // The API allows 300 requests a minute; a full seed needs more, so wait it out.
      const retryAfter = Number(res.headers.get('retry-after') ?? 2);
      await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const session = setCookie.find((c) => c.startsWith('plate_session='));
    if (session) cookie = session.split(';')[0];
    return res.status === 204 ? null : res.json();
  }
}

// ---------- library ----------

const per100 = (kcal, protein, carbs, fat, extra = {}) => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
  ...extra,
});

/** Name → per-100 values and the typical quantity range (g) for one serving. */
const FOODS = [
  { name: 'Oats', per100: per100(389, 16.9, 66.3, 6.9, { fiber: 10.6 }), serving: [60, 90] },
  { name: 'Greek yogurt', per100: per100(59, 10.3, 3.6, 0.4), serving: [150, 200] },
  {
    name: 'Banana',
    per100: per100(89, 1.1, 22.8, 0.3, { fiber: 2.6, sugar: 12.2 }),
    serving: [100, 130],
  },
  { name: 'Eggs', per100: per100(155, 13, 1.1, 11), serving: [100, 150] },
  { name: 'Whole wheat bread', per100: per100(247, 13, 41, 3.4, { fiber: 7 }), serving: [60, 90] },
  { name: 'Peanut butter', per100: per100(588, 25, 20, 50), serving: [15, 30] },
  { name: 'Chicken breast', per100: per100(165, 31, 0, 3.6), serving: [150, 220] },
  { name: 'Brown rice', per100: per100(123, 2.7, 25.6, 1), serving: [180, 260] },
  { name: 'Broccoli', per100: per100(34, 2.8, 7, 0.4, { fiber: 2.6 }), serving: [120, 200] },
  { name: 'Salmon', per100: per100(208, 20, 0, 13), serving: [140, 200] },
  { name: 'Sweet potato', per100: per100(86, 1.6, 20, 0.1, { fiber: 3 }), serving: [180, 260] },
  { name: 'Olive oil', per100: per100(884, 0, 0, 100), serving: [8, 15] },
  {
    name: 'Apple',
    per100: per100(52, 0.3, 14, 0.2, { fiber: 2.4, sugar: 10 }),
    serving: [150, 200],
  },
  { name: 'Almonds', per100: per100(579, 21, 22, 50, { fiber: 12.5 }), serving: [20, 40] },
  { name: 'Dark chocolate', per100: per100(546, 4.9, 61, 31, { sugar: 48 }), serving: [20, 40] },
  { name: 'Milk', per100: per100(42, 3.4, 5, 1, { sugar: 5 }), basis: 'ml', serving: [200, 250] },
];

const MEALS = {
  Breakfast: [
    ['Oats', 'Milk', 'Banana'],
    ['Greek yogurt', 'Banana', 'Almonds'],
    ['Eggs', 'Whole wheat bread'],
    ['Whole wheat bread', 'Peanut butter', 'Banana'],
  ],
  Lunch: [
    ['Chicken breast', 'Brown rice', 'Broccoli'],
    ['Salmon', 'Sweet potato', 'Broccoli', 'Olive oil'],
    ['Chicken breast', 'Sweet potato', 'Olive oil'],
  ],
  Snacks: [['Apple'], ['Almonds'], ['Dark chocolate'], ['Greek yogurt', 'Apple']],
  Dinner: [
    ['Salmon', 'Brown rice', 'Broccoli', 'Olive oil'],
    ['Chicken breast', 'Sweet potato', 'Broccoli'],
    ['Eggs', 'Whole wheat bread', 'Olive oil'],
  ],
};
const TIMES = {
  Breakfast: ['07:20', '08:10'],
  Lunch: ['12:30', '13:30'],
  Snacks: ['16:00', '16:45'],
  Dinner: ['19:00', '20:15'],
};

const PROTEIN_BAR = per100(200, 20, 20, 6, { fiber: 3, sugar: 8 });

async function ensureFoods() {
  const { items } = await api('GET', '/foods?includeArchived=true');
  const byName = new Map(items.map((f) => [f.name.toLowerCase(), f]));
  const out = new Map();
  for (const spec of FOODS) {
    let food = byName.get(spec.name.toLowerCase());
    if (!food) {
      food = await api('POST', '/foods', {
        name: spec.name,
        basis: spec.basis ?? 'g',
        per100: spec.per100,
        kind: 'food',
      });
    } else if (food.archivedAt) {
      food = await api('POST', `/foods/${food.id}/unarchive`);
    }
    out.set(spec.name, { ...spec, id: food.id, basis: food.basis });
  }
  return out;
}

// ---------- goals ----------

const GOAL = (effectiveFrom, kcal) => ({
  effectiveFrom,
  kcal,
  proteinG: 150,
  carbsG: kcal >= 2000 ? 220 : 200,
  fatG: 65,
  fiberG: 30,
  waterMl: 2500,
  goalWeightKg: 74,
  goalWeightDate: daysAgo(-120),
});

async function resetGoals(windowStart) {
  for (const goal of await api('GET', '/goals')) await api('DELETE', `/goals/${goal.id}`);
  await api('POST', '/goals', GOAL(windowStart, 2000));
  if (DAYS > 20) await api('POST', '/goals', GOAL(daysAgo(DAYS - 1 - 20), 1900));
}

// ---------- days ----------

async function clearDay(day) {
  const view = await api('GET', `/diary/${day}`);
  for (const slot of view.slots) {
    for (const entry of slot.entries) await api('DELETE', `/diary/entries/${entry.id}`);
  }
  for (const entry of view.water.entries) await api('DELETE', `/water/${entry.id}`);
  return view;
}

/** Scales one meal's servings so the day lands on the chosen status against the goal. */
function scaleFor(kind) {
  if (kind === 'under') return between(0.62, 0.82);
  if (kind === 'over') return between(1.16, 1.32);
  return between(0.94, 1.06);
}

async function logMeal(day, slotId, foods, names, time, scale) {
  for (const name of names) {
    const food = foods.get(name);
    const [lo, hi] = food.serving;
    const quantity = Math.round(between(lo, hi) * scale);
    await api('POST', '/diary/entries', {
      day,
      slotId,
      loggedAt: at(day, time),
      foodId: food.id,
      quantity: Math.max(1, quantity),
    });
  }
}

async function main() {
  await api('POST', '/auth/login', { password: PASSWORD });
  const windowStart = daysAgo(DAYS - 1);
  console.log(`Seeding ${DAYS} days (${windowStart} → ${TODAY}) at ${API}`);

  const foods = await ensureFoods();
  const slots = await api('GET', '/meal-slots');
  const slotId = (name) => slots.find((s) => s.name === name)?.id ?? slots[0].id;
  await resetGoals(windowStart);

  // Which days are skipped, and the status mix for the rest (~55 % on target, 25 % under, 20 % over).
  const skipped = new Set();
  while (skipped.size < Math.min(4, Math.floor(DAYS / 8))) {
    const i = 1 + Math.floor(rand() * (DAYS - 2));
    skipped.add(i);
  }
  let entries = 0;
  let weighIns = 0;
  let water = 0;
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = daysAgo(i);
    await clearDay(day);
    if (skipped.has(i)) continue;

    const r = rand();
    const kind = r < 0.55 ? 'on' : r < 0.8 ? 'under' : 'over';
    const scale = scaleFor(kind);
    const slotsToday =
      i === 0
        ? ['Breakfast', 'Lunch']
        : rand() < 0.75
          ? ['Breakfast', 'Lunch', 'Snacks', 'Dinner']
          : ['Breakfast', 'Lunch', 'Dinner'];
    for (const slotName of slotsToday) {
      const meal = pick(MEALS[slotName]);
      const time = pick(TIMES[slotName]);
      // The snack slot carries most of the day's variance so breakfast stays recognisable.
      const mealScale = slotName === 'Snacks' ? scale * between(0.8, 1.4) : scale;
      await logMeal(day, slotId(slotName), foods, meal, time, mealScale);
      entries += meal.length;
    }
    if (i !== 0 && rand() < 0.22) {
      await api('POST', '/diary/entries', {
        day,
        slotId: slotId('Snacks'),
        loggedAt: at(day, '15:10'),
        foodId: null,
        name: 'Protein bar',
        quantity: 100,
        per100: PROTEIN_BAR,
      });
      entries += 1;
    }
  }

  // Weigh-ins: gentle downward trend with noise, about six gaps.
  const weightGaps = new Set();
  while (weightGaps.size < Math.min(6, Math.floor(DAYS / 6)))
    weightGaps.add(Math.floor(rand() * DAYS));
  for (const w of await api('GET', `/weights?from=${windowStart}&to=${TODAY}`)) {
    await api('DELETE', `/weights/${w.day}`);
  }
  for (let i = DAYS - 1; i >= 0; i--) {
    if (weightGaps.has(i)) continue;
    const kg = Math.round((79.5 - 0.04 * (DAYS - 1 - i) + (rand() - 0.5) * 0.7) * 10) / 10;
    await api('PUT', `/weights/${daysAgo(i)}`, { kg, ...(i === 0 ? { note: 'morning' } : {}) });
    weighIns += 1;
  }

  // Water for the last ten days (cleared above with each day).
  for (let i = Math.min(9, DAYS - 1); i >= 0; i--) {
    if (skipped.has(i)) continue;
    const glasses = i === 0 ? 3 : 5 + Math.floor(rand() * 5);
    for (let g = 0; g < glasses; g++) {
      await api('POST', '/water', { day: daysAgo(i), ml: pick([250, 250, 330, 500]) });
      water += 1;
    }
  }

  console.log(
    `Done: ${entries} diary entries, ${weighIns} weigh-ins, ${water} water entries, ${skipped.size} days skipped, 2 goals.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
