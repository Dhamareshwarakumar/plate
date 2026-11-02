import {
  macroSplit,
  weeklyIntake,
  type DailyAggregate,
  type InsightsSummary,
  type WeekStart,
} from '@plate/shared';
import { format } from 'date-fns';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { CardTitle } from '@/components/ui/card';
import { ChartTable } from '@/components/ui/chart-table';
import { Segmented } from '@/components/ui/segmented';
import { formatDayLabel, formatDayWithYear, parseDayKey } from '@/lib/dates';
import { formatGrams } from '@/lib/format';
import { LegendItem, Swatch, TooltipBox } from './chart-parts';
import { CHART_HEIGHT, GRID, MACRO_COLOR, MUTED, niceMax } from './chart-theme';

export interface MacrosChartProps {
  daily: readonly DailyAggregate[];
  weekly: boolean;
  weekStart: WeekStart;
  summary: InsightsSummary;
}

type View = 'grams' | 'split';

interface Row {
  key: string;
  /** The x-axis day: the first day the bar covers (a clipped first week starts at the range). */
  tick: string;
  label: string;
  protein: number;
  carbs: number;
  fat: number;
}

const MACROS = [
  { key: 'protein', label: 'Protein', color: MACRO_COLOR.protein, className: 'bg-protein' },
  { key: 'carbs', label: 'Carbs', color: MACRO_COLOR.carbs, className: 'bg-carbs' },
  { key: 'fat', label: 'Fat', color: MACRO_COLOR.fat, className: 'bg-fat' },
] as const;

const VIEW_OPTIONS = [
  { value: 'grams', label: 'grams' },
  { value: 'split', label: 'split' },
] as const satisfies readonly { value: View; label: string }[];

/** Macros per day as stacked grams, or the average split as a donut (FR-I3). */
export function MacrosChart({ daily, weekly, weekStart, summary }: MacrosChartProps) {
  const [view, setView] = useState<View>('grams');
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Macros</CardTitle>
        <Segmented<View>
          aria-label="Macros view"
          value={view}
          onChange={setView}
          options={VIEW_OPTIONS}
          className="w-[10rem]"
        />
      </div>
      <div className="mt-4">
        {view === 'grams' ? (
          <GramsChart daily={daily} weekly={weekly} weekStart={weekStart} />
        ) : (
          <SplitChart summary={summary} />
        )}
      </div>
    </div>
  );
}

function GramsChart({ daily, weekly, weekStart }: Omit<MacrosChartProps, 'summary'>) {
  const rows: Row[] = weekly
    ? weeklyIntake(daily, weekStart).map((week) => ({
        key: week.weekStart,
        tick: week.from,
        label:
          week.from === week.to
            ? formatDayWithYear(week.from)
            : `${format(parseDayKey(week.from), 'd MMM')} – ${formatDayWithYear(week.to)}`,
        protein: week.avgProtein ?? 0,
        carbs: week.avgCarbs ?? 0,
        fat: week.avgFat ?? 0,
      }))
    : daily.map((d) => ({
        key: d.day,
        tick: d.day,
        label: formatDayLabel(d.day),
        protein: d.totals.protein,
        carbs: d.totals.carbs,
        fat: d.totals.fat,
      }));
  const yMax = niceMax(Math.max(0, ...rows.map((r) => r.protein + r.carbs + r.fat)), 50);
  const tickLabel = (tick: string) => {
    const date = parseDayKey(tick);
    if (weekly) return format(date, 'd MMM');
    if (rows.length <= 7) return format(date, 'EEE');
    if (rows.length <= 31) return format(date, 'd');
    return format(date, 'd MMM');
  };

  return (
    <figure className="m-0">
      <div aria-hidden="true" className="text-xs" style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart
            data={rows}
            accessibilityLayer={false}
            margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
            barCategoryGap={rows.length > 31 ? '12%' : '22%'}
          >
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="tick"
              tickFormatter={tickLabel}
              tick={{ fontSize: 11, fill: MUTED }}
              axisLine={false}
              tickLine={false}
              minTickGap={rows.length <= 8 ? 0 : rows.length <= 31 ? 14 : 28}
              tickMargin={8}
              interval={rows.length <= 8 ? 0 : 'preserveStartEnd'}
            />
            <YAxis
              width={48}
              domain={[0, yMax]}
              tickFormatter={(v: number) => `${v} g`}
              tick={{ fontSize: 11, fill: MUTED }}
              axisLine={false}
              tickLine={false}
              tickCount={5}
            />
            <Tooltip
              content={(props) => <GramsTooltip {...props} weekly={weekly} />}
              cursor={{ fill: 'var(--color-surface-2)', fillOpacity: 0.6 }}
              isAnimationActive={false}
            />
            {MACROS.map((macro, i) => (
              <Bar
                key={macro.key}
                dataKey={macro.key}
                stackId="macros"
                fill={macro.color}
                maxBarSize={56}
                isAnimationActive={false}
                radius={i === MACROS.length - 1 ? [3, 3, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-fg-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {MACROS.map((macro) => (
          <LegendItem key={macro.key} swatch={<Swatch className={macro.className} />}>
            {macro.label}
            {weekly ? ' (weekly avg)' : ''}
          </LegendItem>
        ))}
      </figcaption>
      <ChartTable
        caption={weekly ? 'Average macros per week, grams' : 'Macros per day, grams'}
        columns={[weekly ? 'Week' : 'Day', 'Protein (g)', 'Carbs (g)', 'Fat (g)']}
        rows={rows.map((row) => [
          row.label,
          formatGrams(row.protein),
          formatGrams(row.carbs),
          formatGrams(row.fat),
        ])}
      />
    </figure>
  );
}

function GramsTooltip({ active, payload, weekly }: TooltipContentProps & { weekly: boolean }) {
  const row = payload[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <TooltipBox title={`${row.label}${weekly ? ' · weekly avg' : ''}`}>
      <dl className="tabular mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {MACROS.map((macro) => (
          <div key={macro.key} className="contents">
            <dt className="text-fg-muted">{macro.label}</dt>
            <dd className="text-fg text-right font-medium">{formatGrams(row[macro.key])} g</dd>
          </div>
        ))}
      </dl>
    </TooltipBox>
  );
}

function SplitChart({ summary }: { summary: InsightsSummary }) {
  const averages = {
    protein: summary.avgProtein ?? 0,
    carbs: summary.avgCarbs ?? 0,
    fat: summary.avgFat ?? 0,
  };
  const split = macroSplit(averages);
  if (!split) {
    return (
      <p
        className="text-fg-faint flex items-center justify-center text-sm"
        style={{ height: CHART_HEIGHT }}
      >
        No macros logged in this range
      </p>
    );
  }
  const slices = MACROS.map((macro) => ({
    ...macro,
    share: split[macro.key],
    grams: averages[macro.key],
    value: Math.round(split[macro.key] * 1000) / 10,
  }));
  const pct = (share: number) => `${Math.round(share * 100)}%`;

  return (
    <figure className="m-0 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-10">
      <div aria-hidden="true" className="relative size-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart accessibilityLayer={false} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
            >
              {slices.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-fg-muted text-[0.6875rem] font-medium tracking-wide uppercase">
            Avg split
          </span>
          <span className="text-fg tabular text-sm font-semibold">by kcal</span>
        </div>
      </div>
      <figcaption className="w-full max-w-xs sm:w-auto">
        <ul className="flex flex-col gap-2 text-sm">
          {slices.map((slice) => (
            <li key={slice.key} className="flex items-center gap-3">
              <Swatch className={slice.className} />
              <span className="text-fg w-16 font-medium">{slice.label}</span>
              <span className="text-fg tabular w-12 text-right font-semibold">
                {pct(slice.share)}
              </span>
              <span className="text-fg-muted tabular">· {formatGrams(slice.grams)} g/day</span>
            </li>
          ))}
        </ul>
      </figcaption>
      <ChartTable
        caption="Average macro split by calories"
        columns={['Macro', 'Share', 'Average grams per day']}
        rows={slices.map((slice) => [slice.label, pct(slice.share), formatGrams(slice.grams)])}
      />
    </figure>
  );
}
