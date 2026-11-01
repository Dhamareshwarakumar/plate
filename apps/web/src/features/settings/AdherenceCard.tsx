import { DEFAULT_SETTINGS, TOLERANCE_MAX } from '@plate/shared';
import { useState } from 'react';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { ErrorState } from '@/components/ui/states';
import { activeGoalFor, useGoals } from '@/features/goals/api';
import { todayKey } from '@/lib/dates';
import { formatKcal } from '@/lib/format';
import { useSettings, useUpdateSettings } from './api';

const EXAMPLE_KCAL = 2000;

/** More → Adherence tolerance (FR-G3): the ± band that counts a day as on target. */
export function AdherenceCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const goals = useGoals();
  // Shown while dragging; the saved value takes over again on commit.
  const [dragging, setDragging] = useState<number | null>(null);

  const saved = settings.data?.tolerancePct ?? DEFAULT_SETTINGS.tolerancePct;
  const value = dragging ?? saved;
  const goalKcal = activeGoalFor(goals.data, todayKey())?.kcal ?? EXAMPLE_KCAL;
  const low = goalKcal * (1 - value / 100);
  const high = goalKcal * (1 + value / 100);

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>Adherence tolerance</CardTitle>
          <CardDescription>
            How close to the calorie goal still counts as on target.
          </CardDescription>
        </div>
        <span className="text-fg tabular shrink-0 text-2xl font-semibold" aria-hidden="true">
          ±{value}%
        </span>
      </div>
      {settings.isPending ? (
        <Skeleton className="mt-5 h-11" />
      ) : settings.isError ? (
        <ErrorState
          message={settings.error.message}
          onRetry={() => void settings.refetch()}
          retrying={settings.isFetching}
          className="py-6"
        />
      ) : (
        <>
          <Slider
            className="mt-3"
            aria-label="Adherence tolerance in percent"
            value={value}
            min={0}
            max={TOLERANCE_MAX}
            step={1}
            onValueChange={setDragging}
            onValueCommit={(next) => {
              setDragging(null);
              if (next !== saved) update.mutate({ tolerancePct: next });
            }}
          />
          <div className="text-fg-faint flex justify-between text-xs" aria-hidden="true">
            <span>0% · exact</span>
            <span>{TOLERANCE_MAX}%</span>
          </div>
          <p className="text-fg-muted mt-3 text-sm" aria-live="polite">
            A {formatKcal(goalKcal)} kcal day counts as on target between{' '}
            <span className="text-fg tabular font-medium">{formatKcal(low)}</span> and{' '}
            <span className="text-fg tabular font-medium">{formatKcal(high)}</span> kcal.
          </p>
        </>
      )}
    </Card>
  );
}
