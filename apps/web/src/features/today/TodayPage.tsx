import { isValidDayKey, type DiaryDaySlot, type DiaryEntry } from '@plate/shared';
import { History, Plus, UtensilsCrossed } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { InitialPasswordBanner } from '@/features/auth/InitialPasswordBanner';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDayLabel, isoAt, nowMinutes, shiftDay, todayKey } from '@/lib/dates';
import { useKeyboardShortcuts } from '@/lib/keyboard';
import { useMediaQuery } from '@/lib/use-media-query';
import {
  entryToInput,
  useAddEntry,
  useCopyDiary,
  useDeleteEntry,
  useDiaryDay,
  useDuplicateEntry,
} from './api';
import { CopySheet, type CopyRequest } from './CopySheet';
import { DayHeader } from './DayHeader';
import { DayStrip } from './DayStrip';
import { EntryEditSheet } from './EntryEditSheet';
import { LogSheet } from './LogSheet';
import { MealSection } from './MealSection';
import { MiniCalendar } from './MiniCalendar';
import { SummaryCard, SummaryCardSkeleton } from './SummaryCard';

const UNDO_MS = 6000;
const SWIPE_THRESHOLD = 72;

/** `/today` → today's key in the device zone. */
export function TodayRedirect() {
  return <Navigate to={`/today/${todayKey()}`} replace />;
}

/** `/today/:day`. Invalid keys (2025-02-30) bounce to today. */
export function TodayPage() {
  const { day } = useParams<{ day: string }>();
  if (!day || !isValidDayKey(day)) return <TodayRedirect />;
  return <TodayView day={day} />;
}

function TodayView({ day }: { day: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const desktop = useMediaQuery('(min-width: 1024px)');

  const dayQuery = useDiaryDay(day);
  const addEntry = useAddEntry();
  const deleteEntry = useDeleteEntry();
  const duplicateEntry = useDuplicateEntry();
  const copy = useCopyDiary();

  const [editEntry, setEditEntry] = useState<DiaryEntry | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [copyRequest, setCopyRequest] = useState<CopyRequest | null>(null);
  const [clearTarget, setClearTarget] = useState<DiaryDaySlot | null>(null);
  const [clearing, setClearing] = useState(false);

  // The log sheet is URL state (`?log=new|<foodId>&slot=<id>`): Back closes it and deep links open it.
  const logParam = searchParams.get('log');
  const slotParam = searchParams.get('slot');
  const logOpen = logParam !== null;
  const logFoodId = logParam !== null && /^\d+$/.test(logParam) ? Number(logParam) : undefined;
  const openLog = (options: { slotId?: number } = {}) => {
    const next = new URLSearchParams();
    next.set('log', 'new');
    if (options.slotId !== undefined) next.set('slot', String(options.slotId));
    setSearchParams(next);
  };
  const closeLog = () => setSearchParams(new URLSearchParams(), { replace: true });

  const goTo = (next: string) => void navigate(`/today/${next}`);
  // Router navigations are transitions, so a quick second key press would still see the old `day`;
  // the URL is already current.
  const currentDay = () =>
    /\/today\/(\d{4}-\d{2}-\d{2})/.exec(window.location.pathname)?.[1] ?? day;

  useKeyboardShortcuts({
    ArrowLeft: () => goTo(shiftDay(currentDay(), -1)),
    ArrowRight: () => goTo(shiftDay(currentDay(), 1)),
    t: () => goTo(todayKey()),
    n: () => openLog(),
  });

  const data = dayQuery.data;
  const slots = data?.slots.map((s) => s.slot) ?? [];
  const activeSlots = slots.filter((s) => s.archivedAt === null);

  const onEdit = (entry: DiaryEntry) => {
    if (entry.id < 0) return; // still being created
    setEditEntry(entry);
    setEditOpen(true);
  };

  const onDelete = (entry: DiaryEntry) => {
    if (entry.id < 0) return;
    deleteEntry.mutate(entry);
    toast(`${entry.name} removed`, {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => addEntry.mutate(entryToInput(entry)) },
    });
  };

  const onDuplicate = (entry: DiaryEntry) => {
    if (entry.id < 0) return;
    duplicateEntry.mutate({ entry, loggedAt: isoAt(entry.day, nowMinutes()) });
  };

  const copyFromYesterday = (slotId?: number) => {
    copy.mutate(
      {
        fromDay: shiftDay(day, -1),
        toDay: day,
        ...(slotId !== undefined ? { slotId } : {}),
      },
      {
        onSuccess: (result) =>
          toast.success(
            result.copied === 0
              ? 'Nothing was logged yesterday'
              : `Copied ${result.copied} ${result.copied === 1 ? 'entry' : 'entries'} from yesterday`,
          ),
        onError: (err) =>
          toast.error(err instanceof ApiClientError ? err.message : 'Could not copy. Try again.'),
      },
    );
  };

  const clearMeal = async () => {
    if (!clearTarget) return;
    setClearing(true);
    try {
      for (const entry of clearTarget.entries) {
        if (entry.id > 0) await deleteEntry.mutateAsync(entry);
      }
      toast.success(`${clearTarget.slot.name} cleared`);
    } catch {
      // useDeleteEntry already toasts and rolls back the failed delete.
    } finally {
      setClearing(false);
      setClearTarget(null);
    }
  };

  const empty = data !== undefined && data.entryCount === 0;

  return (
    <>
      <InitialPasswordBanner />
      <div className="lg:grid lg:grid-cols-[22.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="lg:col-start-2 lg:row-start-1">
          <DayHeader day={day} onNavigate={goTo} onLog={() => openLog()} />
        </div>

        <DayStrip day={day} onNavigate={goTo} />

        <aside className="mt-3 flex flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-8 lg:mt-8">
          <MiniCalendar day={day} onNavigate={goTo} className="hidden lg:block" />
          {dayQuery.isPending ? (
            <SummaryCardSkeleton />
          ) : data ? (
            <SummaryCard
              totals={data.totals}
              entryCount={data.entryCount}
              className={cn(dayQuery.isPlaceholderData && 'opacity-60 transition-opacity')}
            />
          ) : null}
        </aside>

        <motion.section
          aria-label="Meals"
          drag={desktop ? false : 'x'}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.08}
          dragDirectionLock
          onDragEnd={(_event, info) => {
            if (info.offset.x < -SWIPE_THRESHOLD) goTo(shiftDay(day, 1));
            else if (info.offset.x > SWIPE_THRESHOLD) goTo(shiftDay(day, -1));
          }}
          className={cn(
            'mt-4 flex flex-col gap-4 lg:col-start-2 lg:row-start-2 lg:mt-0',
            dayQuery.isPlaceholderData && 'opacity-60 transition-opacity',
          )}
        >
          {dayQuery.isPending ? (
            <MealsSkeleton />
          ) : dayQuery.isError ? (
            <div className="bg-surface border-border rounded-card border">
              <ErrorState
                message={dayQuery.error.message}
                onRetry={() => void dayQuery.refetch()}
                retrying={dayQuery.isFetching}
              />
            </div>
          ) : empty ? (
            <div className="bg-surface border-border shadow-card rounded-card border">
              <EmptyState
                icon={UtensilsCrossed}
                title={`Nothing logged on ${formatDayLabel(day)}`}
                description="Log what you ate, or start from yesterday and adjust."
                action={
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button onClick={() => openLog()}>
                      <Plus className="size-4" aria-hidden="true" />
                      Log food
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => copyFromYesterday()}
                      loading={copy.isPending}
                    >
                      <History className="size-4" aria-hidden="true" />
                      Copy from yesterday
                    </Button>
                  </div>
                }
              />
            </div>
          ) : data ? (
            data.slots.map((section) => (
              <MealSection
                key={section.slot.id}
                section={section}
                onAdd={(slotId) => openLog({ slotId })}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onCopyFromYesterday={(slotId) => copyFromYesterday(slotId)}
                onCopyFrom={(slotId) => setCopyRequest({ mode: 'from', slotId })}
                onCopyTo={(slotId) => setCopyRequest({ mode: 'to', slotId })}
                onClear={setClearTarget}
              />
            ))
          ) : null}
          {!empty && data ? (
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-fg-muted"
                onClick={() => setCopyRequest({ mode: 'from' })}
              >
                Copy a whole day here…
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-fg-muted"
                onClick={() => setCopyRequest({ mode: 'to' })}
              >
                Copy this day elsewhere…
              </Button>
            </div>
          ) : null}
        </motion.section>
      </div>

      <button
        type="button"
        onClick={() => openLog()}
        aria-label="Log food"
        className="bg-accent text-accent-fg hover:bg-accent-hover fixed right-5 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full shadow-lg shadow-accent/30 transition-transform active:scale-95 lg:hidden"
      >
        <Plus className="size-7" />
      </button>

      <LogSheet
        open={logOpen}
        onClose={closeLog}
        day={day}
        slots={activeSlots}
        dayKcal={data?.totals.kcal ?? 0}
        initialSlotId={slotParam ? Number(slotParam) : undefined}
        initialFoodId={logFoodId}
        onCreateFood={(name) =>
          void navigate(
            `/foods/new?name=${encodeURIComponent(name)}&returnTo=${encodeURIComponent(`/today/${day}`)}`,
          )
        }
      />

      <EntryEditSheet
        entry={editEntry}
        open={editOpen}
        slots={slots}
        onClose={() => setEditOpen(false)}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />

      <CopySheet
        request={copyRequest}
        day={day}
        slots={slots}
        onClose={() => setCopyRequest(null)}
      />

      <ConfirmDialog
        open={clearTarget !== null}
        onOpenChange={(open) => {
          if (!open) setClearTarget(null);
        }}
        title={clearTarget ? `Clear ${clearTarget.slot.name}?` : 'Clear meal?'}
        description={
          clearTarget
            ? `Removes ${clearTarget.entries.length} ${clearTarget.entries.length === 1 ? 'entry' : 'entries'} from ${clearTarget.slot.name} on ${formatDayLabel(day)}. This cannot be undone.`
            : ''
        }
        confirmLabel="Clear meal"
        destructive
        pending={clearing}
        onConfirm={() => void clearMeal()}
      />
    </>
  );
}

function MealsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="bg-surface border-border rounded-card border">
          <div className="flex items-center justify-between px-4 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-14" />
          </div>
          <div className="border-border border-t px-4 py-3">
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
