import {
  isReminderDue,
  localClock,
  reminderKeys,
  shiftDayKey,
  type PushPayload,
} from '@plate/shared';
import type { MealSlotService } from '../mealSlots/service.js';
import type { PushService } from '../push/service.js';
import type { ReminderService } from './service.js';

export interface ReminderSchedulerDeps {
  reminders: ReminderService;
  mealSlots: MealSlotService;
  push: PushService;
  logger: {
    info(obj: object, msg: string): void;
    error(obj: object, msg: string): void;
  };
}

export const REMINDER_TICK_MS = 60_000;
/** A reminder the phone cannot receive within the hour is stale; the push service drops it then. */
export const REMINDER_PUSH_TTL_SECONDS = 60 * 60;
/** Ledger rows older than a week are noise. */
const SENDS_RETENTION_DAYS = 7;

export interface TickResult {
  /** Local day in the configured zone; null when reminders are off or nothing could be delivered. */
  day: string | null;
  /** Reminder keys that went out this tick. */
  fired: string[];
}

interface Candidate {
  key: string;
  minute: number;
  /** The notification to send, or null when the reminder's condition does not hold right now. */
  build: () => PushPayload | null;
}

/**
 * Fires the configured reminders (FR-N1) once a minute: computes the local time in the stored
 * zone, picks the reminders whose minute has come on a day they have not gone out yet and whose
 * condition holds, records the send, then pushes to every device. Started by server.ts only; tests
 * drive `tick()` directly.
 */
export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: ReminderSchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), REMINDER_TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()): Promise<TickResult> {
    if (this.running) return { day: null, fired: [] };
    this.running = true;
    try {
      return await this.run(now);
    } catch (err) {
      this.deps.logger.error({ err }, 'reminder tick failed');
      return { day: null, fired: [] };
    } finally {
      this.running = false;
    }
  }

  private async run(now: Date): Promise<TickResult> {
    const { reminders, mealSlots, push, logger } = this.deps;
    const config = reminders.get();
    if (!config.enabled || config.timezone === null || push.count() === 0) {
      return { day: null, fired: [] };
    }
    const clock = localClock(now, config.timezone);
    reminders.pruneSends(shiftDayKey(clock.day, -SENDS_RETENTION_DAYS));

    const slots = new Map(mealSlots.list(false).map((s) => [s.id, s]));
    const candidates: Candidate[] = [];
    for (const meal of config.meals) {
      const slot = slots.get(meal.slotId);
      if (!meal.enabled || !slot) continue;
      const key = reminderKeys.meal(slot.id);
      candidates.push({
        key,
        minute: meal.minute,
        build: () => {
          const logged = reminders.mealEntryCount(clock.day, slot.id) > 0;
          if (meal.onlyIfEmpty && logged) return null;
          return {
            title: logged ? `Time to log ${slot.name}` : `${slot.name} not logged yet`,
            body: "Tap to open today's diary.",
            tag: key,
            url: '/today',
          };
        },
      });
    }
    if (config.weighIn.enabled) {
      candidates.push({
        key: reminderKeys.weighIn,
        minute: config.weighIn.minute,
        build: () =>
          reminders.hasWeight(clock.day)
            ? null
            : {
                title: 'Time to weigh in',
                body: "Log today's weight in Plate.",
                tag: reminderKeys.weighIn,
                url: '/weight',
              },
      });
    }
    if (config.water.enabled) {
      candidates.push({
        key: reminderKeys.water,
        minute: config.water.minute,
        build: () =>
          reminders.waterBelowGoal(clock.day)
            ? {
                title: 'Below your water goal',
                body: 'There is still water to drink today.',
                tag: reminderKeys.water,
                url: '/today',
              }
            : null,
      });
    }

    const fired: string[] = [];
    for (const candidate of candidates) {
      // A holder rather than a `let`: TypeScript does not see assignments made inside the callback.
      const built: { payload: PushPayload | null } = { payload: null };
      const due = isReminderDue({
        minute: candidate.minute,
        clock,
        alreadySent: reminders.wasSent(candidate.key, clock.day),
        conditionHolds: () => {
          built.payload = candidate.build();
          return built.payload !== null;
        },
      });
      if (!due || built.payload === null) continue;
      // The ledger row goes in first: a crash mid-send loses one reminder rather than repeating it.
      if (!reminders.recordSend(candidate.key, clock.day, now.toISOString())) continue;
      const result = await push.send(built.payload, { ttlSeconds: REMINDER_PUSH_TTL_SECONDS });
      logger.info({ key: candidate.key, day: clock.day, ...result }, 'reminder sent');
      fired.push(candidate.key);
    }
    return { day: clock.day, fired };
  }
}
