import { macroPercentOfKcal, type Goal } from '@plate/shared';
import { ChevronDown, Pencil, Scale, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Tag } from '@/components/ui/chip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDayLabel, formatDayWithYear, todayKey } from '@/lib/dates';
import { formatGrams, formatKcal, formatKg } from '@/lib/format';
import { activeGoalFor, useDeleteGoal, useGoals } from './api';

interface GoalCardProps {
  onEdit: () => void;
  className?: string | undefined;
}

/** More → Goal (DESIGN §7): the active goal, Edit, and the history of past and upcoming goals. */
export function GoalCard({ onEdit, className }: GoalCardProps) {
  const goals = useGoals();
  const deleteGoal = useDeleteGoal();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Goal | null>(null);
  const today = todayKey();
  const active = activeGoalFor(goals.data, today);
  const upcoming = goals.data?.filter((g) => g.effectiveFrom > today) ?? [];

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteGoal.mutateAsync(toDelete.id);
      toast.success('Goal deleted');
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not delete. Try again.');
    } finally {
      setToDelete(null);
    }
  };

  return (
    <Card className={cn('p-0', className)}>
      <div className="p-4 sm:p-5">
        {goals.isPending ? (
          <GoalSkeleton />
        ) : goals.isError ? (
          <ErrorState
            message={goals.error.message}
            onRetry={() => void goals.refetch()}
            retrying={goals.isFetching}
            className="py-6"
          />
        ) : active ? (
          <ActiveGoal goal={active} upcoming={upcoming} onEdit={onEdit} />
        ) : (
          <EmptyState
            icon={Target}
            title="No goal yet"
            description={
              upcoming.length > 0
                ? `A goal starts on ${formatDayLabel(upcoming[upcoming.length - 1]!.effectiveFrom)}. Until then days show no goal.`
                : 'Set a daily calorie and macro target to see how each day measures up.'
            }
            action={
              <Button onClick={onEdit}>
                <Target className="size-4" aria-hidden="true" />
                Set a goal
              </Button>
            }
            className="py-6"
          />
        )}
      </div>

      {goals.data && goals.data.length > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
            className="text-fg hover:bg-surface-2 flex h-12 w-full items-center gap-2 border-t border-border px-4 text-sm font-medium transition-colors sm:px-5"
          >
            <span className="flex-1 text-left">Goal history ({goals.data.length})</span>
            <ChevronDown
              className={cn(
                'text-fg-faint size-4 transition-transform',
                historyOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>
          {historyOpen ? (
            <ul className="border-border border-t" aria-label="Goal history">
              {goals.data.map((g) => (
                <GoalRow
                  key={g.id}
                  goal={g}
                  state={
                    g.id === active?.id ? 'current' : g.effectiveFrom > today ? 'upcoming' : 'past'
                  }
                  onDelete={() => setToDelete(g)}
                />
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        title="Delete this goal?"
        description={
          toDelete
            ? `Days from ${formatDayLabel(toDelete.effectiveFrom)} until the next goal fall back to the goal before it, or show no goal if there is none. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete goal"
        destructive
        pending={deleteGoal.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </Card>
  );
}

function ActiveGoal({
  goal,
  upcoming,
  onEdit,
}: {
  goal: Goal;
  upcoming: Goal[];
  onEdit: () => void;
}) {
  const pct = macroPercentOfKcal(goal);
  const next = upcoming[upcoming.length - 1];
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>Goal</CardTitle>
          <CardDescription>Since {formatDayLabel(goal.effectiveFrom)}</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="size-4" aria-hidden="true" />
          Edit goal
        </Button>
      </div>
      <p className="text-fg mt-4 flex items-baseline gap-1.5">
        <span className="tabular text-[2rem] leading-none font-semibold">
          {formatKcal(goal.kcal)}
        </span>
        <span className="text-fg-muted text-sm font-medium">kcal per day</span>
      </p>
      <dl className="mt-4 grid max-w-xl grid-cols-3 gap-3">
        <MacroStat label="Protein" dot="bg-protein" grams={goal.proteinG} pct={pct?.protein} />
        <MacroStat label="Carbs" dot="bg-carbs" grams={goal.carbsG} pct={pct?.carbs} />
        <MacroStat label="Fat" dot="bg-fat" grams={goal.fatG} pct={pct?.fat} />
      </dl>
      {goal.fiberG !== null || goal.waterMl !== null ? (
        <p className="text-fg-muted mt-3 text-sm">
          {goal.fiberG !== null ? (
            <>
              Fiber{' '}
              <span className="text-fg tabular font-medium">{formatGrams(goal.fiberG)} g</span>
            </>
          ) : null}
          {goal.fiberG !== null && goal.waterMl !== null ? ' · ' : null}
          {goal.waterMl !== null ? (
            <>
              Water{' '}
              <span className="text-fg tabular font-medium">
                {(goal.waterMl / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} L
              </span>
            </>
          ) : null}
        </p>
      ) : null}
      {goal.goalWeightKg !== null ? (
        <p className="text-fg-muted mt-3 flex items-center gap-1.5 text-sm">
          <Scale className="text-fg-faint size-4" aria-hidden="true" />
          Goal weight{' '}
          <span className="text-fg tabular font-medium">{formatKg(goal.goalWeightKg)} kg</span>
          {goal.goalWeightDate !== null ? (
            <span className="text-fg-muted">· by {formatDayWithYear(goal.goalWeightDate)}</span>
          ) : null}
        </p>
      ) : null}
      {next ? (
        <p className="text-fg-faint mt-3 text-xs">
          A new goal of {formatKcal(next.kcal)} kcal starts on {formatDayLabel(next.effectiveFrom)}.
        </p>
      ) : null}
    </>
  );
}

function MacroStat({
  label,
  dot,
  grams,
  pct,
}: {
  label: string;
  dot: string;
  grams: number;
  pct: number | undefined;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-muted flex items-center gap-1.5 text-xs font-medium">
        <span className={cn('size-2 rounded-full', dot)} aria-hidden="true" />
        {label}
      </dt>
      <dd className="text-fg tabular mt-0.5 text-base font-semibold">
        {formatGrams(grams)}
        <span className="text-fg-muted text-xs font-normal"> g</span>
        {pct !== undefined ? (
          <span className="text-fg-muted text-xs font-normal"> · {pct} %</span>
        ) : null}
      </dd>
    </div>
  );
}

function GoalRow({
  goal,
  state,
  onDelete,
}: {
  goal: Goal;
  state: 'current' | 'upcoming' | 'past';
  onDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-fg flex items-center gap-2 text-sm font-medium">
          <span className="tabular">{formatKcal(goal.kcal)} kcal</span>
          {state === 'current' ? (
            <Tag className="bg-accent-soft text-accent">Current</Tag>
          ) : state === 'upcoming' ? (
            <Tag>Upcoming</Tag>
          ) : null}
        </p>
        <p className="text-fg-muted tabular mt-0.5 text-xs">
          From {formatDayLabel(goal.effectiveFrom)} · P {formatGrams(goal.proteinG)} · C{' '}
          {formatGrams(goal.carbsG)} · F {formatGrams(goal.fatG)}
          {goal.fiberG !== null ? ` · Fiber ${formatGrams(goal.fiberG)}` : ''}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete goal from ${formatDayLabel(goal.effectiveFrom)}`}
        className="text-fg-muted hover:text-danger hover:bg-danger/10 -mr-2"
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

function GoalSkeleton() {
  return (
    <div aria-busy="true">
      <div className="flex items-start justify-between">
        <div>
          <Skeleton className="h-5 w-12" />
          <Skeleton className="mt-2 h-4 w-28" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
      <Skeleton className="mt-4 h-8 w-40" />
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </div>
  );
}
