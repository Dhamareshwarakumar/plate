import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { ShellSkeleton } from '@/components/shell-skeleton';

/**
 * Pathless root route: one Suspense boundary for every lazily loaded page outside the app shell
 * (the login page) and for the shell itself on a cold load.
 */
export function RootLayout() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Outlet />
    </Suspense>
  );
}
