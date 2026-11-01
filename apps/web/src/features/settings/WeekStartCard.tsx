import { DEFAULT_SETTINGS, type WeekStart } from '@plate/shared';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useSettings, useUpdateSettings } from './api';

const OPTIONS = [
  { value: 'monday', label: 'Monday' },
  { value: 'sunday', label: 'Sunday' },
] as const satisfies readonly { value: WeekStart; label: string }[];

/** More → Week start (FR-S2): the day strip, calendar and weekly insights start here. */
export function WeekStartCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  return (
    <Card>
      <CardTitle>Week starts on</CardTitle>
      <CardDescription>Shapes the day strip, the calendar and weekly insights.</CardDescription>
      {settings.isPending ? (
        <Skeleton className="mt-4 h-11" />
      ) : settings.isError ? (
        <ErrorState
          message={settings.error.message}
          onRetry={() => void settings.refetch()}
          retrying={settings.isFetching}
          className="py-6"
        />
      ) : (
        <Segmented
          className="mt-4"
          aria-label="Week starts on"
          value={settings.data.weekStart ?? DEFAULT_SETTINGS.weekStart}
          onChange={(weekStart) => update.mutate({ weekStart })}
          options={OPTIONS}
        />
      )}
    </Card>
  );
}
