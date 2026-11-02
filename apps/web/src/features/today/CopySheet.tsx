import { isValidDayKey, type MealSlot } from '@plate/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { ApiClientError } from '@/lib/api';
import { formatDayLabel, shiftDay } from '@/lib/dates';
import { useCopyDiary } from './api';

export interface CopyRequest {
  /** `from`: bring another day's entries here. `to`: send this day's entries elsewhere. */
  mode: 'from' | 'to';
  /** Restrict to one meal (and preselect it). */
  slotId?: number;
}

interface CopySheetProps {
  request: CopyRequest | null;
  day: string;
  slots: MealSlot[];
  onClose: () => void;
}

/** Copy a day or a meal from/to another day. Appends; nothing on the destination is removed. */
export function CopySheet({ request, day, slots, onClose }: CopySheetProps) {
  return (
    <CopySheetInner
      key={request ? `${request.mode}-${request.slotId ?? 'all'}` : 'closed'}
      request={request}
      day={day}
      slots={slots}
      onClose={onClose}
    />
  );
}

function CopySheetInner({ request, day, slots, onClose }: CopySheetProps) {
  const mode = request?.mode ?? 'from';
  const [otherDay, setOtherDay] = useState(() => shiftDay(day, -1));
  const [scope, setScope] = useState<string>(request?.slotId ? String(request.slotId) : 'all');
  const [targetSlot, setTargetSlot] = useState<string>('same');
  const copy = useCopyDiary();
  const active = slots.filter((s) => s.archivedAt === null);
  // An archived meal can still be the source ("Copy to another day…" from its menu).
  const scopeOptions =
    request?.slotId !== undefined && !active.some((s) => s.id === request.slotId)
      ? [...active, ...slots.filter((s) => s.id === request.slotId)]
      : active;

  const sourceDay = mode === 'from' ? otherDay : day;
  const destinationDay = mode === 'from' ? day : otherDay;
  const valid = isValidDayKey(otherDay) && (otherDay !== day || scope !== 'all');

  // Entries from an archived meal cannot stay in it on the destination day (the server refuses an
  // archived target, D57), so "Same meal" is not offered and the first active meal is preselected.
  const scopeArchived = slots.some((s) => String(s.id) === scope && s.archivedAt !== null);
  const targetOptions = active.filter((s) => String(s.id) !== scope);
  const effectiveTarget =
    scopeArchived && targetSlot === 'same' ? String(targetOptions[0]?.id ?? '') : targetSlot;

  const submit = async () => {
    if (!valid) return;
    const input = {
      fromDay: sourceDay,
      toDay: destinationDay,
      ...(scope !== 'all' ? { slotId: Number(scope) } : {}),
      ...(scope !== 'all' && effectiveTarget !== 'same' && effectiveTarget !== ''
        ? { targetSlotId: Number(effectiveTarget) }
        : {}),
    };
    try {
      const result = await copy.mutateAsync(input);
      toast.success(
        result.copied === 0
          ? 'Nothing to copy on that day'
          : `Copied ${result.copied} ${result.copied === 1 ? 'entry' : 'entries'} to ${formatDayLabel(destinationDay)}`,
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not copy. Try again.');
    }
  };

  return (
    <Sheet
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={mode === 'from' ? 'Copy from another day' : 'Copy to another day'}
      description={
        mode === 'from'
          ? `Entries are added to ${formatDayLabel(day)}; nothing here is removed.`
          : `Entries from ${formatDayLabel(day)} are added to the day you pick.`
      }
      locked={copy.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={copy.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={copy.isPending} disabled={!valid}>
            Copy
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 py-1"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label={mode === 'from' ? 'Copy from' : 'Copy to'}
          error={
            otherDay && !isValidDayKey(otherDay)
              ? 'Pick a date'
              : otherDay === day && scope === 'all'
                ? 'Pick a different day'
                : undefined
          }
        >
          {(c) => (
            <Input
              id={c.id}
              type="date"
              value={otherDay}
              onChange={(e) => setOtherDay(e.target.value)}
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              required
            />
          )}
        </Field>
        <Field label="What">
          {(c) => (
            <Select id={c.id} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">The whole day</option>
              {scopeOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.archivedAt === null ? `${s.name} only` : `${s.name} only (archived)`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {scope !== 'all' ? (
          <Field
            label="Into meal"
            description={
              scopeArchived
                ? 'That meal is archived, so the copies go into an active one.'
                : 'Where the copied entries land.'
            }
          >
            {(c) => (
              <Select
                id={c.id}
                aria-describedby={c['aria-describedby']}
                value={effectiveTarget}
                onChange={(e) => setTargetSlot(e.target.value)}
              >
                {!scopeArchived ? <option value="same">Same meal</option> : null}
                {targetOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </form>
    </Sheet>
  );
}
