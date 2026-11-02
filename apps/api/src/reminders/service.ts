import {
  DEFAULT_REMINDERS,
  defaultMealReminder,
  remindersConfigSchema,
  type Reminders,
  type RemindersConfig,
} from '@plate/shared';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { diaryEntries, reminderSends, settings, waterEntries, weights } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { GoalService } from '../goals/service.js';
import type { MealSlotService } from '../mealSlots/service.js';

export const REMINDERS_SETTING_KEY = 'reminders';

export interface ReminderServiceDeps {
  mealSlots: MealSlotService;
  goals: GoalService;
}

/**
 * Reminder configuration (FR-N1, one JSON row in `settings`), the per-day conditions the scheduler
 * checks ("only if nothing is logged in this meal", "no weight today", "below the water goal") and
 * the `reminder_sends` ledger that keeps every reminder to one send per local day.
 */
export class ReminderService {
  constructor(
    private readonly db: Db,
    private readonly deps: ReminderServiceDeps,
  ) {}

  /**
   * The stored configuration reconciled with the active meal slots: one entry per active slot in
   * slot order, defaults for slots added since the last save, archived slots left out.
   */
  get(): Reminders {
    const stored = this.readStored();
    const meals = this.deps.mealSlots
      .list(false)
      .map((slot) => stored?.meals.find((m) => m.slotId === slot.id) ?? defaultMealReminder(slot));
    return {
      enabled: stored?.enabled ?? DEFAULT_REMINDERS.enabled,
      timezone: stored?.timezone ?? DEFAULT_REMINDERS.timezone,
      meals,
      weighIn: stored?.weighIn ?? DEFAULT_REMINDERS.weighIn,
      water: stored?.water ?? DEFAULT_REMINDERS.water,
    };
  }

  /**
   * Replaces the configuration. Every `slotId` must name an existing meal slot. Settings of
   * archived slots that the body leaves out are carried over, so restoring a slot later brings
   * its reminder back the way it was (the UI only ever sends the active slots it shows).
   */
  update(config: RemindersConfig): Reminders {
    const slots = this.deps.mealSlots.list(true);
    const known = new Set(slots.map((s) => s.id));
    const unknown = config.meals.findIndex((m) => !known.has(m.slotId));
    if (unknown !== -1) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Unknown meal slot', [
        { path: `meals.${unknown}.slotId`, message: 'Unknown meal slot' },
      ]);
    }
    const inBody = new Set(config.meals.map((m) => m.slotId));
    const archived = new Set(slots.filter((s) => s.archivedAt !== null).map((s) => s.id));
    const carried = (this.readStored()?.meals ?? []).filter(
      (m) => !inBody.has(m.slotId) && archived.has(m.slotId),
    );
    const now = new Date().toISOString();
    const valueJson = JSON.stringify({ ...config, meals: [...config.meals, ...carried] });
    this.db
      .insert(settings)
      .values({ key: REMINDERS_SETTING_KEY, valueJson, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { valueJson, updatedAt: now } })
      .run();
    return this.get();
  }

  // ---------- conditions ----------

  mealEntryCount(day: string, slotId: number): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(diaryEntries)
      .where(and(eq(diaryEntries.day, day), eq(diaryEntries.slotId, slotId)))
      .get();
    return row?.n ?? 0;
  }

  hasWeight(day: string): boolean {
    return (
      this.db.select({ id: weights.id }).from(weights).where(eq(weights.day, day)).get() !==
      undefined
    );
  }

  /** False when the day has no goal or the goal has no water target. */
  waterBelowGoal(day: string): boolean {
    const goalMl = this.deps.goals.activeFor(day)?.waterMl ?? null;
    if (goalMl === null || goalMl <= 0) return false;
    const row = this.db
      .select({ ml: sql<number>`coalesce(sum(${waterEntries.ml}), 0)` })
      .from(waterEntries)
      .where(eq(waterEntries.day, day))
      .get();
    return (row?.ml ?? 0) < goalMl;
  }

  // ---------- send ledger ----------

  wasSent(reminderKey: string, day: string): boolean {
    return (
      this.db
        .select({ id: reminderSends.id })
        .from(reminderSends)
        .where(and(eq(reminderSends.reminderKey, reminderKey), eq(reminderSends.day, day)))
        .get() !== undefined
    );
  }

  /** Returns false when the row already existed (another tick got there first). */
  recordSend(reminderKey: string, day: string, sentAt: string): boolean {
    const result = this.db
      .insert(reminderSends)
      .values({ reminderKey, day, sentAt })
      .onConflictDoNothing()
      .run();
    return result.changes > 0;
  }

  /** Drops ledger rows older than `beforeDay` (exclusive); the ledger only matters for today. */
  pruneSends(beforeDay: string): number {
    return this.db.delete(reminderSends).where(lt(reminderSends.day, beforeDay)).run().changes;
  }

  private readStored(): RemindersConfig | null {
    const row = this.db
      .select({ valueJson: settings.valueJson })
      .from(settings)
      .where(eq(settings.key, REMINDERS_SETTING_KEY))
      .get();
    if (!row) return null;
    const parsed = remindersConfigSchema.safeParse(parseJson(row.valueJson));
    return parsed.success ? parsed.data : null;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
