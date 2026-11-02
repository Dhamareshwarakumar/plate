import {
  okResponseSchema,
  pushSendResultSchema,
  pushSubscriptionInfoSchema,
  remindersSchema,
  vapidPublicKeyResponseSchema,
  type PushSubscribeRequest,
  type PushSubscriptionInfo,
  type Reminders,
  type RemindersConfig,
} from '@plate/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import { apiRequest, ApiClientError } from '@/lib/api';
import { pushKeys, reminderKeys } from '@/lib/query-keys';

const UPDATE_MUTATION_KEY = ['reminders', 'update'] as const;

export function useReminders() {
  return useQuery({
    queryKey: reminderKeys.all,
    queryFn: ({ signal }) => apiRequest('/reminders', { schema: remindersSchema, signal }),
    staleTime: 60 * 1000,
  });
}

/**
 * Replaces the whole configuration. Optimistic (switches and times reflect the change at once);
 * the cache is refetched only after the last in-flight save, so quick successive edits do not
 * flicker back to an intermediate state.
 */
export function useUpdateReminders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: UPDATE_MUTATION_KEY,
    mutationFn: (config: RemindersConfig) =>
      apiRequest('/reminders', { method: 'PUT', body: config, schema: remindersSchema }),
    onMutate: async (config) => {
      const previous = queryClient.getQueryData<Reminders>(reminderKeys.all);
      // Cache first, then cancel: a second edit in the same instant reads the updated cache.
      queryClient.setQueryData<Reminders>(reminderKeys.all, config);
      await queryClient.cancelQueries({ queryKey: reminderKeys.all });
      return { previous };
    },
    onError: (err, _config, context) => {
      if (context?.previous) queryClient.setQueryData(reminderKeys.all, context.previous);
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not save the reminders. Try again.',
      );
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: UPDATE_MUTATION_KEY }) === 1) {
        void queryClient.invalidateQueries({ queryKey: reminderKeys.all });
      }
    },
  });
}

const fetchVapidPublicKey = (signal?: AbortSignal) =>
  apiRequest('/push/vapid-public-key', {
    schema: vapidPublicKeyResponseSchema,
    ...(signal ? { signal } : {}),
  });

/**
 * The server's VAPID public key, fetched inside the subscribe flow (a click handler, not a render)
 * and cached for the session: it never changes while the server runs.
 */
export function loadVapidPublicKey(queryClient: QueryClient): Promise<string> {
  return queryClient
    .fetchQuery({
      queryKey: pushKeys.vapid,
      queryFn: ({ signal }) => fetchVapidPublicKey(signal),
      staleTime: Infinity,
    })
    .then((r) => r.publicKey);
}

export function usePushDevices() {
  return useQuery({
    queryKey: pushKeys.devices,
    queryFn: ({ signal }) =>
      apiRequest('/push/subscriptions', { schema: z.array(pushSubscriptionInfoSchema), signal }),
    staleTime: 60 * 1000,
  });
}

export function useAddPushDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PushSubscribeRequest) =>
      apiRequest('/push/subscriptions', {
        method: 'POST',
        body: input,
        schema: pushSubscriptionInfoSchema,
      }),
    onSuccess: (device) => {
      queryClient.setQueryData<PushSubscriptionInfo[]>(pushKeys.devices, (list) => [
        ...(list ?? []).filter((d) => d.id !== device.id),
        device,
      ]);
      void queryClient.invalidateQueries({ queryKey: pushKeys.devices });
    },
  });
}

/** Optimistic: the row disappears at once; a failure brings the list back with a toast. */
export function useRemovePushDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/push/subscriptions/${id}`, { method: 'DELETE', schema: okResponseSchema }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: pushKeys.devices });
      const previous = queryClient.getQueryData<PushSubscriptionInfo[]>(pushKeys.devices);
      if (previous) {
        queryClient.setQueryData(
          pushKeys.devices,
          previous.filter((d) => d.id !== id),
        );
      }
      return { previous };
    },
    onError: (err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(pushKeys.devices, context.previous);
      // A device the server no longer knows is already what we wanted.
      if (err instanceof ApiClientError && err.status === 404) return;
      toast.error(err instanceof ApiClientError ? err.message : 'Could not remove the device.');
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: pushKeys.devices }),
  });
}

export function useSendTestNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (endpoint: string) =>
      apiRequest('/push/test', {
        method: 'POST',
        body: { endpoint },
        schema: pushSendResultSchema,
      }),
    // A test may reveal a dead subscription (removed) or bump the failure count.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: pushKeys.devices }),
  });
}
