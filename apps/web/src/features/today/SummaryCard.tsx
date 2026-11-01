import { macroSplit, type DiaryDay, type Goal } from '@plate/shared';
import { ChevronRight, Target } from 'lucide-react';
import { motion, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Bar } from '@/components/ui/bar';
import { Tag } from '@/components/ui/chip';
import { Ring } from '@/components/ui/ring';
import { Skeleton } from '@/components/ui/skeleton';
import { useGoals } from '@/features/goals/api';
import { cn } from '@/lib/cn';
import { formatDayLabel } from '@/lib/dates';
import { formatGrams, formatKcal } from '@/lib/format';

interface SummaryCardProps {
  day: DiaryDay;
  className?: string | undefined;
}

const CARD =
  'rounded-card border-border shadow-card relative overflow-hidden border p-5 bg-[linear-gradient(135deg,var(--accent-soft),transparent_55%),var(--surface)]';

/**
 * Day totals against the goal in effect (DESIGN §2.1): the calorie ring with eaten / goal, what is
 * left, three macro bars and fiber/water chips when those targets are set. Without a goal the card
 * shows what was eaten and the P/C/F split with a link to set one.
 */
export function SummaryCard({ day, className }: SummaryCardProps) {
  return day.goal ? (
    <GoalSummary day={day} goal={day.goal} className={className} />
  ) : (
    <NoGoalSummary day={day} className={className} />
  );
}

function GoalSummary({ day, goal, className }: SummaryCardProps & { goal: Goal }) {
  const { totals, status } = day;
  const remainingKcal = day.remaining?.kcal ?? goal.kcal - totals.kcal;
  const over = remainingKcal < 0;
  const statusLabel =
    status === 'on_target' ? 'On target' : status === 'over' ? 'Over goal' : undefined;

  return (
    <section aria-label="Day summary" className={cn(CARD, className)}>
      <div className="flex flex-col items-center">
        <Ring
          value={totals.kcal}
          max={goal.kcal}
          status={status}
          label={`${formatKcal(totals.kcal)} of ${formatKcal(goal.kcal)} kcal`}
        >
          <CountUp
            value={totals.kcal}
            className="text-fg tabular text-[2.5rem] leading-none font-semibold"
          />
          <span className="text-fg-muted tabular mt-1.5 text-sm">
            / {formatKcal(goal.kcal)} kcal
          </span>
        </Ring>
        <p
          className={cn(
            'tabular mt-3 flex items-center gap-2 text-sm font-medium',
            over ? 'text-over-fg' : 'text-fg-muted',
          )}
          aria-live="polite"
        >
          <span>
            {formatKcal(Math.abs(remainingKcal))} {over ? 'over' : 'left'}
          </span>
          {statusLabel ? (
            <Tag
              className={cn(
                status === 'on_target'
                  ? 'bg-on-target/15 text-on-target-fg'
                  : 'bg-over/15 text-over-fg',
              )}
            >
              {statusLabel}
            </Tag>
          ) : null}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <Bar label="Protein" value={totals.protein} max={goal.proteinG} color="protein" compact />
        <Bar label="Carbs" value={totals.carbs} max={goal.carbsG} color="carbs" compact />
        <Bar label="Fat" value={totals.fat} max={goal.fatG} color="fat" compact />
      </div>

      {goal.fiberG !== null || goal.waterMl !== null ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Other targets">
          {goal.fiberG !== null ? (
            <TargetChip
              dot="bg-fiber"
              label="Fiber"
              value={`${formatGrams(totals.fiber ?? 0)}/${formatGrams(goal.fiberG)} g`}
            />
          ) : null}
          {goal.waterMl !== null ? (
            <TargetChip
              dot="bg-water"
              label="Water"
              value={`${formatLitres(day.water.ml)}/${formatLitres(goal.waterMl)} L`}
            />
          ) : null}
        </ul>
      ) : null}

      <p className="text-fg-faint mt-4 text-xs">
        {day.entryCount === 0
          ? 'Nothing logged yet'
          : `${day.entryCount} ${day.entryCount === 1 ? 'entry' : 'entries'}`}
        {' · goal since '}
        {formatDayLabel(goal.effectiveFrom)}
      </p>
    </section>
  );
}

function TargetChip({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <li className="bg-surface-2 text-fg-muted inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium">
      <span className={cn('size-2 rounded-full', dot)} aria-hidden="true" />
      {label}
      <span className="text-fg tabular">{value}</span>
    </li>
  );
}

function formatLitres(ml: number): string {
  return (Math.round(ml / 10) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** The pre-goal card: eaten kcal, the P/C/F split and a link to set a goal. */
function NoGoalSummary({ day, className }: SummaryCardProps) {
  const { totals, entryCount } = day;
  const split = macroSplit(totals);
  const goals = useGoals();
  // A goal exists but starts after this day: nothing to set, the day is simply before the goal.
  const goalElsewhere = (goals.data?.length ?? 0) > 0;

  return (
    <section aria-label="Day summary" className={cn(CARD, className)}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-fg-muted text-xs font-medium tracking-wide uppercase">Eaten</p>
          <p className="text-fg mt-1 flex items-baseline gap-1.5">
            <CountUp
              value={totals.kcal}
              className="tabular text-[2.5rem] leading-none font-semibold"
            />
            <span className="text-fg-muted text-sm font-medium">kcal</span>
          </p>
        </div>
        {goalElsewhere ? (
          <p className="text-fg-faint max-w-[9rem] text-right text-xs">
            No goal applied on this day
          </p>
        ) : (
          <Link
            to="/more?goal=edit"
            className="text-accent hover:bg-accent-soft -mr-2 flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium transition-colors"
          >
            <Target className="size-4" aria-hidden="true" />
            Set a goal
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>

      <div
        className="bg-surface-2 mt-5 flex h-2 overflow-hidden rounded-full"
        role="img"
        aria-label={
          split
            ? `Calories from protein ${Math.round(split.protein * 100)} percent, carbs ${Math.round(split.carbs * 100)} percent, fat ${Math.round(split.fat * 100)} percent`
            : 'No macros logged yet'
        }
      >
        {split ? (
          <>
            <motion.span
              className="bg-protein h-full"
              animate={{ width: `${split.protein * 100}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            />
            <motion.span
              className="bg-carbs h-full"
              animate={{ width: `${split.carbs * 100}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            />
            <motion.span
              className="bg-fat h-full"
              animate={{ width: `${split.fat * 100}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            />
          </>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Macro label="Protein" value={totals.protein} dot="bg-protein" />
        <Macro label="Carbs" value={totals.carbs} dot="bg-carbs" />
        <Macro label="Fat" value={totals.fat} dot="bg-fat" />
      </dl>
      <p className="text-fg-faint mt-4 text-xs">
        {entryCount === 0
          ? 'Nothing logged yet.'
          : `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} · no goal on this day`}
      </p>
    </section>
  );
}

function Macro({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted flex items-center gap-1.5 text-xs font-medium">
        <span className={cn('size-2 rounded-full', dot)} aria-hidden="true" />
        {label}
      </dt>
      <dd className="text-fg tabular mt-0.5 text-base font-semibold">
        {formatGrams(value)}
        <span className="text-fg-muted text-xs font-normal"> g</span>
      </dd>
    </div>
  );
}

/** Animated number: springs from the previous value to the new one, rendered rounded. */
function CountUp({ value, className }: { value: number; className?: string }) {
  const spring = useSpring(value, { stiffness: 90, damping: 22, mass: 0.6 });
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  const text = useTransform(spring, (v) => Math.round(v).toLocaleString());
  return <motion.span className={className}>{text}</motion.span>;
}

export function SummaryCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-card border-border bg-surface border p-5', className)}
      aria-busy="true"
    >
      <div className="flex flex-col items-center">
        <Skeleton className="size-44 rounded-full" />
        <Skeleton className="mt-3 h-4 w-20" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-14" />
            <Skeleton className="mt-1 h-3 w-16" />
            <Skeleton className="mt-1.5 h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-4 h-3 w-32" />
    </div>
  );
}
