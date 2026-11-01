import type { Weight } from '@plate/shared';
import { Plus, Scale } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { formatDayWithYear, todayKey } from '@/lib/dates';
import { formatKg } from '@/lib/format';
import { useDeleteWeight, useSaveWeight, useWeights, useWeightStats } from './api';
import { WeightList } from './WeightList';
import { WeightLogSheet, type WeightLogMode } from './WeightLogSheet';
import { WeightStats } from './WeightStats';
import { inRange, parseRange, rangeBounds, RANGE_OPTIONS, type WeightRange } from './weight-range';

const UNDO_MS = 6000;
// Recharts (with its d3 dependencies) is only needed here; keep it out of the shell everyone loads.
const WeightChart = lazy(() => import('./WeightChart').then((m) => ({ default: m.WeightChart })));

/**
 * Weight (DESIGN §6, FR-W): stats, the chart with its range, and the list of weigh-ins. The range
 * (`?range=`) and the log sheet (`?log=new|<day>`) live in the URL so Back closes the sheet and
 * a reload keeps the range (D63 pattern).
 */
export function WeightPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = parseRange(searchParams.get('range'));
  const logParam = searchParams.get('log');
  const today = todayKey();

  const weights = useWeights();
  const stats = useWeightStats();
  const save = useSaveWeight();
  const remove = useDeleteWeight();

  const setRange = (next: WeightRange) => {
    const params = new URLSearchParams(searchParams);
    if (next === '1m') params.delete('range');
    else params.set('range', next);
    setSearchParams(params, { replace: true });
  };
  const openLog = (target: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('log', target);
    setSearchParams(params);
  };
  const closeLog = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('log');
    setSearchParams(params, { replace: true });
  };

  const entries = weights.data ?? [];
  const first = entries[0];
  const last = entries[entries.length - 1];
  const bounds = rangeBounds(
    range,
    today,
    first && last ? { first: first.day, last: last.day } : null,
  );
  const visible = inRange(entries, bounds);
  const visibleAverage = inRange(stats.data?.movingAverage ?? [], bounds);
  // The entry just before the range gives the oldest visible row its delta.
  const beforeRange = [...entries].reverse().find((w) => w.day < bounds.from);

  const onDelete = (weight: Weight) => {
    if (weight.id < 0) return;
    remove.mutate(weight);
    toast(`Weigh-in on ${formatDayWithYear(weight.day)} removed`, {
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => save.mutate({ day: weight.day, kg: weight.kg, note: weight.note }),
      },
    });
  };

  const logMode: WeightLogMode =
    logParam === null || logParam === 'new'
      ? { kind: 'new' }
      : (() => {
          const existing = entries.find((w) => w.day === logParam);
          return existing ? { kind: 'edit', weight: existing } : { kind: 'new', day: logParam };
        })();

  const pending = weights.isPending || stats.isPending;
  const error = weights.error ?? stats.error;
  const empty = !pending && !error && entries.length === 0;
  const goalKg = stats.data?.goalKg ?? null;
  const goalDate = stats.data?.goalDate ?? null;

  return (
    <>
      <PageHeader
        title="Weight"
        actions={
          <Button onClick={() => openLog('new')} disabled={pending}>
            <Plus className="size-4" aria-hidden="true" />
            Log
          </Button>
        }
      />

      {pending ? (
        <WeightPageSkeleton />
      ) : error ? (
        <Card className="p-0">
          <ErrorState
            message={error.message}
            onRetry={() => {
              void weights.refetch();
              void stats.refetch();
            }}
            retrying={weights.isFetching || stats.isFetching}
          />
        </Card>
      ) : empty ? (
        <Card className="p-0">
          <EmptyState
            icon={Scale}
            title="No weigh-ins yet"
            description="Log your weight once a day to see the trend, your rate and an ETA for your goal."
            action={
              <Button onClick={() => openLog('new')}>
                <Plus className="size-4" aria-hidden="true" />
                Log your weight
              </Button>
            }
          />
          {goalKg !== null ? (
            <p className="text-fg-muted border-border border-t px-6 py-3 text-center text-sm">
              Goal <span className="text-fg tabular font-medium">{formatKg(goalKg)} kg</span>
              {goalDate !== null ? ` · by ${formatDayWithYear(goalDate)}` : ''}
            </p>
          ) : null}
        </Card>
      ) : stats.data ? (
        <div className="lg:grid lg:grid-cols-[22.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          <WeightStats stats={stats.data} className="lg:sticky lg:top-8" />

          <div className="mt-4 flex flex-col gap-4 lg:mt-0">
            <Card>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Trend</CardTitle>
                <Segmented
                  aria-label="Chart range"
                  value={range}
                  onChange={setRange}
                  options={RANGE_OPTIONS}
                  className="sm:w-[18rem]"
                />
              </div>
              <div className="mt-4">
                <Suspense fallback={<Skeleton className="h-60 w-full" />}>
                  <WeightChart
                    entries={visible}
                    movingAverage={visibleAverage}
                    goalKg={goalKg}
                    from={bounds.from}
                    to={bounds.to}
                  />
                </Suspense>
              </div>
            </Card>

            <Card className="p-0">
              <div className="flex items-baseline justify-between px-4 pt-4 pb-2 sm:px-5 sm:pt-5">
                <CardTitle>Weigh-ins</CardTitle>
                <span className="text-fg-muted tabular text-xs">
                  {visible.length === entries.length
                    ? `${entries.length} total`
                    : `${visible.length} of ${entries.length}`}
                </span>
              </div>
              {visible.length === 0 ? (
                <p className="text-fg-faint px-4 pt-2 pb-5 text-sm sm:px-5">
                  Nothing in this range.{' '}
                  <button
                    type="button"
                    className="text-accent font-medium hover:underline"
                    onClick={() => setRange('all')}
                  >
                    Show all
                  </button>
                </p>
              ) : (
                <div className="border-border border-t">
                  <WeightList
                    entries={visible}
                    previous={beforeRange}
                    onEdit={(w) => openLog(w.day)}
                    onDelete={onDelete}
                  />
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      <WeightLogSheet
        open={logParam !== null && !weights.isPending}
        mode={logMode}
        entries={entries}
        latestKg={stats.data?.latest?.kg ?? last?.kg ?? null}
        onClose={closeLog}
        onDelete={onDelete}
      />
    </>
  );
}

function WeightPageSkeleton() {
  return (
    <div
      className="lg:grid lg:grid-cols-[22.5rem_minmax(0,1fr)] lg:items-start lg:gap-8"
      aria-busy="true"
    >
      <div className="rounded-card border-border bg-surface border p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-10 w-32" />
        <div className="mt-3 flex gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="mt-4 h-4 w-48" />
        <Skeleton className="mt-2 h-4 w-40" />
      </div>
      <div className={cn('mt-4 flex flex-col gap-4 lg:mt-0')}>
        <div className="rounded-card border-border bg-surface border p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-9 w-64" />
          </div>
          <Skeleton className="mt-4 h-60 w-full" />
        </div>
        <div className="rounded-card border-border bg-surface border">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-4 sm:px-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
