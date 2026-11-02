import { DEFAULT_SETTINGS } from '@plate/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { ChartColumn } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useAbout, useSettings } from '@/features/settings/api';
import { cn } from '@/lib/cn';
import { todayKey, weekStartsOnFor } from '@/lib/dates';
import { useKeyboardShortcuts } from '@/lib/keyboard';
import {
  useBySlot,
  useInsightsDaily,
  useInsightsSummary,
  useTopFoods,
  useWeightVsIntake,
} from './api';
import { BySlot } from './BySlot';
import { CalendarHeatmap } from './CalendarHeatmap';
import { CustomRangeSheet } from './CustomRangeSheet';
import {
  isWeeklyView,
  parseRangeParams,
  periodStartingAt,
  rangeLabel,
  rangeToParams,
  shiftRange,
  type InsightsRange,
} from './insights-range';
import { RangePicker } from './RangePicker';
import { StatTiles } from './StatTiles';
import { TopFoods } from './TopFoods';

// Recharts stays out of the shell bundle (D96): the three chart modules load on first visit.
const CaloriesChart = lazy(() =>
  import('./CaloriesChart').then((m) => ({ default: m.CaloriesChart })),
);
const MacrosChart = lazy(() => import('./MacrosChart').then((m) => ({ default: m.MacrosChart })));
const WeightVsIntakeChart = lazy(() =>
  import('./WeightVsIntakeChart').then((m) => ({ default: m.WeightVsIntakeChart })),
);
// The AI digest card (Phase 11) is its own chunk too; it only mounts when a provider is configured.
const WeeklyDigestCard = lazy(() =>
  import('@/features/ai/WeeklyDigestCard').then((m) => ({ default: m.WeeklyDigestCard })),
);

const CUSTOM_PARAM = 'pick';

/**
 * Insights (DESIGN §5, FR-I): a range picker whose state lives in the URL (`?range=&from=`,
 * D99), four stat tiles and the seven views as cards. The whole page keeps the previous range
 * on screen (dimmed) while a new one loads; each secondary card has its own error state.
 */
export function InsightsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const about = useAbout();
  const weekStart = settings.data?.weekStart ?? DEFAULT_SETTINGS.weekStart;
  const weekStartsOn = weekStartsOnFor(weekStart);
  const tolerancePct = settings.data?.tolerancePct ?? DEFAULT_SETTINGS.tolerancePct;
  const today = todayKey();
  const range = parseRangeParams(searchParams, today, weekStartsOn);
  const customOpen = searchParams.get(CUSTOM_PARAM) === 'custom';
  const weekly = isWeeklyView(range);

  const summary = useInsightsSummary(range.from, range.to, today);
  const daily = useInsightsDaily(range.from, range.to);
  const topFoods = useTopFoods(range.from, range.to);
  const bySlot = useBySlot(range.from, range.to);
  const weightVsIntake = useWeightVsIntake(range.from, range.to);

  const setRange = (next: InsightsRange) => setSearchParams(rangeToParams(next), { replace: true });
  const openCustom = () => {
    const params = new URLSearchParams(searchParams);
    params.set(CUSTOM_PARAM, 'custom');
    setSearchParams(params);
  };
  const closeCustom = () => {
    const params = new URLSearchParams(searchParams);
    params.delete(CUSTOM_PARAM);
    setSearchParams(params, { replace: true });
  };

  useKeyboardShortcuts({
    ArrowLeft: () => setRange(shiftRange(range, -1, weekStartsOn)),
    ArrowRight: () => {
      const next = shiftRange(range, 1, weekStartsOn);
      if (next.from <= today) setRange(next);
    },
  });

  const pending = summary.isPending || daily.isPending;
  const error = summary.error ?? daily.error;
  const empty = summary.data !== undefined && summary.data.daysLogged === 0;
  const dimmed = summary.isPlaceholderData || daily.isPlaceholderData;

  return (
    <>
      <PageHeader title="Insights" />
      <RangePicker
        range={range}
        today={today}
        weekStartsOn={weekStartsOn}
        onChange={setRange}
        onCustom={openCustom}
      />

      <div className={cn('mt-4', dimmed && 'opacity-60 transition-opacity')} aria-busy={dimmed}>
        {pending ? (
          <InsightsSkeleton />
        ) : error ? (
          <Card className="p-0">
            <ErrorState
              message={error.message}
              onRetry={() => {
                void summary.refetch();
                void daily.refetch();
              }}
              retrying={summary.isFetching || daily.isFetching}
            />
          </Card>
        ) : empty ? (
          <Card className="p-0">
            <EmptyState
              icon={ChartColumn}
              title={`Nothing logged ${rangeLabel(range)}`}
              description="Log a few meals and this range fills with calories, macros, streaks and your top foods."
              action={
                <Link to={`/today/${today}`} className={buttonVariants({})}>
                  Go to today
                </Link>
              }
            />
          </Card>
        ) : summary.data && daily.data ? (
          <>
            <StatTiles summary={summary.data} />

            {/* `min-w-0` on every card: a wide scroller (the year strip) must not widen the grid. */}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {range.kind === 'week' && about.data?.ai.enabled === true ? (
                <Card className="min-w-0 lg:col-span-2">
                  <CardTitle>Weekly digest</CardTitle>
                  <div className="mt-4">
                    <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                      <WeeklyDigestCard weekStart={range.from} />
                    </Suspense>
                  </div>
                </Card>
              ) : null}

              <Card className="min-w-0 lg:col-span-2">
                <CardTitle>{weekly ? 'Calories per week' : 'Calories per day'}</CardTitle>
                <div className="mt-4">
                  <Suspense fallback={<Skeleton className="h-60 w-full" />}>
                    <CaloriesChart
                      daily={daily.data}
                      weekly={weekly}
                      weekStart={weekStart}
                      tolerancePct={tolerancePct}
                      onSelectDay={(day) => void navigate(`/today/${day}`)}
                      onSelectWeek={(start) =>
                        setRange(periodStartingAt('week', start, weekStartsOn))
                      }
                    />
                  </Suspense>
                </div>
              </Card>

              <Card className={cn('min-w-0', weekly && 'lg:col-span-2')}>
                <Suspense fallback={<Skeleton className="h-72 w-full" />}>
                  <MacrosChart
                    daily={daily.data}
                    weekly={weekly}
                    weekStart={weekStart}
                    summary={summary.data}
                  />
                </Suspense>
              </Card>

              <Card className={cn('min-w-0', weekly && 'lg:col-span-2')}>
                <CardTitle>Calendar</CardTitle>
                <div className="mt-4">
                  <CalendarHeatmap
                    daily={daily.data}
                    from={range.from}
                    to={range.to}
                    today={today}
                    weekStartsOn={weekStartsOn}
                  />
                </div>
              </Card>

              <Card className="min-w-0 lg:col-span-2">
                <CardTitle>Weight vs intake</CardTitle>
                <div className="mt-4">
                  <QueryCard query={weightVsIntake} skeleton={<Skeleton className="h-60 w-full" />}>
                    {(weeks) => (
                      <Suspense fallback={<Skeleton className="h-60 w-full" />}>
                        <WeightVsIntakeChart weeks={weeks} />
                      </Suspense>
                    )}
                  </QueryCard>
                </div>
              </Card>

              <Card className="min-w-0">
                <QueryCard query={topFoods} skeleton={<ListSkeleton title="Top foods" />}>
                  {(data) => <TopFoods data={data} />}
                </QueryCard>
              </Card>

              <Card className="min-w-0">
                <CardTitle>By meal</CardTitle>
                <div className="mt-4">
                  <QueryCard query={bySlot} skeleton={<ListSkeleton />}>
                    {(data) => <BySlot data={data} />}
                  </QueryCard>
                </div>
              </Card>
            </div>
          </>
        ) : null}
      </div>

      <CustomRangeSheet
        open={customOpen}
        range={range}
        onClose={closeCustom}
        onApply={(next) => setSearchParams(rangeToParams(next), { replace: true })}
      />
    </>
  );
}

/** Loading / error / content for one secondary card; the error keeps the card and offers a retry. */
function QueryCard<T>({
  query,
  skeleton,
  children,
}: {
  query: UseQueryResult<T, Error>;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton}</>;
  if (query.error) {
    return (
      <ErrorState
        title="Could not load this view"
        message={query.error.message}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className="py-8"
      />
    );
  }
  return <>{children(query.data)}</>;
}

function ListSkeleton({ title }: { title?: string }) {
  return (
    <div aria-busy="true">
      {title ? (
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-40" />
        </div>
      ) : null}
      <div className={cn('flex flex-col gap-3', title && 'mt-4')}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-card border-border bg-surface border p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-24" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border-border bg-surface border p-4 sm:p-5 lg:col-span-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-60 w-full" />
        </div>
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="rounded-card border-border bg-surface border p-4 sm:p-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-4 h-56 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
