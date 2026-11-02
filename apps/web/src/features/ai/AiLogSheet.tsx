import {
  AI_MAX_IMAGE_BYTES_DEFAULT,
  AI_TEXT_MAX,
  roundNutrient,
  type AiParseMealRequest,
  type DiaryEntryInput,
  type Food,
} from '@plate/shared';
import { Camera, Mic, SearchX, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/chip';
import { NumberField } from '@/components/ui/number-field';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useCreateFood, useFoods } from '@/features/foods/api';
import { FoodPickerSheet } from '@/features/foods/FoodPickerSheet';
import { useAbout } from '@/features/settings/api';
import { useAddEntry } from '@/features/today/api';
import { writeLastQuantity } from '@/features/today/last-quantity';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDayLabel, isoAt, nowMinutes } from '@/lib/dates';
import { formatBytes, formatKcal } from '@/lib/format';
import { useParseMeal } from './api';
import { resizeImageFile, type ResizedImage } from './image';
import { resolvePendingFoods } from './pending-foods';
import { providerPhrase } from './provider-label';
import {
  assignFood,
  itemPer100,
  loggableItems,
  parsePositive,
  reviewTotals,
  toReviewItems,
  type ReviewItem,
} from './review';
import { useDictation } from './use-dictation';
import { useElapsedSeconds } from './use-elapsed';

export interface AiLogSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: string;
  slotId: number;
  slotName: string;
  /** Called after the entries were written; the parent closes the log flow. */
  onLogged: (count: number) => void;
}

/**
 * "Describe or photograph" (Phase 11, FR-AI1): a meal in words and/or a photo goes to the AI
 * provider, which answers with items the user reviews (library match, new food to create, or a
 * food still to pick), edits and then logs in one go. Nothing is written before "Log N items".
 */
export function AiLogSheet(props: AiLogSheetProps) {
  // Fresh text, photo and result on every open; the same instance stays mounted while closing.
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <AiLogSheetInner key={session} {...props} />;
}

interface Review {
  items: ReviewItem[];
  notes: string | null;
  /** True when the model recognised nothing: the empty state rather than an empty list. */
  nothingFound: boolean;
}

function AiLogSheetInner({ open, onOpenChange, day, slotId, slotName, onLogged }: AiLogSheetProps) {
  const about = useAbout();
  const foods = useFoods();
  const parseMeal = useParseMeal();
  const createFood = useCreateFood();
  const addEntry = useAddEntry();

  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<ResizedImage | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastRequest = useRef<AiParseMealRequest | null>(null);
  const elapsed = useElapsedSeconds(parseMeal.isPending ? startedAt : null);
  const dictation = useDictation((spoken) =>
    setText((current) => (current.trim() ? `${current.trimEnd()} ${spoken}` : spoken)),
  );

  // Object URLs are released when the photo changes or the sheet unmounts.
  const previewUrl = photo?.previewUrl;
  useEffect(() => () => (previewUrl ? URL.revokeObjectURL(previewUrl) : undefined), [previewUrl]);

  const phase: 'compose' | 'analysing' | 'error' | 'empty' | 'review' = review
    ? review.nothingFound
      ? 'empty'
      : 'review'
    : parseMeal.isPending
      ? 'analysing'
      : parseMeal.isError
        ? 'error'
        : 'compose';

  const canAnalyse = text.trim().length > 0 || photo !== null;

  const analyse = (request: AiParseMealRequest) => {
    lastRequest.current = request;
    setStartedAt(Date.now());
    setLogError(null);
    parseMeal.mutate(request, {
      onSuccess: (result) => {
        setReview({
          items: toReviewItems(result.items, foods.data ?? []),
          notes: result.notes,
          nothingFound: result.items.length === 0,
        });
      },
    });
  };

  const submitCompose = () => {
    if (!canAnalyse) return;
    const trimmed = text.trim();
    analyse({
      ...(trimmed ? { text: trimmed } : {}),
      ...(photo ? { image: { mimeType: photo.mimeType, base64: photo.base64 } } : {}),
      day,
      slotId,
    });
  };

  const backToCompose = () => {
    setReview(null);
    parseMeal.reset();
  };

  const onPhotoPicked = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const resized = await resizeImageFile(file);
      if (resized.bytes > AI_MAX_IMAGE_BYTES_DEFAULT) {
        URL.revokeObjectURL(resized.previewUrl);
        setPhotoError(
          `The photo is still ${formatBytes(resized.bytes)} after resizing; the limit is ${formatBytes(AI_MAX_IMAGE_BYTES_DEFAULT)}.`,
        );
        return;
      }
      setPhoto(resized);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not read this photo.');
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const updateItems = (update: (items: ReviewItem[]) => ReviewItem[]) =>
    setReview((current) => (current ? { ...current, items: update(current.items) } : current));

  const loggable = review ? loggableItems(review.items) : [];
  const totals = review ? reviewTotals(review.items) : null;

  const logItems = async () => {
    if (!review || loggable.length === 0) return;
    setLogging(true);
    setLogError(null);
    const logged: string[] = [];
    try {
      // 1. Create the foods the model proposed (source 'ai'), reusing names that already exist.
      const createdFoods = new Map<number, Food>();
      const resolved = await resolvePendingFoods(
        loggable.map((item) => ({
          item,
          foodId: item.food?.id ?? null,
          pending: item.food ? null : item.suggestedFood,
        })),
        async (input) => {
          const food = await createFood.mutateAsync(input);
          createdFoods.set(food.id, food);
          return food;
        },
      );
      // 2. Log the entries one by one so the optimistic day cache stays consistent.
      for (const row of resolved) {
        const { item } = row;
        const food = row.item.food ?? createdFoods.get(row.foodId) ?? null;
        const quantity = parsePositive(item.quantityText)!;
        const snapshot = food
          ? { name: food.name, basis: food.basis, per100: food.per100 }
          : {
              name: item.suggestedFood?.name ?? item.description,
              basis: item.basis,
              per100: itemPer100(item)!,
            };
        const input: DiaryEntryInput = {
          day,
          slotId,
          loggedAt: isoAt(day, nowMinutes()),
          foodId: row.foodId,
          quantity,
          basis: snapshot.basis,
          portionLabel: null,
          portionCount: null,
          note: null,
        };
        try {
          await addEntry.mutateAsync({ input, snapshot });
        } catch {
          // `useAddEntry` already toasted the server's message; keep the unlogged rows for a retry.
          setLogError(
            `“${snapshot.name}” was not logged${logged.length > 0 ? '; the items above it were' : ''}. Try again to log the rest.`,
          );
          updateItems((items) => items.filter((i) => !logged.includes(i.key)));
          return;
        }
        writeLastQuantity(row.foodId, { quantity, portionLabel: null, portionCount: null });
        logged.push(item.key);
      }
      toast.success(`${logged.length} ${logged.length === 1 ? 'item' : 'items'} logged`);
      onLogged(logged.length);
    } catch (err) {
      // A food could not be created: nothing was logged yet, the review stays as it is.
      toast.error(err instanceof Error ? err.message : 'Could not save the new foods. Try again.');
    } finally {
      setLogging(false);
    }
  };

  const pickTarget = pickFor ? review?.items.find((i) => i.key === pickFor) : undefined;
  const providerLine = about.data ? `Sent to ${providerPhrase(about.data.ai)} for analysis.` : null;

  const header =
    phase === 'review' || phase === 'empty'
      ? {
          title: phase === 'review' ? 'Review items' : 'Describe or photograph',
          description: `Logging to ${slotName} · ${formatDayLabel(day)}`,
          onBack: backToCompose,
        }
      : phase === 'error'
        ? {
            title: 'Describe or photograph',
            description: `Logging to ${slotName} · ${formatDayLabel(day)}`,
            onBack: backToCompose,
          }
        : {
            title: 'Describe or photograph',
            description: `Logging to ${slotName} · ${formatDayLabel(day)}`,
            onBack: undefined,
          };

  const footer =
    phase === 'compose' ? (
      <>
        {providerLine ? (
          <p className="text-fg-faint mr-auto self-center text-xs">{providerLine}</p>
        ) : null}
        <Button type="button" onClick={submitCompose} disabled={!canAnalyse || photoBusy}>
          <Sparkles className="size-4" aria-hidden="true" />
          Analyse
        </Button>
      </>
    ) : phase === 'review' ? (
      <>
        <Button type="button" variant="secondary" onClick={backToCompose} disabled={logging}>
          Edit description
        </Button>
        <Button
          type="button"
          onClick={() => void logItems()}
          loading={logging}
          disabled={loggable.length === 0}
          className="min-w-32"
        >
          Log {loggable.length} {loggable.length === 1 ? 'item' : 'items'}
        </Button>
      </>
    ) : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={header.title}
      description={header.description}
      onBack={header.onBack}
      locked={logging}
      className="h-[92dvh] sm:h-auto sm:min-h-[32rem] sm:max-w-[40rem]"
      {...(footer ? { footer } : {})}
    >
      {phase === 'compose' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ai-meal-text" className="text-fg text-sm font-medium">
              What did you eat?
            </label>
            <textarea
              id="ai-meal-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={AI_TEXT_MAX}
              rows={4}
              placeholder="2 rotis, a bowl of dal and a banana"
              autoComplete="off"
              enterKeyHint="send"
              data-autofocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitCompose();
                }
              }}
              className={cn(
                'bg-surface text-fg placeholder:text-fg-faint min-h-28 w-full resize-none rounded-control border px-3.5 py-2.5 text-base',
                'border-border-strong transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-ring/40',
              )}
            />
            <p className="text-fg-faint text-xs">
              Portions in your own words are fine ("a bowl", "two slices"); the model turns them
              into grams you can edit.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {dictation.supported ? (
              <Button
                type="button"
                variant={dictation.listening ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={dictation.listening}
                onClick={dictation.listening ? dictation.stop : dictation.start}
                className={cn(dictation.listening && 'text-danger')}
              >
                <Mic
                  className={cn('size-4', dictation.listening && 'animate-pulse')}
                  aria-hidden="true"
                />
                {dictation.listening ? 'Listening… tap to stop' : 'Dictate'}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              loading={photoBusy}
            >
              <Camera className="size-4" aria-hidden="true" />
              {photo ? 'Replace photo' : 'Add photo'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Meal photo"
              tabIndex={-1}
              onChange={(e) => void onPhotoPicked(e.target.files?.[0])}
            />
          </div>
          {dictation.error ? (
            <p role="alert" className="text-danger text-sm">
              {dictation.error}
            </p>
          ) : null}
          {photoError ? (
            <p role="alert" className="text-danger text-sm">
              {photoError}
            </p>
          ) : null}

          {photo ? (
            <div className="bg-surface-2 flex items-center gap-3 rounded-card p-2.5">
              <img
                src={photo.previewUrl}
                alt="Meal photo to analyse"
                className="size-18 shrink-0 rounded-control object-cover"
              />
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-fg font-medium">Photo attached</p>
                <p className="text-fg-muted text-xs">
                  Resized to a JPEG of {formatBytes(photo.bytes)} before upload.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove photo"
                onClick={() => setPhoto(null)}
              >
                <X className="size-5" />
              </Button>
            </div>
          ) : null}
        </div>
      ) : phase === 'analysing' ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <p role="status" className="text-fg-muted text-sm">
            Analysing… {elapsed} s
            <span className="text-fg-faint block text-xs">Usually takes 5–15 seconds.</span>
          </p>
          <ul className="divide-border flex flex-col divide-y" aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 py-3.5">
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-11 w-24" />
              </li>
            ))}
          </ul>
        </div>
      ) : phase === 'error' ? (
        <ErrorState
          title="Could not analyse the meal"
          message={
            parseMeal.error instanceof ApiClientError
              ? parseMeal.error.message
              : 'Something went wrong. Try again.'
          }
          onRetry={() => {
            if (lastRequest.current) analyse(lastRequest.current);
          }}
          className="py-10"
        />
      ) : phase === 'empty' ? (
        <EmptyState
          icon={SearchX}
          title="Nothing recognised"
          description={
            review?.notes ??
            'The model found no food in the description or photo. Add a few words about what you ate.'
          }
          className="py-10"
          action={
            <Button type="button" variant="secondary" onClick={backToCompose}>
              Edit description
            </Button>
          }
        />
      ) : review ? (
        <div className="flex flex-col gap-3">
          {review.items.length > 0 ? (
            <ul className="divide-border -mx-1 divide-y" aria-label="Recognised items">
              {review.items.map((item) => (
                <ReviewRow
                  key={item.key}
                  item={item}
                  disabled={logging}
                  onQuantity={(quantityText) =>
                    updateItems((items) =>
                      items.map((i) => (i.key === item.key ? { ...i, quantityText } : i)),
                    )
                  }
                  onPick={() => setPickFor(item.key)}
                  onRemove={() => updateItems((items) => items.filter((i) => i.key !== item.key))}
                />
              ))}
            </ul>
          ) : (
            <p className="text-fg-muted border-border rounded-card border border-dashed px-4 py-6 text-center text-sm">
              Every item was removed. Go back to edit the description.
            </p>
          )}
          {logError ? (
            <p role="alert" className="text-danger text-sm">
              {logError}
            </p>
          ) : null}
          {review.notes ? (
            <p className="text-fg-muted text-xs">
              <span className="text-fg font-medium">Model notes:</span> {review.notes}
            </p>
          ) : null}
          {totals ? (
            <p className="text-fg-muted tabular text-sm" aria-live="polite">
              {loggable.length} {loggable.length === 1 ? 'item' : 'items'} ·{' '}
              <span className="text-fg font-medium">{formatKcal(totals.kcal)} kcal</span> ·{' '}
              <span className="text-protein">P {roundNutrient('protein', totals.protein)}</span>{' '}
              <span className="text-carbs">C {roundNutrient('carbs', totals.carbs)}</span>{' '}
              <span className="text-fat">F {roundNutrient('fat', totals.fat)}</span>
            </p>
          ) : null}
          <p className="text-fg-faint text-xs">
            Estimated values are the model's; new foods are saved to your library marked "Estimated"
            so you can verify them later.
          </p>
        </div>
      ) : null}

      <FoodPickerSheet
        open={pickTarget !== undefined}
        onOpenChange={(next) => {
          if (!next) setPickFor(null);
        }}
        title="Pick a food"
        {...(pickTarget ? { description: `For “${pickTarget.description}”` } : {})}
        onPick={(food) => {
          if (!pickFor) return;
          updateItems((items) => items.map((i) => (i.key === pickFor ? assignFood(i, food) : i)));
        }}
      />
    </Sheet>
  );
}

const CONFIDENCE_CLASS = {
  low: 'bg-over/15 text-over-fg',
  medium: 'bg-surface-2 text-fg-muted',
  high: 'bg-on-target/15 text-on-target-fg',
} as const;

interface ReviewRowProps {
  item: ReviewItem;
  disabled: boolean;
  onQuantity: (text: string) => void;
  onPick: () => void;
  onRemove: () => void;
}

/** One recognised item: what the model saw, what it will log against, the editable quantity. */
function ReviewRow({ item, disabled, onQuantity, onPick, onRemove }: ReviewRowProps) {
  const per100 = itemPer100(item);
  const quantity = parsePositive(item.quantityText);
  const kcal = per100 && quantity !== null ? (per100.kcal * quantity) / 100 : null;
  const invalidQuantity = item.quantityText.trim() !== '' && quantity === null;
  return (
    <li className="flex flex-col gap-2 px-1 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-fg truncate font-medium">{item.description}</p>
          <div className="text-fg-muted mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            {item.state === 'matched' && item.food ? (
              <>
                <span className="truncate">{item.food.name}</span>
                <Tag className="shrink-0">Library</Tag>
              </>
            ) : item.state === 'new' && item.suggestedFood ? (
              <>
                <span className="truncate">{item.suggestedFood.name}</span>
                <Tag className="bg-accent-soft text-accent shrink-0">Estimated, new food</Tag>
              </>
            ) : (
              <Tag className="bg-under/15 text-under-fg shrink-0">Needs a food</Tag>
            )}
            <Tag className={cn('shrink-0', CONFIDENCE_CLASS[item.confidence])}>
              {item.confidence} confidence
            </Tag>
          </div>
        </div>
        <div className="w-28 shrink-0">
          <NumberField
            aria-label={`${item.description} quantity in ${item.basis}`}
            suffix={item.basis}
            value={item.quantityText}
            onChange={(e) => onQuantity(e.target.value)}
            invalid={invalidQuantity}
            disabled={disabled}
            enterKeyHint="done"
          />
          {kcal !== null ? (
            <p className="text-fg-muted tabular mt-1 text-right text-xs">
              <span className="text-fg font-medium">{formatKcal(kcal)}</span> kcal
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove ${item.description}`}
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 className="text-fg-muted size-4" />
        </Button>
      </div>
      {item.state === 'needs_food' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onPick}
          disabled={disabled}
        >
          Pick a food
        </Button>
      ) : null}
    </li>
  );
}
