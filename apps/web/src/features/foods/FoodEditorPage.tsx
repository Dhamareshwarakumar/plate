import { OFF_CODE_RE, type Food } from '@plate/shared';
import { Archive, ArchiveRestore, ArrowLeft, Trash2, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAbout } from '@/features/settings/api';
import {
  useCategories,
  useCreateFood,
  useDeleteFood,
  useFood,
  useSetFoodArchived,
  useUpdateFood,
} from './api';
import { apiPathToFormField, toFoodInput, type FoodFormValues } from './food-form-schema';
import { FoodForm, type FoodSubmitMeta } from './FoodForm';

/** Create (`/foods/new`) and edit (`/foods/:id`). Full page on phones, right-hand panel on desktop. */
export function FoodEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id === undefined ? undefined : Number(params.id);
  const isCreate = id === undefined;
  const [searchParams] = useSearchParams();
  const initialName = searchParams.get('name') ?? undefined;
  // A scanned barcode the log flow could not resolve (digits only, like the API's offCodeSchema).
  const offCodeParam = searchParams.get('offCode');
  const initialOffCode =
    offCodeParam !== null && OFF_CODE_RE.test(offCodeParam) ? offCodeParam : undefined;
  // Same-origin path only (`/today/2025-10-19`): after creating, go back there with the sheet open.
  const returnToRaw = searchParams.get('returnTo');
  const returnTo =
    returnToRaw && returnToRaw.startsWith('/') && !returnToRaw.startsWith('//')
      ? returnToRaw
      : null;

  const navigate = useNavigate();
  const categories = useCategories();
  const food = useFood(id);
  // "Search online" is hidden until the server confirms the lookup is enabled (FR-F5).
  const about = useAbout();
  const createFood = useCreateFood();
  const updateFood = useUpdateFood();
  const setArchived = useSetFoodArchived();
  const deleteFood = useDeleteFood();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const formRef = useRef<UseFormReturn<FoodFormValues> | null>(null);
  const captureForm = useCallback((form: UseFormReturn<FoodFormValues>) => {
    formRef.current = form;
  }, []);

  const close = () => void navigate('/foods');

  const applyServerError = (err: unknown): boolean => {
    if (!(err instanceof ApiClientError)) return false;
    const form = formRef.current;
    if (err.status === 409 && form) {
      const details = err.details as { foodId?: number; archived?: boolean } | undefined;
      form.setError('name', {
        message: details?.archived
          ? 'An archived food with this name and brand exists. Restore it from the list (show archived) instead.'
          : 'A food with this name and brand already exists.',
      });
      form.setFocus('name');
      return true;
    }
    if (err.code === 'VALIDATION_ERROR' && form) {
      const fieldErrors = err.fieldErrors();
      let applied = false;
      for (const [path, message] of Object.entries(fieldErrors)) {
        form.setError(apiPathToFormField(path) as keyof FoodFormValues, { message });
        applied = true;
      }
      if (applied) return true;
    }
    toast.error(err.message);
    return true;
  };

  const onSubmit = async (
    values: FoodFormValues,
    intent: 'save' | 'save-and-add',
    meta: FoodSubmitMeta,
  ) => {
    const input = toFoodInput(values, { estimated: meta.estimated });
    try {
      if (isCreate) {
        const created = await createFood.mutateAsync(input);
        toast.success(`${created.name} added`);
        if (returnTo) {
          void navigate(`${returnTo}?log=${created.id}`);
          return;
        }
        if (intent === 'save') close();
      } else {
        const updated = await updateFood.mutateAsync({ id, input });
        toast.success(`${updated.name} saved`);
        close();
      }
    } catch (err) {
      if (!applyServerError(err)) toast.error('Could not save. Try again.');
    }
  };

  const onToggleArchive = async (current: Food) => {
    try {
      const updated = await setArchived.mutateAsync({
        id: current.id,
        archived: current.archivedAt === null,
      });
      toast.success(updated.archivedAt ? `${updated.name} archived` : `${updated.name} restored`);
      if (updated.archivedAt) close();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not update. Try again.');
    }
  };

  const onDelete = async (current: Food) => {
    try {
      await deleteFood.mutateAsync(current.id);
      toast.success(`${current.name} deleted`);
      setConfirmDelete(false);
      close();
    } catch (err) {
      setConfirmDelete(false);
      if (err instanceof ApiClientError && err.status === 409) {
        toast.error(`${current.name} is used in your diary or recipes. Archive it instead.`);
      } else {
        toast.error('Could not delete. Try again.');
      }
    }
  };

  const title = isCreate ? 'New food' : (food.data?.name ?? 'Edit food');
  const submitting = createFood.isPending || updateFood.isPending;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-2 pt-3 pb-4 lg:pt-1">
        <Link
          to="/foods"
          aria-label="Back to foods"
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

      {!isCreate && food.isPending ? (
        <EditorSkeleton />
      ) : !isCreate && food.isError ? (
        <ErrorState
          message={food.error.message}
          onRetry={() => void food.refetch()}
          retrying={food.isFetching}
        />
      ) : categories.isPending ? (
        <EditorSkeleton />
      ) : categories.isError ? (
        <ErrorState
          message={categories.error.message}
          onRetry={() => void categories.refetch()}
          retrying={categories.isFetching}
        />
      ) : (
        <FoodForm
          key={food.data?.id ?? 'new'}
          mode={isCreate ? 'create' : 'edit'}
          food={food.data}
          initialName={initialName}
          initialOffCode={initialOffCode}
          categories={categories.data}
          onSubmit={onSubmit}
          formRef={captureForm}
          submitting={submitting}
          hideSaveAndAdd={returnTo !== null}
          offEnabled={about.data?.offEnabled === true}
          aiEnabled={about.data?.ai.enabled === true}
          secondaryActions={
            food.data ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void onToggleArchive(food.data)}
                  loading={setArchived.isPending}
                >
                  {food.data.archivedAt ? (
                    <ArchiveRestore className="size-4" aria-hidden="true" />
                  ) : (
                    <Archive className="size-4" aria-hidden="true" />
                  )}
                  {food.data.archivedAt ? 'Restore' : 'Archive'}
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

      {food.data ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${food.data.name}?`}
          description="This removes the food from your library for good. If it has ever been logged, deletion is refused and you can archive it instead."
          confirmLabel="Delete"
          destructive
          pending={deleteFood.isPending}
          onConfirm={() => void onDelete(food.data)}
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
      <Skeleton className="h-11 w-2/3" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
        <Skeleton className="h-11" />
      </div>
    </div>
  );
}
