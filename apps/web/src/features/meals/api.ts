import {
  entryTotals,
  logTemplateResultSchema,
  mealTemplateSchema,
  okResponseSchema,
  templateFromMealResultSchema,
  type DiaryDay,
  type DiaryEntry,
  type LogTemplateInput,
  type MealTemplate,
  type MealTemplateInput,
  type TemplateFromMealInput,
} from '@plate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { cachedTolerance } from '@/features/settings/api';
import { insertEntry } from '@/features/today/api';
import { apiRequest, ApiClientError } from '@/lib/api';
import { todayKey } from '@/lib/dates';
import { diaryKeys, mealTemplateKeys } from '@/lib/query-keys';

/** Deep link that opens the log sheet on today's diary at the template review step (D63 URL state). */
export function logTemplatePath(id: number): string {
  return `/today/${todayKey()}?log=t${id}`;
}

export function useMealTemplates(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: mealTemplateKeys.list,
    queryFn: ({ signal }) =>
      apiRequest('/meal-templates', { schema: z.array(mealTemplateSchema), signal }),
    staleTime: 5 * 60 * 1000,
    enabled: options.enabled ?? true,
  });
}

export function useMealTemplate(id: number | undefined) {
  return useQuery({
    queryKey: mealTemplateKeys.detail(id ?? 0),
    queryFn: ({ signal }) =>
      apiRequest(`/meal-templates/${id}`, { schema: mealTemplateSchema, signal }),
    enabled: id !== undefined,
    staleTime: 60 * 1000,
  });
}

function useSettleTemplate() {
  const queryClient = useQueryClient();
  return (template: MealTemplate) => {
    queryClient.setQueryData(mealTemplateKeys.detail(template.id), template);
    void queryClient.invalidateQueries({ queryKey: mealTemplateKeys.all });
  };
}

export function useCreateMealTemplate() {
  const settle = useSettleTemplate();
  return useMutation({
    mutationFn: (input: MealTemplateInput) =>
      apiRequest('/meal-templates', { method: 'POST', body: input, schema: mealTemplateSchema }),
    onSuccess: settle,
  });
}

export function useUpdateMealTemplate() {
  const settle = useSettleTemplate();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: MealTemplateInput }) =>
      apiRequest(`/meal-templates/${id}`, {
        method: 'PUT',
        body: input,
        schema: mealTemplateSchema,
      }),
    onSuccess: settle,
  });
}

export function useDeleteMealTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/meal-templates/${id}`, { method: 'DELETE', schema: okResponseSchema }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: mealTemplateKeys.all }),
  });
}

/** "Save as meal": snapshots a logged meal into a new template (ad-hoc entries are skipped). */
export function useSaveMealAsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateFromMealInput) =>
      apiRequest('/meal-templates/from-meal', {
        method: 'POST',
        body: input,
        schema: templateFromMealResultSchema,
      }),
    onSuccess: ({ template }) => {
      queryClient.setQueryData(mealTemplateKeys.detail(template.id), template);
      void queryClient.invalidateQueries({ queryKey: mealTemplateKeys.all });
    },
  });
}

export interface LogTemplateVariables {
  template: MealTemplate;
  /** Reviewed amounts, one per item, in item order. */
  amounts: number[];
  input: LogTemplateInput;
}

/** Entries as the day will show them, from the template's current item data (before the server answers). */
function optimisticEntries(
  { template, amounts, input }: LogTemplateVariables,
  baseId: number,
  now: string,
): DiaryEntry[] {
  return template.items.map((item, index) => {
    const quantity = amounts[index] ?? item.amount;
    return {
      id: baseId - index,
      day: input.day,
      slotId: input.slotId,
      loggedAt: input.loggedAt ?? now,
      foodId: item.foodId,
      name: item.name,
      quantity,
      basis: item.basis,
      portionLabel: null,
      portionCount: null,
      note: null,
      per100: item.per100,
      totals: entryTotals(item.per100, quantity),
      createdAt: now,
      updatedAt: now,
    };
  });
}

/** Logs every item of a template into one meal; the rows appear at once and the server's day replaces them. */
export function useLogMealTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ template, input }: LogTemplateVariables) =>
      apiRequest(`/meal-templates/${template.id}/log`, {
        method: 'POST',
        body: input,
        schema: logTemplateResultSchema,
      }),
    onMutate: async (variables) => {
      const key = diaryKeys.day(variables.input.day);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DiaryDay>(key);
      if (previous) {
        const tolerance = cachedTolerance(queryClient);
        const now = new Date().toISOString();
        queryClient.setQueryData(
          key,
          optimisticEntries(variables, -Date.now(), now).reduce(
            (day, entry) => insertEntry(day, entry, tolerance),
            previous,
          ),
        );
      }
      return { previous, key };
    },
    onError: (err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not log the meal. Try again.',
      );
    },
    onSuccess: (result, _variables, context) => {
      queryClient.setQueryData(context.key, result.day);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: diaryKeys.all }),
  });
}
