import type { WeightVsIntakePoint } from '@plate/shared';
import { format } from 'date-fns';
import { Link } from 'react-router';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { ChartTable } from '@/components/ui/chart-table';
import { formatDayWithYear, parseDayKey } from '@/lib/dates';
import { formatKcal, formatKg } from '@/lib/format';
import { LegendItem, Swatch, TooltipBox } from './chart-parts';
import { ACCENT, CHART_HEIGHT, GRID, kcalTicks, MUTED, niceMax } from './chart-theme';

export interface WeightVsIntakeChartProps {
  weeks: readonly WeightVsIntakePoint[];
}

interface Row {
  key: string;
  /** The x-axis day: the first day the bucket covers (a clipped first week starts at the range). */
  tick: string;
  label: string;
  avgKcal: number | null;
  avgWeightKg: number | null;
  weighIns: number;
}

const weekLabel = (week: WeightVsIntakePoint) =>
  week.from === week.to
    ? formatDayWithYear(week.from)
    : `${format(parseDayKey(week.from), 'd MMM')} – ${formatDayWithYear(week.to)}`;

/** Weekly average kcal as bars against the 7-day weight moving average as a line, two axes (FR-I5). */
export function WeightVsIntakeChart({ weeks }: WeightVsIntakeChartProps) {
  const rows: Row[] = weeks.map((week) => ({
    key: week.weekStart,
    tick: week.from,
    label: weekLabel(week),
    avgKcal: week.avgKcal,
    avgWeightKg: week.avgWeightKg === null ? null : Math.round(week.avgWeightKg * 100) / 100,
    weighIns: week.weighIns,
  }));
  const weights = rows.map((r) => r.avgWeightKg).filter((v): v is number => v !== null);
  const hasWeights = weights.length > 0;
  const kcalMax = niceMax(Math.max(0, ...rows.map((r) => r.avgKcal ?? 0)), 500);
  const wMin = hasWeights ? Math.floor(Math.min(...weights) - 0.5) : 0;
  const wMax = hasWeights ? Math.ceil(Math.max(...weights) + 0.5) : 1;

  return (
    <figure className="m-0">
      <div aria-hidden="true" className="text-xs" style={{ height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart
            data={rows}
            accessibilityLayer={false}
            margin={{ left: 0, right: 0, top: 8, bottom: 0 }}
            barCategoryGap="28%"
          >
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="tick"
              tickFormatter={(tick: string) => format(parseDayKey(tick), 'd MMM')}
              tick={{ fontSize: 11, fill: MUTED }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
              tickMargin={8}
              interval={rows.length <= 8 ? 0 : 'preserveStartEnd'}
            />
            <YAxis
              yAxisId="kcal"
              width={44}
              domain={[0, kcalMax]}
              ticks={kcalTicks(kcalMax)}
              tickFormatter={(v: number) => formatKcal(v)}
              tick={{ fontSize: 11, fill: MUTED }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="kg"
              orientation="right"
              width={40}
              domain={[wMin, wMax]}
              tickFormatter={(v: number) => formatKg(v)}
              tick={{ fontSize: 11, fill: MUTED }}
              axisLine={false}
              tickLine={false}
              tickCount={5}
              hide={!hasWeights}
            />
            <Tooltip
              content={WeightVsIntakeTooltip}
              cursor={{ fill: 'var(--color-surface-2)', fillOpacity: 0.6 }}
              isAnimationActive={false}
            />
            <Bar
              yAxisId="kcal"
              dataKey="avgKcal"
              fill={ACCENT}
              fillOpacity={0.6}
              radius={[3, 3, 0, 0]}
              maxBarSize={56}
              isAnimationActive={false}
            />
            <Line
              yAxisId="kg"
              dataKey="avgWeightKg"
              type="monotone"
              stroke="var(--color-fg)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-fg)', strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: 'var(--color-surface)', strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {hasWeights ? null : (
        <p className="text-fg-muted mt-2 text-sm">
          No weigh-ins in this range.{' '}
          <Link to="/weight" className="text-accent font-medium hover:underline">
            Log your weight
          </Link>
        </p>
      )}

      <figcaption className="text-fg-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <LegendItem swatch={<Swatch className="bg-accent/60" />}>Weekly avg kcal</LegendItem>
        <LegendItem swatch={<span className="bg-fg h-0.5 w-4 rounded-full" />}>
          Weight, 7-day average
        </LegendItem>
      </figcaption>

      <ChartTable
        caption="Weekly average calories and weight"
        columns={['Week', 'Average kcal', 'Average weight (kg)', 'Weigh-ins']}
        rows={rows.map((row) => [
          row.label,
          row.avgKcal === null ? '' : formatKcal(row.avgKcal),
          row.avgWeightKg === null ? '' : formatKg(row.avgWeightKg),
          row.weighIns,
        ])}
      />
    </figure>
  );
}

function WeightVsIntakeTooltip({ active, payload }: TooltipContentProps) {
  const row = payload[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <TooltipBox title={row.label}>
      <p className="text-fg tabular mt-0.5 text-sm font-semibold">
        {row.avgKcal === null ? 'Nothing logged' : `${formatKcal(row.avgKcal)} kcal avg`}
      </p>
      <p className="text-fg-muted tabular mt-0.5">
        {row.avgWeightKg === null
          ? 'No weigh-ins'
          : `${formatKg(row.avgWeightKg)} kg · ${row.weighIns} weigh-in${row.weighIns === 1 ? '' : 's'}`}
      </p>
    </TooltipBox>
  );
}
