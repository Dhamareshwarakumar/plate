import { dishSchema, type Dish, type DishInput } from '@plate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { dishKeys, foodKeys, mealTemplateKeys } from '@/lib/query-keys';

export function useDish(id: number | undefined) {
  return useQuery({
    queryKey: dishKeys.detail(id ?? 0),
    queryFn: ({ signal }) => apiRequest(`/dishes/${id}`, { schema: dishSchema, signal }),
    enabled: id !== undefined,
    staleTime: 60 * 1000,
  });
}

/**
 * Dishes are foods too: every dish change refreshes the food list the pickers and tabs read, and
 * the meal templates whose items reference the dish (their previews use its current per-100).
 */
function useSettleDish() {
  const queryClient = useQueryClient();
  return (dish: Dish) => {
    queryClient.setQueryData(dishKeys.detail(dish.id), dish);
    void queryClient.invalidateQueries({ queryKey: foodKeys.all });
    void queryClient.invalidateQueries({ queryKey: mealTemplateKeys.all });
  };
}

export function useCreateDish() {
  const settle = useSettleDish();
  return useMutation({
    mutationFn: (input: DishInput) =>
      apiRequest('/dishes', { method: 'POST', body: input, schema: dishSchema }),
    onSuccess: settle,
  });
}

export function useUpdateDish() {
  const settle = useSettleDish();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: DishInput }) =>
      apiRequest(`/dishes/${id}`, { method: 'PUT', body: input, schema: dishSchema }),
    onSuccess: settle,
  });
}

export function useRecalculateDish() {
  const settle = useSettleDish();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/dishes/${id}/recalculate`, { method: 'POST', schema: dishSchema }),
    onSuccess: settle,
  });
}
