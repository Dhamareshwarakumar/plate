import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** The styled tooltip box shared by the insight charts. */
export function TooltipBox({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-surface border-border rounded-control border px-3 py-2 text-xs shadow-lg',
        className,
      )}
    >
      <p className="text-fg-muted">{title}</p>
      {children}
    </div>
  );
}

/** One legend entry: a swatch (any element) and its text label. */
export function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden="true" className="flex shrink-0 items-center">
        {swatch}
      </span>
      {children}
    </span>
  );
}

export function Swatch({ className }: { className: string }) {
  return <span className={cn('size-2.5 rounded-[3px]', className)} />;
}
