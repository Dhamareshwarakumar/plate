import { roundNutrient, type Category, type Food } from '@plate/shared';
import {
  Apple,
  ArrowDownAZ,
  Clock,
  Download,
  FolderCog,
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
import { cn } from '@/lib/cn';
import { searchItems } from '@/lib/search';
import { useCategories, useFoods } from './api';
import { ImportCsvSheet } from './ImportCsvSheet';

type LibraryTab = 'foods' | 'dishes' | 'meals';
type SortMode = 'name' | 'newest';

/**
 * Library layout. On phones the list and the editor (`/foods/new`, `/foods/:id`) replace each
 * other; from `lg` up they sit side by side.
 */
export function FoodsPage() {
  const newMatch = useMatch('/foods/new');
  const idMatch = useMatch('/foods/:id');
  const editorOpen = newMatch !== null || idMatch !== null;
  return (
    <div
      className={cn('lg:grid lg:gap-8', editorOpen && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}
    >
      <div className={cn(editorOpen && 'hidden lg:block')}>
        <FoodList />
      </div>
      {editorOpen ? (
        <div className="lg:border-border lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:rounded-card lg:border lg:bg-surface lg:p-6 lg:shadow-card">
          <Outlet />
        </div>
      ) : null}
    </div>
  );
}

function FoodList() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = (params.get('tab') as LibraryTab | null) ?? 'foods';
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

  const visible = useMemo(() => {
    const items = foods.data ?? [];
    const filtered = items.filter(
      (f) => f.kind === 'food' && (categoryId === null || f.categoryId === categoryId),
    );
    const ranked = searchItems(filtered, query, (f) => ({
      primary: f.name,
      secondary: f.brand,
    })).map((m) => m.item);
    if (query.trim() !== '') return ranked;
    return sort === 'newest'
      ? [...ranked].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : ranked;
  }, [foods.data, categoryId, query, sort]);

  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );
  const activeCategories = (categories.data ?? []).filter((c) => c.archivedAt === null);

  return (
    <>
      <PageHeader
        title="Foods"
        actions={
          <>
            <Link
              to="/foods/new"
              className={cn(buttonVariants({ size: 'sm' }), 'hidden sm:inline-flex')}
            >
              <Plus className="size-4" aria-hidden="true" />
              New food
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
              <MenuSeparator />
              <MenuItem
                icon={showArchived ? <X /> : <Clock />}
                onSelect={() => setParam('archived', showArchived ? null : '1')}
              >
                {showArchived ? 'Hide archived' : 'Show archived'}
              </MenuItem>
            </Menu>
          </>
        }
      />

      <Segmented
        aria-label="Library section"
        value={tab}
        onChange={(v) => setParam('tab', v === 'foods' ? null : v)}
        options={[
          { value: 'foods', label: 'Foods' },
          { value: 'dishes', label: 'Dishes' },
          { value: 'meals', label: 'Meals' },
        ]}
        className="mb-4"
      />

      {tab !== 'foods' ? (
        <div className="bg-surface border-border rounded-card border">
          <EmptyState
            icon={Apple}
            title={
              tab === 'dishes' ? 'Dishes arrive in Phase 4' : 'Meal templates arrive in Phase 4'
            }
            description={
              tab === 'dishes'
                ? 'Build a recipe from ingredients and a cooked weight; Plate works out the nutrition per 100 g so you log it like any food.'
                : 'Save a combination of foods and log all of them with one tap.'
            }
          />
        </div>
      ) : (
        <>
          <div className="relative mb-3">
            <Search
              className="text-fg-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setParam('q', e.target.value)}
              placeholder="Search foods"
              aria-label="Search foods"
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
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-fg-muted shrink-0"
              aria-label={
                sort === 'name'
                  ? 'Sorted by name. Sort by newest'
                  : 'Sorted by newest. Sort by name'
              }
              onClick={() => setParam('sort', sort === 'name' ? 'newest' : null)}
              disabled={query.trim() !== ''}
            >
              {sort === 'name' ? <ArrowDownAZ className="size-5" /> : <Clock className="size-5" />}
            </Button>
          </div>

          {foods.isPending ? (
            <ListSkeleton />
          ) : foods.isError ? (
            <ErrorState
              message={foods.error.message}
              onRetry={() => void foods.refetch()}
              retrying={foods.isFetching}
            />
          ) : (foods.data ?? []).filter((f) => f.kind === 'food').length === 0 ? (
            <div className="bg-surface border-border rounded-card border">
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
            </div>
          ) : visible.length === 0 ? (
            <div className="bg-surface border-border rounded-card border">
              <EmptyState
                icon={Search}
                title={query ? `No foods match “${query.trim()}”` : 'No foods in this category'}
                description={
                  query
                    ? 'Check the spelling, or add it as a new food.'
                    : 'Pick another category or add a food here.'
                }
                action={
                  <Link
                    to={`/foods/new${query ? `?name=${encodeURIComponent(query.trim())}` : ''}`}
                    className={buttonVariants({})}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {query ? `Create “${query.trim()}”` : 'New food'}
                  </Link>
                }
              />
            </div>
          ) : (
            <FoodRows foods={visible} categoryName={categoryName} />
          )}
        </>
      )}

      <Link
        to="/foods/new"
        aria-label="New food"
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
function FoodRows({ foods, categoryName }: { foods: Food[]; categoryName: Map<number, string> }) {
  const idMatch = useMatch('/foods/:id');
  const activeId = idMatch?.params.id ? Number(idMatch.params.id) : null;
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
  category,
  active,
}: {
  food: Food;
  category: string | undefined;
  active: boolean;
}) {
  const archived = food.archivedAt !== null;
  const { per100 } = food;
  return (
    <li>
      <Link
        to={`/foods/${food.id}`}
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
                {food.portions.length} portion{food.portions.length === 1 ? '' : 's'}
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
