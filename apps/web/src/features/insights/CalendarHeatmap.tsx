import { shiftDayKey, type DailyAggregate, type DayStatus } from '@plate/shared';
import { format } from 'date-fns';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';
import {
  formatDayLong,
  formatMonthLong,
  monthBounds,
  monthGrid,
  parseDayKey,
  shiftMonth,
  weekdayLabels,
  weekDays,
  type WeekStartsOn,
} from '@/lib/dates';
import { formatKcal } from '@/lib/format';
import { LegendItem, Swatch } from './chart-parts';
import { STATUS_BG, STATUS_LABEL } from './chart-theme';
import { isWeeklyView, rangeDays } from './insights-range';

export interface CalendarHeatmapProps {
  daily: readonly DailyAggregate[];
  from: string;
  to: string;
  today: string;
  weekStartsOn: WeekStartsOn;
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const LEGEND: DayStatus[] = ['not_logged', 'on_target', 'under', 'over', 'no_goal'];

/**
 * Day status heatmap (FR-I4, D105): one row for a week, a grid per calendar month for ranges up
 * to 100 days, and a GitHub-style year strip beyond that. Every past cell is a link to that day
 * in Today whose label carries the day, its status and its kcal, so the grid is its own
 * accessible representation. Future days are blank outlines.
 */
export function CalendarHeatmap({ daily, from, to, today, weekStartsOn }: CalendarHeatmapProps) {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const cell = (day: string, size: 'month' | 'strip') => (
    <DayCell key={day} day={day} data={byDay.get(day)} today={today} size={size} />
  );

  let body: React.ReactNode;
  if (isWeeklyView({ from, to })) {
    body = <YearStrip from={from} to={to} weekStartsOn={weekStartsOn} cell={cell} />;
  } else if (rangeDays({ from, to }) <= 7) {
    const days: string[] = [];
    for (let d = from; d <= to; d = shiftDayKey(d, 1)) days.push(d);
    body = (
      <div className="grid grid-cols-7 gap-1 text-center">
        {days.map((d) => (
          <span key={d} className="text-fg-faint text-[0.6875rem] font-medium" aria-hidden="true">
            {format(parseDayKey(d), 'EEEEE')}
          </span>
        ))}
        {days.map((d) => cell(d, 'month'))}
      </div>
    );
  } else {
    const months: string[] = [];
    for (let m = monthBounds(from).start; m <= to; m = shiftMonth(m, 1)) months.push(m);
    const letters = weekdayLabels(weekStartsOn, WEEKDAY_LETTERS);
    body = (
      <div className="@container">
        <div className="@md:grid-cols-2 @3xl:grid-cols-3 grid gap-5">
          {months.map((month) => {
            const { start, end } = monthBounds(month);
            return (
              <section key={month} aria-label={formatMonthLong(month)}>
                <h3 className="text-fg mb-2 text-sm font-semibold">{formatMonthLong(month)}</h3>
                <div className="grid grid-cols-7 gap-1 text-center">
                  {letters.map((letter, i) => (
                    <span
                      key={i}
                      className="text-fg-faint text-[0.6875rem] font-medium"
                      aria-hidden="true"
                    >
                      {letter}
                    </span>
                  ))}
                  {monthGrid(month, weekStartsOn)
                    .flat()
                    .map((d) =>
                      d < start || d > end || d < from || d > to ? (
                        <span key={d} className="h-9" aria-hidden="true" />
                      ) : (
                        cell(d, 'month')
                      ),
                    )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      {body}
      <p className="text-fg-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {LEGEND.map((status) => (
          <LegendItem key={status} swatch={<Swatch className={STATUS_BG[status]} />}>
            {STATUS_LABEL[status]}
          </LegendItem>
        ))}
      </p>
    </div>
  );
}

function DayCell({
  day,
  data,
  today,
  size,
}: {
  day: string;
  data: DailyAggregate | undefined;
  today: string;
  size: 'month' | 'strip';
}) {
  const number = parseDayKey(day).getDate();
  const base = size === 'month' ? 'h-9 rounded-md text-sm' : 'size-3.5 rounded-[3px]';
  if (day > today) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          base,
          'border-border text-fg-faint tabular flex items-center justify-center border border-dashed',
        )}
      >
        {size === 'month' ? number : null}
      </span>
    );
  }
  const status = data?.status ?? 'not_logged';
  const kcal = data && data.entryCount > 0 ? `, ${formatKcal(data.totals.kcal)} kcal` : '';
  const coloured = status !== 'not_logged';
  return (
    <Link
      to={`/today/${day}`}
      aria-label={`${formatDayLong(day)}: ${STATUS_LABEL[status].toLowerCase()}${kcal}`}
      className={cn(
        base,
        STATUS_BG[status],
        'tabular flex items-center justify-center font-medium transition-[filter] hover:brightness-110',
        'focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-1',
        coloured ? 'text-black/80' : 'text-fg',
        day === today && 'ring-accent ring-2 ring-offset-1 ring-offset-[var(--surface)]',
      )}
    >
      {size === 'month' ? number : null}
    </Link>
  );
}

/** Weeks as columns, weekdays as rows; scrolls horizontally on phones and opens at the end. */
function YearStrip({
  from,
  to,
  weekStartsOn,
  cell,
}: {
  from: string;
  to: string;
  weekStartsOn: WeekStartsOn;
  cell: (day: string, size: 'month' | 'strip') => React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [from, to]);

  const weeks: string[][] = [];
  const firstWeek = weekDays(from, weekStartsOn);
  for (let start = firstWeek[0]!; start <= to; start = shiftDayKey(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => shiftDayKey(start, i)));
  }
  const letters = weekdayLabels(weekStartsOn, WEEKDAY_LETTERS);
  // A month label sits over the first column that contains the 1st of that month.
  const monthStarts = weeks
    .map((week, col) => ({
      col,
      first: week.find((d) => d >= from && d <= to && d.endsWith('-01')),
    }))
    .filter((m): m is { col: number; first: string } => m.first !== undefined);

  return (
    <div ref={scroller} className="scrollbar-none -mx-1 overflow-x-auto px-1 pb-1">
      <div className="flex gap-1.5" style={{ width: 'max-content' }}>
        <div className="grid shrink-0 grid-rows-7 gap-0.5 pt-5" aria-hidden="true">
          {letters.map((letter, i) => (
            <span
              key={i}
              className="text-fg-faint flex h-3.5 items-center text-[0.625rem] leading-none font-medium"
            >
              {letter}
            </span>
          ))}
        </div>
        <div>
          <div
            className="grid h-5 gap-0.5"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, 0.875rem)` }}
            aria-hidden="true"
          >
            {monthStarts.map(({ col, first }) => (
              <span
                key={first}
                className="text-fg-muted col-span-4 text-[0.625rem] leading-none font-medium"
                style={{ gridColumnStart: col + 1 }}
              >
                {format(parseDayKey(first), 'MMM')}
              </span>
            ))}
          </div>
          <div
            className="grid grid-flow-col grid-rows-7 gap-0.5"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, 0.875rem)` }}
          >
            {weeks
              .flat()
              .map((d) =>
                d < from || d > to ? (
                  <span key={d} className="size-3.5" aria-hidden="true" />
                ) : (
                  cell(d, 'strip')
                ),
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
