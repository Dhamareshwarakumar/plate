import type { SessionInfo } from '@plate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { changePassword, fetchSession, login, logout } from './api';

export const sessionQueryKey = ['session'] as const;

export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchSession(signal),
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) =>
      // Network blips are worth one retry; anything else is a real answer.
      failureCount < 1 && error instanceof Error && error.name === 'ApiClientError',
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (session: SessionInfo) => {
      queryClient.setQueryData(sessionQueryKey, session);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      // Whatever the server said, the client forgets everything it knew.
      queryClient.setQueryData(sessionQueryKey, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    },
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: changePassword });
}
