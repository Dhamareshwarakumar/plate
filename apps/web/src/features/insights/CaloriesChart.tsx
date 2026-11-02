import {
  weeklyIntake,
  type DailyAggregate,
  type DayStatus,
  type WeekStart,
  type WeeklyIntake,
} from '@plate/shared';
import { format } from 'date-fns';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type MouseHandlerDataParam,
  type TooltipContentProps,
} from 'recharts';
import { ChartTable } from '@/components/ui/chart-table';
import { formatDayLabel, formatDayWithYear, parseDayKey } from '@/lib/dates';
import { formatKcal } from '@/lib/format';
import { LegendItem, Swatch, TooltipBox } from './chart-parts';
import {
  ACCENT,
  CHART_HEIGHT,
  GRID,
  kcalTicks,
  MUTED,
  niceMax,
  STATUS_BG,
  STATUS_COLOR,
  STATUS_LABEL,
} from './chart-theme';

export interface CaloriesChartProps {
  daily: readonly DailyAggregate[];
  /** One bar per week instead of per day (ranges over 100 days, D103). */
  weekly: boolean;
  weekStart: WeekStart;
  tolerancePct: number;
  onSelectDay: (day: string) => void;
  onSelectWeek: (weekStart: string) => void;
}

interface Row {
  key: string;
  label: string;
  kcal: number;
  goal: number | null;
  status: DayStatus | null;
  color: string;
}

/** Consecutive rows sharing one kcal goal: one shaded band and one dashed line each. */
interface GoalRun {
  first: string;
  last: string;
  next: string | undefined;
  goal: number;
}

function goalRuns(rows: readonly Row[]): GoalRun[] {
  const runs: GoalRun[] = [];
  rows.forEach((row, i) => {
    if (row.goal === null) return;
    const current = runs[runs.length - 1];
    const previous = rows[i - 1];
    if (current && previous && current.goal === row.goal && current.last === previous.key) {
      current.last = row.key;
    } else {
      runs.push({ first: row.key, last: row.key, next: undefined, goal: row.goal });
    }
  });
  // `next` is the row after the run: its left edge is where the run's line must stop.
  for (const run of runs) {
    run.next = rows[rows.findIndex((r) => r.key === run.last) + 1]?.key;
  }
  return runs;
}

const weekLabel = (week: WeeklyIntake) =>
  week.from === week.to
    ? formatDayWithYear(week.from)
    : `${format(parseDayKey(week.from), 'd MMM')} – ${formatDayWithYear(week.to)}`;

/**
 * Calories per day (FR-I2): bars coloured by the day's status, the goal as a dashed line and
 * the ± tolerance band shaded behind, both stepping where the goal changed. Long ranges show
 * one accent bar per week (the average over logged days). Click a column to open that day
 * (or that week in Insights).
 */
export function CaloriesChart({
  daily,
  weekly,
  weekStart,
  tolerancePct,
  onSelectDay,
  onSelectWeek,
}: CaloriesChartProps) {
  const rows: Row[] = weekly
    ? weeklyIntake(daily, weekStart).map((week) => ({
        key: week.weekStart,
        label: weekLabel(week),
        kcal: week.avgKcal ?? 0,
        goal: week.goalKcal,
        status: null,
        color: ACCENT,
      }))
    : daily.map((d) => ({
        key: d.day,
        label: formatDayLabel(d.day),
        kcal: d.totals.kcal,
        goal: d.goalKcal,
        status: d.status,
        color: STATUS_COLOR[d.status],
      }));
  const runs = goalRuns(rows);
  const band = (goal: number) => [goal * (1 - tolerancePct / 100), goal * (1 + tolerancePct / 100)];
  const yMax = niceMax(
    Math.max(0, ...rows.map((r) => r.kcal), ...runs.map((r) => band(r.goal)[1]!)),
    500,
  );

  const tickLabel = (key: string) => {
    const date = parseDayKey(key);
    if (weekly) return format(date, 'd MMM');
    if (rows.length <= 7) return format(date, 'EEE');
    if (rows.length <= 31) return format(date, 'd');
    return format(date, 'd MMM');
  };
  const onClick = (state: MouseHandlerDataParam) => {
    const index = Number(state.activeTooltipIndex ?? NaN);
    const row = Number.isInteger(index) ? rows[index] : undefined;
    if (!row) return;
    if (weekly) onSelectWeek(row.key);
    else onSelectDay(row.key);
  };

  const statusesShown = new Set(
    rows.map((r) => r.status).filter((s): s is DayStatus => s !== null),
  );
  const legendStatuses = (['on_target', 'under', 'over', 'no_goal'] as const).filter((s) =>
    statusesShown.has(s),
  );

  return (
    <figure className="m-0">
      <div aria-hidden="true" className="text-xs" style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart
            data={rows}
            accessibilityLayer={false}
            margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
            barCategoryGap={rows.length > 31 ? '12%' : '22%'}
            onClick={onClick}
            className="cursor-pointer"
          >
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="key"
              tickFormatter={tickLabel}
              tick={{ fontSize: 11, fill: MUTED }}
              axisLine={false}
              tickLine={false}
              minTickGap={rows.length <= 8 ? 0 : rows.length <= 31 ? 14 : 28}
              tickMargin={8}
              interval={rows.length <= 8 ? 0 : 'preserveStartEnd'}
            />
            <YAxis
              width={44}
              domain={[0, yMax]}
              ticks={kcalTicks(yMax)}
              tickFormatter={(v: number) => formatKcal(v)}
              tick={{ fontSize: 11, fill: MUTED }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={(props) => <CaloriesTooltip {...props} weekly={weekly} />}
              cursor={{ fill: 'var(--color-surface-2)', fillOpacity: 0.6 }}
              isAnimationActive={false}
            />
            {runs.map((run) => {
              const [lo, hi] = band(run.goal) as [number, number];
              return (
                <ReferenceArea
                  key={`band-${run.first}`}
                  x1={run.first}
                  x2={run.last}
                  y1={lo}
                  y2={hi}
                  fill="var(--color-on-target)"
                  fillOpacity={0.12}
                  stroke="none"
                  ifOverflow="visible"
                />
              );
            })}
            {runs.map((run) => (
              <ReferenceLine
                key={`goal-${run.first}`}
                position="start"
                segment={[
                  { x: run.first, y: run.goal },
                  run.next === undefined ? { y: run.goal } : { x: run.next, y: run.goal },
                ]}
                stroke={MUTED}
                strokeDasharray="4 4"
                strokeWidth={1.5}
                ifOverflow="visible"
              />
            ))}
            <Bar
              dataKey="kcal"
              isAnimationActive={false}
              radius={[3, 3, 0, 0]}
              minPointSize={0}
              maxBarSize={56}
            >
              {rows.map((row) => (
                <Cell key={row.key} fill={row.color} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <figcaption className="text-fg-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {weekly ? (
          <LegendItem swatch={<Swatch className="bg-accent" />}>Weekly average</LegendItem>
        ) : (
          legendStatuses.map((status) => (
            <LegendItem key={status} swatch={<Swatch className={STATUS_BG[status]} />}>
              {STATUS_LABEL[status]}
            </LegendItem>
          ))
        )}
        {runs.length > 0 ? (
          <>
            <LegendItem swatch={<span className="border-fg-muted w-4 border-t border-dashed" />}>
              Goal
            </LegendItem>
            <LegendItem swatch={<Swatch className="bg-on-target/25" />}>
              ±{tolerancePct}% band
            </LegendItem>
          </>
        ) : null}
      </figcaption>

      <ChartTable
        caption={weekly ? 'Average calories per week' : 'Calories per day'}
        columns={
          weekly ? ['Week', 'Average calories', 'Goal'] : ['Day', 'Calories', 'Goal', 'Status']
        }
        rows={rows.map((row) =>
          weekly
            ? [
                row.label,
                row.kcal === 0 ? '' : formatKcal(row.kcal),
                row.goal === null ? '' : formatKcal(row.goal),
              ]
            : [
                row.label,
                formatKcal(row.kcal),
                row.goal === null ? '' : formatKcal(row.goal),
                row.status ? STATUS_LABEL[row.status] : '',
              ],
        )}
      />
    </figure>
  );
}

function CaloriesTooltip({ active, payload, weekly }: TooltipContentProps & { weekly: boolean }) {
  const row = payload[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <TooltipBox title={row.label}>
      <p className="text-fg tabular mt-0.5 text-sm font-semibold">
        {formatKcal(row.kcal)} kcal{weekly ? ' avg' : ''}
      </p>
      {row.goal !== null ? (
        <p className="text-fg-muted tabular mt-0.5">Goal {formatKcal(row.goal)}</p>
      ) : null}
      {row.status ? <p className="text-fg-muted mt-0.5">{STATUS_LABEL[row.status]}</p> : null}
    </TooltipBox>
  );
}
