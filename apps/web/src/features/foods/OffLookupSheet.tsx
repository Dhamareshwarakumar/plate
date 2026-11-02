import { OFF_QUERY_MAX, roundNutrient, type OffResult } from '@plate/shared';
import { Globe, Search, SearchX, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useOffLookup } from './api';

const MIN_QUERY = 2;

export interface OffLookupSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Usually the name typed so far; searched as soon as the sheet opens when long enough. */
  initialQuery?: string | undefined;
  /** Called with the chosen result; the sheet closes itself afterwards. */
  onPick: (result: OffResult) => void;
}

/** "Search online" (FR-F5, DESIGN §4.2): Open Food Facts search by name or barcode, through the API. */
export function OffLookupSheet(props: OffLookupSheetProps) {
  // Fresh query state on every open; the same instance stays mounted during the close animation.
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <OffLookupSheetInner key={session} {...props} />;
}

function OffLookupSheetInner({ open, onOpenChange, initialQuery, onPick }: OffLookupSheetProps) {
  const initial = initialQuery ?? '';
  const [query, setQuery] = useState(initial);
  // Explicit submit (Enter / Search): every lookup is a third-party call, so no search-as-you-type.
  const [submitted, setSubmitted] = useState(initial.trim().length >= MIN_QUERY ? initial : '');
  const searchRef = useRef<HTMLInputElement>(null);
  const lookup = useOffLookup(submitted);
  const canSearch = query.trim().length >= MIN_QUERY;
  const hasQuery = submitted.trim().length >= MIN_QUERY;

  const runSearch = () => {
    if (canSearch) setSubmitted(query);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Search online"
      description="Product data from Open Food Facts."
      className="h-[92dvh] sm:h-auto sm:min-h-[32rem] sm:max-w-[40rem]"
      headerExtra={
        // Not a <form>: a submit here would bubble through the React tree into the food editor's form.
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="text-fg-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runSearch();
                }
              }}
              placeholder="Name or barcode"
              aria-label="Search Open Food Facts"
              autoComplete="off"
              autoCorrect="off"
              inputMode="search"
              enterKeyHint="search"
              maxLength={OFF_QUERY_MAX}
              className="pr-10 pl-10"
              data-autofocus
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="text-fg-muted hover:text-fg absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <Button type="button" size="md" onClick={runSearch} disabled={!canSearch}>
            Search
          </Button>
        </div>
      }
      footer={
        <p className="text-fg-faint mr-auto self-center text-xs">
          Powered by{' '}
          <a
            href="https://world.openfoodfacts.org"
            target="_blank"
            rel="noreferrer"
            className="hover:text-fg-muted underline underline-offset-2"
          >
            Open Food Facts
          </a>
        </p>
      }
    >
      {!hasQuery ? (
        <EmptyState
          icon={Globe}
          title="Search Open Food Facts"
          description="Type a product name or the barcode from the package, then press Search."
          className="py-10"
        />
      ) : lookup.isPending ? (
        <div
          className="divide-border flex flex-col divide-y"
          aria-busy="true"
          aria-label="Searching"
        >
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 py-3.5">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : lookup.isError ? (
        <ErrorState
          title="Lookup failed"
          message={lookup.error.message}
          onRetry={() => void lookup.refetch()}
          retrying={lookup.isFetching}
          className="py-10"
        />
      ) : lookup.data.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No products found"
          description={`No results for “${submitted.trim()}”. Try fewer words, or the barcode from the package.`}
          className="py-10"
        />
      ) : (
        <ul className="divide-border -mx-2 divide-y" aria-label="Results">
          {lookup.data.map((result) => {
            const detail = [result.brand, result.quantity].filter(Boolean).join(' · ');
            return (
              <li key={result.code}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(result);
                    onOpenChange(false);
                  }}
                  className="hover:bg-surface-2 focus-visible:bg-surface-2 flex w-full items-center gap-3 rounded-control px-2 py-2.5 text-left outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-fg block truncate font-medium">{result.name}</span>
                    {detail ? (
                      <span className="text-fg-muted mt-0.5 block truncate text-xs">{detail}</span>
                    ) : null}
                  </span>
                  <span className="text-fg tabular shrink-0 text-right text-sm font-semibold">
                    {roundNutrient('kcal', result.per100.kcal)}
                    <span className="text-fg-faint text-xs font-normal"> kcal/100</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
