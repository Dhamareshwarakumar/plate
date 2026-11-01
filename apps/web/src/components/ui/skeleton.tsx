import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('bg-surface-3/70 animate-pulse rounded-lg', className)} />
  );
}
