import { Navigate, Outlet, useLocation } from 'react-router';
import { ShellSkeleton } from '@/components/shell-skeleton';
import { ErrorState } from '@/components/ui/states';
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
