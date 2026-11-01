import {
  localDayKey,
  mifflinStJeor,
  type CalculatorResult,
  type Goal,
  type GoalInputParsed,
  type Profile,
} from '@plate/shared';
import { desc, eq, lte } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { goals } from '../db/schema.js';
import { AppError } from '../errors.js';

function toGoal(row: typeof goals.$inferSelect): Goal {
  return {
    id: row.id,
    effectiveFrom: row.effectiveFrom,
    kcal: row.kcal,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    fiberG: row.fiberG,
    waterMl: row.waterMl,
    createdAt: row.createdAt,
  };
}

/** Goals with effective-from dates (FR-G1) and the Mifflin-St Jeor calculator (FR-G4). */
export class GoalService {
  constructor(private readonly db: Db) {}

  /** Newest effective date first. */
  list(): Goal[] {
    return this.db.select().from(goals).orderBy(desc(goals.effectiveFrom)).all().map(toGoal);
  }

  /** The goal in effect on `day`: the latest one whose `effectiveFrom` is on or before it. */
  activeFor(day: string): Goal | null {
    const row = this.db
      .select()
      .from(goals)
      .where(lte(goals.effectiveFrom, day))
      .orderBy(desc(goals.effectiveFrom))
      .limit(1)
      .get();
    return row ? toGoal(row) : null;
  }

  /**
   * Creates a goal, or replaces the one that already starts on the same day. Earlier goals are
   * never touched, so days before `effectiveFrom` keep the goal they had.
   */
  create(input: GoalInputParsed): Goal {
    const values = {
      kcal: input.kcal,
      proteinG: input.proteinG,
      carbsG: input.carbsG,
      fatG: input.fatG,
      fiberG: input.fiberG,
      waterMl: input.waterMl,
    };
    const row = this.db
      .insert(goals)
      .values({
        effectiveFrom: input.effectiveFrom,
        ...values,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({ target: goals.effectiveFrom, set: values })
      .returning()
      .get();
    return toGoal(row);
  }

  /** Days from this goal's start until the next goal fall back to the previous goal (or none). */
  delete(id: number): void {
    const row = this.db.select({ id: goals.id }).from(goals).where(eq(goals.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Goal not found');
    this.db.delete(goals).where(eq(goals.id, id)).run();
  }

  /** BMR/TDEE and kcal suggestions from the stored profile and the given weight. */
  calculate(profileData: Profile | null, weightKg: number | undefined): CalculatorResult {
    if (!profileData) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Set up your profile first', [
        { path: 'profile', message: 'Set up your profile first' },
      ]);
    }
    if (weightKg === undefined) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Enter your current weight', [
        { path: 'weightKg', message: 'Enter your current weight' },
      ]);
    }
    return mifflinStJeor({ ...profileData, weightKg, today: localDayKey(new Date()) });
  }
}
