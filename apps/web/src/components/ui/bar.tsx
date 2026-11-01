import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { formatGrams } from '@/lib/format';

export type BarColor = 'protein' | 'carbs' | 'fat' | 'fiber' | 'water';

export interface BarProps {
  label: string;
  value: number;
  max: number;
  /** One of the fixed semantic colours (DESIGN §9). */
  color: BarColor;
  unit?: string;
  /** Number formatting for the label row; grams to one decimal by default. */
  format?: (n: number) => string;
  /** Stacks the label above the numbers (for narrow columns) instead of one row. */
  compact?: boolean;
  className?: string;
}

const COLORS: Record<BarColor, { fill: string; cssVar: string }> = {
  protein: { fill: 'bg-protein', cssVar: 'var(--color-protein)' },
  carbs: { fill: 'bg-carbs', cssVar: 'var(--color-carbs)' },
  fat: { fill: 'bg-fat', cssVar: 'var(--color-fat)' },
  fiber: { fill: 'bg-fiber', cssVar: 'var(--color-fiber)' },
  water: { fill: 'bg-water', cssVar: 'var(--color-water)' },
};

const SPRING = { type: 'spring', stiffness: 120, damping: 20 } as const;

/**
 * Slim progress bar for a macro against its goal. Past 100 % the track represents what was eaten:
 * the solid part is the goal and a hatched segment shows the overflow instead of clipping
 * (DESIGN §2.1). The label row always states the numbers, so colour is not the only signal.
 */
export function Bar({
  label,
  value,
  max,
  color,
  unit = 'g',
  format = formatGrams,
  compact = false,
  className,
}: BarProps) {
  const c = COLORS[color];
  const over = value > max && value > 0;
  const solidPct = over ? (max / value) * 100 : max > 0 ? (value / max) * 100 : 0;
  const hatchPct = over ? 100 - solidPct : 0;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.round(max))}
      aria-valuenow={Math.round(Math.min(Math.max(value, 0), Math.max(max, 0)))}
      aria-valuetext={`${format(value)} of ${format(max)} ${unit} ${label.toLowerCase()}${over ? ', over' : ''}`}
      className={cn('min-w-0', className)}
    >
      <div
        className={cn(
          'flex text-xs',
          compact ? 'flex-col gap-y-0.5' : 'items-baseline justify-between gap-x-2',
        )}
      >
        <span className="text-fg-muted flex items-center gap-1.5 font-medium">
          <span className={cn('size-2 shrink-0 rounded-full', c.fill)} aria-hidden="true" />
          {label}
        </span>
        <span
          className={cn('tabular', over ? 'text-over-fg font-semibold' : 'text-fg font-medium')}
        >
          {format(value)}
          <span className={cn('font-normal', over ? 'text-over-fg/80' : 'text-fg-faint')}>
            /{format(max)} {unit}
          </span>
        </span>
      </div>
      <div className="bg-surface-3 mt-1.5 flex h-1.5 overflow-hidden rounded-full">
        <motion.span
          className={cn('h-full', c.fill)}
          initial={false}
          animate={{ width: `${solidPct}%` }}
          transition={SPRING}
        />
        {over ? (
          <motion.span
            className="h-full"
            style={{
              backgroundImage: `repeating-linear-gradient(135deg, ${c.cssVar} 0 3px, transparent 3px 6px)`,
            }}
            initial={false}
            animate={{ width: `${hatchPct}%` }}
            transition={SPRING}
          />
        ) : null}
      </div>
    </div>
  );
}
