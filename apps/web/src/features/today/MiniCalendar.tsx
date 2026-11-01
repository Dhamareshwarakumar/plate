import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/features/settings/api';
import { cn } from '@/lib/cn';
import {
  formatDayLabel,
  formatMonthLong,
  monthBounds,
  monthGrid,
  parseDayKey,
  shiftMonth,
  todayKey,
  weekdayLabels,
  weekStartsOnFor,
} from '@/lib/dates';
import { useDiaryDays } from './api';

interface MiniCalendarProps {
  day: string;
  onNavigate: (day: string) => void;
  className?: string | undefined;
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * Desktop month grid with dots on logged days, starting the week on the configured weekday.
 * Remounts (via `key`) when the selected month changes.
 */
export function MiniCalendar({ day, onNavigate, className }: MiniCalendarProps) {
  return (
    <MiniCalendarInner
      key={day.slice(0, 7)}
      day={day}
      onNavigate={onNavigate}
      className={className}
    />
  );
}

function MiniCalendarInner({ day, onNavigate, className }: MiniCalendarProps) {
  const [monthOffset, setMonthOffset] = useState(0);
  const settings = useSettings();
  const weekStartsOn = weekStartsOnFor(settings.data?.weekStart ?? 'monday');
  const viewDay = monthOffset === 0 ? day : shiftMonth(day, monthOffset);
  const { start, end } = monthBounds(viewDay);
  const grid = monthGrid(viewDay, weekStartsOn);
  const letters = weekdayLabels(weekStartsOn, WEEKDAY_LETTERS);
  const summaries = useDiaryDays(grid[0]![0]!, grid[grid.length - 1]![6]!);
  const logged = new Set((summaries.data ?? []).map((d) => d.day));
  const today = todayKey();

  return (
    <section
      aria-label="Calendar"
      className={cn('rounded-card border-border bg-surface shadow-card border p-4', className)}
    >
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => setMonthOffset((n) => n - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="text-fg text-sm font-semibold">{formatMonthLong(viewDay)}</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => setMonthOffset((n) => n + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-y-1 text-center">
        {letters.map((letter, i) => (
          <span key={i} className="text-fg-faint text-[0.6875rem] font-medium" aria-hidden="true">
            {letter}
          </span>
        ))}
        {grid.flat().map((d) => {
          const inMonth = d >= start && d <= end;
          const selected = d === day;
          const isTodayCell = d === today;
          const hasEntries = logged.has(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => onNavigate(d)}
              aria-label={formatDayLabel(d)}
              aria-current={selected ? 'date' : undefined}
              className={cn(
                'relative mx-auto flex size-9 flex-col items-center justify-center rounded-full text-sm transition-colors',
                selected
                  ? 'bg-accent text-accent-fg font-semibold'
                  : inMonth
                    ? 'text-fg hover:bg-surface-2'
                    : 'text-fg-faint hover:bg-surface-2',
                !selected && isTodayCell && 'text-accent font-semibold',
              )}
            >
              <span className="tabular leading-none">{parseDayKey(d).getDate()}</span>
              <span
                aria-hidden="true"
                className={cn(
                  'absolute bottom-1 size-1 rounded-full',
                  hasEntries ? (selected ? 'bg-accent-fg' : 'bg-accent') : 'bg-transparent',
                )}
              />
              {hasEntries ? <span className="sr-only">, has entries</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
