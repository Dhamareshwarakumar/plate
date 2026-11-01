import type { WeightStats as WeightStatsData } from '@plate/shared';
import { Minus, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import { formatDayLabel, formatDayShort, formatDayWithYear } from '@/lib/dates';
import { formatKg, formatSignedKg } from '@/lib/format';

export interface WeightStatsProps {
  stats: WeightStatsData;
  className?: string | undefined;
}

/** Changes smaller than this are shown as flat, not as progress or regress. */
const FLAT_KG = 0.05;

/**
 * The stats block of the Weight page (DESIGN §6, FR-W2): latest weight, change vs 7 and 30 days,
 * the goal with what is left, and the weekly rate with an ETA when the trend points at the goal.
 * Colour marks direction toward/away from the goal; the arrow icons and text say the same thing.
 */
export function WeightStats({ stats, className }: WeightStatsProps) {
  const { latest, goalKg, goalDate, remaining, ratePerWeek, eta } = stats;
  if (!latest) return null;
  const atGoal = remaining !== null && Math.abs(remaining) < 0.1;

  return (
    <section
      aria-label="Weight summary"
      className={cn(
        'rounded-card border-border shadow-card border p-5 bg-[linear-gradient(135deg,var(--accent-soft),transparent_55%),var(--surface)]',
        className,
      )}
    >
      <p className="text-fg-muted text-xs font-medium tracking-wide uppercase">
        Latest · {formatDayLabel(latest.day)}
      </p>
      <p className="text-fg mt-1 flex items-baseline gap-1.5">
        <span className="tabular text-[2.5rem] leading-none font-semibold">
          {formatKg(latest.kg)}
        </span>
        <span className="text-fg-muted text-sm font-medium">kg</span>
      </p>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Recent change">
        <Delta change={stats.change7d} span="7d" goalKg={goalKg} latestKg={latest.kg} />
        <Delta change={stats.change30d} span="30d" goalKg={goalKg} latestKg={latest.kg} />
      </ul>

      <dl className="border-border mt-4 flex flex-col gap-2 border-t pt-4 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="text-fg-muted w-10 shrink-0">Goal</dt>
          <dd className="text-fg min-w-0">
            {goalKg !== null && remaining !== null ? (
              <>
                <span className="tabular font-medium">{formatKg(goalKg)} kg</span>
                <span className="text-fg-muted tabular">
                  {' · '}
                  {atGoal ? 'At goal' : `${formatKg(Math.abs(remaining))} to go`}
                  {goalDate !== null ? ` · by ${formatDayWithYear(goalDate)}` : ''}
                </span>
              </>
            ) : (
              <Link
                to="/more?goal=edit"
                className="text-accent inline-flex items-center gap-1 font-medium hover:underline"
              >
                <Target className="size-3.5" aria-hidden="true" />
                Set a goal weight
              </Link>
            )}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="text-fg-muted w-10 shrink-0">Rate</dt>
          <dd className="text-fg min-w-0">
            {ratePerWeek !== null ? (
              <>
                <span className="tabular font-medium">{formatSignedKg(ratePerWeek)} kg/week</span>
                {eta !== null ? (
                  <span className="text-fg-muted tabular"> · ETA ~ {formatDayShort(eta)}</span>
                ) : null}
              </>
            ) : (
              <span className="text-fg-muted">Log for a few more days to see your rate</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Delta({
  change,
  span,
  goalKg,
  latestKg,
}: {
  change: number | null;
  span: string;
  goalKg: number | null;
  latestKg: number;
}) {
  if (change === null) {
    return (
      <li className="text-fg-faint tabular flex items-center gap-1">
        <Minus className="size-4" aria-hidden="true" />— vs {span}
      </li>
    );
  }
  const flat = Math.abs(change) < FLAT_KG;
  const Icon = flat ? Minus : change < 0 ? TrendingDown : TrendingUp;
  // Toward the goal when the change has the same sign as the distance still to cover.
  const towardGoal =
    goalKg === null || flat ? null : Math.sign(change) === Math.sign(goalKg - (latestKg - change));
  const tone =
    towardGoal === null ? 'text-fg-muted' : towardGoal ? 'text-on-target-fg' : 'text-over-fg';
  const direction = flat ? 'no change' : change < 0 ? 'down' : 'up';
  return (
    <li className={cn('tabular flex items-center gap-1 font-medium', tone)}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{direction} </span>
      {formatSignedKg(change)} kg <span className="text-fg-muted font-normal">vs {span}</span>
    </li>
  );
}
