import { Navigate, Outlet, useLocation } from 'react-router';
import { ErrorState } from '@/components/ui/states';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from './use-session';

/** Gate for every signed-in route: skeleton while checking, login redirect when signed out, retry on failure. */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return <ShellSkeleton />;
  }

  if (session.isError) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <ErrorState
          title="Can't reach Plate"
          message={session.error.message}
          onRetry={() => void session.refetch()}
          retrying={session.isFetching}
        />
      </main>
    );
  }

  if (!session.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return <Outlet />;
}

function ShellSkeleton() {
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
