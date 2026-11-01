import type { Dish } from '@plate/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowLeft, Trash2, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useCategories, useDeleteFood, useFoods, useSetFoodArchived } from '@/features/foods/api';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { dishKeys, useCreateDish, useDish, useRecalculateDish, useUpdateDish } from './api';
import { toDishInput, type DishFormValues } from './dish-form-schema';
import { DishForm } from './DishForm';

const LIST = '/foods?tab=dishes';

/** Create (`/foods/dishes/new`) and edit (`/foods/dishes/:id`). Full page on phones, right panel on desktop. */
export function DishEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id === undefined ? undefined : Number(params.id);
  const isCreate = id === undefined;

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const library = useFoods({ includeArchived: true });
  const dish = useDish(id);
  const createDish = useCreateDish();
  const updateDish = useUpdateDish();
  const recalculate = useRecalculateDish();
  const setArchived = useSetFoodArchived();
  const deleteFood = useDeleteFood();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const formRef = useRef<UseFormReturn<DishFormValues> | null>(null);
  const captureForm = useCallback((form: UseFormReturn<DishFormValues>) => {
    formRef.current = form;
  }, []);

  const close = () => void navigate(LIST);

  const applyServerError = (err: unknown): boolean => {
    if (!(err instanceof ApiClientError)) return false;
    const form = formRef.current;
    if (err.status === 409 && form) {
      const details = err.details as { archived?: boolean } | undefined;
      form.setError('name', {
        message: details?.archived
          ? 'An archived food or dish with this name exists. Restore it from the list instead.'
          : 'A food or dish with this name and brand already exists.',
      });
      form.setFocus('name');
      return true;
    }
    if (err.code === 'VALIDATION_ERROR' && form) {
      let applied = false;
      for (const [path, message] of Object.entries(err.fieldErrors())) {
        if (path === 'cookedWeight' || path === 'servings' || path === 'name') {
          form.setError(path, { message });
          applied = true;
        } else if (/^ingredients\.\d+\.amount$/.test(path)) {
          form.setError(path as `ingredients.${number}.amount`, { message });
          applied = true;
        } else if (path.startsWith('ingredients')) {
          form.setError('ingredients', { message });
          applied = true;
        }
      }
      if (applied) return true;
    }
    toast.error(err.message);
    return true;
  };

  const onSubmit = async (values: DishFormValues) => {
    const input = toDishInput(values);
    try {
      if (isCreate) {
        const created = await createDish.mutateAsync(input);
        toast.success(`${created.name} added to your dishes`);
      } else {
        const updated = await updateDish.mutateAsync({ id, input });
        toast.success(`${updated.name} saved and recalculated`);
      }
      close();
    } catch (err) {
      if (!applyServerError(err)) toast.error('Could not save. Try again.');
    }
  };

  const onRecalculate = async (current: Dish) => {
    try {
      const fresh = await recalculate.mutateAsync(current.id);
      toast.success(`${fresh.name} recalculated`);
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not recalculate. Try again.',
      );
    }
  };

  const onToggleArchive = async (current: Dish) => {
    try {
      const updated = await setArchived.mutateAsync({
        id: current.id,
        archived: current.archivedAt === null,
      });
      void queryClient.invalidateQueries({ queryKey: dishKeys.detail(current.id) });
      toast.success(updated.archivedAt ? `${updated.name} archived` : `${updated.name} restored`);
      if (updated.archivedAt) close();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not update. Try again.');
    }
  };

  const onDelete = async (current: Dish) => {
    try {
      await deleteFood.mutateAsync(current.id);
      queryClient.removeQueries({ queryKey: dishKeys.detail(current.id) });
      toast.success(`${current.name} deleted`);
      setConfirmDelete(false);
      close();
    } catch (err) {
      setConfirmDelete(false);
      if (err instanceof ApiClientError && err.status === 409) {
        toast.error(
          `${current.name} has been logged or is in a meal template. Archive it instead.`,
        );
      } else {
        toast.error('Could not delete. Try again.');
      }
    }
  };

  const title = isCreate ? 'New dish' : (dish.data?.name ?? 'Edit dish');
  const submitting = createDish.isPending || updateDish.isPending;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-2 pt-3 pb-4 lg:pt-1">
        <Link
          to={LIST}
          aria-label="Back to dishes"
          className="text-fg-muted hover:bg-surface-2 hover:text-fg -ml-2 flex size-10 items-center justify-center rounded-full lg:hidden"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h2 className="text-fg min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close editor"
          onClick={close}
          className="hidden lg:inline-flex"
        >
          <X className="size-5" />
        </Button>
      </header>

      {!isCreate && dish.isPending ? (
        <EditorSkeleton />
      ) : !isCreate && dish.isError ? (
        <ErrorState
          message={dish.error.message}
          onRetry={() => void dish.refetch()}
          retrying={dish.isFetching}
        />
      ) : categories.isPending || library.isPending ? (
        <EditorSkeleton />
      ) : categories.isError ? (
        <ErrorState
          message={categories.error.message}
          onRetry={() => void categories.refetch()}
          retrying={categories.isFetching}
        />
      ) : library.isError ? (
        <ErrorState
          message={library.error.message}
          onRetry={() => void library.refetch()}
          retrying={library.isFetching}
        />
      ) : (
        <DishForm
          key={dish.data?.id ?? 'new'}
          mode={isCreate ? 'create' : 'edit'}
          dish={dish.data}
          categories={categories.data}
          library={library.data}
          onSubmit={onSubmit}
          formRef={captureForm}
          submitting={submitting}
          onRecalculate={dish.data ? () => void onRecalculate(dish.data) : undefined}
          recalculating={recalculate.isPending}
          secondaryActions={
            dish.data ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void onToggleArchive(dish.data)}
                  loading={setArchived.isPending}
                >
                  {dish.data.archivedAt ? (
                    <ArchiveRestore className="size-4" aria-hidden="true" />
                  ) : (
                    <Archive className="size-4" aria-hidden="true" />
                  )}
                  {dish.data.archivedAt ? 'Restore' : 'Archive'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn('text-danger hover:bg-danger/10')}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </Button>
              </>
            ) : null
          }
        />
      )}

      {dish.data ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${dish.data.name}?`}
          description="This removes the dish and its recipe for good. If it has ever been logged or sits in a meal template, deletion is refused and you can archive it instead."
          confirmLabel="Delete"
          destructive
          pending={deleteFood.isPending}
          onConfirm={() => void onDelete(dish.data)}
        />
      ) : null}
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-11 w-full" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
      <Skeleton className="h-24 w-full" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
