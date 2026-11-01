import { WATER_QUICK_ML, type DiaryDay } from '@plate/shared';
import { Droplets, Plus, Undo2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Bar } from '@/components/ui/bar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { formatLitres } from '@/lib/format';
import { useAddWater, useRemoveWater } from './api';
import { WaterAmountSheet } from './WaterAmountSheet';

export interface WaterCardProps {
  day: DiaryDay;
  className?: string | undefined;
}

const CARD = 'bg-surface border-border shadow-card rounded-card border p-4 sm:p-5';

/**
 * Water for the day (FR-D9, DESIGN §2.1): total against the goal when one is set, quick +250 /
 * +500, a custom amount, and "Undo last", which removes the newest addition. Every change is
 * optimistic, so the number and the summary chip move before the server answers.
 */
export function WaterCard({ day, className }: WaterCardProps) {
  const addWater = useAddWater();
  const removeWater = useRemoveWater();
  const [customOpen, setCustomOpen] = useState(false);
  // The card renders twice (phone and desktop slots), so the heading id must be unique.
  const titleId = useId();

  const { ml, entries } = day.water;
  const goalMl = day.goal?.waterMl ?? null;
  const last = entries[entries.length - 1];
  // A temp entry (negative id) is still being created; let it settle before undoing.
  const canUndo = last !== undefined && last.id > 0 && !removeWater.isPending;
  const add = (amount: number) => addWater.mutate({ day: day.day, ml: amount });

  return (
    <section aria-labelledby={titleId} className={cn(CARD, className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-fg flex items-center gap-2 text-base font-semibold">
          <span
            className="bg-water/15 text-water flex size-8 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            <Droplets className="size-4" />
          </span>
          Water
        </h2>
        <p className="tabular text-right" aria-live="polite">
          <span className="text-fg text-xl font-semibold">{formatLitres(ml)}</span>
          <span className="text-fg-muted text-sm font-medium">
            {goalMl !== null ? ` / ${formatLitres(goalMl)} L` : ' L'}
          </span>
        </p>
      </div>

      {goalMl !== null ? (
        <Bar
          label="Water"
          value={ml}
          max={goalMl}
          color="water"
          unit="L"
          format={formatLitres}
          showLabel={false}
          className="mt-3"
        />
      ) : (
        <p className="text-fg-faint mt-2 text-xs">
          No water goal yet ·{' '}
          <Link to="/more?goal=edit" className="text-accent font-medium hover:underline">
            set one in More
          </Link>
        </p>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {WATER_QUICK_ML.map((amount) => (
          <Button
            key={amount}
            variant="secondary"
            onClick={() => add(amount)}
            aria-label={`Add ${amount} ml of water`}
            className="tabular"
          >
            <Plus className="size-4" aria-hidden="true" />
            {amount}
          </Button>
        ))}
        <Button
          variant="secondary"
          onClick={() => setCustomOpen(true)}
          aria-label="Add a custom amount of water"
        >
          <Plus className="size-4" aria-hidden="true" />…
        </Button>
      </div>
      <div className="mt-1 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-fg-muted -mr-3"
          disabled={!canUndo}
          onClick={() => {
            if (last) removeWater.mutate(last);
          }}
          aria-label="Undo last water entry"
        >
          <Undo2 className="size-4" aria-hidden="true" />
          Undo last
        </Button>
      </div>

      <WaterAmountSheet
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        onAdd={(amount) => {
          add(amount);
          setCustomOpen(false);
        }}
      />
    </section>
  );
}

export function WaterCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(CARD, className)} aria-busy="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="mt-3 h-1.5 w-full rounded-full" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-11 w-20" />
        <Skeleton className="h-11 w-20" />
        <Skeleton className="h-11 w-14" />
      </div>
    </div>
  );
}
