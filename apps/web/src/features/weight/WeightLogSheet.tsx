import type { Weight } from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Sheet } from '@/components/ui/sheet';
import { ApiClientError } from '@/lib/api';
import { formatDayLabel, formatDayLong, todayKey } from '@/lib/dates';
import { formatKg } from '@/lib/format';
import { useSaveWeight } from './api';
import {
  emptyWeightForm,
  fromWeight,
  toWeightInput,
  weightFormSchema,
  type WeightFormValues,
} from './weight-form-schema';

export type WeightLogMode =
  { kind: 'new'; day?: string | undefined } | { kind: 'edit'; weight: Weight };

export interface WeightLogSheetProps {
  open: boolean;
  mode: WeightLogMode;
  /** The whole log, to warn when the chosen day already has a weigh-in (FR-W1). */
  entries: readonly Weight[];
  /** Placeholder for the kg field. */
  latestKg: number | null;
  onClose: () => void;
  onDelete: (weight: Weight) => void;
}

const FORM_ID = 'weight-log-form';

/** "+ Log" and tap-to-edit (DESIGN §6). Remounts its form on every open so it starts fresh. */
export function WeightLogSheet(props: WeightLogSheetProps) {
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <WeightLogSheetInner key={session} {...props} />;
}

function WeightLogSheetInner({
  open,
  mode,
  entries,
  latestKg,
  onClose,
  onDelete,
}: WeightLogSheetProps) {
  const save = useSaveWeight();
  const today = todayKey();
  const editing = mode.kind === 'edit' ? mode.weight : null;

  const form = useForm<WeightFormValues>({
    resolver: zodResolver(weightFormSchema),
    defaultValues: editing
      ? fromWeight(editing)
      : { ...emptyWeightForm(today), day: mode.kind === 'new' && mode.day ? mode.day : today },
  });
  const errors = form.formState.errors;
  const day = useWatch({ control: form.control, name: 'day' });
  // Logging a day that already has a weigh-in replaces it; say so before Save (FR-W1).
  const replaces = editing ? undefined : entries.find((w) => w.day === day);

  const submit = async (values: WeightFormValues) => {
    try {
      await save.mutateAsync(toWeightInput(values));
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'VALIDATION_ERROR') {
        let applied = false;
        for (const [path, message] of Object.entries(err.fieldErrors())) {
          if (path in values) {
            form.setError(path as keyof WeightFormValues, { message });
            applied = true;
          }
        }
        if (applied) return;
      }
      // Other failures were already toasted by the mutation; keep the sheet open to retry.
      return;
    }
    toast.success(editing ? 'Weight updated' : replaces ? 'Weight replaced' : 'Weight logged');
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={editing ? 'Edit weigh-in' : 'Log weight'}
      description={editing ? formatDayLong(editing.day) : 'One weigh-in per day, with one decimal.'}
      locked={save.isPending}
      footer={
        <>
          {editing ? (
            <Button
              variant="ghost"
              className="text-danger hover:bg-danger/10 mr-auto"
              disabled={save.isPending}
              onClick={() => {
                onClose();
                onDelete(editing);
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={save.isPending} className="min-w-24">
            Save
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        className="flex flex-col gap-5 pt-1"
      >
        <Field label="Weight" error={errors.kg?.message}>
          {(c) => (
            <NumberField
              id={c.id}
              suffix="kg"
              data-autofocus
              placeholder={latestKg === null ? '70.0' : formatKg(latestKg)}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              className="text-lg font-semibold"
              {...form.register('kg')}
            />
          )}
        </Field>

        {editing ? null : (
          <Field label="Day" error={errors.day?.message}>
            {(c) => (
              <Input
                id={c.id}
                type="date"
                max={today}
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                {...form.register('day')}
              />
            )}
          </Field>
        )}
        {replaces ? (
          <p role="status" className="text-under-fg -mt-3 text-sm">
            Replaces the {formatKg(replaces.kg)} kg logged on {formatDayLabel(replaces.day)}.
          </p>
        ) : null}

        <Field label="Note" description="Optional" error={errors.note?.message}>
          {(c) => (
            <Input
              id={c.id}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              autoComplete="off"
              placeholder="post-run, after breakfast…"
              {...form.register('note')}
            />
          )}
        </Field>
      </form>
    </Sheet>
  );
}
