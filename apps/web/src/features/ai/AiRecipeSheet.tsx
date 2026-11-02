import { AI_RECIPE_TEXT_MAX, type AiRecipeRequest, type AiRecipeResponse } from '@plate/shared';
import { Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/chip';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { useFoods } from '@/features/foods/api';
import { useAbout } from '@/features/settings/api';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatKcal, formatQuantity } from '@/lib/format';
import { useParseRecipe } from './api';
import { providerPhrase } from './provider-label';
import { useElapsedSeconds } from './use-elapsed';

export interface AiRecipeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the parsed recipe; the sheet closes itself afterwards. */
  onApply: (result: AiRecipeResponse) => void;
}

/**
 * "Paste a recipe" (Phase 11, FR-AI3): free text in → a dish name, ingredient lines matched to the
 * library or proposed as new foods, a cooked weight and servings, shown for review before they
 * prefill the dish editor. New foods are created when the dish is saved, not here.
 */
export function AiRecipeSheet(props: AiRecipeSheetProps) {
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <AiRecipeSheetInner key={session} {...props} />;
}

function AiRecipeSheetInner({ open, onOpenChange, onApply }: AiRecipeSheetProps) {
  const about = useAbout();
  const library = useFoods({ includeArchived: true });
  const parse = useParseRecipe();
  const [text, setText] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const lastRequest = useRef<AiRecipeRequest | null>(null);
  const elapsed = useElapsedSeconds(parse.isPending ? startedAt : null);

  const run = (request: AiRecipeRequest) => {
    lastRequest.current = request;
    setStartedAt(Date.now());
    parse.mutate(request);
  };
  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) run({ text: trimmed });
  };

  const result = parse.data;
  const libraryFood = (id: number) => library.data?.find((f) => f.id === id);
  const unresolved = result
    ? result.ingredients.filter((i) => i.matchedFoodId === null && i.suggestedFood === null).length
    : 0;
  const providerLine = about.data ? `Sent to ${providerPhrase(about.data.ai)}.` : null;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Paste a recipe"
      description="Ingredient lines in any unit become raw amounts in grams; you review them first."
      className="h-[92dvh] sm:h-auto sm:min-h-[32rem] sm:max-w-[40rem]"
      footer={
        result ? (
          <>
            <Button type="button" variant="secondary" onClick={() => parse.reset()}>
              Edit text
            </Button>
            <Button
              type="button"
              onClick={() => {
                onApply(result);
                onOpenChange(false);
              }}
            >
              Use recipe
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
              disabled={text.trim() === '' || parse.isPending}
              loading={parse.isPending}
            >
              <Sparkles className="size-4" aria-hidden="true" />
              Parse recipe
            </Button>
          </>
        )
      }
    >
      {parse.isPending ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <p role="status" className="text-fg-muted text-sm">
            Reading the recipe… {elapsed} s
            <span className="text-fg-faint block text-xs">Usually takes 5–15 seconds.</span>
          </p>
          <Skeleton className="h-6 w-40" />
          <ul className="divide-border flex flex-col divide-y" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-4 w-14" />
              </li>
            ))}
          </ul>
        </div>
      ) : parse.isError ? (
        <ErrorState
          title="Could not read the recipe"
          message={
            parse.error instanceof ApiClientError
              ? parse.error.message
              : 'Something went wrong. Try again.'
          }
          onRetry={() => {
            if (lastRequest.current) run(lastRequest.current);
          }}
          className="py-10"
        />
      ) : result ? (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-fg-muted text-xs font-semibold tracking-wide uppercase">Dish</p>
            <p className="text-fg mt-1 text-lg font-semibold">{result.name}</p>
          </div>
          {result.ingredients.length > 0 ? (
            <ul className="divide-border -mx-1 divide-y" aria-label="Ingredients">
              {result.ingredients.map((line, index) => {
                const matched =
                  line.matchedFoodId === null ? undefined : libraryFood(line.matchedFoodId);
                const kcalPer100 = line.suggestedFood?.per100.kcal;
                return (
                  <li key={index} className="flex items-start gap-3 px-1 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-fg truncate text-sm font-medium">{line.description}</p>
                      <div className="text-fg-muted mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                        {line.matchedFoodId !== null ? (
                          <>
                            <span className="truncate">
                              {matched?.name ?? `Food #${line.matchedFoodId}`}
                            </span>
                            <Tag className="shrink-0">Library</Tag>
                          </>
                        ) : line.suggestedFood ? (
                          <>
                            <span className="truncate">
                              {line.suggestedFood.name}
                              {kcalPer100 !== undefined
                                ? ` · ${formatKcal(kcalPer100)} kcal/100 ${line.suggestedFood.basis}`
                                : ''}
                            </span>
                            <Tag className="bg-accent-soft text-accent shrink-0">New food</Tag>
                          </>
                        ) : (
                          <Tag className="bg-under/15 text-under-fg shrink-0">Needs a food</Tag>
                        )}
                      </div>
                    </div>
                    <span className="text-fg tabular shrink-0 text-sm font-medium">
                      {formatQuantity(
                        line.amount,
                        matched?.basis ?? line.suggestedFood?.basis ?? 'g',
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-fg-muted text-sm">No ingredient lines were recognised.</p>
          )}
          <dl className="text-fg-muted grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt>Cooked weight</dt>
            <dd className={cn('tabular text-right', result.cookedWeight !== null && 'text-fg')}>
              {result.cookedWeight !== null
                ? formatQuantity(result.cookedWeight, 'g')
                : 'Not given — weigh the pot'}
            </dd>
            <dt>Servings</dt>
            <dd className={cn('tabular text-right', result.servings !== null && 'text-fg')}>
              {result.servings !== null ? result.servings : 'Not given'}
            </dd>
          </dl>
          <p className="text-fg-faint text-xs">
            New foods are added to your library marked "Estimated" when you save the dish
            {unresolved > 0
              ? `; ${unresolved} ${unresolved === 1 ? 'line needs' : 'lines need'} a food you pick by hand.`
              : '.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <label htmlFor="ai-recipe-text" className="text-fg text-sm font-medium">
            Recipe text
          </label>
          <textarea
            id="ai-recipe-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={AI_RECIPE_TEXT_MAX}
            rows={10}
            placeholder={
              'Dal tadka\n200 g red lentils\n1 tbsp ghee\n1 onion\nsalt to taste\nServes 4'
            }
            autoComplete="off"
            data-autofocus
            className={cn(
              'bg-surface text-fg placeholder:text-fg-faint min-h-48 w-full resize-y rounded-control border px-3.5 py-2.5 text-base',
              'border-border-strong transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-ring/40',
            )}
          />
          <p className="text-fg-faint text-xs">
            Paste the ingredient list; amounts in any unit. A name, the cooked weight and the number
            of servings are picked up when the text mentions them.
          </p>
        </div>
      )}
    </Sheet>
  );
}
