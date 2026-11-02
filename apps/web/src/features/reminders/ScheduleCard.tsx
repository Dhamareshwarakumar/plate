import {
  minutesToTimeString,
  sameTimeZone,
  timeStringToMinutes,
  type MealReminder,
  type Reminders,
} from '@plate/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { useMealSlots } from '@/features/today/api';
import { cn } from '@/lib/cn';
import { reminderKeys } from '@/lib/query-keys';
import { usePushDevices, useReminders, useUpdateReminders } from './api';
import { deviceTimeZone } from './push-support';

/**
 * More → Reminders, the schedule (FR-N1): master switch, one row per active meal slot (time,
 * "only if nothing is logged"), weigh-in and water nudges, and the zone the times are in. Every
 * change saves at once (optimistic, like the other settings cards).
 */
export function ScheduleCard() {
  const reminders = useReminders();
  const slots = useMealSlots();
  const devices = usePushDevices();
  const update = useUpdateReminders();
  const queryClient = useQueryClient();
  const titleId = useId();
  const zone = deviceTimeZone();

  const save = (change: (current: Reminders) => Reminders) => {
    // Start from the cache, not the render: two quick edits must build on each other even before
    // the first optimistic update has re-rendered.
    const current = queryClient.getQueryData<Reminders>(reminderKeys.all) ?? reminders.data;
    if (!current) return;
    const next = change(current);
    // Times are stored with the zone they were set in; the first save takes this device's.
    update.mutate({ ...next, timezone: next.timezone ?? zone });
  };
  const saveMeal = (slotId: number, patch: Partial<MealReminder>) =>
    save((c) => ({
      ...c,
      meals: c.meals.map((m) => (m.slotId === slotId ? { ...m, ...patch } : m)),
    }));

  if (reminders.isPending || slots.isPending) {
    return (
      <Card aria-busy="true">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <CardTitle>Reminders</CardTitle>
            <Skeleton className="mt-2 h-4 w-3/4" />
          </div>
          <Skeleton className="h-7 w-12 rounded-full" />
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      </Card>
    );
  }

  if (reminders.isError || slots.isError) {
    const failed = reminders.isError ? reminders : slots;
    return (
      <Card className="p-0">
        <ErrorState
          message={failed.error?.message ?? 'Could not load the reminders.'}
          onRetry={() => {
            void reminders.refetch();
            void slots.refetch();
          }}
          retrying={reminders.isFetching || slots.isFetching}
        />
      </Card>
    );
  }

  const config = reminders.data;
  const slotById = new Map(slots.data.map((s) => [s.id, s]));
  const meals = config.meals.filter((m) => slotById.has(m.slotId));
  const deviceCount = devices.data?.length;
  const savedZone = config.timezone;

  const status = !config.enabled
    ? 'Off. Turn on to get a nudge for meals you have not logged, weigh-ins and water.'
    : deviceCount === 0
      ? 'On, but no device gets them yet. Enable one below.'
      : deviceCount === undefined
        ? 'On.'
        : `On · ${deviceCount} ${deviceCount === 1 ? 'device' : 'devices'}.`;

  return (
    <Card className="p-0">
      <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <CardTitle id={titleId}>Reminders</CardTitle>
          <CardDescription aria-live="polite">{status}</CardDescription>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(enabled) => save((c) => ({ ...c, enabled }))}
          aria-labelledby={titleId}
        />
      </div>

      <div className={cn(!config.enabled && 'opacity-70')}>
        <Section title="Meals">
          {meals.length === 0 ? (
            <p className="text-fg-muted px-4 pb-3 text-sm sm:px-5">
              No active meal slots. Add one under More → Meal slots.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {meals.map((meal) => {
                const slot = slotById.get(meal.slotId)!;
                return (
                  <ReminderRow
                    key={meal.slotId}
                    label={slot.name}
                    enabled={meal.enabled}
                    minute={meal.minute}
                    onEnabled={(enabled) => saveMeal(slot.id, { enabled })}
                    onMinute={(minute) => saveMeal(slot.id, { minute })}
                  >
                    <label className="text-fg-muted flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="accent-accent size-4"
                        checked={meal.onlyIfEmpty}
                        disabled={!meal.enabled}
                        onChange={(e) => saveMeal(slot.id, { onlyIfEmpty: e.target.checked })}
                      />
                      Only if nothing is logged in this meal
                    </label>
                  </ReminderRow>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Body and water">
          <ul className="divide-border divide-y">
            <ReminderRow
              label="Weigh-in"
              enabled={config.weighIn.enabled}
              minute={config.weighIn.minute}
              onEnabled={(enabled) => save((c) => ({ ...c, weighIn: { ...c.weighIn, enabled } }))}
              onMinute={(minute) => save((c) => ({ ...c, weighIn: { ...c.weighIn, minute } }))}
            >
              <p className="text-fg-muted text-xs">Only when no weight is logged for the day.</p>
            </ReminderRow>
            <ReminderRow
              label="Water"
              enabled={config.water.enabled}
              minute={config.water.minute}
              onEnabled={(enabled) => save((c) => ({ ...c, water: { ...c.water, enabled } }))}
              onMinute={(minute) => save((c) => ({ ...c, water: { ...c.water, minute } }))}
            >
              <p className="text-fg-muted text-xs">
                Only when you are below the water goal; needs a goal with a water target.
              </p>
            </ReminderRow>
          </ul>
        </Section>
      </div>

      <footer className="border-border text-fg-muted flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-3 text-xs sm:px-5">
        <span>
          Times are in <span className="text-fg font-medium">{savedZone ?? zone}</span>
          {savedZone === null ? ' (this device)' : ''}.
        </span>
        {savedZone !== null && !sameTimeZone(savedZone, zone) ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-xs"
            onClick={() => save((c) => ({ ...c, timezone: zone }))}
          >
            Use {zone}, this device&apos;s zone
          </Button>
        ) : null}
      </footer>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-border border-t">
      <h3 className="text-fg-muted px-4 pt-3 pb-1 text-xs font-semibold tracking-wide uppercase sm:px-5">
        {title}
      </h3>
      {children}
    </section>
  );
}

interface ReminderRowProps {
  label: string;
  enabled: boolean;
  minute: number;
  onEnabled: (enabled: boolean) => void;
  onMinute: (minute: number) => void;
  /** Second line: the condition this reminder is subject to. */
  children: ReactNode;
}

function ReminderRow({ label, enabled, minute, onEnabled, onMinute, children }: ReminderRowProps) {
  const labelId = useId();
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      <div className="flex min-h-9 items-center gap-3">
        <Switch checked={enabled} onCheckedChange={onEnabled} aria-labelledby={labelId} />
        <span id={labelId} className="text-fg min-w-0 flex-1 truncate text-sm font-medium">
          {label}
        </span>
        <Input
          type="time"
          value={minutesToTimeString(minute)}
          disabled={!enabled}
          aria-label={`${label} reminder time`}
          className="tabular h-9 w-36 shrink-0 px-2 text-sm"
          onChange={(e) => {
            // Browsers emit "" while a segment is still being typed; the saved time stays until
            // the value is complete.
            const next = timeStringToMinutes(e.target.value);
            if (next !== null && next !== minute) onMinute(next);
          }}
        />
      </div>
      <div className="pl-15">{children}</div>
    </li>
  );
}
