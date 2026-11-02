import { roundNutrient } from '@plate/shared';
import { Barcode, GlobeLock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import type { useOffLookup } from '@/features/foods/api';
import { inferBasis } from './scan-helpers';

export interface ScannedStepProps {
  code: string;
  /** False when the server reports `offEnabled: false`: no lookup runs, the food is created by hand. */
  offEnabled: boolean;
  lookup: ReturnType<typeof useOffLookup>;
}

/**
 * Log flow after a scan that matched nothing in the library: the Open Food Facts product for the
 * code (or why there is none). The actions live in the sheet footer, next to the step's state.
 */
export function ScannedStep({ code, offEnabled, lookup }: ScannedStepProps) {
  if (!offEnabled) {
    return (
      <EmptyState
        icon={GlobeLock}
        title="Not in your library"
        description={`Online lookup is turned off on this server, so Plate cannot fetch the product for barcode ${code}. Create the food from its label; the barcode is kept so the next scan finds it.`}
        className="py-10"
      />
    );
  }
  if (lookup.isPending) {
    return (
      <div
        className="flex flex-col gap-3 py-2"
        aria-busy="true"
        aria-label="Looking up the product"
      >
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-2 h-16 w-full" />
      </div>
    );
  }
  if (lookup.isError) {
    return (
      <ErrorState
        title="Lookup failed"
        message={lookup.error.message}
        onRetry={() => void lookup.refetch()}
        retrying={lookup.isFetching}
        className="py-10"
      />
    );
  }
  const result = lookup.data[0];
  if (!result) {
    return (
      <EmptyState
        icon={Barcode}
        title="Not on Open Food Facts"
        description={`No product has the barcode ${code}. Create the food from its label; the barcode is kept so the next scan finds it.`}
        className="py-10"
      />
    );
  }
  const basis = inferBasis(result.quantity);
  const detail = [result.brand, result.quantity].filter(Boolean).join(' · ');
  const p = result.per100;
  return (
    <div className="flex flex-col gap-4 py-2">
      <div>
        <h3 className="text-fg text-lg font-semibold">{result.name}</h3>
        {detail ? <p className="text-fg-muted mt-0.5 text-sm">{detail}</p> : null}
      </div>
      <dl className="bg-surface-2 grid grid-cols-4 gap-2 rounded-card px-4 py-3 text-center">
        {(
          [
            ['Calories', roundNutrient('kcal', p.kcal), 'kcal'],
            ['Protein', roundNutrient('protein', p.protein), 'g'],
            ['Carbs', roundNutrient('carbs', p.carbs), 'g'],
            ['Fat', roundNutrient('fat', p.fat), 'g'],
          ] as const
        ).map(([label, value, unit]) => (
          <div key={label} className="min-w-0">
            <dt className="text-fg-muted truncate text-xs">{label}</dt>
            <dd className="text-fg tabular mt-0.5 text-sm font-semibold">
              {value}
              <span className="text-fg-faint text-xs font-normal"> {unit}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-fg-muted text-sm">
        Per 100 {basis}. Added as a library food with the barcode, so the next scan logs it
        directly; you can edit or add portions under Foods later.
      </p>
      <p className="text-fg-faint text-xs">
        Data from{' '}
        <a
          href="https://world.openfoodfacts.org"
          target="_blank"
          rel="noreferrer"
          className="hover:text-fg-muted underline underline-offset-2"
        >
          Open Food Facts
        </a>
      </p>
    </div>
  );
}
