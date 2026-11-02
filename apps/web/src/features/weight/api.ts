import {
  okResponseSchema,
  weightSchema,
  weightStatsSchema,
  type Weight,
  type WeightInput,
} from '@plate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { apiRequest, ApiClientError } from '@/lib/api';
import { weightKeys } from '@/lib/query-keys';

/** The whole log, oldest first; ranges are filtered client-side (at most one row per day). */
export function useWeights() {
  return useQuery({
    queryKey: weightKeys.list,
    queryFn: ({ signal }) => apiRequest('/weights', { schema: z.array(weightSchema), signal }),
    staleTime: 60 * 1000,
  });
}

export function useWeightStats() {
  return useQuery({
    queryKey: weightKeys.stats,
    queryFn: ({ signal }) => apiRequest('/weights/stats', { schema: weightStatsSchema, signal }),
    staleTime: 60 * 1000,
  });
}

const byDay = (a: Weight, b: Weight) => a.day.localeCompare(b.day);

function describeError(err: unknown, fallback: string): string {
  return err instanceof ApiClientError ? err.message : fallback;
}

/**
 * `PUT weights/:day`: creates or replaces the day's weigh-in (FR-W1). Optimistic on the list; the
 * stats are refetched afterwards because the moving average and rate depend on the whole series.
 */
export function useSaveWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WeightInput) =>
      apiRequest(`/weights/${input.day}`, {
        method: 'PUT',
        body: { kg: input.kg, note: input.note ?? null },
        schema: weightSchema,
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: weightKeys.all });
      const previous = queryClient.getQueryData<Weight[]>(weightKeys.list);
      if (previous) {
        const existing = previous.find((w) => w.day === input.day);
        const now = new Date().toISOString();
        const guess: Weight = {
          id: existing?.id ?? -Date.now(),
          day: input.day,
          kg: input.kg,
          note: input.note ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        queryClient.setQueryData(
          weightKeys.list,
          [...previous.filter((w) => w.day !== input.day), guess].sort(byDay),
        );
      }
      return { previous };
    },
    onError: (err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(weightKeys.list, context.previous);
      // Validation errors are shown inline by the sheet; anything else gets a toast.
      if (!(err instanceof ApiClientError && err.code === 'VALIDATION_ERROR')) {
        toast.error(describeError(err, 'Could not save the weight. Try again.'));
      }
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<Weight[]>(weightKeys.list, (current) =>
        current ? [...current.filter((w) => w.day !== saved.day), saved].sort(byDay) : current,
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: weightKeys.all }),
  });
}

export function useDeleteWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (weight: Weight) =>
      apiRequest(`/weights/${weight.day}`, { method: 'DELETE', schema: okResponseSchema }),
    onMutate: async (weight) => {
      await queryClient.cancelQueries({ queryKey: weightKeys.all });
      const previous = queryClient.getQueryData<Weight[]>(weightKeys.list);
      if (previous) {
        queryClient.setQueryData(
          weightKeys.list,
          previous.filter((w) => w.day !== weight.day),
        );
      }
      return { previous };
    },
    onError: (err, _weight, context) => {
      if (context?.previous) queryClient.setQueryData(weightKeys.list, context.previous);
      toast.error(describeError(err, 'Could not delete that weigh-in. Try again.'));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: weightKeys.all }),
  });
}
