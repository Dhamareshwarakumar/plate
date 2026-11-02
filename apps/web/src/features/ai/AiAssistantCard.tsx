import type { ReactNode } from 'react';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useAbout } from '@/features/settings/api';
import { cn } from '@/lib/cn';
import { useAiUsage } from './api';
import { providerName, providerPhrase } from './provider-label';

const README_URL = 'https://github.com/Dhamareshwarakumar/plate#ai-assistance-optional';

/**
 * More → AI assistant (Phase 11): which provider and model answer, how many requests went out
 * today and over the last 30 days, and in plain words what leaves the server. The one AI surface
 * that renders when the feature is off, because it is where the user learns how to turn it on.
 */
export function AiAssistantCard({ className }: { className?: string }) {
  const about = useAbout();
  const enabled = about.data?.ai.enabled === true;
  const usage = useAiUsage(enabled);

  return (
    <Card className={cn(className)}>
      <CardTitle>AI assistant</CardTitle>
      {about.isPending ? (
        <>
          <Skeleton className="mt-2 h-4 w-40" />
          <Skeleton className="mt-4 h-16 w-full" />
        </>
      ) : about.isError ? (
        <ErrorState
          message={about.error.message}
          onRetry={() => void about.refetch()}
          retrying={about.isFetching}
          className="py-6"
        />
      ) : enabled ? (
        <>
          <CardDescription>
            {providerName(about.data.ai)}
            {about.data.ai.model ? ` · ${about.data.ai.model}` : ''}
          </CardDescription>
          {usage.isPending ? (
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:max-w-sm" aria-busy="true">
              <Stat label="Requests today">
                <Skeleton className="mt-1 h-7 w-10" />
              </Stat>
              <Stat label="Last 30 days">
                <Skeleton className="mt-1 h-7 w-10" />
              </Stat>
            </dl>
          ) : usage.isError ? (
            <div className="bg-surface-2 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-control px-3 py-2 text-sm">
              <span className="text-fg-muted">Could not load the usage counter.</span>
              <button
                type="button"
                onClick={() => void usage.refetch()}
                className="text-accent font-medium"
              >
                Retry
              </button>
            </div>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:max-w-sm">
              <Stat label="Requests today">{usage.data.today.toLocaleString()}</Stat>
              <Stat label="Last 30 days">{usage.data.last30Days.toLocaleString()}</Stat>
            </dl>
          )}
          <p className="text-fg-muted mt-4 text-sm">
            What you type or photograph for these features, a list of your library's food names, and
            for the weekly digest the week's numbers and top foods are sent to{' '}
            {providerPhrase(about.data.ai)}. Nothing else leaves your server, and nothing is saved
            until you confirm it.
          </p>
          {about.data.ai.provider === 'fake' ? (
            <p className="text-fg-faint mt-2 text-xs">
              The fake provider answers with canned data and never calls out; it exists for
              development and screenshots.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <CardDescription>Off</CardDescription>
          <p className="text-fg-muted mt-4 text-sm">
            Describe or photograph a meal to log it, estimate a food's nutrition, paste a recipe
            into a dish, and get a weekly digest. Set <Code>AI_PROVIDER</Code> and{' '}
            <Code>AI_API_KEY</Code> in <Code>.env</Code> on the server and restart Plate; the{' '}
            <a
              href={README_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              README
            </a>{' '}
            explains how to get a Gemini key and what is sent.
          </p>
        </>
      )}
    </Card>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface-2 rounded-control px-3 py-2.5">
      <dt className="text-fg-muted text-xs">{label}</dt>
      <dd className="text-fg tabular text-xl font-semibold">{children}</dd>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="bg-surface-2 text-fg rounded px-1 py-0.5 font-mono text-[0.8125rem]">
      {children}
    </code>
  );
}
