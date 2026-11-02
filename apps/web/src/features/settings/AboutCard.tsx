import type { ReactNode } from 'react';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { formatBytes } from '@/lib/format';
import { useAbout } from './api';

/** More → About (FR-S6): version, database footprint and headline counts from `GET about`. */
export function AboutCard() {
  const about = useAbout();

  return (
    <Card>
      <CardTitle>About</CardTitle>
      <CardDescription>Plate, self-hosted. Your data never leaves your server.</CardDescription>
      {about.isPending ? (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" aria-busy="true">
          {['Version', 'Database', 'Foods', 'Diary entries', 'Days logged'].map((label) => (
            <Row key={label} label={label}>
              <Skeleton className="ml-auto h-4 w-16" />
            </Row>
          ))}
        </dl>
      ) : about.isError ? (
        <ErrorState
          message={about.error.message}
          onRetry={() => void about.refetch()}
          retrying={about.isFetching}
          className="py-6"
        />
      ) : (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <Row label="Version">{about.data.version}</Row>
          <Row label="Database">
            <span className="text-fg-muted">{about.data.dbPath}</span> ·{' '}
            {formatBytes(about.data.dbSizeBytes)}
          </Row>
          <Row label="Foods">{about.data.counts.foods.toLocaleString()}</Row>
          <Row label="Diary entries">{about.data.counts.entries.toLocaleString()}</Row>
          <Row label="Days logged">{about.data.counts.days.toLocaleString()}</Row>
        </dl>
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg tabular text-right">{children}</dd>
    </>
  );
}
