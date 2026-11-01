import { motion } from 'motion/react';
import { useState } from 'react';
import { useSettings } from '@/features/settings/api';
import { cn } from '@/lib/cn';
import {
  formatDayLabel,
  parseDayKey,
  shiftDay,
  todayKey,
  weekdayLabels,
  weekDays,
  weekStartsOnFor,
} from '@/lib/dates';
import { useDiaryDays } from './api';

interface DayStripProps {
  day: string;
  onNavigate: (day: string) => void;
}

const WEEKDAY_LETTERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const SWIPE_THRESHOLD = 48;

/**
 * The week around the selected day, starting on the configured weekday (Monday until the settings
 * load). A dot marks days with entries. Swiping the strip moves a whole week; tapping a day selects
 * it.
 */
export function DayStrip({ day, onNavigate }: DayStripProps) {
  const settings = useSettings();
  const weekStartsOn = weekStartsOnFor(settings.data?.weekStart ?? 'monday');
  const days = weekDays(day, weekStartsOn);
  const letters = weekdayLabels(weekStartsOn, WEEKDAY_LETTERS);
  const first = days[0]!;
  const last = days[6]!;
  const summaries = useDiaryDays(first, last);
  const logged = new Set((summaries.data ?? []).map((d) => d.day));
  const today = todayKey();
  const [direction, setDirection] = useState(0);

  return (
    <nav aria-label="Days of the week" className="-mx-1 overflow-hidden lg:hidden">
      <motion.ul
        key={first}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        dragDirectionLock
        onDragEnd={(_event, info) => {
          if (info.offset.x < -SWIPE_THRESHOLD) {
            setDirection(1);
            onNavigate(shiftDay(day, 7));
          } else if (info.offset.x > SWIPE_THRESHOLD) {
            setDirection(-1);
            onNavigate(shiftDay(day, -7));
          }
        }}
        initial={{ opacity: 0, x: direction * 32 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        className="grid grid-cols-7 gap-1 px-1 py-1 select-none"
      >
        {days.map((d, i) => {
          const selected = d === day;
          const isTodayCell = d === today;
          const hasEntries = logged.has(d);
          return (
            <li key={d}>
              <button
                type="button"
                onClick={() => onNavigate(d)}
                aria-label={formatDayLabel(d)}
                aria-current={selected ? 'date' : undefined}
                className={cn(
                  'relative flex h-[3.75rem] w-full flex-col items-center justify-center gap-0.5 rounded-control text-sm transition-colors',
                  selected
                    ? 'bg-accent text-accent-fg shadow-sm'
                    : 'text-fg-muted hover:bg-surface-2 active:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'text-[0.6875rem] font-medium',
                    selected ? 'text-accent-fg/80' : 'text-fg-faint',
                  )}
                >
                  {letters[i]}
                </span>
                <span
                  className={cn(
                    'tabular text-base leading-none font-semibold',
                    !selected && isTodayCell && 'text-accent',
                    !selected && !isTodayCell && 'text-fg',
                  )}
                >
                  {parseDayKey(d).getDate()}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 size-1.5 rounded-full transition-colors',
                    hasEntries
                      ? selected
                        ? 'bg-accent-fg'
                        : 'bg-accent'
                      : isTodayCell && !selected
                        ? 'bg-border-strong'
                        : 'bg-transparent',
                  )}
                />
                {hasEntries ? <span className="sr-only">, has entries</span> : null}
              </button>
            </li>
          );
        })}
      </motion.ul>
    </nav>
  );
}
