import { roundNutrient, type Food, type MealTemplate } from '@plate/shared';
import { Apple, PenLine, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Chip, Tag } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useCategories, useFoods } from '@/features/foods/api';
import { useMealTemplates } from '@/features/meals/api';
import { cn } from '@/lib/cn';
import { formatKcal } from '@/lib/format';
import { normalize, searchItems } from '@/lib/search';
import { useFrequentFoods, useRecentFoods } from './api';

type Shelf = 'recent' | 'frequent' | 'dishes' | 'meals' | 'all';
const TINY_LIBRARY = 20;
const NO_FOODS: Food[] = [];
const NO_TEMPLATES: MealTemplate[] = [];

export interface FoodPickerProps {
  query: string;
  onPick: (food: Food) => void;
  /** "Create “x” as a new food" row for searches with no exact match; hidden when omitted. */
  onCreate?: ((name: string) => void) | undefined;
  /** "Quick ad-hoc entry" row; hidden when omitted. */
  onAdHoc?: (() => void) | undefined;
  /** Shows the Meals shelf (and templates in search results); picking one hands it back. */
  onPickTemplate?: ((template: MealTemplate) => void) | undefined;
  /** Narrows the library, e.g. no dishes when picking dish ingredients. */
  filter?: ((food: Food) => boolean) | undefined;
}

/**
 * Step 1 of the log flow and the picker of the recipe editors: Recent | Frequent | Dishes | Meals |
 * All shelves, instant typo-tolerant search over the whole library, and the two escape hatches
 * (create as new food, quick ad-hoc entry) when the caller offers them.
 */
export function FoodPicker({
  query,
  onPick,
  onCreate,
  onAdHoc,
  onPickTemplate,
  filter,
}: FoodPickerProps) {
  const foods = useFoods();
  const categories = useCategories({ includeArchived: true });
  const recent = useRecentFoods();
  const frequent = useFrequentFoods();
  const templatesEnabled = onPickTemplate !== undefined;
  const templatesQuery = useMealTemplates({ enabled: templatesEnabled });
  const [shelfChoice, setShelfChoice] = useState<Shelf | null>(null);

  const library = useMemo(() => {
    const all = foods.data ?? NO_FOODS;
    return filter ? all.filter(filter) : all;
  }, [foods.data, filter]);
  const templates = templatesEnabled ? (templatesQuery.data ?? NO_TEMPLATES) : NO_TEMPLATES;
  // A failed templates request must stay visible: the Meals shelf keeps its chip and shows the
  // error with a retry, and searches say that templates are missing from the results.
  const templatesFailed = templatesEnabled && templatesQuery.isError;
  const byId = useMemo(() => new Map(library.map((f) => [f.id, f])), [library]);
  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );

  const recentFoods = useMemo(
    () => (recent.data ?? []).map((u) => byId.get(u.foodId)).filter((f): f is Food => !!f),
    [recent.data, byId],
  );
  const frequentFoods = useMemo(
    () => (frequent.data ?? []).map((u) => byId.get(u.foodId)).filter((f): f is Food => !!f),
    [frequent.data, byId],
  );
  const dishes = useMemo(() => library.filter((f) => f.kind === 'dish'), [library]);

  const defaultShelf: Shelf =
    library.length <= TINY_LIBRARY
      ? 'all'
      : recentFoods.length > 0
        ? 'recent'
        : frequentFoods.length > 0
          ? 'frequent'
          : 'all';
  const shelf = shelfChoice ?? defaultShelf;
  const searching = query.trim() !== '';

  const results = useMemo(() => {
    if (searching) {
      return searchItems(library, query, (f) => ({ primary: f.name, secondary: f.brand })).map(
        (m) => m.item,
      );
    }
    if (shelf === 'recent') return recentFoods;
    if (shelf === 'frequent') return frequentFoods;
    if (shelf === 'dishes') return dishes;
    if (shelf === 'meals') return NO_FOODS;
    return library;
  }, [searching, library, query, shelf, recentFoods, frequentFoods, dishes]);

  const templateResults = useMemo(() => {
    if (!templatesEnabled) return NO_TEMPLATES;
    if (searching) {
      return searchItems(templates, query, (t) => ({ primary: t.name })).map((m) => m.item);
    }
    return shelf === 'meals' ? templates : NO_TEMPLATES;
  }, [templatesEnabled, searching, templates, query, shelf]);

  const exactMatch = useMemo(() => {
    if (!searching) return true;
    const q = normalize(query);
    return library.some((f) => normalize(f.name) === q);
  }, [searching, library, query]);

  // Shelves are disabled while empty, except All, and Meals when the request failed (the shelf then
  // shows the error).
  const shelves: { value: Shelf; label: string; disabled: boolean }[] = [
    { value: 'recent', label: 'Recent', disabled: recentFoods.length === 0 },
    { value: 'frequent', label: 'Frequent', disabled: frequentFoods.length === 0 },
    { value: 'dishes', label: 'Dishes', disabled: dishes.length === 0 },
    ...(templatesEnabled
      ? [
          {
            value: 'meals' as const,
            label: 'Meals',
            disabled: !templatesFailed && templates.length === 0,
          },
        ]
      : []),
    { value: 'all', label: 'All', disabled: false },
  ];

  const emptyShelfText =
    shelf === 'recent'
      ? 'Nothing logged recently.'
      : shelf === 'frequent'
        ? 'Nothing logged in the last 60 days.'
        : shelf === 'dishes'
          ? 'No dishes yet. Build one under Foods → Dishes.'
          : shelf === 'meals'
            ? 'No meal templates yet. Save a logged meal from its ⋯ menu.'
            : 'Nothing here yet.';

  return (
    <div className="flex flex-col gap-3">
      <div
        className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5"
        role="tablist"
        aria-label="Food shelves"
      >
        {shelves.map((s) => (
          <Chip
            key={s.value}
            role="tab"
            aria-selected={!searching && shelf === s.value}
            selected={!searching && shelf === s.value}
            onClick={() => setShelfChoice(s.value)}
            disabled={s.disabled}
            className="disabled:opacity-50"
          >
            {s.label}
          </Chip>
        ))}
      </div>

      {foods.isPending ? (
        <PickerSkeleton />
      ) : foods.isError ? (
        <ErrorState
          message={foods.error.message}
          onRetry={() => void foods.refetch()}
          retrying={foods.isFetching}
          className="py-8"
        />
      ) : shelf === 'meals' && !searching && templatesFailed ? (
        <ErrorState
          title="Meal templates didn't load"
          message={templatesQuery.error?.message ?? 'Could not load meal templates.'}
          onRetry={() => void templatesQuery.refetch()}
          retrying={templatesQuery.isFetching}
          className="py-8"
        />
      ) : library.length === 0 && !searching && templates.length === 0 ? (
        <EmptyState
          icon={Apple}
          title="Your library is empty"
          description={
            onAdHoc
              ? 'Search above to create your first food, or log a quick ad-hoc entry.'
              : 'Add foods under Foods first, then pick them here.'
          }
          className="py-8"
        />
      ) : (
        <ul className="divide-border -mx-2 divide-y">
          {searching && templatesFailed ? (
            <li
              role="alert"
              className="text-fg-muted flex items-center justify-between gap-3 px-2 py-2.5 text-xs"
            >
              <span>Meal templates didn't load, so none are in these results.</span>
              <button
                type="button"
                onClick={() => void templatesQuery.refetch()}
                className="text-accent shrink-0 font-medium"
              >
                Retry
              </button>
            </li>
          ) : null}
          {templateResults.map((template) => (
            <li key={`t${template.id}`}>
              <button
                type="button"
                onClick={() => onPickTemplate?.(template)}
                className="hover:bg-surface-2 focus-visible:bg-surface-2 flex w-full items-center gap-3 rounded-control px-2 py-2.5 text-left outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-fg truncate font-medium">{template.name}</span>
                    <Tag className="bg-accent-soft text-accent shrink-0">Meal</Tag>
                  </span>
                  <span className="text-fg-muted mt-0.5 block truncate text-xs">
                    {template.items.length} {template.items.length === 1 ? 'item' : 'items'} ·{' '}
                    {template.items.map((i) => i.name).join(', ')}
                  </span>
                </span>
                <span className="text-fg tabular shrink-0 text-right text-sm font-semibold">
                  {formatKcal(template.totals.kcal)}
                  <span className="text-fg-faint text-xs font-normal"> kcal</span>
                </span>
              </button>
            </li>
          ))}
          {results.map((food) => (
            <li key={food.id}>
              <button
                type="button"
                onClick={() => onPick(food)}
                className="hover:bg-surface-2 focus-visible:bg-surface-2 flex w-full items-center gap-3 rounded-control px-2 py-2.5 text-left outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-fg truncate font-medium">{food.name}</span>
                    {food.kind === 'dish' ? <Tag className="shrink-0">Dish</Tag> : null}
                    {food.categoryId !== null && categoryName.get(food.categoryId) ? (
                      <Tag className="shrink-0">{categoryName.get(food.categoryId)}</Tag>
                    ) : null}
                  </span>
                  <span className="text-fg-muted mt-0.5 block truncate text-xs">
                    {food.brand ? `${food.brand} · ` : ''}P{' '}
                    {roundNutrient('protein', food.per100.protein)} · C{' '}
                    {roundNutrient('carbs', food.per100.carbs)} · F{' '}
                    {roundNutrient('fat', food.per100.fat)}
                  </span>
                </span>
                <span className="text-fg tabular shrink-0 text-right text-sm font-semibold">
                  {roundNutrient('kcal', food.per100.kcal)}
                  <span className="text-fg-faint text-xs font-normal"> kcal/100{food.basis}</span>
                </span>
              </button>
            </li>
          ))}
          {searching && results.length === 0 && templateResults.length === 0 ? (
            <li className="text-fg-muted px-2 py-6 text-center text-sm">
              No foods match “{query.trim()}”.
            </li>
          ) : null}
          {!searching && results.length === 0 && templateResults.length === 0 ? (
            <li className="text-fg-muted px-2 py-6 text-center text-sm">{emptyShelfText}</li>
          ) : null}
          {searching && !exactMatch && onCreate ? (
            <li>
              <ActionRow
                icon={<Plus className="size-4" />}
                onClick={() => onCreate(query.trim())}
                label={
                  <>
                    Create <span className="text-fg font-semibold">“{query.trim()}”</span> as a new
                    food
                  </>
                }
              />
            </li>
          ) : null}
          {onAdHoc ? (
            <li>
              <ActionRow
                icon={<PenLine className="size-4" />}
                onClick={onAdHoc}
                label="Quick ad-hoc entry"
                hint="Name and calories only, no library food"
              />
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-accent hover:bg-accent-soft/60 focus-visible:bg-accent-soft/60 flex w-full items-center gap-3 rounded-control px-2 py-3 text-left text-sm font-medium outline-none',
      )}
    >
      <span className="bg-accent-soft flex size-8 shrink-0 items-center justify-center rounded-full">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        {hint ? <span className="text-fg-muted block text-xs font-normal">{hint}</span> : null}
      </span>
    </button>
  );
}

function PickerSkeleton() {
  return (
    <div className="flex flex-col divide-y divide-border" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center justify-between py-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
