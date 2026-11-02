import type { DayStatus } from '@plate/shared';

/** Theme variables so every chart follows dark mode (D96 pattern). */
export const ACCENT = 'var(--color-accent)';
export const MUTED = 'var(--color-fg-muted)';
export const GRID = 'var(--color-border)';
export const MACRO_COLOR = {
  protein: 'var(--color-protein)',
  carbs: 'var(--color-carbs)',
  fat: 'var(--color-fat)',
} as const;

export const STATUS_COLOR: Record<DayStatus, string> = {
  on_target: 'var(--color-on-target)',
  under: 'var(--color-under)',
  over: 'var(--color-over)',
  no_goal: 'var(--color-fg-faint)',
  not_logged: 'var(--color-surface-3)',
};

/** Tailwind classes for the same colours (heatmap cells, legend swatches). */
export const STATUS_BG: Record<DayStatus, string> = {
  on_target: 'bg-on-target',
  under: 'bg-under',
  over: 'bg-over',
  no_goal: 'bg-fg-faint/40',
  not_logged: 'bg-surface-3',
};

export const STATUS_LABEL: Record<DayStatus, string> = {
  on_target: 'On target',
  under: 'Under',
  over: 'Over',
  no_goal: 'No goal',
  not_logged: 'Not logged',
};

export const CHART_HEIGHT = 240;

/** Rounds a chart maximum up to a friendly tick boundary with a little headroom. */
export function niceMax(value: number, step: number): number {
  if (value <= 0) return step;
  return Math.ceil((value * 1.08) / step) * step;
}

/** Explicit ticks from 0 to `max` at a step that keeps at most seven labels (500, 1,000, 2,000…). */
export function kcalTicks(max: number): number[] {
  const step = max <= 3000 ? 500 : max <= 6000 ? 1000 : 2000;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}
