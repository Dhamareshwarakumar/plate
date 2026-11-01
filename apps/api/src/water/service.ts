import type { DayWater, WaterEntry, WaterEntryInput } from '@plate/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { waterEntries } from '../db/schema.js';
import { AppError } from '../errors.js';

export function toWaterEntry(row: typeof waterEntries.$inferSelect): WaterEntry {
  return { id: row.id, day: row.day, ml: row.ml, loggedAt: row.loggedAt };
}

/** Water additions per day (FR-D9). Water never counts as "logging" for the day's status. */
export class WaterService {
  constructor(private readonly db: Db) {}

  add(input: WaterEntryInput): WaterEntry {
    const row = this.db
      .insert(waterEntries)
      .values({ day: input.day, ml: input.ml, loggedAt: new Date().toISOString() })
      .returning()
      .get();
    return toWaterEntry(row);
  }

  /** "Undo last": the client deletes the newest entry of the day. */
  remove(id: number): void {
    const row = this.db
      .select({ id: waterEntries.id })
      .from(waterEntries)
      .where(eq(waterEntries.id, id))
      .get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Water entry not found');
    this.db.delete(waterEntries).where(eq(waterEntries.id, id)).run();
  }

  /** The day's total (summed in SQL) and its additions in logging order. */
  forDay(day: string): DayWater {
    const total = this.db
      .select({ ml: sql<number>`coalesce(sum(${waterEntries.ml}), 0)` })
      .from(waterEntries)
      .where(eq(waterEntries.day, day))
      .get();
    const entries = this.db
      .select()
      .from(waterEntries)
      .where(eq(waterEntries.day, day))
      .orderBy(asc(waterEntries.loggedAt), asc(waterEntries.id))
      .all()
      .map(toWaterEntry);
    return { ml: total?.ml ?? 0, entries };
  }
}
