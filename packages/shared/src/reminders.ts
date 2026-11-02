import { z } from 'zod';
import { idSchema } from './foods.js';
import { minutesOfDaySchema } from './mealSlots.js';

// ---------- time zones ----------

export const TIME_ZONE_MAX = 64;

/**
 * True for an IANA zone the runtime can format in. `Intl.supportedValuesOf` lists one spelling per
 * zone and engines disagree on which (V8 lists `Asia/Calcutta`, Firefox reports `Asia/Kolkata`), so
 * a zone missing from the list is still accepted when `Intl.DateTimeFormat` takes it.
 */
export function isValidTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > TIME_ZONE_MAX) return false;
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      if (intl.supportedValuesOf('timeZone').includes(value)) return true;
    } catch {
      // Fall through to the constructor probe.
    }
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .max(TIME_ZONE_MAX, 'Time zone name is too long')
  .refine(isValidTimeZone, { message: 'Unknown time zone' });

/**
 * Whether two zone names denote the same zone. Browsers report aliases differently (Chrome says
 * `Asia/Calcutta`, Firefox `Asia/Kolkata`), so names are compared after the engine canonicalises
 * both; unknown names compare by spelling only.
 */
export function sameTimeZone(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const canonical = (zone: string) =>
      new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
    return canonical(a) === canonical(b);
  } catch {
    return false;
  }
}

// ---------- reminder configuration (FR-N1), stored as one JSON row in `settings` ----------

export const mealReminderSchema = z.object({
  slotId: idSchema,
  enabled: z.boolean(),
  /** Minutes since local midnight; defaults to the slot's window end. */
  minute: minutesOfDaySchema,
  /** Skip the reminder when the meal already has an entry that day. */
  onlyIfEmpty: z.boolean(),
});
export type MealReminder = z.infer<typeof mealReminderSchema>;

export const REMINDER_MEALS_MAX = 100;

/** `PUT reminders`: the whole configuration, replaced in one go. */
export const remindersConfigSchema = z.object({
  /** Master switch; nothing is sent while off. */
  enabled: z.boolean(),
  /** The zone reminder times are in (the phone's, sent by the client). */
  timezone: timeZoneSchema,
  meals: z
    .array(mealReminderSchema)
    .max(REMINDER_MEALS_MAX)
    .refine((meals) => new Set(meals.map((m) => m.slotId)).size === meals.length, {
      message: 'Each meal slot may appear only once',
    }),
  /** Fires only when no weight is logged for the day. */
  weighIn: z.object({ enabled: z.boolean(), minute: minutesOfDaySchema }),
  /** Fires only when the day's water is below the goal (needs a goal with a water target). */
  water: z.object({ enabled: z.boolean(), minute: minutesOfDaySchema }),
});
export type RemindersConfig = z.infer<typeof remindersConfigSchema>;

/**
 * `GET reminders`: the stored configuration reconciled with the active meal slots (one entry per
 * slot, defaults for slots added since the last save). `timezone` is null until the first save.
 */
export const remindersSchema = remindersConfigSchema.extend({
  timezone: timeZoneSchema.nullable(),
});
export type Reminders = z.infer<typeof remindersSchema>;

export const DEFAULT_WEIGH_IN_MINUTE = 7 * 60 + 30;
export const DEFAULT_WATER_MINUTE = 17 * 60;

export const DEFAULT_REMINDERS: Omit<Reminders, 'meals'> = {
  enabled: false,
  timezone: null,
  weighIn: { enabled: true, minute: DEFAULT_WEIGH_IN_MINUTE },
  water: { enabled: false, minute: DEFAULT_WATER_MINUTE },
};

export function defaultMealReminder(slot: { id: number; windowEndMin: number }): MealReminder {
  return { slotId: slot.id, enabled: true, minute: slot.windowEndMin, onlyIfEmpty: true };
}

// ---------- scheduling (pure; the API's scheduler calls these once a minute) ----------

/** Keys of the `reminder_sends` ledger and the notification `tag` (a repeat replaces the last one). */
export const reminderKeys = {
  meal: (slotId: number) => `meal:${slotId}`,
  weighIn: 'weigh-in',
  water: 'water',
  test: 'test',
} as const;

/** A moment expressed in a zone: the local day key and minutes since that day's midnight. */
export interface LocalClock {
  day: string;
  minute: number;
}

export function localClock(now: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const year = part('year') ?? '0000';
  const month = part('month') ?? '00';
  const day = part('day') ?? '00';
  // Some engines print midnight as "24" under h23 for a few locales; keep the minute in range.
  const hour = Number(part('hour') ?? '0') % 24;
  const minute = Number(part('minute') ?? '0');
  return { day: `${year}-${month}-${day}`, minute: hour * 60 + minute };
}

/**
 * How long after its time a reminder may still go out. Covers a server restart or a clock jump
 * (the spring DST gap skips the configured minute entirely) without replaying a whole day's
 * reminders after a long outage.
 */
export const REMINDER_LATE_WINDOW_MIN = 120;

export interface ReminderDueInput {
  /** Configured minute of the local day. */
  minute: number;
  clock: LocalClock;
  /** A `reminder_sends` row exists for this reminder and `clock.day`. */
  alreadySent: boolean;
  /** "Only if nothing is logged" and friends; a function is called only once the time checks pass. */
  conditionHolds: boolean | (() => boolean);
}

/**
 * Due when the local time has reached the configured minute (and is within the late window) on a
 * day the reminder has not gone out yet and its condition holds. The day boundary comes from the
 * clock, so a 23:30 reminder is never carried into the next day.
 */
export function isReminderDue(input: ReminderDueInput): boolean {
  const { minute, clock, alreadySent, conditionHolds } = input;
  if (alreadySent) return false;
  if (clock.minute < minute || clock.minute >= minute + REMINDER_LATE_WINDOW_MIN) return false;
  return typeof conditionHolds === 'function' ? conditionHolds() : conditionHolds;
}
