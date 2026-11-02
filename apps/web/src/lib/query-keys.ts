/**
 * TanStack Query keys for every domain, in one module with no feature imports. The feature api
 * modules invalidate each other's caches (a food edit stales dishes and meal templates, a settings
 * change stales every day), so keeping the keys here is what lets them do that without import
 * cycles between `features/<domain>/api.ts` files.
 */

export const foodKeys = {
  all: ['foods'] as const,
  list: (includeArchived: boolean) => ['foods', 'list', { includeArchived }] as const,
  detail: (id: number) => ['foods', 'detail', id] as const,
};
export const categoryKeys = {
  all: ['categories'] as const,
  list: (includeArchived: boolean) => ['categories', 'list', { includeArchived }] as const,
};
export const offKeys = {
  all: ['off'] as const,
  lookup: (q: string) => ['off', 'lookup', q] as const,
};

export const dishKeys = {
  all: ['dishes'] as const,
  detail: (id: number) => ['dishes', 'detail', id] as const,
};

export const mealTemplateKeys = {
  all: ['mealTemplates'] as const,
  list: ['mealTemplates', 'list'] as const,
  detail: (id: number) => ['mealTemplates', 'detail', id] as const,
};

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

export const goalKeys = {
  all: ['goals'] as const,
  list: ['goals', 'list'] as const,
};

export const settingsKeys = {
  all: ['settings'] as const,
};
export const profileKeys = {
  all: ['profile'] as const,
};
export const aboutKeys = {
  all: ['about'] as const,
};

export const weightKeys = {
  all: ['weights'] as const,
  list: ['weights', 'list'] as const,
  stats: ['weights', 'stats'] as const,
};

export const insightsKeys = {
  all: ['insights'] as const,
  daily: (from: string, to: string) => ['insights', 'daily', { from, to }] as const,
  summary: (from: string, to: string, today: string) =>
    ['insights', 'summary', { from, to, today }] as const,
  topFoods: (from: string, to: string) => ['insights', 'top-foods', { from, to }] as const,
  bySlot: (from: string, to: string) => ['insights', 'by-slot', { from, to }] as const,
  weightVsIntake: (from: string, to: string) =>
    ['insights', 'weight-vs-intake', { from, to }] as const,
};
