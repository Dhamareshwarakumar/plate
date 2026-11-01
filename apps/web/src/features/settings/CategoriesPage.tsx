import { CATEGORY_NAME_MAX, type Category } from '@plate/shared';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
  useReorderCategories,
  useSetCategoryArchived,
} from '@/features/foods/api';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';

export function CategoriesPage() {
  const categories = useCategories({ includeArchived: true });
  const create = useCreateCategory();
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState<string | null>(null);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setNewError('Enter a name');
      return;
    }
    try {
      await create.mutateAsync(name);
      setNewName('');
      setNewError(null);
      toast.success(`${name} added`);
    } catch (err) {
      setNewError(err instanceof ApiClientError ? err.message : 'Could not add the category');
    }
  };

  const active = (categories.data ?? []).filter((c) => c.archivedAt === null);
  const archived = (categories.data ?? []).filter((c) => c.archivedAt !== null);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Group foods for filtering. Reorder to control the chip order on the Foods screen."
        className="pt-2 lg:pt-6"
      />
      <Link
        to="/more"
        className="text-fg-muted hover:text-fg -mt-2 mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to More
      </Link>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="lg:col-span-2">
          <form onSubmit={(e) => void onCreate(e)} className="flex items-start gap-2" noValidate>
            <div className="flex-1">
              <Input
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNewError(null);
                }}
                placeholder="New category"
                aria-label="New category name"
                maxLength={CATEGORY_NAME_MAX}
                invalid={newError !== null}
                enterKeyHint="done"
              />
              {newError ? (
                <p role="alert" className="text-danger mt-1 text-sm">
                  {newError}
                </p>
              ) : null}
            </div>
            <Button type="submit" loading={create.isPending}>
              <Plus className="size-4" aria-hidden="true" />
              Add
            </Button>
          </form>
        </Card>

        {categories.isPending ? (
          <Card className="lg:col-span-2">
            <div className="flex flex-col gap-3" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          </Card>
        ) : categories.isError ? (
          <Card className="lg:col-span-2 p-0">
            <ErrorState
              message={categories.error.message}
              onRetry={() => void categories.refetch()}
              retrying={categories.isFetching}
            />
          </Card>
        ) : (
          <>
            <Card className={cn('p-0', archived.length === 0 && 'lg:col-span-2')}>
              <h2 className="text-fg-muted border-border border-b px-4 py-2.5 text-xs font-semibold tracking-wide uppercase">
                Active
              </h2>
              {active.length === 0 ? (
                <EmptyState
                  icon={Archive}
                  title="No active categories"
                  description="Add one above or restore an archived one."
                />
              ) : (
                <ul className="divide-border divide-y">
                  {active.map((c, index) => (
                    <CategoryRow key={c.id} category={c} index={index} siblings={active} />
                  ))}
                </ul>
              )}
            </Card>
            {archived.length > 0 ? (
              <Card className="p-0">
                <h2 className="text-fg-muted border-border border-b px-4 py-2.5 text-xs font-semibold tracking-wide uppercase">
                  Archived
                </h2>
                <ul className="divide-border divide-y">
                  {archived.map((c) => (
                    <CategoryRow key={c.id} category={c} index={-1} siblings={[]} />
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function CategoryRow({
  category,
  index,
  siblings,
}: {
  category: Category;
  index: number;
  siblings: Category[];
}) {
  const rename = useRenameCategory();
  const setArchived = useSetCategoryArchived();
  const remove = useDeleteCategory();
  const reorder = useReorderCategories();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(category.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = category.archivedAt !== null;

  const commitRename = async () => {
    const name = draft.trim();
    if (!name || name === category.name) {
      setEditing(false);
      setDraft(category.name);
      return;
    }
    try {
      await rename.mutateAsync({ id: category.id, name });
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not rename');
    }
  };

  const move = (delta: number) => {
    const ids = siblings.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids, { onError: () => toast.error('Could not reorder') });
  };

  const toggleArchive = async () => {
    try {
      await setArchived.mutateAsync({ id: category.id, archived: !archived });
      toast.success(archived ? `${category.name} restored` : `${category.name} archived`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not update');
    }
  };

  const onDelete = async () => {
    try {
      await remove.mutateAsync(category.id);
      toast.success(`${category.name} deleted`);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        toast.error(`${category.name} is used by foods. Archive it instead.`);
      } else {
        toast.error('Could not delete');
      }
    } finally {
      setConfirmDelete(false);
    }
  };

  return (
    <li className={cn('flex items-center gap-1 px-2 py-1.5 sm:px-3', archived && 'opacity-70')}>
      {!archived ? (
        <div className="flex flex-col">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={`Move ${category.name} up`}
            disabled={index === 0 || reorder.isPending}
            onClick={() => move(-1)}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={`Move ${category.name} down`}
            disabled={index === siblings.length - 1 || reorder.isPending}
            onClick={() => move(1)}
          >
            <ArrowDown className="size-3.5" />
          </Button>
        </div>
      ) : null}

      {editing ? (
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void commitRename();
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`Rename ${category.name}`}
            maxLength={CATEGORY_NAME_MAX}
            autoFocus
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditing(false);
                setDraft(category.name);
              }
            }}
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            aria-label="Save name"
            loading={rename.isPending}
          >
            <Check className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel rename"
            onClick={() => {
              setEditing(false);
              setDraft(category.name);
            }}
          >
            <X className="size-4" />
          </Button>
        </form>
      ) : (
        <>
          <span className="text-fg min-w-0 flex-1 truncate px-2 text-sm font-medium">
            {category.name}
          </span>
          {!archived ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Rename ${category.name}`}
              onClick={() => setEditing(true)}
            >
              <Pencil className="text-fg-muted size-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={archived ? `Restore ${category.name}` : `Archive ${category.name}`}
            onClick={() => void toggleArchive()}
            loading={setArchived.isPending}
          >
            {archived ? (
              <ArchiveRestore className="text-fg-muted size-4" />
            ) : (
              <Archive className="text-fg-muted size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${category.name}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="text-danger size-4" />
          </Button>
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${category.name}?`}
        description="Only possible when no food uses it. Foods keep working either way; archiving is the safe alternative."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => void onDelete()}
      />
    </li>
  );
}
