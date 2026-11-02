import {
  DEFAULT_MEAL_SLOTS,
  type ApiError,
  type Food,
  type MealSlot,
  type Reminders,
  type RemindersConfig,
} from '@plate/shared';
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type webpush from 'web-push';
import { GoalService } from '../src/goals/service.js';
import { MealSlotService } from '../src/mealSlots/service.js';
import { PushService } from '../src/push/service.js';
import { ReminderScheduler } from '../src/reminders/scheduler.js';
import { ReminderService } from '../src/reminders/service.js';
import { createTestApp, login, type TestContext } from './helpers.js';

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('web-push', async () => {
  const actual = await vi.importActual<typeof webpush>('web-push');
  return {
    default: {
      generateVAPIDKeys: actual.generateVAPIDKeys,
      sendNotification: mocks.sendNotification,
    },
  };
});

const TZ = 'Asia/Kolkata';
/** `YYYY-MM-DDTHH:mm` in Kolkata (UTC+05:30) as an instant. */
const kolkata = (local: string) => new Date(`${local}:00+05:30`);
const DAY = '2025-06-02';

let ctx: TestContext;
let cookie: string;
let slots: MealSlot[];
let scheduler: ReminderScheduler;
let push: PushService;

const silentLogger = { info: () => undefined, error: () => undefined };

beforeEach(async () => {
  mocks.sendNotification.mockReset();
  mocks.sendNotification.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
  ctx = await createTestApp();
  new MealSlotService(ctx.opened.db).seedDefaults();
  cookie = await login(ctx.app);
  slots = (await api('GET', '/api/meal-slots')).json<MealSlot[]>();

  const db = ctx.opened.db;
  const mealSlots = new MealSlotService(db);
  const reminders = new ReminderService(db, { mealSlots, goals: new GoalService(db) });
  push = new PushService(db, { vapidSubject: 'mailto:test@plate.test' });
  scheduler = new ReminderScheduler({ reminders, mealSlots, push, logger: silentLogger });
});
afterEach(() => ctx.close());

const api = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) => {
  const options: InjectOptions = { method, url, headers: { cookie } };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
  return ctx.app.inject(options);
};

const paths = (res: { json: () => { error: { details?: unknown } } }) =>
  (res.json().error.details as { path: string }[]).map((d) => d.path);

const slot = (name: string) => slots.find((s) => s.name === name)!;

function config(overrides: Partial<RemindersConfig> = {}): RemindersConfig {
  return {
    enabled: true,
    timezone: TZ,
    meals: slots.map((s) => ({
      slotId: s.id,
      enabled: true,
      minute: s.windowEndMin,
      onlyIfEmpty: true,
    })),
    weighIn: { enabled: true, minute: 7 * 60 + 30 },
    water: { enabled: false, minute: 17 * 60 },
    ...overrides,
  };
}

async function putConfig(body: RemindersConfig): Promise<Reminders> {
  const res = await api('PUT', '/api/reminders', body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Reminders>();
}

async function enrol(endpoint = 'https://fcm.googleapis.com/fcm/send/one'): Promise<void> {
  const res = await api('POST', '/api/push/subscriptions', {
    subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
    deviceLabel: 'Chrome on Android',
    timezone: TZ,
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function logFood(slotId: number, day = DAY): Promise<void> {
  const food = (
    await api('POST', '/api/foods', {
      name: `Food ${slotId}`,
      per100: {
        kcal: 100,
        protein: 1,
        carbs: 1,
        fat: 1,
        fiber: null,
        sugar: null,
        saturatedFat: null,
        sodiumMg: null,
      },
    })
  ).json<Food>();
  const res = await api('POST', '/api/diary/entries', {
    day,
    slotId,
    loggedAt: `${day}T12:00:00+05:30`,
    foodId: food.id,
    quantity: 100,
  });
  expect(res.statusCode, res.body).toBe(201);
}

/** Titles of everything pushed so far, in order. */
const sentTitles = () =>
  mocks.sendNotification.mock.calls.map(
    (call) => (JSON.parse(call[1] as string) as { title: string }).title,
  );

const sentPayload = (index = 0) =>
  JSON.parse(mocks.sendNotification.mock.calls[index]![1] as string) as Record<string, unknown>;

describe('auth gate on reminder routes', () => {
  it('denies anonymous access', async () => {
    for (const [method, url] of [
      ['GET', '/api/reminders'],
      ['PUT', '/api/reminders'],
    ] as const) {
      const options: InjectOptions = { method, url };
      if (method === 'PUT') options.payload = config();
      const res = await ctx.app.inject(options);
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Session/);
    }
  });
});

describe('GET /api/reminders', () => {
  it('starts off, without a time zone, with one default per active slot (window end, only if empty)', async () => {
    const res = await api('GET', '/api/reminders');
    expect(res.statusCode).toBe(200);
    const body = res.json<Reminders>();
    expect(body.enabled).toBe(false);
    expect(body.timezone).toBeNull();
    expect(body.weighIn).toEqual({ enabled: true, minute: 450 });
    expect(body.water).toEqual({ enabled: false, minute: 1020 });
    expect(body.meals).toEqual(
      DEFAULT_MEAL_SLOTS.map((s) => ({
        slotId: slot(s.name).id,
        enabled: true,
        minute: s.windowEndMin,
        onlyIfEmpty: true,
      })),
    );
  });
});

describe('PUT /api/reminders', () => {
  it('rejects an unknown time zone, an out-of-range minute, a slot listed twice and an unknown slot, with paths', async () => {
    const dinner = slot('Dinner');
    const cases: [RemindersConfig, string][] = [
      [config({ timezone: 'Mars/Olympus_Mons' }), 'timezone'],
      [config({ weighIn: { enabled: true, minute: 1440 } }), 'weighIn.minute'],
      [
        config({
          meals: [
            { slotId: dinner.id, enabled: true, minute: 1, onlyIfEmpty: true },
            { slotId: dinner.id, enabled: true, minute: 2, onlyIfEmpty: true },
          ],
        }),
        'meals',
      ],
      [
        config({
          meals: [
            { slotId: dinner.id, enabled: true, minute: 1, onlyIfEmpty: true },
            { slotId: 999, enabled: true, minute: 2, onlyIfEmpty: true },
          ],
        }),
        'meals.1.slotId',
      ],
    ];
    for (const [body, path] of cases) {
      const res = await api('PUT', '/api/reminders', body);
      expect(res.statusCode, path).toBe(400);
      expect(res.json<ApiError>().error.code).toBe('VALIDATION_ERROR');
      expect(paths(res), path).toEqual([path]);
    }
  });

  it('stores the configuration and returns it reconciled with the slots', async () => {
    const dinner = slot('Dinner');
    const body = config({
      meals: [{ slotId: dinner.id, enabled: true, minute: 21 * 60, onlyIfEmpty: false }],
      water: { enabled: true, minute: 16 * 60 },
    });
    const saved = await putConfig(body);
    expect(saved.enabled).toBe(true);
    expect(saved.timezone).toBe(TZ);
    expect(saved.water).toEqual({ enabled: true, minute: 960 });
    // Slots left out of the body come back with defaults; the saved one keeps its values.
    expect(saved.meals).toHaveLength(slots.length);
    expect(saved.meals.find((m) => m.slotId === dinner.id)).toEqual(body.meals[0]);
    expect(saved.meals.find((m) => m.slotId === slot('Lunch').id)).toEqual({
      slotId: slot('Lunch').id,
      enabled: true,
      minute: slot('Lunch').windowEndMin,
      onlyIfEmpty: true,
    });
    expect((await api('GET', '/api/reminders')).json<Reminders>()).toEqual(saved);
  });

  it('follows the meal slots: a new slot gets defaults, an archived one disappears, restoring brings its settings back', async () => {
    const dinner = slot('Dinner');
    await putConfig(
      config({
        meals: [{ slotId: dinner.id, enabled: false, minute: 20 * 60, onlyIfEmpty: true }],
      }),
    );
    const supper = (
      await api('POST', '/api/meal-slots', {
        name: 'Supper',
        windowStartMin: 1320,
        windowEndMin: 1410,
      })
    ).json<MealSlot>();
    let view = (await api('GET', '/api/reminders')).json<Reminders>();
    expect(view.meals.map((m) => m.slotId)).toContain(supper.id);
    expect(view.meals.find((m) => m.slotId === supper.id)).toMatchObject({
      minute: 1410,
      enabled: true,
    });

    await api('POST', `/api/meal-slots/${dinner.id}/archive`);
    view = (await api('GET', '/api/reminders')).json<Reminders>();
    expect(view.meals.map((m) => m.slotId)).not.toContain(dinner.id);
    // A save made while Dinner is archived (the UI sends only the slots it shows) keeps its settings.
    await putConfig({ ...view, timezone: TZ, water: { enabled: true, minute: 900 } });

    await api('POST', `/api/meal-slots/${dinner.id}/unarchive`);
    view = (await api('GET', '/api/reminders')).json<Reminders>();
    expect(view.water).toEqual({ enabled: true, minute: 900 });
    expect(view.meals.find((m) => m.slotId === dinner.id)).toMatchObject({
      enabled: false,
      minute: 1200,
    });
  });
});

describe('ReminderScheduler', () => {
  it('does nothing while reminders are off, unconfigured or no device is enrolled', async () => {
    // Off by default.
    expect(await scheduler.tick(kolkata(`${DAY}T22:00`))).toEqual({ day: null, fired: [] });
    // On, but nobody to send to.
    await putConfig(config());
    expect(await scheduler.tick(kolkata(`${DAY}T22:00`))).toEqual({ day: null, fired: [] });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('fires a meal reminder at the slot window end in the configured zone, once per local day', async () => {
    await putConfig(config());
    await enrol();
    const dinner = slot('Dinner'); // window ends 22:00

    expect(await scheduler.tick(kolkata(`${DAY}T21:59`))).toEqual({ day: DAY, fired: [] });
    const first = await scheduler.tick(kolkata(`${DAY}T22:00`));
    expect(first).toEqual({ day: DAY, fired: [`meal:${dinner.id}`] });
    expect(sentPayload()).toEqual({
      title: 'Dinner not logged yet',
      body: "Tap to open today's diary.",
      tag: `meal:${dinner.id}`,
      url: '/today',
    });
    expect(mocks.sendNotification.mock.calls[0]![2]).toMatchObject({ TTL: 3600, urgency: 'high' });
    expect(ctx.opened.sqlite.prepare('SELECT reminder_key, day FROM reminder_sends').all()).toEqual(
      [{ reminder_key: `meal:${dinner.id}`, day: DAY }],
    );

    // Later ticks the same evening do not repeat it; the next day it is due again.
    expect(await scheduler.tick(kolkata(`${DAY}T22:01`))).toEqual({ day: DAY, fired: [] });
    expect(await scheduler.tick(kolkata(`${DAY}T23:30`))).toEqual({ day: DAY, fired: [] });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    expect((await scheduler.tick(kolkata('2025-06-03T22:00'))).fired).toEqual([
      `meal:${dinner.id}`,
    ]);
  });

  it('uses the configured zone for the day boundary: 00:10 in Kolkata is a new day', async () => {
    await putConfig(config());
    await enrol();
    // 18:40 UTC = 00:10 Kolkata on the next day: yesterday's dinner reminder (22:00) is gone.
    const result = await scheduler.tick(new Date(`${DAY}T18:40:00Z`));
    expect(result).toEqual({ day: '2025-06-03', fired: [] });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('skips a reminder once its late window has passed (a long outage does not replay the day)', async () => {
    await putConfig(config());
    await enrol();
    // Breakfast ends 10:30, lunch 14:30; at 13:00 breakfast is 150 min late (window 120) but lunch is not due yet.
    expect((await scheduler.tick(kolkata(`${DAY}T13:00`))).fired).toEqual([]);
    // At 14:35 lunch is due; breakfast stays skipped.
    expect((await scheduler.tick(kolkata(`${DAY}T14:35`))).fired).toEqual([
      `meal:${slot('Lunch').id}`,
    ]);
  });

  it('honours "only if nothing is logged", and words the reminder by what is logged otherwise', async () => {
    const dinner = slot('Dinner');
    await enrol();
    await logFood(dinner.id);

    await putConfig(config());
    expect((await scheduler.tick(kolkata(`${DAY}T22:00`))).fired).toEqual([]);

    await putConfig(
      config({
        meals: [{ slotId: dinner.id, enabled: true, minute: 22 * 60, onlyIfEmpty: false }],
      }),
    );
    expect((await scheduler.tick(kolkata(`${DAY}T22:00`))).fired).toEqual([`meal:${dinner.id}`]);
    expect(sentPayload().title).toBe('Time to log Dinner');

    // The condition is re-checked on later ticks: once the entry is gone, the reminder goes out.
    await putConfig(config());
    expect((await scheduler.tick(kolkata('2025-06-03T22:00'))).fired).toEqual([
      `meal:${dinner.id}`,
    ]);
    expect(sentTitles().at(-1)).toBe('Dinner not logged yet');
  });

  it('leaves disabled meals alone and ignores archived slots', async () => {
    await enrol();
    const breakfast = slot('Breakfast');
    const lunch = slot('Lunch');
    await putConfig(
      config({
        meals: [
          { slotId: breakfast.id, enabled: false, minute: 10 * 60 + 30, onlyIfEmpty: true },
          { slotId: lunch.id, enabled: true, minute: 10 * 60 + 30, onlyIfEmpty: true },
        ],
        weighIn: { enabled: false, minute: 450 },
      }),
    );
    await api('POST', `/api/meal-slots/${lunch.id}/archive`);
    expect((await scheduler.tick(kolkata(`${DAY}T10:30`))).fired).toEqual([]);
    await api('POST', `/api/meal-slots/${lunch.id}/unarchive`);
    expect((await scheduler.tick(kolkata(`${DAY}T10:30`))).fired).toEqual([`meal:${lunch.id}`]);
  });

  it('reminds to weigh in only when the day has no weight', async () => {
    await enrol();
    await putConfig(config({ meals: [] }));
    expect((await scheduler.tick(kolkata(`${DAY}T07:30`))).fired).toEqual(['weigh-in']);
    expect(sentPayload()).toEqual({
      title: 'Time to weigh in',
      body: "Log today's weight in Plate.",
      tag: 'weigh-in',
      url: '/weight',
    });

    await api('PUT', '/api/weights/2025-06-03', { kg: 74.2 });
    expect((await scheduler.tick(kolkata('2025-06-03T07:30'))).fired).toEqual([]);
  });

  it('nudges about water only below a goal that has a water target', async () => {
    await enrol();
    await putConfig(
      config({
        meals: [],
        weighIn: { enabled: false, minute: 450 },
        water: { enabled: true, minute: 17 * 60 },
      }),
    );
    // No goal at all: nothing to be below.
    expect((await scheduler.tick(kolkata(`${DAY}T17:00`))).fired).toEqual([]);

    const goal = await api('POST', '/api/goals', {
      effectiveFrom: '2025-01-01',
      kcal: 2000,
      proteinG: 150,
      carbsG: 200,
      fatG: 70,
      fiberG: null,
      waterMl: 2000,
      goalWeightKg: null,
      goalWeightDate: null,
    });
    expect(goal.statusCode, goal.body).toBe(201);
    await api('POST', '/api/water', { day: DAY, ml: 500 });
    expect((await scheduler.tick(kolkata(`${DAY}T17:00`))).fired).toEqual(['water']);
    expect(sentPayload()).toEqual({
      title: 'Below your water goal',
      body: 'There is still water to drink today.',
      tag: 'water',
      url: '/today',
    });

    await api('POST', '/api/water', { day: '2025-06-03', ml: 2500 });
    expect((await scheduler.tick(kolkata('2025-06-03T17:00'))).fired).toEqual([]);
  });

  it('sends to every device, drops the ones reported gone and keeps ticking after a failure', async () => {
    await putConfig(config({ meals: [] }));
    await enrol('https://push.example/fine');
    await enrol('https://push.example/gone');
    mocks.sendNotification.mockImplementation((target: unknown) =>
      (target as { endpoint: string }).endpoint.endsWith('/gone')
        ? Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 }))
        : Promise.resolve({ statusCode: 201, body: '', headers: {} }),
    );
    expect((await scheduler.tick(kolkata(`${DAY}T07:30`))).fired).toEqual(['weigh-in']);
    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
    expect(push.list().map((d) => d.endpoint)).toEqual(['https://push.example/fine']);

    mocks.sendNotification.mockRejectedValue(new Error('network down'));
    expect((await scheduler.tick(kolkata('2025-06-03T07:30'))).fired).toEqual(['weigh-in']);
    expect(push.list()[0]!.failures).toBe(1);
  });

  it('prunes ledger rows older than a week', async () => {
    await putConfig(config({ meals: [] }));
    await enrol();
    ctx.opened.sqlite
      .prepare('INSERT INTO reminder_sends (reminder_key, day, sent_at) VALUES (?, ?, ?)')
      .run('weigh-in', '2025-05-20', '2025-05-20T02:00:00.000Z');
    await scheduler.tick(kolkata(`${DAY}T07:30`));
    expect(
      (
        ctx.opened.sqlite.prepare('SELECT day FROM reminder_sends ORDER BY day').all() as {
          day: string;
        }[]
      ).map((r) => r.day),
    ).toEqual([DAY]);
  });
});
