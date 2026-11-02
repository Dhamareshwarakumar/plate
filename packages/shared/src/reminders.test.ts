import { describe, expect, it } from 'vitest';
import {
  defaultMealReminder,
  isReminderDue,
  isValidTimeZone,
  localClock,
  REMINDER_LATE_WINDOW_MIN,
  remindersConfigSchema,
  sameTimeZone,
  timeZoneSchema,
  type LocalClock,
} from './reminders.js';

describe('isValidTimeZone', () => {
  it('accepts canonical IANA names, their legacy aliases and UTC', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Asia/Calcutta')).toBe(true);
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('rejects made-up zones, the empty string and over-long names', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Europe/'.padEnd(80, 'x'))).toBe(false);
    expect(timeZoneSchema.safeParse('Nowhere/Land').error?.issues[0]?.message).toBe(
      'Unknown time zone',
    );
  });
});

describe('sameTimeZone', () => {
  it('treats an alias and its canonical name as one zone, different zones as different', () => {
    expect(sameTimeZone('Asia/Kolkata', 'Asia/Calcutta')).toBe(true);
    expect(sameTimeZone('Asia/Kolkata', 'Asia/Kolkata')).toBe(true);
    expect(sameTimeZone('Asia/Kolkata', 'Europe/Berlin')).toBe(false);
    expect(sameTimeZone('Asia/Kolkata', 'Nowhere/Land')).toBe(false);
  });
});

describe('remindersConfigSchema', () => {
  const valid = {
    enabled: true,
    timezone: 'Asia/Kolkata',
    meals: [{ slotId: 1, enabled: true, minute: 630, onlyIfEmpty: true }],
    weighIn: { enabled: true, minute: 450 },
    water: { enabled: false, minute: 1020 },
  };

  it('accepts a full configuration', () => {
    expect(remindersConfigSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a slot listed twice and minutes outside the day', () => {
    const twice = { ...valid, meals: [valid.meals[0], valid.meals[0]] };
    expect(remindersConfigSchema.safeParse(twice).error?.issues[0]?.path).toEqual(['meals']);
    const late = { ...valid, weighIn: { enabled: true, minute: 1440 } };
    expect(remindersConfigSchema.safeParse(late).error?.issues[0]?.path).toEqual([
      'weighIn',
      'minute',
    ]);
  });

  it('defaults a meal reminder to the slot window end, enabled, only when empty', () => {
    expect(defaultMealReminder({ id: 4, windowEndMin: 22 * 60 })).toEqual({
      slotId: 4,
      enabled: true,
      minute: 1320,
      onlyIfEmpty: true,
    });
  });
});

describe('localClock', () => {
  it('gives the day and minute in the zone, not the host zone', () => {
    // 18:40 UTC on 1 June is 00:10 on 2 June in Kolkata (midnight already wrapped there).
    expect(localClock(new Date('2025-06-01T18:40:00Z'), 'Asia/Kolkata')).toEqual({
      day: '2025-06-02',
      minute: 10,
    });
    expect(localClock(new Date('2025-06-01T18:40:00Z'), 'UTC')).toEqual({
      day: '2025-06-01',
      minute: 18 * 60 + 40,
    });
    expect(localClock(new Date('2025-06-02T03:30:00Z'), 'America/Los_Angeles')).toEqual({
      day: '2025-06-01',
      minute: 20 * 60 + 30,
    });
  });

  it('follows the spring-forward jump (02:00 → 03:00 in Berlin on 30 March 2025)', () => {
    expect(localClock(new Date('2025-03-30T00:59:00Z'), 'Europe/Berlin').minute).toBe(119);
    expect(localClock(new Date('2025-03-30T01:00:00Z'), 'Europe/Berlin').minute).toBe(180);
  });

  it('repeats the hour when clocks fall back (26 October 2025 in Berlin)', () => {
    expect(localClock(new Date('2025-10-26T00:30:00Z'), 'Europe/Berlin').minute).toBe(150);
    expect(localClock(new Date('2025-10-26T01:30:00Z'), 'Europe/Berlin').minute).toBe(150);
  });
});

describe('isReminderDue', () => {
  const at = (minute: number, day = '2025-06-02'): LocalClock => ({ day, minute });
  const due = (
    clock: LocalClock,
    minute = 22 * 60,
    extra: Partial<Parameters<typeof isReminderDue>[0]> = {},
  ) => isReminderDue({ minute, clock, alreadySent: false, conditionHolds: true, ...extra });

  it('fires from the configured minute until the late window closes', () => {
    expect(due(at(21 * 60 + 59))).toBe(false);
    expect(due(at(22 * 60))).toBe(true);
    expect(due(at(22 * 60 + 45))).toBe(true);
    expect(due(at(22 * 60 + REMINDER_LATE_WINDOW_MIN - 1))).toBe(true);
    expect(due(at(22 * 60 + REMINDER_LATE_WINDOW_MIN))).toBe(false);
  });

  it('is not carried over midnight: at 00:05 a 23:30 reminder belongs to the new day', () => {
    expect(due(at(23 * 60 + 40), 23 * 60 + 30)).toBe(true);
    expect(due(at(5, '2025-06-03'), 23 * 60 + 30)).toBe(false);
  });

  it('fires once: an existing send for the day blocks it', () => {
    expect(due(at(22 * 60 + 1), 22 * 60, { alreadySent: true })).toBe(false);
  });

  it('respects the condition and only evaluates it once the time is right', () => {
    expect(due(at(22 * 60 + 1), 22 * 60, { conditionHolds: false })).toBe(false);
    let calls = 0;
    const probe = () => {
      calls += 1;
      return true;
    };
    expect(due(at(21 * 60), 22 * 60, { conditionHolds: probe })).toBe(false);
    expect(calls).toBe(0);
    expect(due(at(22 * 60), 22 * 60, { conditionHolds: probe })).toBe(true);
    expect(calls).toBe(1);
  });

  it('still fires on the spring-forward day when the configured minute never happens', () => {
    // 02:30 local does not exist in Berlin on 30 March 2025; the first tick after the jump is 03:00.
    const clock = localClock(new Date('2025-03-30T01:00:30Z'), 'Europe/Berlin');
    expect(clock).toEqual({ day: '2025-03-30', minute: 180 });
    expect(due(clock, 2 * 60 + 30)).toBe(true);
  });
});
