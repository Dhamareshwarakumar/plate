import { motion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  'aria-label': string;
  className?: string;
}

/** iOS-style segmented control with an animated sliding thumb. Keyboard: arrows move between options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  ...aria
}: SegmentedProps<T>) {
  const layoutId = useId();
  const selectedIndex = options.findIndex((o) => o.value === value);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // With nothing selected yet (an empty form choice) arrows start from the first option.
    const index = selectedIndex === -1 ? 0 : selectedIndex;
    let next: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = (index + 1) % options.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (index - 1 + options.length) % options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const option = options[next];
    if (option) onChange(option.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      onKeyDown={onKeyDown}
      className={cn(
        'bg-surface-2 relative grid auto-cols-fr grid-flow-col gap-1 rounded-control p-1',
        className,
      )}
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (selectedIndex === -1 && i === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 flex h-9 items-center justify-center gap-1.5 rounded-[0.5rem] px-3 text-sm font-medium transition-colors',
              selected ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={layoutId}
                className="bg-surface shadow-card absolute inset-0 -z-10 rounded-[0.5rem]"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            ) : null}
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
