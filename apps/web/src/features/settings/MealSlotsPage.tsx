import {
  MEAL_SLOT_NAME_MAX,
  minutesToTimeString,
  timeStringToMinutes,
  type MealSlot,
} from '@plate/shared';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import {
  useCreateMealSlot,
  useMealSlots,
  useReorderMealSlots,
  useSetMealSlotArchived,
  useUpdateMealSlot,
} from '@/features/today/api';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Meal slot manager: add, rename, time window, reorder, archive. Slots are never deleted. */
export function MealSlotsPage() {
  const slots = useMealSlots({ includeArchived: true });
  const create = useCreateMealSlot();
  const [newName, setNewName] = useState('');
  const [newStart, setNewStart] = useState('22:00');
  const [newEnd, setNewEnd] = useState('23:30');
  const [newError, setNewError] = useState<string | null>(null);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const start = timeStringToMinutes(newStart);
    const end = timeStringToMinutes(newEnd);
    if (!name) {
      setNewError('Enter a name');
      return;
    }
    if (start === null || end === null) {
      setNewError('Enter both times');
      return;
    }
    try {
      await create.mutateAsync({ name, windowStartMin: start, windowEndMin: end });
      setNewName('');
      setNewError(null);
      toast.success(`${name} added`);
    } catch (err) {
      setNewError(err instanceof ApiClientError ? err.message : 'Could not add the meal slot');
    }
  };

  const active = (slots.data ?? []).filter((s) => s.archivedAt === null);
  const archived = (slots.data ?? []).filter((s) => s.archivedAt !== null);

  return (
    <>
      <PageHeader
        title="Meal slots"
        description="The meals of your day. The time window picks the meal automatically when you log."
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
          <form onSubmit={(e) => void onCreate(e)} noValidate className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_auto] sm:items-end">
              <label className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
                <span className="text-fg text-sm font-medium">Name</span>
                <Input
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setNewError(null);
                  }}
                  placeholder="e.g. Supper"
                  maxLength={MEAL_SLOT_NAME_MAX}
                  invalid={newError !== null}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-fg text-sm font-medium">From</span>
                <Input
                  type="time"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  required
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-fg text-sm font-medium">To</span>
                <Input
                  type="time"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  required
                />
              </label>
              <Button type="submit" loading={create.isPending} className="col-span-2 sm:col-span-1">
                <Plus className="size-4" aria-hidden="true" />
                Add
              </Button>
            </div>
            {newError ? (
              <p role="alert" className="text-danger text-sm">
                {newError}
              </p>
            ) : (
              <p className="text-fg-muted text-xs">
                A window may cross midnight (22:00–02:00). Gaps resolve to the nearest meal.
              </p>
            )}
          </form>
        </Card>

        {slots.isPending ? (
          <Card className="lg:col-span-2">
            <div className="flex flex-col gap-3" aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          </Card>
        ) : slots.isError ? (
          <Card className="p-0 lg:col-span-2">
            <ErrorState
              message={slots.error.message}
              onRetry={() => void slots.refetch()}
              retrying={slots.isFetching}
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
                  title="No active meal slots"
                  description="Restore one below or add a new one."
                />
              ) : (
                <ul className="divide-border divide-y">
                  {active.map((s, index) => (
                    <SlotRow key={s.id} slot={s} index={index} siblings={active} />
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
                  {archived.map((s) => (
                    <SlotRow key={s.id} slot={s} index={-1} siblings={[]} />
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

function SlotRow({
  slot,
  index,
  siblings,
}: {
  slot: MealSlot;
  index: number;
  siblings: MealSlot[];
}) {
  const update = useUpdateMealSlot();
  const setArchived = useSetMealSlotArchived();
  const reorder = useReorderMealSlots();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(slot.name);
  const [start, setStart] = useState(minutesToTimeString(slot.windowStartMin));
  const [end, setEnd] = useState(minutesToTimeString(slot.windowEndMin));
  const archived = slot.archivedAt !== null;

  const reset = () => {
    setEditing(false);
    setName(slot.name);
    setStart(minutesToTimeString(slot.windowStartMin));
    setEnd(minutesToTimeString(slot.windowEndMin));
  };

  const commit = async () => {
    const trimmed = name.trim();
    const startMin = timeStringToMinutes(start);
    const endMin = timeStringToMinutes(end);
    if (!trimmed || startMin === null || endMin === null) {
      toast.error('Enter a name and both times');
      return;
    }
    try {
      await update.mutateAsync({
        id: slot.id,
        input: { name: trimmed, windowStartMin: startMin, windowEndMin: endMin },
      });
      setEditing(false);
      toast.success(`${trimmed} saved`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not save');
    }
  };

  const move = (delta: number) => {
    const ids = siblings.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate(ids, { onError: () => toast.error('Could not reorder') });
  };

  const toggleArchive = async () => {
    try {
      await setArchived.mutateAsync({ id: slot.id, archived: !archived });
      toast.success(archived ? `${slot.name} restored` : `${slot.name} archived`);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not update');
    }
  };

  const window = `${minutesToTimeString(slot.windowStartMin)}–${minutesToTimeString(slot.windowEndMin)}`;

  return (
    <li className={cn('flex items-center gap-1 px-2 py-1.5 sm:px-3', archived && 'opacity-70')}>
      {!archived ? (
        <div className="flex flex-col">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={`Move ${slot.name} up`}
            disabled={index === 0 || reorder.isPending}
            onClick={() => move(-1)}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={`Move ${slot.name} down`}
            disabled={index === siblings.length - 1 || reorder.isPending}
            onClick={() => move(1)}
          >
            <ArrowDown className="size-3.5" />
          </Button>
        </div>
      ) : null}

      {editing ? (
        <form
          className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={`Rename ${slot.name}`}
            maxLength={MEAL_SLOT_NAME_MAX}
            autoFocus
            className="h-9 col-span-2 sm:col-span-1"
            onKeyDown={(e) => {
              if (e.key === 'Escape') reset();
            }}
          />
          <Input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            aria-label={`${slot.name} window start`}
            className="h-9"
          />
          <Input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            aria-label={`${slot.name} window end`}
            className="h-9"
          />
          <div className="flex">
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              aria-label="Save"
              loading={update.isPending}
            >
              <Check className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel"
              onClick={reset}
            >
              <X className="size-4" />
            </Button>
          </div>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 px-2">
            <span className="text-fg block truncate text-sm font-medium">{slot.name}</span>
            <span className="text-fg-muted tabular block text-xs">{window}</span>
          </span>
          {!archived ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${slot.name}`}
              onClick={() => setEditing(true)}
            >
              <Pencil className="text-fg-muted size-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={archived ? `Restore ${slot.name}` : `Archive ${slot.name}`}
            onClick={() => void toggleArchive()}
            loading={setArchived.isPending}
          >
            {archived ? (
              <ArchiveRestore className="text-fg-muted size-4" />
            ) : (
              <Archive className="text-fg-muted size-4" />
            )}
          </Button>
        </>
      )}
    </li>
  );
}
