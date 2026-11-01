import { macroSplit, type Nutrients } from '@plate/shared';
import { ChevronRight, Target } from 'lucide-react';
import { motion, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatGrams } from '@/lib/format';

interface SummaryCardProps {
  totals: Nutrients;
  entryCount: number;
  className?: string;
}

/**
 * Day totals. Until a goal exists (Phase 3) the card shows what was eaten with a "Set a goal" link;
 * the kcal figure counts up through a spring whenever it changes.
 */
export function SummaryCard({ totals, entryCount, className }: SummaryCardProps) {
  const split = macroSplit(totals);
  return (
    <section
      aria-label="Day summary"
      className={cn(
        'rounded-card border-border shadow-card relative overflow-hidden border p-5',
        'bg-[linear-gradient(135deg,var(--accent-soft),transparent_55%),var(--surface)]',
        className,
      )}
    >
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
        <Link
          to="/more"
          className="text-accent hover:bg-accent-soft -mr-2 flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium transition-colors"
        >
          <Target className="size-4" aria-hidden="true" />
          Set a goal
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
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
          : `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} · no goal set`}
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
      <Skeleton className="h-3 w-12" />
      <Skeleton className="mt-3 h-10 w-36" />
      <Skeleton className="mt-5 h-2 w-full rounded-full" />
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </div>
  );
}
