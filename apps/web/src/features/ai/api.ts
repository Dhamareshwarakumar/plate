import {
  aiEstimateFoodResponseSchema,
  aiParseMealResponseSchema,
  aiRecipeResponseSchema,
  aiUsageSchema,
  aiWeeklyDigestCachedSchema,
  aiWeeklyDigestResponseSchema,
  type AiEstimateFoodRequest,
  type AiParseMealRequest,
  type AiRecipeRequest,
  type AiWeeklyDigestCached,
} from '@plate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { parseDayKey, todayKey } from '@/lib/dates';
import { aiKeys } from '@/lib/query-keys';

/**
 * AI assistance (Phase 11). Every call here costs a provider request, so nothing fires on its own:
 * the three parsers are mutations the user triggers, the digest is generated on a button and read
 * back from the server's per-week cache, and only the usage counter and the cached digest are
 * plain queries. Each mutation stales the usage counter.
 */

function useInvalidateUsage() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: aiKeys.usageAll });
}

/** "Describe or photograph": text and/or a resized photo → items to review. */
export function useParseMeal() {
  const invalidateUsage = useInvalidateUsage();
  return useMutation({
    mutationFn: (input: AiParseMealRequest) =>
      apiRequest('/ai/parse-meal', {
        method: 'POST',
        body: input,
        schema: aiParseMealResponseSchema,
      }),
    onSettled: invalidateUsage,
  });
}

/** "Estimate with AI" in the food editor: label-style values for a named food. */
export function useEstimateFood() {
  const invalidateUsage = useInvalidateUsage();
  return useMutation({
    mutationFn: (input: AiEstimateFoodRequest) =>
      apiRequest('/ai/estimate-food', {
        method: 'POST',
        body: input,
        schema: aiEstimateFoodResponseSchema,
      }),
    onSettled: invalidateUsage,
  });
}

/** "Paste a recipe" in the dish editor: free text → name, ingredient lines, cooked weight, servings. */
export function useParseRecipe() {
  const invalidateUsage = useInvalidateUsage();
  return useMutation({
    mutationFn: (input: AiRecipeRequest) =>
      apiRequest('/ai/parse-recipe', {
        method: 'POST',
        body: input,
        schema: aiRecipeResponseSchema,
      }),
    onSettled: invalidateUsage,
  });
}

/** The cached digest for a week (null when none was generated yet); never spends a request. */
export function useWeeklyDigest(weekStart: string, enabled: boolean) {
  return useQuery({
    queryKey: aiKeys.digest(weekStart),
    queryFn: ({ signal }) =>
      apiRequest(`/ai/weekly-digest?weekStart=${weekStart}`, {
        schema: aiWeeklyDigestCachedSchema,
        signal,
      }),
    enabled,
    staleTime: 5 * 60 * 1000,
    select: (data) => data.digest,
  });
}

/** Generate (or, with `refresh`, regenerate) a week's digest; the result replaces the cached one. */
export function useGenerateWeeklyDigest() {
  const queryClient = useQueryClient();
  const invalidateUsage = useInvalidateUsage();
  return useMutation({
    mutationFn: ({ weekStart, refresh }: { weekStart: string; refresh: boolean }) =>
      apiRequest(`/ai/weekly-digest?refresh=${refresh}`, {
        method: 'POST',
        body: { weekStart },
        schema: aiWeeklyDigestResponseSchema,
      }),
    onSuccess: (digest, { weekStart }) => {
      const cached: AiWeeklyDigestCached = { digest };
      queryClient.setQueryData(aiKeys.digest(weekStart), cached);
    },
    onSettled: invalidateUsage,
  });
}

/** Local midnight as an ISO instant, so "today" in the usage counter follows the browser's zone. */
export function localMidnightIso(): string {
  return parseDayKey(todayKey()).toISOString();
}

/** Provider round-trips today and over the last 30 days (More → AI assistant). */
export function useAiUsage(enabled: boolean) {
  const dayStart = localMidnightIso();
  return useQuery({
    queryKey: aiKeys.usage(dayStart),
    queryFn: ({ signal }) =>
      apiRequest(`/ai/usage?dayStart=${encodeURIComponent(dayStart)}`, {
        schema: aiUsageSchema,
        signal,
      }),
    enabled,
    staleTime: 60 * 1000,
  });
}
