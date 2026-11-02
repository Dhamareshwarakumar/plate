import {
  computeDayStatus,
  INSIGHTS_RANGE_MAX_DAYS,
  localDayKey,
  movingAverage7,
  shiftDayKey,
  summarize,
  weeklyIntake,
  ZERO_NUTRIENTS,
  type BySlot,
  type DailyAggregate,
  type FoodKind,
  type InsightsSummary,
  type SlotAverage,
  type TopFood,
  type TopFoods,
  type WeightVsIntakePoint,
} from '@plate/shared';
import { and, asc, count, countDistinct, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { diaryEntries, foods, mealSlots } from '../db/schema.js';
import { totalsSelection } from '../diary/service.js';
import type { GoalService } from '../goals/service.js';
import type { SettingsService } from '../settings/service.js';
import type { WeightService } from '../weights/service.js';

export interface InsightsServiceDeps {
  goals: GoalService;
  settings: SettingsService;
  weights: WeightService;
}

/** Library entries group by food; ad-hoc entries by their lower-cased name (D101). */
const topFoodGroup = sql<string>`coalesce(cast(${diaryEntries.foodId} as text), 'adhoc:' || lower(${diaryEntries.nameSnapshot}))`;
const topFoodName = sql<string>`coalesce(min(${foods.name}), min(${diaryEntries.nameSnapshot}))`;
const topFoodId = sql<number | null>`min(${diaryEntries.foodId})`;
/** Null for ad-hoc groups (no joined food row). */
const topFoodKind = sql<FoodKind | null>`min(${foods.kind})`;

/**
 * Range aggregations for the Insights screen (FR-I1–I7). Totals are summed in SQL from the
 * per-100 snapshots exactly like the day view; only the day→week bucketing and the streaks are
 * done in JS, on at most 731 rows (the range cap).
 */
export class InsightsService {
  constructor(
    private readonly db: Db,
    private readonly deps: InsightsServiceDeps,
  ) {}

  /** One row per day of the range, zero rows for days without entries, judged against the goal in effect. */
  daily(from: string, to: string): DailyAggregate[] {
    const rows = this.db
      .select({ day: diaryEntries.day, entryCount: count(), ...totalsSelection })
      .from(diaryEntries)
      .where(this.inRange(from, to))
      .groupBy(diaryEntries.day)
      .all();
    const byDay = new Map(rows.map((row) => [row.day, row]));
    // Newest first: the goal in effect on a day is the first one starting on or before it.
    const goals = this.deps.goals.list();
    const tolerance = this.deps.settings.get().tolerancePct;

    const out: DailyAggregate[] = [];
    for (let day = from; day <= to; day = shiftDayKey(day, 1)) {
      const row = byDay.get(day);
      const totals = row
        ? {
            kcal: row.kcal,
            protein: row.protein,
            carbs: row.carbs,
            fat: row.fat,
            fiber: row.fiber,
            sugar: row.sugar,
            saturatedFat: row.saturatedFat,
            sodiumMg: row.sodiumMg,
          }
        : ZERO_NUTRIENTS;
      const entryCount = row?.entryCount ?? 0;
      const goalKcal = goals.find((g) => g.effectiveFrom <= day)?.kcal ?? null;
      out.push({
        day,
        entryCount,
        totals,
        goalKcal,
        status: computeDayStatus(totals.kcal, goalKcal, entryCount, tolerance),
      });
    }
    return out;
  }

  /**
   * FR-I1. `today` is the client's day; the server's local day is the fallback (D70
   * approximation). Averages and adherence cover the range; the streaks are computed over the
   * two years ending today, whatever the range, because a streak is a statement about now.
   */
  summary(from: string, to: string, today = localDayKey(new Date())): InsightsSummary {
    const streakWindow = this.daily(shiftDayKey(today, -(INSIGHTS_RANGE_MAX_DAYS - 1)), today);
    return summarize(this.daily(from, to), today, streakWindow);
  }

  /** FR-I6: the `limit` most-logged and the `limit` most-caloric foods of the range. */
  topFoods(from: string, to: string, limit = 10): TopFoods {
    const base = () =>
      this.db
        .select({
          foodId: topFoodId,
          kind: topFoodKind,
          name: topFoodName,
          count: count(),
          kcal: totalsSelection.kcal,
        })
        .from(diaryEntries)
        .leftJoin(foods, eq(foods.id, diaryEntries.foodId))
        .where(this.inRange(from, to))
        .groupBy(topFoodGroup);
    const toTopFood = (row: {
      foodId: number | null;
      kind: FoodKind | null;
      name: string;
      count: number;
      kcal: number;
    }): TopFood => ({
      foodId: row.foodId,
      kind: row.kind,
      name: row.name,
      count: row.count,
      kcal: row.kcal,
    });
    return {
      byCount: base()
        .orderBy(desc(count()), desc(totalsSelection.kcal), asc(topFoodName))
        .limit(limit)
        .all()
        .map(toTopFood),
      byKcal: base()
        .orderBy(desc(totalsSelection.kcal), desc(count()), asc(topFoodName))
        .limit(limit)
        .all()
        .map(toTopFood),
    };
  }

  /**
   * FR-I7: kcal per slot averaged over the range's logged days, so the slots add up to the daily
   * average (D102). Active slots are always listed in order; archived slots only when they have
   * entries in the range (the `getDay` ordering).
   */
  bySlot(from: string, to: string): BySlot {
    const slotRows = this.db
      .select()
      .from(mealSlots)
      .orderBy(asc(mealSlots.sortOrder), asc(mealSlots.id))
      .all();
    const perSlot = new Map(
      this.db
        .select({
          slotId: diaryEntries.slotId,
          entryCount: count(),
          days: countDistinct(diaryEntries.day),
          kcal: totalsSelection.kcal,
        })
        .from(diaryEntries)
        .where(this.inRange(from, to))
        .groupBy(diaryEntries.slotId)
        .all()
        .map((row) => [row.slotId, row] as const),
    );
    const loggedDays =
      this.db
        .select({ n: countDistinct(diaryEntries.day) })
        .from(diaryEntries)
        .where(this.inRange(from, to))
        .get()?.n ?? 0;

    const toAverage = (slot: (typeof slotRows)[number]): SlotAverage => {
      const stats = perSlot.get(slot.id);
      const totalKcal = stats?.kcal ?? 0;
      return {
        slotId: slot.id,
        name: slot.name,
        archived: slot.archivedAt !== null,
        entryCount: stats?.entryCount ?? 0,
        days: stats?.days ?? 0,
        totalKcal,
        avgKcal: loggedDays === 0 ? 0 : totalKcal / loggedDays,
      };
    };
    const active = slotRows.filter((s) => s.archivedAt === null);
    const archivedWithEntries = slotRows.filter((s) => s.archivedAt !== null && perSlot.has(s.id));
    return { loggedDays, slots: [...active, ...archivedWithEntries].map(toAverage) };
  }

  /**
   * FR-I5: weekly intake buckets (D103) with the mean of the 7-day weight moving average inside
   * each week. The average is computed over the weigh-ins from six days before the range so the
   * first week's points carry their real trailing window.
   */
  weightVsIntake(from: string, to: string): WeightVsIntakePoint[] {
    const weeks = weeklyIntake(this.daily(from, to), this.deps.settings.get().weekStart);
    const movingAverage = movingAverage7(
      this.deps.weights.list(shiftDayKey(from, -6), to).map(({ day, kg }) => ({ day, kg })),
    );
    return weeks.map((week) => {
      const points = movingAverage.filter((p) => p.day >= week.from && p.day <= week.to);
      return {
        ...week,
        avgWeightKg:
          points.length === 0 ? null : points.reduce((a, p) => a + p.kg, 0) / points.length,
        // One moving-average point per weigh-in day, so this is also the number of weigh-ins.
        weighIns: points.length,
      };
    });
  }

  private inRange(from: string, to: string) {
    return and(gte(diaryEntries.day, from), lte(diaryEntries.day, to));
  }
}
