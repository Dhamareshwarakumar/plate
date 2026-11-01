import { MEAL_TEMPLATE_ITEMS_MAX, MEAL_TEMPLATE_NAME_MAX, type DiaryDaySlot } from '@plate/shared';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { ApiClientError } from '@/lib/api';
import { formatDayLabel } from '@/lib/dates';
import { formatKcal } from '@/lib/format';
import { useSaveMealAsTemplate } from './api';

export interface SaveAsMealSheetProps {
  /** The meal being saved; kept while closing so the exit animation can play. */
  section: DiaryDaySlot | null;
  open: boolean;
  day: string;
  onClose: () => void;
}

/** Name prompt for "Save as meal template…" (FR-R3). Library entries become items; ad-hoc ones are skipped. */
export function SaveAsMealSheet(props: SaveAsMealSheetProps) {
  // Fresh name/error state on every open; the same instance stays mounted during the close animation.
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  if (!props.section) return null;
  return (
    <SaveAsMealSheetInner
      key={`${props.section.slot.id}-${session}`}
      {...props}
      section={props.section}
    />
  );
}

function SaveAsMealSheetInner({
  section,
  open,
  day,
  onClose,
}: SaveAsMealSheetProps & { section: DiaryDaySlot }) {
  const navigate = useNavigate();
  const save = useSaveMealAsTemplate();
  const [name, setName] = useState(section.slot.name);
  const [error, setError] = useState<string | null>(null);

  const libraryEntries = section.entries.filter((e) => e.foodId !== null);
  const skipped = section.entries.length - libraryEntries.length;
  const tooMany = libraryEntries.length > MEAL_TEMPLATE_ITEMS_MAX;
  const kcal = libraryEntries.reduce((sum, e) => sum + e.totals.kcal, 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name');
      return;
    }
    try {
      const { template, skipped: skippedCount } = await save.mutateAsync({
        day,
        slotId: section.slot.id,
        name: trimmed,
      });
      toast.success(
        skippedCount > 0
          ? `${template.name} saved (${skippedCount} quick ${skippedCount === 1 ? 'entry' : 'entries'} skipped)`
          : `${template.name} saved with ${template.items.length} ${template.items.length === 1 ? 'item' : 'items'}`,
        { action: { label: 'Open', onClick: () => void navigate(`/foods/meals/${template.id}`) } },
      );
      onClose();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setError('A meal template with this name already exists');
      } else if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError('Could not save the meal. Try again.');
      }
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Save as meal template"
      description={`${section.slot.name} on ${formatDayLabel(day)} becomes a template you can log in one tap.`}
      locked={save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="save-as-meal-form"
            loading={save.isPending}
            disabled={libraryEntries.length === 0 || tooMany}
          >
            Save template
          </Button>
        </>
      }
    >
      <form
        id="save-as-meal-form"
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-4 py-1"
      >
        <Field label="Name" error={error ?? undefined}>
          {(c) => (
            <Input
              id={c.id}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              value={name}
              maxLength={MEAL_TEMPLATE_NAME_MAX}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              autoComplete="off"
              enterKeyHint="done"
              data-autofocus
            />
          )}
        </Field>
        <div className="bg-surface-2 rounded-card px-4 py-3 text-sm">
          <p className="text-fg">
            <span className="tabular font-semibold">{libraryEntries.length}</span>{' '}
            {libraryEntries.length === 1 ? 'item' : 'items'} ·{' '}
            <span className="tabular font-semibold">{formatKcal(kcal)}</span> kcal
          </p>
          <ul className="text-fg-muted mt-1 flex flex-col gap-0.5 text-xs">
            {libraryEntries.map((e) => (
              <li key={e.id} className="truncate">
                {e.name}
              </li>
            ))}
          </ul>
          {skipped > 0 ? (
            <p className="text-fg-muted mt-2 text-xs">
              {skipped} quick {skipped === 1 ? 'entry has' : 'entries have'} no library food and{' '}
              {skipped === 1 ? 'is' : 'are'} skipped.
            </p>
          ) : null}
          {libraryEntries.length === 0 ? (
            <p role="alert" className="text-danger mt-2 text-xs">
              Only quick entries here; a template needs foods from your library.
            </p>
          ) : null}
          {tooMany ? (
            <p role="alert" className="text-danger mt-2 text-xs">
              A template holds at most {MEAL_TEMPLATE_ITEMS_MAX} items.
            </p>
          ) : null}
        </div>
      </form>
    </Sheet>
  );
}
