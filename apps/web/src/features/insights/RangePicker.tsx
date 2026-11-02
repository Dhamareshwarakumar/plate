import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import type { WeekStartsOn } from '@/lib/dates';
import {
  canGoForward,
  RANGE_KIND_OPTIONS,
  rangeLabel,
  shiftRange,
  switchKind,
  type InsightsRange,
  type RangeKind,
} from './insights-range';

export interface RangePickerProps {
  range: InsightsRange;
  today: string;
  weekStartsOn: WeekStartsOn;
  onChange: (range: InsightsRange) => void;
  /** Opens the custom range sheet. */
  onCustom: () => void;
  className?: string | undefined;
}

/**
 * Week | Month | 3M | Year plus a "Custom range" button, and ‹ label › navigation (DESIGN §5).
 * Five text options do not fit a 390 px phone inside the equal-width segmented control, so
 * custom gets an icon button that stays pressed while a custom span is shown (D99).
 */
export function RangePicker({
  range,
  today,
  weekStartsOn,
  onChange,
  onCustom,
  className,
}: RangePickerProps) {
  const forward = canGoForward(range, today, weekStartsOn);
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        className,
      )}
    >
      <div className="flex items-center gap-2 sm:w-[24rem] sm:shrink-0">
        <Segmented<RangeKind>
          aria-label="Range"
          value={range.kind}
          onChange={(kind) => {
            if (kind !== 'custom') onChange(switchKind(range, kind, today, weekStartsOn));
          }}
          options={RANGE_KIND_OPTIONS}
          className="min-w-0 flex-1"
        />
        <Button
          variant={range.kind === 'custom' ? 'secondary' : 'outline'}
          size="icon"
          aria-label="Custom range"
          aria-pressed={range.kind === 'custom'}
          onClick={onCustom}
          className={cn(range.kind === 'custom' && 'text-accent')}
        >
          <CalendarRange className="size-5" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex items-center justify-between gap-1 sm:justify-end">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous period"
          onClick={() => onChange(shiftRange(range, -1, weekStartsOn))}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Button>
        <h2 className="text-fg tabular min-w-0 truncate text-center text-base font-semibold sm:min-w-[13rem]">
          {rangeLabel(range)}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next period"
          disabled={!forward}
          onClick={() => onChange(shiftRange(range, 1, weekStartsOn))}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
