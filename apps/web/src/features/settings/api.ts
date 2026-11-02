import {
  aboutResponseSchema,
  DEFAULT_SETTINGS,
  profileSchema,
  RESTORE_CONFIRMATION,
  restoreResultSchema,
  settingsSchema,
  type Backup,
  type Profile,
  type Settings,
  type SettingsPatch,
} from '@plate/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiRequest, ApiClientError } from '@/lib/api';
import { aboutKeys, diaryKeys, profileKeys, settingsKeys } from '@/lib/query-keys';

/**
 * File downloads go through top-level navigation (the browser handles the attachment and the
 * cookie goes along), the same way the Foods page exports its CSV. The backups take the client's
 * day for the file name: the server may run in UTC and would otherwise date a late export yesterday.
 */
export const DOWNLOADS = {
  backupJson: (day: string) => `/api/backup.json?day=${day}`,
  backupSqlite: (day: string) => `/api/backup.sqlite?day=${day}`,
  foodsCsv: '/api/foods/export.csv',
  diaryCsv: (from: string, to: string) => `/api/diary/export.csv?from=${from}&to=${to}`,
} as const;

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

/** More → About and the import sheet's "On this server" column. */
export function useAbout() {
  return useQuery({
    queryKey: aboutKeys.all,
    queryFn: ({ signal }) => apiRequest('/about', { schema: aboutResponseSchema, signal }),
    staleTime: 60 * 1000,
  });
}

/**
 * Replaces everything on the server with the given backup. On success every query is invalidated
 * (no filter): there is nothing in the cache that could still be right.
 */
export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (backup: Backup) =>
      apiRequest('/backup/restore', {
        method: 'POST',
        body: { confirm: RESTORE_CONFIRMATION, backup },
        schema: restoreResultSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
