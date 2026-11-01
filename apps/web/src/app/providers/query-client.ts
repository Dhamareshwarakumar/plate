import { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // Don't hammer the server for answers that won't change (auth, validation, not found).
          if (error instanceof ApiClientError && error.status >= 400 && error.status < 500)
            return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
