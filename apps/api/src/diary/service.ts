import {
  computeDayStatus,
  entryTotals,
  goalRemaining,
  localDayKey,
  type CopyDayInput,
  type CopyResult,
  type DiaryDay,
  type DiaryDaySummary,
  type DiaryEntry,
  type DiaryEntryInputParsed,
  type DiaryEntryPatchParsed,
  type FoodBasis,
  type FoodUsage,
  type MealSlot,
  type Nutrients,
} from '@plate/shared';
import { and, asc, count, desc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { diaryEntries, foods, mealSlots, portions } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { GoalService } from '../goals/service.js';
import { toMealSlot } from '../mealSlots/service.js';
import type { SettingsService } from '../settings/service.js';

type EntryRow = typeof diaryEntries.$inferSelect;

interface Snapshot {
  name: string;
  basis: FoodBasis;
  per100: Nutrients;
}

/** Row shape of the diary CSV export (one line per entry). */
export interface DiaryExportRow {
  day: string;
  loggedAt: string;
  slotName: string;
  name: string;
  brand: string;
  quantity: number;
  basis: FoodBasis;
  portionLabel: string | null;
  portionCount: number | null;
  note: string | null;
  totals: Nutrients;
}

/** Totals as SQL: `sum(value_100 * quantity / 100)`; the four required macros default to 0. */
const totalsSelection = {
  kcal: sql<number>`coalesce(sum(${diaryEntries.kcal100} * ${diaryEntries.quantity} / 100), 0)`,
  protein: sql<number>`coalesce(sum(${diaryEntries.protein100} * ${diaryEntries.quantity} / 100), 0)`,
  carbs: sql<number>`coalesce(sum(${diaryEntries.carbs100} * ${diaryEntries.quantity} / 100), 0)`,
  fat: sql<number>`coalesce(sum(${diaryEntries.fat100} * ${diaryEntries.quantity} / 100), 0)`,
  // Optional nutrients stay null when no entry has a value (SQL sum ignores nulls, yields null if all are).
  fiber: sql<number | null>`sum(${diaryEntries.fiber100} * ${diaryEntries.quantity} / 100)`,
  sugar: sql<number | null>`sum(${diaryEntries.sugar100} * ${diaryEntries.quantity} / 100)`,
  saturatedFat: sql<
    number | null
  >`sum(${diaryEntries.saturatedFat100} * ${diaryEntries.quantity} / 100)`,
  sodiumMg: sql<number | null>`sum(${diaryEntries.sodiumMg100} * ${diaryEntries.quantity} / 100)`,
};

const ZERO: Nutrients = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: null,
  sugar: null,
  saturatedFat: null,
  sodiumMg: null,
};

function per100Of(row: EntryRow): Nutrients {
  return {
    kcal: row.kcal100,
    protein: row.protein100,
    carbs: row.carbs100,
    fat: row.fat100,
    fiber: row.fiber100,
    sugar: row.sugar100,
    saturatedFat: row.saturatedFat100,
    sodiumMg: row.sodiumMg100,
  };
}

export function toEntry(row: EntryRow): DiaryEntry {
  const per100 = per100Of(row);
  return {
    id: row.id,
    day: row.day,
    slotId: row.slotId,
    loggedAt: row.loggedAt,
    foodId: row.foodId,
    name: row.nameSnapshot,
    quantity: row.quantity,
    basis: row.basis,
    portionLabel: row.portionLabel,
    portionCount: row.portionCount,
    note: row.note,
    per100,
    totals: entryTotals(per100, row.quantity),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function snapshotColumns(per100: Nutrients) {
  return {
    kcal100: per100.kcal,
    protein100: per100.protein,
    carbs100: per100.carbs,
    fat100: per100.fat,
    fiber100: per100.fiber,
    sugar100: per100.sugar,
    saturatedFat100: per100.saturatedFat,
    sodiumMg100: per100.sodiumMg,
  };
}

/** Services the diary reads from to judge a day (FR-G1, FR-G3). */
export interface DiaryServiceDeps {
  goals: GoalService;
  settings: SettingsService;
}

export class DiaryService {
  constructor(
    private readonly db: Db,
    private readonly deps: DiaryServiceDeps,
  ) {}

  /**
   * The day grouped by meal slot: every active slot in order (even when empty), then any archived
   * slot that still has entries that day. Totals are computed in SQL; the goal in effect on the day
   * gives `status` and `remaining`.
   */
  getDay(day: string): DiaryDay {
    const slotRows = this.db
      .select()
      .from(mealSlots)
      .orderBy(asc(mealSlots.sortOrder), asc(mealSlots.id))
      .all();
    const entryRows = this.db
      .select()
      .from(diaryEntries)
      .where(eq(diaryEntries.day, day))
      .orderBy(asc(diaryEntries.loggedAt), asc(diaryEntries.id))
      .all();
    const slotTotals = this.db
      .select({ slotId: diaryEntries.slotId, ...totalsSelection })
      .from(diaryEntries)
      .where(eq(diaryEntries.day, day))
      .groupBy(diaryEntries.slotId)
      .all();
    const dayTotal = this.db
      .select(totalsSelection)
      .from(diaryEntries)
      .where(eq(diaryEntries.day, day))
      .get();

    const entriesBySlot = new Map<number, DiaryEntry[]>();
    for (const row of entryRows) {
      const list = entriesBySlot.get(row.slotId);
      const entry = toEntry(row);
      if (list) list.push(entry);
      else entriesBySlot.set(row.slotId, [entry]);
    }
    const totalsBySlot = new Map(slotTotals.map(({ slotId, ...totals }) => [slotId, totals]));

    const active: MealSlot[] = [];
    const archivedWithEntries: MealSlot[] = [];
    for (const row of slotRows) {
      if (row.archivedAt === null) active.push(toMealSlot(row));
      else if (entriesBySlot.has(row.id)) archivedWithEntries.push(toMealSlot(row));
    }

    const slots = [...active, ...archivedWithEntries].map((slot) => ({
      slot,
      entries: entriesBySlot.get(slot.id) ?? [],
      totals: totalsBySlot.get(slot.id) ?? ZERO,
    }));

    const totals = dayTotal ?? ZERO;
    const goal = this.deps.goals.activeFor(day);
    return {
      day,
      slots,
      totals,
      entryCount: entryRows.length,
      goal,
      status: computeDayStatus(
        totals.kcal,
        goal?.kcal ?? null,
        entryRows.length,
        this.deps.settings.get().tolerancePct,
      ),
      remaining: goal ? goalRemaining(goal, totals) : null,
      water: { ml: 0 },
    };
  }

  getEntry(id: number): DiaryEntry {
    return toEntry(this.getRow(id));
  }

  /**
   * Logs an entry. Food entries snapshot name/basis/per-100 from the food (archived foods may still
   * be logged); ad-hoc entries store what was sent. A portion label matching one of the food's
   * portions turns `portionCount` into the quantity; otherwise the quantity is taken as given.
   * The slot must exist but may be archived (the UI only offers active slots; undo of a delete
   * restores an entry into the slot it came from).
   */
  addEntry(input: DiaryEntryInputParsed): DiaryEntry {
    this.assertSlotExists(input.slotId, 'slotId');
    let snapshot: Snapshot;
    let quantity = input.quantity;
    if (input.foodId !== null) {
      const food = this.db.select().from(foods).where(eq(foods.id, input.foodId)).get();
      if (!food) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Unknown food', [
          { path: 'foodId', message: 'Unknown food' },
        ]);
      }
      snapshot = {
        name: food.name,
        basis: food.basis,
        per100: {
          kcal: food.kcal,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          fiber: food.fiber,
          sugar: food.sugar,
          saturatedFat: food.saturatedFat,
          sodiumMg: food.sodiumMg,
        },
      };
      quantity = this.resolveQuantity(food.id, input.portionLabel, input.portionCount, quantity);
    } else {
      // The schema guarantees name and per100 for ad-hoc entries.
      snapshot = { name: input.name!, basis: input.basis, per100: input.per100! };
    }
    const now = new Date().toISOString();
    const row = this.db
      .insert(diaryEntries)
      .values({
        day: input.day,
        slotId: input.slotId,
        loggedAt: input.loggedAt,
        foodId: input.foodId,
        nameSnapshot: snapshot.name,
        quantity,
        basis: snapshot.basis,
        portionLabel: input.portionLabel,
        portionCount: input.portionCount,
        note: input.note,
        ...snapshotColumns(snapshot.per100),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return toEntry(row);
  }

  /**
   * Edits quantity/portion/slot/time/day/note. The snapshot never changes, so a quantity edit
   * recomputes totals from the values captured at logging time (FR-D10). Moving to another slot
   * requires an active one; an entry may stay in a slot that has been archived since.
   */
  patchEntry(id: number, patch: DiaryEntryPatchParsed): DiaryEntry {
    const existing = this.getRow(id);
    if (patch.slotId !== undefined && patch.slotId !== existing.slotId) {
      this.assertActiveSlot(patch.slotId, 'slotId');
    }

    const portionLabel =
      patch.portionLabel !== undefined ? patch.portionLabel : existing.portionLabel;
    const portionCount =
      patch.portionCount !== undefined ? patch.portionCount : existing.portionCount;
    let quantity = patch.quantity ?? existing.quantity;
    const portionTouched = patch.portionLabel !== undefined || patch.portionCount !== undefined;
    if (portionTouched && existing.foodId !== null) {
      quantity = this.resolveQuantity(existing.foodId, portionLabel, portionCount, quantity);
    }

    const row = this.db
      .update(diaryEntries)
      .set({
        quantity,
        portionLabel,
        portionCount,
        slotId: patch.slotId ?? existing.slotId,
        loggedAt: patch.loggedAt ?? existing.loggedAt,
        day: patch.day ?? existing.day,
        note: patch.note !== undefined ? patch.note : existing.note,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(diaryEntries.id, id))
      .returning()
      .get();
    return toEntry(row);
  }

  deleteEntry(id: number): void {
    this.getRow(id);
    this.db.delete(diaryEntries).where(eq(diaryEntries.id, id)).run();
  }

  /** Copies an entry into the same day and slot. The client sends `loggedAt` in its own zone. */
  duplicateEntry(id: number, loggedAt?: string): DiaryEntry {
    const source = this.getRow(id);
    const now = new Date().toISOString();
    const row = this.db
      .insert(diaryEntries)
      .values({
        ...copyableColumns(source),
        loggedAt: loggedAt ?? now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return toEntry(row);
  }

  /**
   * Copies the snapshot rows of a day (or one meal) onto another day, keeping each entry's time of
   * day. Copies append; nothing on the destination is removed.
   */
  copy(input: CopyDayInput): CopyResult {
    if (input.targetSlotId !== undefined) this.assertActiveSlot(input.targetSlotId, 'targetSlotId');
    const conditions = [eq(diaryEntries.day, input.fromDay)];
    if (input.slotId !== undefined) conditions.push(eq(diaryEntries.slotId, input.slotId));
    const sources = this.db
      .select()
      .from(diaryEntries)
      .where(and(...conditions))
      .orderBy(asc(diaryEntries.loggedAt), asc(diaryEntries.id))
      .all();
    if (sources.length > 0) {
      const now = new Date().toISOString();
      this.db
        .insert(diaryEntries)
        .values(
          sources.map((source) => ({
            ...copyableColumns(source),
            day: input.toDay,
            slotId: input.targetSlotId ?? source.slotId,
            loggedAt: source.loggedAt.replace(/^\d{4}-\d{2}-\d{2}/, input.toDay),
            createdAt: now,
            updatedAt: now,
          })),
        )
        .run();
    }
    return { copied: sources.length, day: this.getDay(input.toDay) };
  }

  /** Distinct library foods by most recent logging; archived foods and ad-hoc entries are skipped. */
  recentFoods(limit = 20): FoodUsage[] {
    return this.usageQuery()
      .orderBy(desc(sql`max(${diaryEntries.loggedAt})`), desc(count()))
      .limit(limit)
      .all()
      .map(toUsage);
  }

  /** Distinct library foods by how often they were logged in the last `days` days. */
  frequentFoods(limit = 20, days = 60): FoodUsage[] {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.usageQuery(gte(diaryEntries.day, localDayKey(since)))
      .orderBy(desc(count()), desc(sql`max(${diaryEntries.loggedAt})`))
      .limit(limit)
      .all()
      .map(toUsage);
  }

  /** Entry count and kcal per day in the range; days without entries are omitted. */
  daysSummary(from: string, to: string): DiaryDaySummary[] {
    return this.db
      .select({
        day: diaryEntries.day,
        entryCount: count(),
        kcal: totalsSelection.kcal,
      })
      .from(diaryEntries)
      .where(and(gte(diaryEntries.day, from), lte(diaryEntries.day, to)))
      .groupBy(diaryEntries.day)
      .orderBy(asc(diaryEntries.day))
      .all();
  }

  /** Rows for the CSV export, joined with the slot name and the food's current brand. */
  exportRows(from: string, to: string): DiaryExportRow[] {
    const rows = this.db
      .select({
        entry: diaryEntries,
        slotName: mealSlots.name,
        brand: foods.brand,
      })
      .from(diaryEntries)
      .innerJoin(mealSlots, eq(mealSlots.id, diaryEntries.slotId))
      .leftJoin(foods, eq(foods.id, diaryEntries.foodId))
      .where(and(gte(diaryEntries.day, from), lte(diaryEntries.day, to)))
      .orderBy(asc(diaryEntries.day), asc(diaryEntries.loggedAt), asc(diaryEntries.id))
      .all();
    return rows.map(({ entry, slotName, brand }) => ({
      day: entry.day,
      loggedAt: entry.loggedAt,
      slotName,
      name: entry.nameSnapshot,
      brand: brand ?? '',
      quantity: entry.quantity,
      basis: entry.basis,
      portionLabel: entry.portionLabel,
      portionCount: entry.portionCount,
      note: entry.note,
      totals: entryTotals(per100Of(entry), entry.quantity),
    }));
  }

  private usageQuery(extra?: ReturnType<typeof gte>) {
    const conditions = [isNotNull(diaryEntries.foodId), isNull(foods.archivedAt)];
    if (extra) conditions.push(extra);
    return this.db
      .select({
        foodId: diaryEntries.foodId,
        lastLoggedAt: sql<string>`max(${diaryEntries.loggedAt})`,
        count: count(),
      })
      .from(diaryEntries)
      .innerJoin(foods, eq(foods.id, diaryEntries.foodId))
      .where(and(...conditions))
      .groupBy(diaryEntries.foodId);
  }

  private getRow(id: number): EntryRow {
    const row = this.db.select().from(diaryEntries).where(eq(diaryEntries.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Diary entry not found');
    return row;
  }

  private assertSlotExists(slotId: number, path: string): { archivedAt: string | null } {
    const slot = this.db
      .select({ archivedAt: mealSlots.archivedAt })
      .from(mealSlots)
      .where(eq(mealSlots.id, slotId))
      .get();
    if (!slot) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Unknown meal slot', [
        { path, message: 'Unknown meal slot' },
      ]);
    }
    return slot;
  }

  private assertActiveSlot(slotId: number, path: string): void {
    const slot = this.assertSlotExists(slotId, path);
    if (slot.archivedAt !== null) {
      throw new AppError(400, 'VALIDATION_ERROR', 'This meal slot is archived', [
        { path, message: 'This meal slot is archived' },
      ]);
    }
  }

  /** `portion.amount × count` when the label names one of the food's portions, else the quantity as given. */
  private resolveQuantity(
    foodId: number,
    portionLabel: string | null,
    portionCount: number | null,
    quantity: number,
  ): number {
    if (portionLabel === null || portionCount === null) return quantity;
    const portion = this.db
      .select({ amount: portions.amount })
      .from(portions)
      .where(
        and(eq(portions.foodId, foodId), sql`lower(${portions.label}) = lower(${portionLabel})`),
      )
      .get();
    return portion ? portion.amount * portionCount : quantity;
  }
}

/** Everything that is copied when an entry is duplicated or a day is copied (no id, no timestamps). */
function copyableColumns(row: EntryRow) {
  return {
    day: row.day,
    slotId: row.slotId,
    loggedAt: row.loggedAt,
    foodId: row.foodId,
    nameSnapshot: row.nameSnapshot,
    quantity: row.quantity,
    basis: row.basis,
    portionLabel: row.portionLabel,
    portionCount: row.portionCount,
    note: row.note,
    ...snapshotColumns(per100Of(row)),
  };
}

function toUsage(row: { foodId: number | null; lastLoggedAt: string; count: number }): FoodUsage {
  // The inner join on foods guarantees a food id; the column type is nullable only in the schema.
  return { foodId: row.foodId!, lastLoggedAt: row.lastLoggedAt, count: row.count };
}
