import { formatDistanceToNow, parseISO } from 'date-fns';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useAbout } from '@/features/settings/api';
import { ApiClientError } from '@/lib/api';
import { useGenerateWeeklyDigest, useWeeklyDigest } from './api';
import { providerPhrase } from './provider-label';
import { useElapsedSeconds } from './use-elapsed';

export interface WeeklyDigestCardProps {
  /** First day of the week shown in Insights (per the week-start setting). */
  weekStart: string;
}

/**
 * Insights → Week → "Weekly digest" (Phase 11, FR-AI4): a few plain sentences about the week from
 * the numbers Insights already computed, generated on request and cached per week on the server.
 * The cached digest shows at once; Regenerate spends a new request.
 */
export function WeeklyDigestCard({ weekStart }: WeeklyDigestCardProps) {
  const about = useAbout();
  const cached = useWeeklyDigest(weekStart, true);
  const generate = useGenerateWeeklyDigest();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const elapsed = useElapsedSeconds(generate.isPending ? startedAt : null);

  const run = (refresh: boolean) => {
    setStartedAt(Date.now());
    generate.mutate({ weekStart, refresh });
  };
  const providerLine = about.data ? providerPhrase(about.data.ai) : 'the AI provider';

  if (cached.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (cached.isError) {
    return (
      <ErrorState
        title="Could not load the digest"
        message={cached.error.message}
        onRetry={() => void cached.refetch()}
        retrying={cached.isFetching}
        className="py-6"
      />
    );
  }
  if (generate.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <p role="status" className="text-fg-muted text-sm">
          Writing the digest… {elapsed} s
          <span className="text-fg-faint block text-xs">Usually takes 5–15 seconds.</span>
        </p>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (generate.isError) {
    return (
      <ErrorState
        title="Could not write the digest"
        message={
          generate.error instanceof ApiClientError
            ? generate.error.message
            : 'Something went wrong. Try again.'
        }
        onRetry={() => run(generate.variables?.refresh ?? false)}
        className="py-6"
      />
    );
  }

  const digest = cached.data;
  if (!digest) {
    return (
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-fg-muted text-sm">
          A few sentences on how the week went and one thing to try next week. Sends this week's
          totals, per-day numbers and top foods to {providerLine}.
        </p>
        <Button type="button" className="shrink-0" onClick={() => run(false)}>
          <Sparkles className="size-4" aria-hidden="true" />
          Generate
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="text-fg flex flex-col gap-2 text-sm">
        {digest.lines.map((line, index) => (
          <li key={index} className="flex gap-2.5">
            <span className="bg-accent mt-2 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="bg-accent-soft text-accent rounded-control px-3 py-2.5 text-sm">
        <span className="font-semibold">Next week:</span> {digest.suggestion}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-faint text-xs">
          Generated {formatDistanceToNow(parseISO(digest.generatedAt), { addSuffix: true })} ·{' '}
          {digest.model}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => run(true)}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Regenerate
        </Button>
      </div>
    </div>
  );
}
