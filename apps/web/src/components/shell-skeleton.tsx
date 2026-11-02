import { Skeleton } from '@/components/ui/skeleton';

/** Full-viewport placeholder while the session is checked or the first page chunk loads. */
export function ShellSkeleton() {
  return (
    <div
      className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-4 pt-6"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="size-9 rounded-full" />
      </div>
      <Skeleton className="h-52 w-full rounded-card" />
      <Skeleton className="h-28 w-full rounded-card" />
      <Skeleton className="h-28 w-full rounded-card" />
    </div>
  );
}

/**
 * In-shell placeholder shown inside <main> while a lazily loaded page chunk arrives. Navigations
 * are transitions, so this appears only on a cold load of a deep link, never while switching tabs.
 */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-6" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="size-9 rounded-full" />
      </div>
      <Skeleton className="h-52 w-full rounded-card" />
      <Skeleton className="h-28 w-full rounded-card" />
      <Skeleton className="h-28 w-full rounded-card" />
    </div>
  );
}
