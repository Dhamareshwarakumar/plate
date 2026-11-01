import { isValidDayKey } from '@plate/shared';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { formatDayLong, formatMonthLong, isToday, shiftDay, todayKey } from '@/lib/dates';

interface DayHeaderProps {
  day: string;
  onNavigate: (day: string) => void;
  onLog: () => void;
}

/**
 * Phone: month label, calendar jump, "Today" pill. Desktop: the full date with ‹ › and a primary
 * "Log food" button (the FAB is hidden there).
 */
export function DayHeader({ day, onNavigate, onLog }: DayHeaderProps) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const today = isToday(day);

  return (
    <header className="flex items-center justify-between gap-3 pt-4 pb-3 lg:pt-8 lg:pb-5">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous day"
          className="hidden lg:inline-flex"
          onClick={() => onNavigate(shiftDay(day, -1))}
        >
          <ChevronLeft className="size-5" />
        </Button>
        <h1 className="text-fg min-w-0 truncate text-2xl font-semibold tracking-tight lg:text-3xl">
          <span className="lg:hidden">{formatMonthLong(day)}</span>
          <span className="hidden lg:inline">{formatDayLong(day)}</span>
        </h1>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next day"
          className="hidden lg:inline-flex"
          onClick={() => onNavigate(shiftDay(day, 1))}
        >
          <ChevronRight className="size-5" />
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!today ? (
          <Button variant="secondary" size="sm" onClick={() => onNavigate(todayKey())}>
            Today
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Jump to a date"
          onClick={() => setJumpOpen(true)}
          className="lg:hidden"
        >
          <CalendarDays className="size-5" />
        </Button>
        <Button size="sm" onClick={onLog} className={cn('hidden lg:inline-flex')}>
          <Plus className="size-4" aria-hidden="true" />
          Log food
        </Button>
      </div>

      <JumpSheet
        key={day}
        open={jumpOpen}
        day={day}
        onOpenChange={setJumpOpen}
        onPick={(next) => {
          setJumpOpen(false);
          onNavigate(next);
        }}
      />
    </header>
  );
}

function JumpSheet({
  open,
  day,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  day: string;
  onOpenChange: (open: boolean) => void;
  onPick: (day: string) => void;
}) {
  const [value, setValue] = useState(day);
  const valid = isValidDayKey(value);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to a day"
      description="Pick any date to view or back-fill it."
      footer={
        <>
          <Button variant="secondary" onClick={() => onPick(todayKey())}>
            Today
          </Button>
          <Button disabled={!valid} onClick={() => onPick(value)}>
            Go
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onPick(value);
        }}
        className="py-1"
      >
        <label htmlFor="jump-day" className="text-fg text-sm font-medium">
          Date
        </label>
        <Input
          id="jump-day"
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1.5"
          required
        />
      </form>
    </Sheet>
  );
}
