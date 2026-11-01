import {
  categorySchema,
  foodListSchema,
  foodSchema,
  importResultSchema,
  okResponseSchema,
  type Category,
  type Food,
  type FoodInput,
  type ImportConflictStrategy,
  type ImportResult,
} from '@plate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, ApiClientError } from '@/lib/api';

export const foodKeys = {
  all: ['foods'] as const,
  list: (includeArchived: boolean) => ['foods', 'list', { includeArchived }] as const,
  detail: (id: number) => ['foods', 'detail', id] as const,
};
export const categoryKeys = {
  all: ['categories'] as const,
  list: (includeArchived: boolean) => ['categories', 'list', { includeArchived }] as const,
};

// ---------- foods ----------

export function useFoods(options: { includeArchived?: boolean } = {}) {
  const includeArchived = options.includeArchived ?? false;
  return useQuery({
    queryKey: foodKeys.list(includeArchived),
    queryFn: ({ signal }) =>
      apiRequest(`/foods?includeArchived=${includeArchived}`, { schema: foodListSchema, signal }),
    staleTime: 5 * 60 * 1000,
    select: (data) => data.items,
  });
}

export function useFood(id: number | undefined) {
  return useQuery({
    queryKey: foodKeys.detail(id ?? 0),
    queryFn: ({ signal }) => apiRequest(`/foods/${id}`, { schema: foodSchema, signal }),
    enabled: id !== undefined,
    staleTime: 60 * 1000,
  });
}

function useInvalidateFoods() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: foodKeys.all });
}

export function useCreateFood() {
  const invalidate = useInvalidateFoods();
  return useMutation({
    mutationFn: (input: FoodInput) =>
      apiRequest('/foods', { method: 'POST', body: input, schema: foodSchema }),
    onSuccess: () => void invalidate(),
  });
}

export function useUpdateFood() {
  const invalidate = useInvalidateFoods();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: FoodInput }) =>
      apiRequest(`/foods/${id}`, { method: 'PUT', body: input, schema: foodSchema }),
    onSuccess: (food: Food) => {
      queryClient.setQueryData(foodKeys.detail(food.id), food);
      void invalidate();
    },
  });
}

export function useSetFoodArchived() {
  const invalidate = useInvalidateFoods();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      apiRequest(`/foods/${id}/${archived ? 'archive' : 'unarchive'}`, {
        method: 'POST',
        schema: foodSchema,
      }),
    onSuccess: (food: Food) => {
      queryClient.setQueryData(foodKeys.detail(food.id), food);
      void invalidate();
    },
  });
}

export function useDeleteFood() {
  const invalidate = useInvalidateFoods();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/foods/${id}`, { method: 'DELETE', schema: okResponseSchema }),
    onSuccess: () => void invalidate(),
  });
}

export function useImportFoods() {
  const invalidate = useInvalidateFoods();
  return useMutation({
    mutationFn: async ({
      csv,
      dryRun,
      onConflict,
    }: {
      csv: string;
      dryRun: boolean;
      onConflict: ImportConflictStrategy;
    }): Promise<ImportResult> => {
      const response = await fetch(`/api/foods/import?dryRun=${dryRun}&onConflict=${onConflict}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'text/csv' },
        body: csv,
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => undefined);
        const parsed = z
          .object({ error: z.object({ code: z.string(), message: z.string() }) })
          .safeParse(body);
        throw new ApiClientError(
          response.status,
          parsed.success ? (parsed.data.error.code as ApiClientError['code']) : 'INTERNAL_ERROR',
          parsed.success ? parsed.data.error.message : `Import failed (${response.status})`,
        );
      }
      return importResultSchema.parse(await response.json());
    },
    onSuccess: (result) => {
      if (!result.dryRun) void invalidate();
    },
  });
}

// ---------- categories ----------

export function useCategories(options: { includeArchived?: boolean } = {}) {
  const includeArchived = options.includeArchived ?? false;
  return useQuery({
    queryKey: categoryKeys.list(includeArchived),
    queryFn: ({ signal }) =>
      apiRequest(`/categories?includeArchived=${includeArchived}`, {
        schema: z.array(categorySchema),
        signal,
      }),
    staleTime: 5 * 60 * 1000,
  });
}

function useInvalidateCategories() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: categoryKeys.all });
}

export function useCreateCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (name: string) =>
      apiRequest('/categories', { method: 'POST', body: { name }, schema: categorySchema }),
    onSuccess: () => void invalidate(),
  });
}

export function useRenameCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiRequest(`/categories/${id}`, { method: 'PATCH', body: { name }, schema: categorySchema }),
    onSuccess: () => void invalidate(),
  });
}

export function useSetCategoryArchived() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      apiRequest(`/categories/${id}/${archived ? 'archive' : 'unarchive'}`, {
        method: 'POST',
        schema: categorySchema,
      }),
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteCategory() {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/categories/${id}`, { method: 'DELETE', schema: okResponseSchema }),
    onSuccess: () => void invalidate(),
  });
}

export function useReorderCategories() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      apiRequest('/categories/order', {
        method: 'PUT',
        body: { ids },
        schema: z.array(categorySchema),
      }),
    onMutate: async (ids) => {
      // Optimistic: reorder the cached list immediately, roll back on failure.
      await queryClient.cancelQueries({ queryKey: categoryKeys.all });
      const previous = queryClient.getQueryData<Category[]>(categoryKeys.list(true));
      if (previous) {
        const byId = new Map(previous.map((c) => [c.id, c]));
        const ordered = ids.map((id) => byId.get(id)).filter((c): c is Category => c !== undefined);
        const rest = previous.filter((c) => !ids.includes(c.id));
        queryClient.setQueryData(
          categoryKeys.list(true),
          [...ordered, ...rest].map((c, i) => ({ ...c, sortOrder: i })),
        );
      }
      return { previous };
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(categoryKeys.list(true), context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: categoryKeys.all }),
  });
}
