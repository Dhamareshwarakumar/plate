import {
  bySlotSchema,
  dailyAggregateSchema,
  insightsSummarySchema,
  topFoodsSchema,
  weightVsIntakePointSchema,
} from '@plate/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api';
import { insightsKeys } from '@/lib/query-keys';

/**
 * Insights are read-only and always refetched on mount (`staleTime: 0`, D104), so no other
 * feature has to invalidate them after a write. Range changes keep the previous data on screen
 * (dimmed) instead of flashing skeletons.
 */
const rangeQuery = { staleTime: 0, placeholderData: keepPreviousData } as const;

export function useInsightsDaily(from: string, to: string) {
  return useQuery({
    queryKey: insightsKeys.daily(from, to),
    queryFn: ({ signal }) =>
      apiRequest(`/insights/daily?from=${from}&to=${to}`, {
        schema: z.array(dailyAggregateSchema),
        signal,
      }),
    ...rangeQuery,
  });
}

export function useInsightsSummary(from: string, to: string, today: string) {
  return useQuery({
    queryKey: insightsKeys.summary(from, to, today),
    queryFn: ({ signal }) =>
      apiRequest(`/insights/summary?from=${from}&to=${to}&today=${today}`, {
        schema: insightsSummarySchema,
        signal,
      }),
    ...rangeQuery,
  });
}

export function useTopFoods(from: string, to: string) {
  return useQuery({
    queryKey: insightsKeys.topFoods(from, to),
    queryFn: ({ signal }) =>
      apiRequest(`/insights/top-foods?from=${from}&to=${to}`, { schema: topFoodsSchema, signal }),
    ...rangeQuery,
  });
}

export function useBySlot(from: string, to: string) {
  return useQuery({
    queryKey: insightsKeys.bySlot(from, to),
    queryFn: ({ signal }) =>
      apiRequest(`/insights/by-slot?from=${from}&to=${to}`, { schema: bySlotSchema, signal }),
    ...rangeQuery,
  });
}

export function useWeightVsIntake(from: string, to: string) {
  return useQuery({
    queryKey: insightsKeys.weightVsIntake(from, to),
    queryFn: ({ signal }) =>
      apiRequest(`/insights/weight-vs-intake?from=${from}&to=${to}`, {
        schema: z.array(weightVsIntakePointSchema),
        signal,
      }),
    ...rangeQuery,
  });
}
