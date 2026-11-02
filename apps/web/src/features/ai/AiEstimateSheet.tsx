import {
  AI_DESCRIPTION_MAX,
  OPTIONAL_NUTRIENT_KEYS,
  roundNutrient,
  type AiEstimateFoodRequest,
  type AiEstimateFoodResponse,
} from '@plate/shared';
import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useAbout } from '@/features/settings/api';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatQuantity } from '@/lib/format';
import { useEstimateFood } from './api';
import { providerPhrase } from './provider-label';
import { useElapsedSeconds } from './use-elapsed';

export interface AiEstimateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The name (and brand) typed in the editor so far. */
  name: string;
  brand: string;
  /** Called with the accepted estimate; the sheet closes itself afterwards. */
  onApply: (result: AiEstimateFoodResponse) => void;
}

/**
 * "Estimate with AI" (Phase 11, FR-AI2): label-style per-100 values for the named food, shown with
 * the model's confidence and reasoning before anything lands in the form (confirm-first, like the
 * Open Food Facts sheet).
 */
export function AiEstimateSheet(props: AiEstimateSheetProps) {
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <AiEstimateSheetInner key={session} {...props} />;
}

const OPTIONAL_LABELS: Record<(typeof OPTIONAL_NUTRIENT_KEYS)[number], string> = {
  fiber: 'Fiber',
  sugar: 'Sugar',
  saturatedFat: 'Saturated fat',
  sodiumMg: 'Sodium',
};

const CONFIDENCE_CLASS = {
  low: 'bg-over/15 text-over-fg',
  medium: 'bg-surface-2 text-fg-muted',
  high: 'bg-on-target/15 text-on-target-fg',
} as const;

function AiEstimateSheetInner({ open, onOpenChange, name, brand, onApply }: AiEstimateSheetProps) {
  const about = useAbout();
  const estimate = useEstimateFood();
  const [hint, setHint] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const lastRequest = useRef<AiEstimateFoodRequest | null>(null);
  const elapsed = useElapsedSeconds(estimate.isPending ? startedAt : null);
  const trimmedName = name.trim();
  const trimmedBrand = brand.trim();

  const run = (request: AiEstimateFoodRequest) => {
    lastRequest.current = request;
    setStartedAt(Date.now());
    estimate.mutate(request);
  };
  const submit = () => {
    if (!trimmedName) return;
    const description = hint.trim();
    run({
      name: trimmedName,
      ...(trimmedBrand ? { brand: trimmedBrand } : {}),
      ...(description ? { description } : {}),
    });
  };

  const result = estimate.data;
  const providerLine = about.data ? `Sent to ${providerPhrase(about.data.ai)}.` : null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Estimate with AI"
      description={`Typical label values for “${trimmedName}”${trimmedBrand ? ` by ${trimmedBrand}` : ''}.`}
      className="sm:max-w-[36rem]"
      footer={
        result ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                estimate.reset();
              }}
            >
              Change hint
            </Button>
            <Button
              type="button"
              onClick={() => {
                onApply(result);
                onOpenChange(false);
              }}
            >
              Use these values
            </Button>
          </>
        ) : (
          <>
            {providerLine ? (
              <p className="text-fg-faint mr-auto self-center text-xs">{providerLine}</p>
            ) : null}
            <Button
              type="button"
              onClick={submit}
              disabled={!trimmedName || estimate.isPending}
              loading={estimate.isPending}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Estimate
            </Button>
          </>
        )
      }
    >
      {estimate.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <p role="status" className="text-fg-muted text-sm">
            Estimating… {elapsed} s
            <span className="text-fg-faint block text-xs">Usually takes a few seconds.</span>
          </p>
          <div className="grid grid-cols-2 gap-3" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="bg-surface-2 rounded-card flex flex-col gap-2 p-3">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))}
          </div>
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : estimate.isError ? (
        <ErrorState
          title="Could not estimate"
          message={
            estimate.error instanceof ApiClientError
              ? estimate.error.message
              : 'Something went wrong. Try again.'
          }
          onRetry={() => {
            if (lastRequest.current) run(lastRequest.current);
          }}
          className="py-8"
        />
      ) : result ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Value label="Calories" value={roundNutrient('kcal', result.per100.kcal)} unit="kcal" />
            <Value
              label="Protein"
              value={roundNutrient('protein', result.per100.protein)}
              unit="g"
              className="text-protein"
            />
            <Value
              label="Carbs"
              value={roundNutrient('carbs', result.per100.carbs)}
              unit="g"
              className="text-carbs"
            />
            <Value
              label="Fat"
              value={roundNutrient('fat', result.per100.fat)}
              unit="g"
              className="text-fat"
            />
            {OPTIONAL_NUTRIENT_KEYS.flatMap((key) => {
              const value = result.per100[key];
              return value === null
                ? []
                : [
                    <Value
                      key={key}
                      label={OPTIONAL_LABELS[key]}
                      value={roundNutrient(key, value)}
                      unit={key === 'sodiumMg' ? 'mg' : 'g'}
                    />,
                  ];
            })}
          </div>
          <p className="text-fg-muted text-xs">Per 100 {result.basis}.</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag className={CONFIDENCE_CLASS[result.confidence]}>
              {result.confidence} confidence
            </Tag>
            {result.portions.map((portion) => (
              <Tag key={portion.label}>
                {portion.label} = {formatQuantity(portion.amount, result.basis)}
              </Tag>
            ))}
          </div>
          {result.rationale ? <p className="text-fg text-sm">{result.rationale}</p> : null}
          <p className="text-fg-faint text-xs">
            An estimate, not a label. The food is marked "Estimated" in your library until you edit
            the values.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field
            label="Anything that helps?"
            description="Optional: homemade, with coconut, restaurant style, a serving size you know."
          >
            {(c) => (
              <Input
                id={c.id}
                aria-describedby={c['aria-describedby']}
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                maxLength={AI_DESCRIPTION_MAX}
                autoComplete="off"
                enterKeyHint="send"
                data-autofocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            )}
          </Field>
          <p className="text-fg-muted text-sm">
            The model answers with per-100 values, typical portions and how sure it is. You review
            them before they fill the form, and nothing is saved until you save the food.
          </p>
        </div>
      )}
    </Sheet>
  );
}

function Value({
  label,
  value,
  unit,
  className,
}: {
  label: string;
  value: number;
  unit: string;
  className?: string;
}) {
  return (
    <div className="bg-surface-2 rounded-card flex flex-col px-3 py-2.5">
      <span className="text-fg-muted text-xs">{label}</span>
      <span className={cn('text-fg tabular text-lg font-semibold', className)}>
        {value.toLocaleString()}
        <span className="text-fg-faint text-xs font-normal"> {unit}</span>
      </span>
    </div>
  );
}
