import { Slider as RadixSlider } from 'radix-ui';
import { cn } from '@/lib/cn';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Fires on every move (drag, arrow keys); use for the live preview. */
  onValueChange: (value: number) => void;
  /** Fires when the pointer is released or a key press ends; use to persist. */
  onValueCommit?: (value: number) => void;
  'aria-label': string;
  disabled?: boolean;
  className?: string;
}

/**
 * Single-value slider on Radix: keyboard operable (arrows, Home/End, PageUp/Down), 44 px tall so
 * thumbs can grab it, accent range, visible focus ring.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  onValueCommit,
  disabled = false,
  className,
  ...aria
}: SliderProps) {
  return (
    <RadixSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={([next]) => {
        if (next !== undefined) onValueChange(next);
      }}
      onValueCommit={([next]) => {
        if (next !== undefined) onValueCommit?.(next);
      }}
      className={cn(
        'relative flex h-11 w-full touch-none items-center select-none data-[disabled]:opacity-50',
        className,
      )}
    >
      <RadixSlider.Track className="bg-surface-3 relative h-1.5 grow overflow-hidden rounded-full">
        <RadixSlider.Range className="bg-accent absolute h-full rounded-full" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={aria['aria-label']}
        className="bg-surface border-accent block size-6 cursor-grab rounded-full border-[3px] shadow-md transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing"
      />
    </RadixSlider.Root>
  );
}
