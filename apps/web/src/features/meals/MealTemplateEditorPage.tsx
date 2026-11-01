import type { MealTemplate } from '@plate/shared';
import { ArrowLeft, Play, Trash2, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useFoods } from '@/features/foods/api';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  logTemplatePath,
  useCreateMealTemplate,
  useDeleteMealTemplate,
  useMealTemplate,
  useUpdateMealTemplate,
} from './api';
import { toMealInput, type MealFormValues } from './meal-form-schema';
import { MealTemplateForm } from './MealTemplateForm';

const LIST = '/foods?tab=meals';

/** Create (`/foods/meals/new`) and edit (`/foods/meals/:id`). Full page on phones, right panel on desktop. */
export function MealTemplateEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id === undefined ? undefined : Number(params.id);
  const isCreate = id === undefined;

  const navigate = useNavigate();
  const library = useFoods({ includeArchived: true });
  const template = useMealTemplate(id);
  const createTemplate = useCreateMealTemplate();
  const updateTemplate = useUpdateMealTemplate();
  const deleteTemplate = useDeleteMealTemplate();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const formRef = useRef<UseFormReturn<MealFormValues> | null>(null);
  const captureForm = useCallback((form: UseFormReturn<MealFormValues>) => {
    formRef.current = form;
  }, []);

  const close = () => void navigate(LIST);

  const applyServerError = (err: unknown): boolean => {
    if (!(err instanceof ApiClientError)) return false;
    const form = formRef.current;
    if (err.status === 409 && form) {
      form.setError('name', { message: 'A meal template with this name already exists.' });
      form.setFocus('name');
      return true;
    }
    if (err.code === 'VALIDATION_ERROR' && form) {
      let applied = false;
      for (const [path, message] of Object.entries(err.fieldErrors())) {
        if (path === 'name') {
          form.setError('name', { message });
          applied = true;
        } else if (/^items\.\d+\.amount$/.test(path)) {
          form.setError(path as `items.${number}.amount`, { message });
          applied = true;
        } else if (path.startsWith('items')) {
          form.setError('items', { message });
          applied = true;
        }
      }
      if (applied) return true;
    }
    toast.error(err.message);
    return true;
  };

  const onSubmit = async (values: MealFormValues) => {
    const input = toMealInput(values);
    try {
      if (isCreate) {
        const created = await createTemplate.mutateAsync(input);
        toast.success(`${created.name} saved`, {
          action: { label: 'Log now', onClick: () => void navigate(logTemplatePath(created.id)) },
        });
      } else {
        const updated = await updateTemplate.mutateAsync({ id, input });
        toast.success(`${updated.name} saved`);
      }
      close();
    } catch (err) {
      if (!applyServerError(err)) toast.error('Could not save. Try again.');
    }
  };

  const onDelete = async (current: MealTemplate) => {
    try {
      await deleteTemplate.mutateAsync(current.id);
      toast.success(`${current.name} deleted`);
      setConfirmDelete(false);
      close();
    } catch (err) {
      setConfirmDelete(false);
      toast.error(err instanceof ApiClientError ? err.message : 'Could not delete. Try again.');
    }
  };

  const title = isCreate ? 'New meal template' : (template.data?.name ?? 'Edit meal template');
  const submitting = createTemplate.isPending || updateTemplate.isPending;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-2 pt-3 pb-4 lg:pt-1">
        <Link
          to={LIST}
          aria-label="Back to meals"
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

      {!isCreate && template.isPending ? (
        <EditorSkeleton />
      ) : !isCreate && template.isError ? (
        <ErrorState
          message={template.error.message}
          onRetry={() => void template.refetch()}
          retrying={template.isFetching}
        />
      ) : library.isPending ? (
        <EditorSkeleton />
      ) : library.isError ? (
        <ErrorState
          message={library.error.message}
          onRetry={() => void library.refetch()}
          retrying={library.isFetching}
        />
      ) : (
        <MealTemplateForm
          key={template.data?.id ?? 'new'}
          mode={isCreate ? 'create' : 'edit'}
          template={template.data}
          library={library.data}
          onSubmit={onSubmit}
          formRef={captureForm}
          submitting={submitting}
          primaryExtra={
            template.data ? (
              <Link
                to={logTemplatePath(template.data.id)}
                className={cn(
                  'bg-surface-2 text-fg hover:bg-surface-3 rounded-control inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-medium',
                )}
              >
                <Play className="size-4" aria-hidden="true" />
                Log now
              </Link>
            ) : null
          }
          secondaryActions={
            template.data ? (
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
            ) : null
          }
        />
      )}

      {template.data ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${template.data.name}?`}
          description="Removes the template. Meals you already logged with it stay in your diary."
          confirmLabel="Delete"
          destructive
          pending={deleteTemplate.isPending}
          onConfirm={() => void onDelete(template.data)}
        />
      ) : null}
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-9 w-36" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
