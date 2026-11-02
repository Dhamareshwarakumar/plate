import type { InsightsSummary } from '@plate/shared';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatKcal } from '@/lib/format';

export interface StatTilesProps {
  summary: InsightsSummary;
  className?: string | undefined;
}

const dayWord = (n: number) => (n === 1 ? 'day' : 'days');

/**
 * The four FR-I1 tiles (DESIGN §5): 2×2 on phones, 4-up on desktop. Averages and adherence are
 * about the range; the streaks are about today (D100), whatever range is shown.
 */
export function StatTiles({ summary, className }: StatTilesProps) {
  const s = summary;
  const elapsed = Math.min(s.daysElapsed, s.daysInRange);
  return (
    <dl className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>
      <Tile
        label="Avg per day"
        value={s.avgKcal === null ? '—' : formatKcal(s.avgKcal)}
        unit={s.avgKcal === null ? undefined : 'kcal'}
        detail={
          s.avgProtein === null || s.avgCarbs === null || s.avgFat === null ? (
            'No logged days'
          ) : (
            <>
              P {Math.round(s.avgProtein)} · C {Math.round(s.avgCarbs)} · F {Math.round(s.avgFat)} g
            </>
          )
        }
      />
      <Tile
        label="On target"
        value={s.adherencePct === null ? '—' : String(s.adherencePct)}
        unit={s.adherencePct === null ? undefined : '%'}
        detail={
          s.daysWithGoal === 0
            ? s.daysLogged === 0
              ? 'Nothing logged'
              : 'No goal in this range'
            : `${s.daysOnTarget} of ${s.daysWithGoal} ${dayWord(s.daysWithGoal)} with a goal`
        }
      />
      <Tile
        label="Logging streak"
        value={String(s.loggingStreak.current)}
        unit={dayWord(s.loggingStreak.current)}
        detail={`Best ${s.loggingStreak.best} · ${s.daysLogged} of ${elapsed} ${dayWord(elapsed)} logged`}
      />
      <Tile
        label="On-target streak"
        value={String(s.onTargetStreak.current)}
        unit={dayWord(s.onTargetStreak.current)}
        detail={`Best ${s.onTargetStreak.best}`}
      />
    </dl>
  );
}

function Tile({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string;
  unit?: string | undefined;
  detail: ReactNode;
}) {
  return (
    <div className="rounded-card border-border bg-surface shadow-card min-w-0 border p-4">
      <dt className="text-fg-muted text-[0.6875rem] leading-tight font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd className="mt-1 min-w-0">
        <p className="text-fg flex flex-wrap items-baseline gap-x-1">
          <span className="tabular text-[1.75rem] leading-none font-semibold">{value}</span>
          {unit ? <span className="text-fg-muted text-sm font-medium">{unit}</span> : null}
        </p>
        <p className="text-fg-muted tabular mt-1.5 text-xs leading-snug">{detail}</p>
      </dd>
    </div>
  );
}
