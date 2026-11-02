import {
  computeDayStatus,
  copyResultSchema,
  dayTotals,
  diaryDaySchema,
  diaryDaySummarySchema,
  diaryEntrySchema,
  entryTotals,
  foodUsageSchema,
  goalRemaining,
  mealSlotSchema,
  okResponseSchema,
  sumNutrients,
  DEFAULT_SETTINGS,
  type CopyDayInput,
  type CopyResult,
  type DiaryDay,
  type DiaryEntry,
  type DiaryEntryInput,
  type DiaryEntryPatch,
  type FoodBasis,
  type MealSlot,
  type MealSlotInput,
  type Nutrients,
  type WaterEntry,
  type WaterEntryInput,
  waterEntrySchema,
} from '@plate/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { cachedTolerance } from '@/features/settings/api';
import { apiRequest, ApiClientError } from '@/lib/api';

export const diaryKeys = {
  all: ['diary'] as const,
  day: (day: string) => ['diary', 'day', day] as const,
  days: (from: string, to: string) => ['diary', 'days', { from, to }] as const,
  recent: ['diary', 'recent'] as const,
  frequent: ['diary', 'frequent'] as const,
};
export const mealSlotKeys = {
  all: ['mealSlots'] as const,
  list: (includeArchived: boolean) => ['mealSlots', 'list', { includeArchived }] as const,
};

// ---------- queries ----------

export function useDiaryDay(day: string) {
  return useQuery({
    queryKey: diaryKeys.day(day),
    queryFn: ({ signal }) => apiRequest(`/diary/${day}`, { schema: diaryDaySchema, signal }),
    staleTime: 30 * 1000,
    // Day navigation keeps the previous day on screen (dimmed) instead of flashing a skeleton.
    placeholderData: keepPreviousData,
  });
}

export function useDiaryDays(from: string, to: string) {
  return useQuery({
    queryKey: diaryKeys.days(from, to),
    queryFn: ({ signal }) =>
      apiRequest(`/diary/days?from=${from}&to=${to}`, {
        schema: z.array(diaryDaySummarySchema),
        signal,
      }),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
}

export function useRecentFoods() {
  return useQuery({
    queryKey: diaryKeys.recent,
    queryFn: ({ signal }) =>
      apiRequest('/diary/recent-foods', { schema: z.array(foodUsageSchema), signal }),
    staleTime: 60 * 1000,
  });
}

export function useFrequentFoods() {
  return useQuery({
    queryKey: diaryKeys.frequent,
    queryFn: ({ signal }) =>
      apiRequest('/diary/frequent-foods', { schema: z.array(foodUsageSchema), signal }),
    staleTime: 60 * 1000,
  });
}

export function useMealSlots(options: { includeArchived?: boolean } = {}) {
  const includeArchived = options.includeArchived ?? false;
  return useQuery({
    queryKey: mealSlotKeys.list(includeArchived),
    queryFn: ({ signal }) =>
      apiRequest(`/meal-slots?includeArchived=${includeArchived}`, {
        schema: z.array(mealSlotSchema),
        signal,
      }),
    staleTime: 5 * 60 * 1000,
  });
}

// ---------- cache helpers (pure) ----------

/** What the UI needs to show an entry before the server has answered. */
export interface EntrySnapshot {
  name: string;
  basis: FoodBasis;
  per100: Nutrients;
}

export interface AddEntryVariables {
  input: DiaryEntryInput;
  snapshot: EntrySnapshot;
}

/** Re-derives totals, count, status and remaining after the slots changed (optimistic updates). */
function recompute(
  day: DiaryDay,
  slots: DiaryDay['slots'],
  tolerancePct = DEFAULT_SETTINGS.tolerancePct,
): DiaryDay {
  const entryCount = slots.reduce((n, s) => n + s.entries.length, 0);
  const totals = sumNutrients(slots.map((s) => s.totals));
  return {
    ...day,
    slots,
    totals,
    entryCount,
    status: computeDayStatus(totals.kcal, day.goal?.kcal ?? null, entryCount, tolerancePct),
    remaining: day.goal ? goalRemaining(day.goal, totals) : null,
  };
}

const byTime = (a: DiaryEntry, b: DiaryEntry) =>
  a.loggedAt.localeCompare(b.loggedAt) || a.id - b.id;

function withEntries(
  day: DiaryDay,
  update: (slotId: number, entries: DiaryEntry[]) => DiaryEntry[],
  tolerancePct?: number,
): DiaryDay {
  return recompute(
    day,
    day.slots.map((s) => {
      const entries = update(s.slot.id, s.entries).sort(byTime);
      return { ...s, entries, totals: dayTotals(entries) };
    }),
    tolerancePct,
  );
}

export function insertEntry(day: DiaryDay, entry: DiaryEntry, tolerancePct?: number): DiaryDay {
  if (!day.slots.some((s) => s.slot.id === entry.slotId)) return day;
  return withEntries(
    day,
    // A refetch that raced the mutation may already hold this entry: replace, never duplicate.
    (slotId, entries) =>
      slotId === entry.slotId
        ? [...entries.filter((e) => e.id !== entry.id), entry]
        : entries.filter((e) => e.id !== entry.id),
    tolerancePct,
  );
}

export function removeEntry(day: DiaryDay, id: number, tolerancePct?: number): DiaryDay {
  return withEntries(day, (_slotId, entries) => entries.filter((e) => e.id !== id), tolerancePct);
}

export function replaceEntry(
  day: DiaryDay,
  id: number,
  next: DiaryEntry,
  tolerancePct?: number,
): DiaryDay {
  const stripped = removeEntry(day, id, tolerancePct);
  return next.day === day.day ? insertEntry(stripped, next, tolerancePct) : stripped;
}

function optimisticEntry(
  { input, snapshot }: AddEntryVariables,
  id: number,
  now: string,
): DiaryEntry {
  const quantity = input.quantity;
  return {
    id,
    day: input.day,
    slotId: input.slotId,
    loggedAt: input.loggedAt,
    foodId: input.foodId ?? null,
    name: snapshot.name,
    quantity,
    basis: snapshot.basis,
    portionLabel: input.portionLabel ?? null,
    portionCount: input.portionCount ?? null,
    note: input.note ?? null,
    per100: snapshot.per100,
    totals: entryTotals(snapshot.per100, quantity),
    createdAt: now,
    updatedAt: now,
  };
}

/** Re-creates the POST body for an entry (undo after delete). Ad-hoc entries carry their snapshot. */
export function entryToInput(entry: DiaryEntry): AddEntryVariables {
  const base: DiaryEntryInput = {
    day: entry.day,
    slotId: entry.slotId,
    loggedAt: entry.loggedAt,
    foodId: entry.foodId,
    quantity: entry.quantity,
    basis: entry.basis,
    portionLabel: entry.portionLabel,
    portionCount: entry.portionCount,
    note: entry.note,
  };
  const input: DiaryEntryInput =
    entry.foodId === null ? { ...base, name: entry.name, per100: entry.per100 } : base;
  return { input, snapshot: { name: entry.name, basis: entry.basis, per100: entry.per100 } };
}

function describeError(err: unknown, fallback: string): string {
  return err instanceof ApiClientError ? err.message : fallback;
}

// ---------- mutations ----------

export function useAddEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input }: AddEntryVariables) =>
      apiRequest('/diary/entries', { method: 'POST', body: input, schema: diaryEntrySchema }),
    onMutate: async (variables) => {
      const key = diaryKeys.day(variables.input.day);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DiaryDay>(key);
      const tempId = -Date.now();
      if (previous) {
        const now = new Date().toISOString();
        queryClient.setQueryData(
          key,
          insertEntry(
            previous,
            optimisticEntry(variables, tempId, now),
            cachedTolerance(queryClient),
          ),
        );
      }
      return { previous, tempId, key };
    },
    onError: (err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast.error(describeError(err, 'Could not log that. Try again.'));
    },
    onSuccess: (entry, _variables, context) => {
      queryClient.setQueryData<DiaryDay>(context.key, (current) =>
        current
          ? replaceEntry(current, context.tempId, entry, cachedTolerance(queryClient))
          : current,
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: diaryKeys.all }),
  });
}

export interface PatchEntryVariables {
  entry: DiaryEntry;
  patch: DiaryEntryPatch;
}

export function usePatchEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entry, patch }: PatchEntryVariables) =>
      apiRequest(`/diary/entries/${entry.id}`, {
        method: 'PATCH',
        body: patch,
        schema: diaryEntrySchema,
      }),
    onMutate: async ({ entry, patch }) => {
      const key = diaryKeys.day(entry.day);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DiaryDay>(key);
      if (previous) {
        const quantity = patch.quantity ?? entry.quantity;
        const guess: DiaryEntry = {
          ...entry,
          quantity,
          totals: entryTotals(entry.per100, quantity),
          slotId: patch.slotId ?? entry.slotId,
          loggedAt: patch.loggedAt ?? entry.loggedAt,
          day: patch.day ?? entry.day,
          note: patch.note === undefined ? entry.note : patch.note,
          portionLabel: patch.portionLabel === undefined ? entry.portionLabel : patch.portionLabel,
          portionCount: patch.portionCount === undefined ? entry.portionCount : patch.portionCount,
        };
        queryClient.setQueryData(
          key,
          replaceEntry(previous, entry.id, guess, cachedTolerance(queryClient)),
        );
      }
      return { previous, key };
    },
    onError: (err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast.error(describeError(err, 'Could not save the change. Try again.'));
    },
    onSuccess: (updated, { entry }, context) => {
      queryClient.setQueryData<DiaryDay>(context.key, (current) =>
        current ? replaceEntry(current, entry.id, updated, cachedTolerance(queryClient)) : current,
      );
      if (updated.day !== entry.day) {
        void queryClient.invalidateQueries({ queryKey: diaryKeys.day(updated.day) });
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: diaryKeys.all }),
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entry: DiaryEntry) =>
      apiRequest(`/diary/entries/${entry.id}`, { method: 'DELETE', schema: okResponseSchema }),
    onMutate: async (entry) => {
      const key = diaryKeys.day(entry.day);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DiaryDay>(key);
      if (previous) {
        queryClient.setQueryData(
          key,
          removeEntry(previous, entry.id, cachedTolerance(queryClient)),
        );
      }
      return { previous, key };
    },
    onError: (err, _entry, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast.error(describeError(err, 'Could not delete that. Try again.'));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: diaryKeys.all }),
  });
}

export function useDuplicateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entry, loggedAt }: { entry: DiaryEntry; loggedAt: string }) =>
      apiRequest(`/diary/entries/${entry.id}/duplicate`, {
        method: 'POST',
        body: { loggedAt },
        schema: diaryEntrySchema,
      }),
    onMutate: async ({ entry, loggedAt }) => {
      const key = diaryKeys.day(entry.day);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DiaryDay>(key);
      const tempId = -Date.now();
      if (previous) {
        queryClient.setQueryData(
          key,
          insertEntry(previous, { ...entry, id: tempId, loggedAt }, cachedTolerance(queryClient)),
        );
      }
      return { previous, key, tempId };
    },
    onError: (err, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast.error(describeError(err, 'Could not duplicate that. Try again.'));
    },
    onSuccess: (created, _variables, context) => {
      queryClient.setQueryData<DiaryDay>(context.key, (current) =>
        current
          ? replaceEntry(current, context.tempId, created, cachedTolerance(queryClient))
          : current,
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: diaryKeys.all }),
  });
}

export function useCopyDiary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CopyDayInput) =>
      apiRequest('/diary/copy', { method: 'POST', body: input, schema: copyResultSchema }),
    onSuccess: (result: CopyResult) => {
      queryClient.setQueryData(diaryKeys.day(result.day.day), result.day);
      void queryClient.invalidateQueries({ queryKey: diaryKeys.all });
    },
  });
}

// ---------- water (FR-D9) ----------

function withWater(day: DiaryDay, entries: WaterEntry[]): DiaryDay {
  return { ...day, water: { ml: entries.reduce((sum, e) => sum + e.ml, 0), entries } };
}

/** Optimistic: the card and the summary chip move at once; the server entry replaces the temp one. */
export function useAddWater() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WaterEntryInput) =>
      apiRequest('/water', { method: 'POST', body: input, schema: waterEntrySchema }),
    onMutate: async (input) => {
      const key = diaryKeys.day(input.day);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DiaryDay>(key);
      const tempId = -Date.now();
      if (previous) {
        const temp: WaterEntry = {
          id: tempId,
          day: input.day,
          ml: input.ml,
          loggedAt: new Date().toISOString(),
        };
        queryClient.setQueryData(key, withWater(previous, [...previous.water.entries, temp]));
      }
      return { previous, key, tempId };
    },
    onError: (err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast.error(describeError(err, 'Could not add water. Try again.'));
    },
    onSuccess: (entry, _input, context) => {
      queryClient.setQueryData<DiaryDay>(context.key, (current) =>
        current
          ? withWater(
              current,
              current.water.entries.map((e) => (e.id === context.tempId ? entry : e)),
            )
          : current,
      );
    },
    onSettled: (_entry, _err, input) =>
      void queryClient.invalidateQueries({ queryKey: diaryKeys.day(input.day) }),
  });
}

/** "Undo last": removes one addition (the newest, as chosen by the card). */
export function useRemoveWater() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entry: WaterEntry) =>
      apiRequest(`/water/${entry.id}`, { method: 'DELETE', schema: okResponseSchema }),
    onMutate: async (entry) => {
      const key = diaryKeys.day(entry.day);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DiaryDay>(key);
      if (previous) {
        queryClient.setQueryData(
          key,
          withWater(
            previous,
            previous.water.entries.filter((e) => e.id !== entry.id),
          ),
        );
      }
      return { previous, key };
    },
    onError: (err, _entry, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast.error(describeError(err, 'Could not undo that. Try again.'));
    },
    onSettled: (_ok, _err, entry) =>
      void queryClient.invalidateQueries({ queryKey: diaryKeys.day(entry.day) }),
  });
}

// ---------- meal slots ----------

function useInvalidateMealSlots() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: mealSlotKeys.all });
    // Day views embed slot names and order.
    void queryClient.invalidateQueries({ queryKey: diaryKeys.all });
  };
}

export function useCreateMealSlot() {
  const invalidate = useInvalidateMealSlots();
  return useMutation({
    mutationFn: (input: MealSlotInput) =>
      apiRequest('/meal-slots', { method: 'POST', body: input, schema: mealSlotSchema }),
    onSuccess: invalidate,
  });
}

export function useUpdateMealSlot() {
  const invalidate = useInvalidateMealSlots();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: MealSlotInput }) =>
      apiRequest(`/meal-slots/${id}`, { method: 'PATCH', body: input, schema: mealSlotSchema }),
    onSuccess: invalidate,
  });
}

export function useSetMealSlotArchived() {
  const invalidate = useInvalidateMealSlots();
  return useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      apiRequest(`/meal-slots/${id}/${archived ? 'archive' : 'unarchive'}`, {
        method: 'POST',
        schema: mealSlotSchema,
      }),
    onSuccess: invalidate,
  });
}

export function useReorderMealSlots() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateMealSlots();
  return useMutation({
    mutationFn: (ids: number[]) =>
      apiRequest('/meal-slots/order', {
        method: 'PUT',
        body: { ids },
        schema: z.array(mealSlotSchema),
      }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: mealSlotKeys.all });
      const previous = queryClient.getQueryData<MealSlot[]>(mealSlotKeys.list(true));
      if (previous) {
        const byId = new Map(previous.map((s) => [s.id, s]));
        const ordered = ids.map((id) => byId.get(id)).filter((s): s is MealSlot => s !== undefined);
        const rest = previous.filter((s) => !ids.includes(s.id));
        queryClient.setQueryData(
          mealSlotKeys.list(true),
          [...ordered, ...rest].map((s, i) => ({ ...s, sortOrder: i })),
        );
      }
      return { previous };
    },
    onError: (_err, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(mealSlotKeys.list(true), context.previous);
    },
    onSettled: invalidate,
  });
}
