import { daysBetween, type Weight, type WeightPoint } from '@plate/shared';
import { format } from 'date-fns';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import { ChartTable } from '@/components/ui/chart-table';
import { formatDayLabel, formatDayWithYear, parseDayKey, toDayKey } from '@/lib/dates';
import { formatKg } from '@/lib/format';

export interface WeightChartProps {
  /** Weigh-ins inside the range, oldest first. */
  entries: readonly Weight[];
  /** Moving-average points inside the range (computed by the server over the whole log). */
  movingAverage: readonly WeightPoint[];
  goalKg: number | null;
  from: string;
  to: string;
}

interface ChartPoint {
  t: number;
  day: string;
  kg?: number;
  ma?: number;
}

const HEIGHT = 240;
const DAY_MS = 86_400_000;
const LONG_RANGE_DAYS = 200;
const DENSE_POINTS = 120;

const ACCENT = 'var(--color-accent)';
const MUTED = 'var(--color-fg-muted)';
const GRID = 'var(--color-border)';

/**
 * Dots for the weigh-ins, a line for the 7-day moving average and a dashed goal line (DESIGN §6).
 * The SVG is decorative for assistive tech; the hidden table next to it carries the same values
 * (DESIGN §10). Colours come from the theme variables so the chart follows dark mode.
 */
export function WeightChart({ entries, movingAverage, goalKg, from, to }: WeightChartProps) {
  const points = mergePoints(entries, movingAverage);
  const rangeDays = daysBetween(from, to);
  const toMs = parseDayKey(to).getTime();
  // Keep at least a week of width so a lone weigh-in is not a dot on a zero-width axis.
  const fromMs = Math.min(parseDayKey(from).getTime(), toMs - 6 * DAY_MS);
  const longRange = rangeDays > LONG_RANGE_DAYS;
  const tickLabel = (ms: number) => format(new Date(ms), longRange ? 'MMM yyyy' : 'd MMM');

  const values = points.flatMap((p) => [p.kg, p.ma]).filter((v): v is number => v !== undefined);
  if (goalKg !== null) values.push(goalKg);
  const yMin = values.length ? Math.floor(Math.min(...values) - 0.5) : 0;
  const yMax = values.length ? Math.ceil(Math.max(...values) + 0.5) : 100;
  const dotRadius = points.length > DENSE_POINTS ? 2 : 3;

  const rangeLabel = `${formatDayWithYear(from)} to ${formatDayWithYear(to)}`;

  return (
    <figure className="m-0">
      {points.length === 0 ? (
        <div
          className="text-fg-faint flex items-center justify-center text-sm"
          style={{ height: HEIGHT }}
        >
          No weigh-ins in this range
        </div>
      ) : (
        <div aria-hidden="true" className="text-xs" style={{ height: HEIGHT }}>
          <ResponsiveContainer width="100%" height={HEIGHT}>
            <LineChart
              data={points}
              accessibilityLayer={false}
              margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[fromMs, toMs]}
                tickFormatter={tickLabel}
                tick={{ fontSize: 11, fill: MUTED }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
                tickMargin={8}
              />
              <YAxis
                width={40}
                domain={[yMin, yMax]}
                tickFormatter={(v: number) => formatKg(v)}
                tick={{ fontSize: 11, fill: MUTED }}
                axisLine={false}
                tickLine={false}
                tickCount={5}
              />
              <Tooltip
                content={WeightTooltip}
                cursor={{ stroke: 'var(--color-border-strong)', strokeDasharray: '3 3' }}
                isAnimationActive={false}
              />
              {goalKg !== null ? (
                <ReferenceLine
                  y={goalKg}
                  stroke={MUTED}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: `Goal ${formatKg(goalKg)}`,
                    position: 'insideTopRight',
                    fontSize: 11,
                    fill: MUTED,
                  }}
                />
              ) : null}
              <Line
                dataKey="kg"
                stroke="none"
                dot={{ r: dotRadius, fill: ACCENT, fillOpacity: 0.75, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: ACCENT, stroke: 'var(--color-surface)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Line
                dataKey="ma"
                type="monotone"
                stroke={ACCENT}
                strokeWidth={2}
                dot={false}
                activeDot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <figcaption className="text-fg-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="bg-accent/75 size-2 rounded-full" aria-hidden="true" />
          Weigh-ins
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-accent h-0.5 w-4 rounded-full" aria-hidden="true" />
          7-day average
        </span>
        {goalKg !== null ? (
          <span className="flex items-center gap-1.5">
            <span className="border-fg-muted w-4 border-t border-dashed" aria-hidden="true" />
            Goal {formatKg(goalKg)} kg
          </span>
        ) : null}
      </figcaption>

      <ChartTable
        caption={`Weight, ${rangeLabel}`}
        columns={['Day', 'Weight (kg)', '7-day average (kg)']}
        rows={points.map((p) => [
          formatDayLabel(p.day),
          p.kg === undefined ? '' : formatKg(p.kg),
          p.ma === undefined ? '' : formatKg(p.ma),
        ])}
      />
    </figure>
  );
}

/** One row per day holding the weigh-in and/or the moving average of that day. */
function mergePoints(
  entries: readonly Weight[],
  movingAverage: readonly WeightPoint[],
): ChartPoint[] {
  const byDay = new Map<string, ChartPoint>();
  const at = (day: string) => {
    let point = byDay.get(day);
    if (!point) {
      point = { t: parseDayKey(day).getTime(), day };
      byDay.set(day, point);
    }
    return point;
  };
  for (const e of entries) at(e.day).kg = e.kg;
  for (const m of movingAverage) at(m.day).ma = Math.round(m.kg * 100) / 100;
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

function WeightTooltip({ active, payload }: TooltipContentProps) {
  const point = payload[0]?.payload as ChartPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="bg-surface border-border rounded-control border px-3 py-2 text-xs shadow-lg">
      <p className="text-fg-muted">{formatDayLabel(toDayKey(new Date(point.t)))}</p>
      {point.kg !== undefined ? (
        <p className="text-fg tabular mt-0.5 text-sm font-semibold">{formatKg(point.kg)} kg</p>
      ) : null}
      {point.ma !== undefined ? (
        <p className="text-fg-muted tabular mt-0.5">7-day avg {formatKg(point.ma)}</p>
      ) : null}
    </div>
  );
}
