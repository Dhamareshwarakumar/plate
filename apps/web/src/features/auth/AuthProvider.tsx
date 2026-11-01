import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { setUnauthenticatedHandler } from '@/lib/api';
import { sessionQueryKey } from './use-session';

/** Wires the API client's 401 signal to the session cache so expired sessions bounce to login. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      queryClient.setQueryData(sessionQueryKey, null);
    });
    return () => setUnauthenticatedHandler(undefined);
  }, [queryClient]);
  return children;
}
