import { roundNutrient, type Category, type Food, type MealTemplate } from '@plate/shared';
import {
  Apple,
  ArrowDownAZ,
  BookmarkPlus,
  ChefHat,
  Clock,
  Download,
  FolderCog,
  Play,
  Plus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Chip, Tag } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { logTemplatePath, useMealTemplates } from '@/features/meals/api';
import { cn } from '@/lib/cn';
import { formatGrams, formatKcal } from '@/lib/format';
import { searchItems } from '@/lib/search';
import { useCategories, useFoods } from './api';
import { ImportCsvSheet } from './ImportCsvSheet';

type LibraryTab = 'foods' | 'dishes' | 'meals';
type SortMode = 'name' | 'newest';

const TAB_META: Record<
  LibraryTab,
  { title: string; newLabel: string; newPath: string; searchPlaceholder: string }
> = {
  foods: {
    title: 'Foods',
    newLabel: 'New food',
    newPath: '/foods/new',
    searchPlaceholder: 'Search foods',
  },
  dishes: {
    title: 'Dishes',
    newLabel: 'New dish',
    newPath: '/foods/dishes/new',
    searchPlaceholder: 'Search dishes',
  },
  meals: {
    title: 'Meals',
    newLabel: 'New meal',
    newPath: '/foods/meals/new',
    searchPlaceholder: 'Search meal templates',
  },
};

/**
 * Library layout. On phones the list and the editors (`/foods/new`, `/foods/:id`,
 * `/foods/dishes/…`, `/foods/meals/…`) replace each other; from `lg` up they sit side by side.
 */
export function FoodsPage() {
  const foodNew = useMatch('/foods/new');
  const foodEdit = useMatch('/foods/:id');
  const dishNew = useMatch('/foods/dishes/new');
  const dishEdit = useMatch('/foods/dishes/:id');
  const mealNew = useMatch('/foods/meals/new');
  const mealEdit = useMatch('/foods/meals/:id');
  const editorOpen = [foodNew, foodEdit, dishNew, dishEdit, mealNew, mealEdit].some(
    (m) => m !== null,
  );
  // An open editor decides which tab the list shows next to it.
  const routeTab: LibraryTab | null =
    dishNew || dishEdit ? 'dishes' : mealNew || mealEdit ? 'meals' : null;
  return (
    <div
      className={cn('lg:grid lg:gap-8', editorOpen && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}
    >
      <div className={cn(editorOpen && 'hidden lg:block')}>
        <LibraryList routeTab={routeTab} />
      </div>
      {editorOpen ? (
        <div className="lg:border-border lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:rounded-card lg:border lg:bg-surface lg:p-6 lg:shadow-card">
          <Outlet />
        </div>
      ) : null}
    </div>
  );
}

function LibraryList({ routeTab }: { routeTab: LibraryTab | null }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const paramTab = params.get('tab');
  const tab: LibraryTab =
    routeTab ?? (paramTab === 'dishes' || paramTab === 'meals' ? paramTab : 'foods');
  const query = params.get('q') ?? '';
  const categoryParam = params.get('cat');
  const categoryId = categoryParam ? Number(categoryParam) : null;
  const sort = (params.get('sort') as SortMode | null) ?? 'name';
  const showArchived = params.get('archived') === '1';
  const [importOpen, setImportOpen] = useState(false);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const foods = useFoods({ includeArchived: showArchived });
  const categories = useCategories({ includeArchived: true });
  const templates = useMealTemplates({ enabled: tab === 'meals' });

  const kind = tab === 'dishes' ? 'dish' : 'food';
  const ofKind = useMemo(
    () => (foods.data ?? []).filter((f) => f.kind === kind),
    [foods.data, kind],
  );
  const visible = useMemo(() => {
    const filtered = ofKind.filter((f) => categoryId === null || f.categoryId === categoryId);
    const ranked = searchItems(filtered, query, (f) => ({
      primary: f.name,
      secondary: f.brand,
    })).map((m) => m.item);
    if (query.trim() !== '') return ranked;
    return sort === 'newest'
      ? [...ranked].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : ranked;
  }, [ofKind, categoryId, query, sort]);

  const visibleTemplates = useMemo(() => {
    const items = templates.data ?? [];
    const ranked = searchItems(items, query, (t) => ({ primary: t.name })).map((m) => m.item);
    if (query.trim() !== '') return ranked;
    return sort === 'newest'
      ? [...ranked].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : ranked;
  }, [templates.data, query, sort]);

  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );
  const activeCategories = (categories.data ?? []).filter((c) => c.archivedAt === null);
  const meta = TAB_META[tab];
  const hrefFor = (food: Food) =>
    tab === 'dishes' ? `/foods/dishes/${food.id}` : `/foods/${food.id}`;

  return (
    <>
      <PageHeader
        title="Foods"
        actions={
          <>
            <Link
              to={meta.newPath}
              className={cn(buttonVariants({ size: 'sm' }), 'hidden sm:inline-flex')}
            >
              <Plus className="size-4" aria-hidden="true" />
              {meta.newLabel}
            </Link>
            <Menu
              trigger={
                <Button variant="outline" size="icon-sm" aria-label="More actions">
                  <span className="text-lg leading-none">⋯</span>
                </Button>
              }
            >
              <MenuItem icon={<Upload />} onSelect={() => setImportOpen(true)}>
                Import CSV…
              </MenuItem>
              <MenuItem
                icon={<Download />}
                onSelect={() => window.location.assign('/api/foods/export.csv')}
              >
                Export CSV
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<FolderCog />} onSelect={() => void navigate('/more/categories')}>
                Manage categories
              </MenuItem>
              {tab !== 'meals' ? (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={showArchived ? <X /> : <Clock />}
                    onSelect={() => setParam('archived', showArchived ? null : '1')}
                  >
                    {showArchived ? 'Hide archived' : 'Show archived'}
                  </MenuItem>
                </>
              ) : null}
            </Menu>
          </>
        }
      />

      <Segmented
        aria-label="Library section"
        value={tab}
        onChange={(v) => {
          const next = new URLSearchParams(params);
          if (v === 'foods') next.delete('tab');
          else next.set('tab', v);
          next.delete('cat');
          if (routeTab !== null) {
            // Switching tabs while an editor is open closes it.
            void navigate({ pathname: '/foods', search: next.toString() });
            return;
          }
          setParams(next, { replace: true });
        }}
        options={[
          { value: 'foods', label: 'Foods' },
          { value: 'dishes', label: 'Dishes' },
          { value: 'meals', label: 'Meals' },
        ]}
        className="mb-4"
      />

      <div className="relative mb-3">
        <Search
          className="text-fg-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder={meta.searchPlaceholder}
          aria-label={meta.searchPlaceholder}
          autoComplete="off"
          enterKeyHint="search"
          className="pl-10 pr-10"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setParam('q', null)}
            aria-label="Clear search"
            className="text-fg-muted hover:text-fg absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="mb-4 flex items-center gap-2">
        {tab !== 'meals' ? (
          <div className="scrollbar-none flex min-w-0 flex-1 gap-2 overflow-x-auto lg:flex-wrap">
            <Chip selected={categoryId === null} onClick={() => setParam('cat', null)}>
              All
            </Chip>
            {activeCategories.map((c) => (
              <Chip
                key={c.id}
                selected={categoryId === c.id}
                onClick={() => setParam('cat', categoryId === c.id ? null : String(c.id))}
              >
                {c.name}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-fg-muted min-w-0 flex-1 text-sm">
            Log a whole meal in one tap. Save one from a meal's ⋯ menu on Today, or build it here.
          </p>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-fg-muted shrink-0"
          aria-label={
            sort === 'name' ? 'Sorted by name. Sort by newest' : 'Sorted by newest. Sort by name'
          }
          onClick={() => setParam('sort', sort === 'name' ? 'newest' : null)}
          disabled={query.trim() !== ''}
        >
          {sort === 'name' ? <ArrowDownAZ className="size-5" /> : <Clock className="size-5" />}
        </Button>
      </div>

      {tab === 'meals' ? (
        templates.isPending ? (
          <ListSkeleton />
        ) : templates.isError ? (
          <ErrorState
            message={templates.error.message}
            onRetry={() => void templates.refetch()}
            retrying={templates.isFetching}
          />
        ) : (templates.data ?? []).length === 0 ? (
          <div className="bg-surface border-border rounded-card border">
            <EmptyState
              icon={BookmarkPlus}
              title="No meal templates yet"
              description="A template is a named list of foods and dishes with amounts. Log it and every item lands in your diary at once."
              action={
                <Link to="/foods/meals/new" className={buttonVariants({})}>
                  <Plus className="size-4" aria-hidden="true" />
                  Build your first meal
                </Link>
              }
            />
          </div>
        ) : visibleTemplates.length === 0 ? (
          <div className="bg-surface border-border rounded-card border">
            <EmptyState
              icon={Search}
              title={`No meals match “${query.trim()}”`}
              description="Check the spelling, or build a new meal template."
              action={
                <Link to="/foods/meals/new" className={buttonVariants({})}>
                  <Plus className="size-4" aria-hidden="true" />
                  New meal
                </Link>
              }
            />
          </div>
        ) : (
          <MealRows templates={visibleTemplates} />
        )
      ) : foods.isPending ? (
        <ListSkeleton />
      ) : foods.isError ? (
        <ErrorState
          message={foods.error.message}
          onRetry={() => void foods.refetch()}
          retrying={foods.isFetching}
        />
      ) : ofKind.length === 0 ? (
        <div className="bg-surface border-border rounded-card border">
          {tab === 'dishes' ? (
            <EmptyState
              icon={ChefHat}
              title="No dishes yet"
              description="A dish is a recipe: ingredients from your library plus the cooked weight. Plate works out the nutrition per 100 g so you log it like any food."
              action={
                <Link to="/foods/dishes/new" className={buttonVariants({})}>
                  <Plus className="size-4" aria-hidden="true" />
                  Build your first dish
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={Apple}
              title="Your library is empty"
              description="Add foods with their nutrition per 100 g, or import a CSV to bring in many at once."
              action={
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Link to="/foods/new" className={buttonVariants({})}>
                    <Plus className="size-4" aria-hidden="true" />
                    Add your first food
                  </Link>
                  <Button variant="secondary" onClick={() => setImportOpen(true)}>
                    <Upload className="size-4" aria-hidden="true" />
                    Import CSV
                  </Button>
                </div>
              }
            />
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface border-border rounded-card border">
          <EmptyState
            icon={Search}
            title={query ? `No ${tab} match “${query.trim()}”` : `No ${tab} in this category`}
            description={
              query
                ? `Check the spelling, or add it as a new ${tab === 'dishes' ? 'dish' : 'food'}.`
                : `Pick another category or add a ${tab === 'dishes' ? 'dish' : 'food'} here.`
            }
            action={
              <Link
                to={`${meta.newPath}${query && tab === 'foods' ? `?name=${encodeURIComponent(query.trim())}` : ''}`}
                className={buttonVariants({})}
              >
                <Plus className="size-4" aria-hidden="true" />
                {query && tab === 'foods' ? `Create “${query.trim()}”` : meta.newLabel}
              </Link>
            }
          />
        </div>
      ) : (
        <FoodRows foods={visible} categoryName={categoryName} hrefFor={hrefFor} />
      )}

      <Link
        to={meta.newPath}
        aria-label={meta.newLabel}
        className="bg-accent text-accent-fg hover:bg-accent-hover fixed right-5 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full shadow-lg shadow-accent/30 transition-transform active:scale-95 sm:hidden"
      >
        <Plus className="size-7" />
      </Link>

      <ImportCsvSheet open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}

const TABLE_COLS =
  '@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_8rem_4.5rem_3.5rem_3.5rem_3.5rem] @3xl:items-center @3xl:gap-3';

/** Card rows on narrow containers; a proper table once the list container is wide enough. */
function FoodRows({
  foods,
  categoryName,
  hrefFor,
}: {
  foods: Food[];
  categoryName: Map<number, string>;
  hrefFor: (food: Food) => string;
}) {
  const foodMatch = useMatch('/foods/:id');
  const dishMatch = useMatch('/foods/dishes/:id');
  const activeParam = dishMatch?.params.id ?? foodMatch?.params.id;
  const activeId = activeParam ? Number(activeParam) : null;
  return (
    <div className="@container">
      <div className="bg-surface border-border rounded-card overflow-hidden border">
        <div
          className={cn(
            'text-fg-muted border-border hidden border-b px-4 py-2 text-xs font-medium',
            TABLE_COLS,
          )}
        >
          <span>Name</span>
          <span>Category</span>
          <span className="text-right">kcal</span>
          <span className="text-right">Protein</span>
          <span className="text-right">Carbs</span>
          <span className="text-right">Fat</span>
        </div>
        <ul className="divide-border divide-y">
          {foods.map((food) => (
            <FoodRow
              key={food.id}
              food={food}
              href={hrefFor(food)}
              active={food.id === activeId}
              category={food.categoryId === null ? undefined : categoryName.get(food.categoryId)}
            />
          ))}
        </ul>
        <p className="text-fg-faint border-border border-t px-4 py-2 text-xs">
          Values per 100 g or 100 ml
        </p>
      </div>
    </div>
  );
}

function FoodRow({
  food,
  href,
  category,
  active,
}: {
  food: Food;
  href: string;
  category: string | undefined;
  active: boolean;
}) {
  const archived = food.archivedAt !== null;
  const stale = food.kind === 'dish' && food.staleSince !== null;
  const { per100 } = food;
  return (
    <li>
      <Link
        to={href}
        className={cn(
          'hover:bg-surface-2 focus-visible:bg-surface-2 flex items-center gap-3 border-l-2 border-transparent px-4 py-3 outline-none transition-colors',
          TABLE_COLS,
          active && 'bg-surface-2 border-accent',
          archived && 'opacity-60',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-fg truncate font-medium">{food.name}</span>
            {archived ? <Tag>Archived</Tag> : null}
            {food.estimatedAt ? (
              <Tag className="bg-accent-soft text-accent shrink-0">Estimated</Tag>
            ) : null}
            {stale ? (
              <Tag className="bg-under/15 text-under-fg shrink-0 gap-1">
                <span className="bg-under size-1.5 rounded-full" aria-hidden="true" />
                Recalculate
              </Tag>
            ) : null}
          </div>
          <div className="text-fg-muted mt-0.5 flex items-center gap-1.5 text-xs">
            {food.brand ? <span className="truncate">{food.brand}</span> : null}
            {food.brand && category ? (
              <span aria-hidden="true" className="@3xl:hidden">
                ·
              </span>
            ) : null}
            {category ? <span className="@3xl:hidden">{category}</span> : null}
            {food.portions.length > 0 ? (
              <span className="hidden @3xl:inline">
                {food.brand ? ' · ' : ''}
                {food.kind === 'dish' && food.portions[0]?.label === '1 serving'
                  ? `1 serving = ${formatGrams(food.portions[0].amount)} g`
                  : `${food.portions.length} portion${food.portions.length === 1 ? '' : 's'}`}
              </span>
            ) : null}
          </div>
        </div>

        {/* Narrow: two-line number block. */}
        <div className="text-right @3xl:hidden">
          <div className="text-fg tabular text-sm font-semibold">
            {roundNutrient('kcal', per100.kcal)}
            <span className="text-fg-faint text-xs font-normal"> kcal</span>
          </div>
          <div className="text-fg-muted tabular mt-0.5 text-xs">
            P {roundNutrient('protein', per100.protein)} · C {roundNutrient('carbs', per100.carbs)}{' '}
            · F {roundNutrient('fat', per100.fat)}
          </div>
        </div>

        {/* Wide: one cell per column. */}
        <span className="text-fg-muted hidden truncate text-sm @3xl:block">{category ?? '—'}</span>
        <span className="text-fg tabular hidden text-right text-sm font-semibold @3xl:block">
          {roundNutrient('kcal', per100.kcal)}
        </span>
        <span className="text-protein tabular hidden text-right text-sm @3xl:block">
          {roundNutrient('protein', per100.protein)}
        </span>
        <span className="text-carbs tabular hidden text-right text-sm @3xl:block">
          {roundNutrient('carbs', per100.carbs)}
        </span>
        <span className="text-fat tabular hidden text-right text-sm @3xl:block">
          {roundNutrient('fat', per100.fat)}
        </span>
      </Link>
    </li>
  );
}

/** Meal templates: name, items and the total of one log; "Log" jumps to today's log sheet. */
function MealRows({ templates }: { templates: MealTemplate[] }) {
  const match = useMatch('/foods/meals/:id');
  const activeId = match?.params.id ? Number(match.params.id) : null;
  return (
    <div className="@container">
      <div className="bg-surface border-border rounded-card overflow-hidden border">
        <ul className="divide-border divide-y">
          {templates.map((template) => (
            <li
              key={template.id}
              className={cn(
                'flex items-center gap-2 border-l-2 border-transparent pr-3 transition-colors',
                template.id === activeId && 'bg-surface-2 border-accent',
              )}
            >
              <Link
                to={`/foods/meals/${template.id}`}
                className="hover:bg-surface-2 focus-visible:bg-surface-2 -mr-2 flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 pl-4 outline-none"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-fg block truncate font-medium">{template.name}</span>
                  <span className="text-fg-muted mt-0.5 block truncate text-xs">
                    {template.items.length} {template.items.length === 1 ? 'item' : 'items'} ·{' '}
                    {template.items.map((i) => i.name).join(', ')}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-fg tabular text-sm font-semibold">
                    {formatKcal(template.totals.kcal)}
                    <span className="text-fg-faint text-xs font-normal"> kcal</span>
                  </div>
                  <div className="text-fg-muted tabular mt-0.5 hidden text-xs @xl:block">
                    P {formatGrams(template.totals.protein)} · C{' '}
                    {formatGrams(template.totals.carbs)} · F {formatGrams(template.totals.fat)}
                  </div>
                </div>
              </Link>
              <Link
                to={logTemplatePath(template.id)}
                aria-label={`Log ${template.name} now`}
                className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'shrink-0')}
              >
                <Play className="size-4" aria-hidden="true" />
                Log
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-fg-faint border-border border-t px-4 py-2 text-xs">
          Totals use the current library values; logged entries keep the values of their day.
        </p>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div
      className="bg-surface border-border rounded-card divide-border divide-y overflow-hidden border"
      aria-busy="true"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center justify-between px-4 py-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

export type { Category };
