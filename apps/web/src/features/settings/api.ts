import {
  DEFAULT_SETTINGS,
  profileSchema,
  settingsSchema,
  type Profile,
  type Settings,
  type SettingsPatch,
} from '@plate/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { diaryKeys } from '@/features/today/api';
import { apiRequest, ApiClientError } from '@/lib/api';

export const settingsKeys = {
  all: ['settings'] as const,
};
export const profileKeys = {
  all: ['profile'] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: ({ signal }) => apiRequest('/settings', { schema: settingsSchema, signal }),
    staleTime: 5 * 60 * 1000,
  });
}

/** Tolerance from the settings cache (default while loading), for optimistic day-status recomputes. */
export function cachedTolerance(queryClient: QueryClient): number {
  return (
    queryClient.getQueryData<Settings>(settingsKeys.all)?.tolerancePct ??
    DEFAULT_SETTINGS.tolerancePct
  );
}

/** Optimistic: the slider and segmented control reflect the change at once; failures roll back. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) =>
      apiRequest('/settings', { method: 'PUT', body: patch, schema: settingsSchema }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: settingsKeys.all });
      const previous = queryClient.getQueryData<Settings>(settingsKeys.all);
      if (previous) queryClient.setQueryData(settingsKeys.all, { ...previous, ...patch });
      return { previous };
    },
    onError: (err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(settingsKeys.all, context.previous);
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not save the setting. Try again.',
      );
    },
    onSuccess: (settings) => queryClient.setQueryData(settingsKeys.all, settings),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all });
      // The tolerance decides each day's status.
      void queryClient.invalidateQueries({ queryKey: diaryKeys.all });
    },
  });
}

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.all,
    queryFn: ({ signal }) => apiRequest('/profile', { schema: profileSchema.nullable(), signal }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Profile) =>
      apiRequest('/profile', { method: 'PUT', body: input, schema: profileSchema }),
    onSuccess: (profile) => queryClient.setQueryData(profileKeys.all, profile),
  });
}
