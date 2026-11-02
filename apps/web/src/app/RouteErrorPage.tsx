import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/cn';

/** A chunk that failed to download (stale tab after an upgrade, flaky network) looks like this. */
function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'ChunkLoadError' ||
      /dynamically imported module|Importing a module script failed|Loading chunk/i.test(
        error.message,
      ))
  );
}

interface RouteErrorPageProps {
  /** Inside the app shell (page errors) the state sits in `<main>`; outside it fills the viewport. */
  inShell?: boolean;
}

/**
 * React Router `errorElement`: a rendering error or a page chunk that could not be fetched would
 * otherwise show the router's stack-trace page. Reloading fetches the current build.
 */
export function RouteErrorPage({ inShell = false }: RouteErrorPageProps) {
  const error = useRouteError();
  useEffect(() => {
    // Keep the detail where a developer would look for it; the user gets the plain message.
    console.error(error);
  }, [error]);

  const chunk = isChunkLoadError(error);
  const state = (
    <ErrorState
      title={chunk ? "This part of Plate didn't load" : 'Something went wrong'}
      message={
        chunk
          ? 'Plate may have been updated since this tab was opened, or the connection dropped. Reloading fetches the current version.'
          : 'An unexpected error stopped this screen. Reloading usually fixes it; your data on the server is unaffected.'
      }
      onRetry={() => window.location.reload()}
      retryLabel="Reload"
    />
  );
  return inShell ? (
    <div className="bg-surface border-border rounded-card mt-6 border">{state}</div>
  ) : (
    <main className={cn('flex min-h-dvh items-center justify-center px-6')}>{state}</main>
  );
}
