import { goalSchema, okResponseSchema, type Goal, type GoalInput } from '@plate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { diaryKeys } from '@/features/today/api';
import { apiRequest } from '@/lib/api';

export const goalKeys = {
  all: ['goals'] as const,
  list: ['goals', 'list'] as const,
};

/** All goals, newest effective date first. */
export function useGoals() {
  return useQuery({
    queryKey: goalKeys.list,
    queryFn: ({ signal }) => apiRequest('/goals', { schema: z.array(goalSchema), signal }),
    staleTime: 5 * 60 * 1000,
  });
}

/** The goal in effect on `day` from the cached list (null when none applies). */
export function activeGoalFor(goals: readonly Goal[] | undefined, day: string): Goal | null {
  if (!goals) return null;
  return goals.find((g) => g.effectiveFrom <= day) ?? null;
}

function useInvalidateGoals() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: goalKeys.all });
    // Every day view embeds the goal in effect, its status and what is left.
    void queryClient.invalidateQueries({ queryKey: diaryKeys.all });
  };
}

/** Creates a goal, or replaces the one with the same effective-from date. */
export function useCreateGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (input: GoalInput) =>
      apiRequest('/goals', { method: 'POST', body: input, schema: goalSchema }),
    onSuccess: invalidate,
  });
}

export function useDeleteGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/goals/${id}`, { method: 'DELETE', schema: okResponseSchema }),
    onSuccess: invalidate,
  });
}
