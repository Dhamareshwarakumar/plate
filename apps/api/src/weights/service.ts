import {
  computeWeightStats,
  localDayKey,
  type Weight,
  type WeightBodyParsed,
  type WeightStats,
} from '@plate/shared';
import { and, asc, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { weights } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { GoalService } from '../goals/service.js';

export function toWeight(row: typeof weights.$inferSelect): Weight {
  return {
    id: row.id,
    day: row.day,
    kg: row.kg,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Body weight log (FR-W1) and its statistics (FR-W2): one weigh-in per day, replaced on re-log. */
export class WeightService {
  constructor(
    private readonly db: Db,
    private readonly goals: GoalService,
  ) {}

  /** Oldest first, optionally bounded by day keys (both inclusive). */
  list(from?: string, to?: string): Weight[] {
    const conditions: SQL[] = [];
    if (from !== undefined) conditions.push(gte(weights.day, from));
    if (to !== undefined) conditions.push(lte(weights.day, to));
    return this.db
      .select()
      .from(weights)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(weights.day))
      .all()
      .map(toWeight);
  }

  /** The weigh-in with the latest day (not the most recently written one). */
  latest(): Weight | null {
    const row = this.db.select().from(weights).orderBy(desc(weights.day)).limit(1).get();
    return row ? toWeight(row) : null;
  }

  /** Creates the day's weigh-in or replaces it, keeping the row id. */
  upsert(day: string, body: WeightBodyParsed): Weight {
    const now = new Date().toISOString();
    const row = this.db
      .insert(weights)
      .values({ day, kg: body.kg, note: body.note, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: weights.day,
        set: { kg: body.kg, note: body.note, updatedAt: now },
      })
      .returning()
      .get();
    return toWeight(row);
  }

  remove(day: string): void {
    const row = this.db.select({ id: weights.id }).from(weights).where(eq(weights.day, day)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'No weigh-in on that day');
    this.db.delete(weights).where(eq(weights.day, day)).run();
  }

  /**
   * Stats over the whole log (at most one row per day, so loading it is cheap) against the goal
   * weight of the goal in effect on the server's local day (the same approximation D70 uses).
   */
  stats(): WeightStats {
    return computeWeightStats(this.list(), this.goals.activeFor(localDayKey(new Date())));
  }
}
