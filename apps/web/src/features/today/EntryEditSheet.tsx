import {
  entryTotals,
  minutesToTimeString,
  timeStringToMinutes,
  type DiaryEntry,
  type DiaryEntryPatch,
  type MealSlot,
} from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Copy, Minus, Plus, Trash2 } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { useFoods } from '@/features/foods/api';
import { isoAt, minutesOfIso, nowMinutes } from '@/lib/dates';
import { formatGrams, formatKcal } from '@/lib/format';
import { usePatchEntry } from './api';
import { entryEditFormSchema, parsePositive, type EntryEditFormValues } from './log-form-schemas';
import { QuantityPortionFields } from './QuantityPortionFields';

export interface EntryEditSheetProps {
  /** The entry being edited; kept while closing so the exit animation can play. */
  entry: DiaryEntry | null;
  open: boolean;
  /** All slots of the day (archived ones included); only active ones and the entry's own are offered. */
  slots: MealSlot[];
  onClose: () => void;
  onDuplicate: (entry: DiaryEntry) => void;
  onDelete: (entry: DiaryEntry) => void;
}

const FORM_ID = 'entry-edit-form';
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Edit quantity/portion, meal, time, day and note of an entry; duplicate or delete it. */
export function EntryEditSheet({
  entry,
  open,
  slots,
  onClose,
  onDuplicate,
  onDelete,
}: EntryEditSheetProps) {
  if (!entry) return null;
  return (
    <EntryEditSheetInner
      key={entry.id}
      entry={entry}
      open={open}
      slots={slots}
      onClose={onClose}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
    />
  );
}

function EntryEditSheetInner({
  entry,
  open,
  slots,
  onClose,
  onDuplicate,
  onDelete,
}: EntryEditSheetProps & { entry: DiaryEntry }) {
  const foods = useFoods({ includeArchived: true });
  const patch = usePatchEntry();
  const food = entry.foodId === null ? undefined : foods.data?.find((f) => f.id === entry.foodId);
  const adHocUnit = entry.foodId === null && entry.portionLabel !== null;

  const form = useForm<EntryEditFormValues>({
    resolver: zodResolver(entryEditFormSchema),
    defaultValues: {
      quantity: fmt(entry.quantity),
      portionLabel: entry.portionLabel ?? '',
      portionCount: entry.portionCount === null ? '' : fmt(entry.portionCount),
      slotId: String(entry.slotId),
      time: minutesToTimeString(minutesOfIso(entry.loggedAt)),
      day: entry.day,
      note: entry.note ?? '',
    },
  });
  const errors = form.formState.errors;
  const [quantity, portionLabel, portionCount] = useWatch({
    control: form.control,
    name: ['quantity', 'portionLabel', 'portionCount'],
  });

  const parsedQuantity = parsePositive(quantity);
  const preview = parsedQuantity === null ? null : entryTotals(entry.per100, parsedQuantity);
  const count = parsePositive(portionCount) ?? 1;

  // Active slots are offered; the entry's own slot stays selectable even if it has been archived since.
  const slotOptions = slots.filter((s) => s.archivedAt === null || s.id === entry.slotId);
  if (!slotOptions.some((s) => s.id === entry.slotId)) {
    slotOptions.push({
      id: entry.slotId,
      name: 'Archived meal',
      sortOrder: 999,
      windowStartMin: 0,
      windowEndMin: 0,
      archivedAt: 'archived',
    });
  }

  const stepCount = (delta: number) => {
    const next = Math.max(0.5, Math.round((count + delta) * 2) / 2);
    form.setValue('portionCount', fmt(next), { shouldDirty: true });
    form.setValue('quantity', fmt(100 * next), { shouldDirty: true });
  };

  const submit = (values: EntryEditFormValues) => {
    const q = parsePositive(values.quantity);
    if (q === null) return;
    const minutes = timeStringToMinutes(values.time) ?? nowMinutes();
    const note = values.note.trim();
    const body: DiaryEntryPatch = {
      quantity: q,
      loggedAt: isoAt(values.day, minutes),
      day: values.day,
      note: note === '' ? null : note,
    };
    // Only an actual move is sent, so an entry may keep sitting in a slot archived since.
    const slotId = Number(values.slotId);
    if (slotId !== entry.slotId) body.slotId = slotId;
    if (adHocUnit) {
      body.portionCount = parsePositive(values.portionCount);
    } else if (values.portionLabel) {
      body.portionLabel = values.portionLabel;
      body.portionCount = parsePositive(values.portionCount);
    } else {
      body.portionLabel = null;
      body.portionCount = null;
    }
    patch.mutate({ entry, patch: body });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={entry.name}
      description={`${formatKcal(entry.per100.kcal)} kcal per ${adHocUnit ? entry.portionLabel : `100 ${entry.basis}`}`}
      autoFocusFirstField={false}
      className="sm:max-w-[36rem]"
      footer={
        <>
          <Button
            variant="ghost"
            className="text-danger hover:bg-danger/10 mr-auto"
            onClick={() => {
              onClose();
              onDelete(entry);
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              onDuplicate(entry);
            }}
          >
            <Copy className="size-4" aria-hidden="true" />
            Duplicate
          </Button>
          <Button type="submit" form={FORM_ID} className="min-w-24">
            Save
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={form.handleSubmit(submit)}
        className="flex flex-col gap-5 pt-1"
      >
        {adHocUnit ? (
          <div className="flex flex-col items-center gap-2">
            <div
              className="bg-surface-2 flex items-center gap-1 rounded-full p-1"
              role="group"
              aria-label="Count"
            >
              <button
                type="button"
                onClick={() => stepCount(-0.5)}
                aria-label="Fewer"
                disabled={count <= 0.5}
                className="text-fg hover:bg-surface flex size-10 items-center justify-center rounded-full disabled:opacity-40"
              >
                <Minus className="size-4" />
              </button>
              <span className="text-fg tabular min-w-[7rem] text-center text-base font-semibold">
                {fmt(count)} × {entry.portionLabel}
              </span>
              <button
                type="button"
                onClick={() => stepCount(0.5)}
                aria-label="More"
                className="text-fg hover:bg-surface flex size-10 items-center justify-center rounded-full"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>
        ) : (
          <QuantityPortionFields
            basis={entry.basis}
            portions={food?.portions ?? []}
            value={{ quantity, portionLabel, portionCount }}
            onChange={(next) => {
              form.setValue('quantity', next.quantity, { shouldDirty: true });
              form.setValue('portionLabel', next.portionLabel);
              form.setValue('portionCount', next.portionCount);
              if (errors.quantity) void form.trigger('quantity');
            }}
            error={errors.quantity?.message}
            size="compact"
          />
        )}

        <div
          className="bg-surface-2 rounded-card flex items-baseline justify-between gap-3 px-4 py-3"
          aria-live="polite"
        >
          <span className="text-fg tabular text-lg font-semibold">
            {preview ? formatKcal(preview.kcal) : '—'}{' '}
            <span className="text-fg-muted text-sm font-normal">kcal</span>
          </span>
          <span className="text-fg-muted tabular text-sm">
            <span className="text-protein">P {preview ? formatGrams(preview.protein) : '–'}</span>
            {' · '}
            <span className="text-carbs">C {preview ? formatGrams(preview.carbs) : '–'}</span>
            {' · '}
            <span className="text-fat">F {preview ? formatGrams(preview.fat) : '–'}</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Meal" error={errors.slotId?.message}>
            {(c) => (
              <Select
                id={c.id}
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                {...form.register('slotId')}
              >
                {slotOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.archivedAt === null ? s.name : `${s.name} (archived)`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Time" error={errors.time?.message}>
            {(c) => (
              <Input
                id={c.id}
                type="time"
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                {...form.register('time')}
              />
            )}
          </Field>
          <Field label="Day" error={errors.day?.message} className="col-span-2">
            {(c) => (
              <Input
                id={c.id}
                type="date"
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                {...form.register('day')}
              />
            )}
          </Field>
        </div>
        <Field label="Note" description="Optional" error={errors.note?.message}>
          {(c) => (
            <Input
              id={c.id}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              autoComplete="off"
              {...form.register('note')}
            />
          )}
        </Field>
      </form>
    </Sheet>
  );
}
