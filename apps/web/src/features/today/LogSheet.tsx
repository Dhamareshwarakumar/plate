import {
  pickSlotForTime,
  roundNutrient,
  scaleNutrients,
  timeStringToMinutes,
  type DiaryEntryInput,
  type Food,
  type MealSlot,
  type MealTemplate,
  type OffResult,
} from '@plate/shared';
import { Check, ScanBarcode, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useCreateFood, useFoods, useOffLookup } from '@/features/foods/api';
import { useLogMealTemplate, useMealTemplates } from '@/features/meals/api';
import { BarcodeScannerSheet } from '@/features/scan/BarcodeScannerSheet';
import { useAbout } from '@/features/settings/api';
import { ApiClientError } from '@/lib/api';
import { sameBarcode } from '@/lib/barcode';
import { formatDayLabel, isoAt, nowMinutes } from '@/lib/dates';
import { AdHocStep } from './AdHocStep';
import { useAddEntry } from './api';
import { FoodPicker } from './FoodPicker';
import { writeLastQuantity } from './last-quantity';
import {
  adHocUnitNutrients,
  parsePositive,
  type AdHocFormValues,
  type QuantityFormValues,
  type TemplateLogFormValues,
} from './log-form-schemas';
import { QuantityStep } from './QuantityStep';
import { scannedResultToFoodInput } from './scan-helpers';
import { ScannedStep } from './ScannedStep';
import { TemplateStep } from './TemplateStep';

export interface LogSheetProps {
  open: boolean;
  onClose: () => void;
  day: string;
  /** Active meal slots in order. */
  slots: MealSlot[];
  dayKcal: number;
  /** The day's kcal goal, for the "Day after: x / goal" line; omitted when there is no goal. */
  goalKcal?: number | undefined;
  /** Preselects the meal (launched from "Add to <meal>"). */
  initialSlotId?: number | undefined;
  /** Opens straight at the quantity step for this food (`?log=<id>` after creating it). */
  initialFoodId?: number | undefined;
  /** Opens straight at the review step of this meal template (`?log=t<id>`). */
  initialTemplateId?: number | undefined;
  /** Where "Create as new food" goes; `offCode` is a scanned barcode to keep on the new food. */
  onCreateFood: (name: string, offCode?: string) => void;
}

type Step =
  | { kind: 'pick' }
  | { kind: 'quantity'; food: Food }
  | { kind: 'template'; template: MealTemplate }
  | { kind: 'adhoc'; name: string }
  /** A scanned barcode no library food carries: Open Food Facts product or the ways out. */
  | { kind: 'scanned'; code: string }
  | { kind: 'loading' };

const FORM_ID = 'log-entry-form';
const CHECK_MS = 520;

/** Bottom sheet (phone) / dialog (desktop) that logs an entry in two steps: pick → quantity. */
export function LogSheet(props: LogSheetProps) {
  // Remount the inner sheet on every open so step, search and slot state start fresh, while the
  // same instance stays mounted during the close animation.
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <LogSheetInner key={session} {...props} />;
}

function LogSheetInner({
  open,
  onClose,
  day,
  slots,
  dayKcal,
  goalKcal,
  initialSlotId,
  initialFoodId,
  initialTemplateId,
  onCreateFood,
}: LogSheetProps) {
  const foods = useFoods();
  const templates = useMealTemplates({ enabled: initialTemplateId !== undefined });
  // Whether a scanned code may be looked up online; unknown (still loading) counts as yes.
  const about = useAbout();
  const offEnabled = about.data?.offEnabled !== false;
  const addEntry = useAddEntry();
  const logTemplate = useLogMealTemplate();
  const createFood = useCreateFood();
  const [step, setStep] = useState<Step | null>(null);
  const [query, setQuery] = useState('');
  const [slotId, setSlotId] = useState<number | undefined>(initialSlotId);
  const [done, setDone] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const intent = useRef<'log' | 'log-and-add'>('log');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // `/` focuses the search while the picker is showing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select')) return;
      if (searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const effectiveSlotId = slotId ?? pickSlotForTime(slots, nowMinutes())?.id ?? slots[0]?.id ?? 0;

  const initialFood =
    initialFoodId === undefined ? undefined : foods.data?.find((f) => f.id === initialFoodId);
  const initialTemplate =
    initialTemplateId === undefined
      ? undefined
      : templates.data?.find((t) => t.id === initialTemplateId);
  // A deep link to a food or template that is not in the cache yet (just created, list still
  // refetching) shows the loading step, not the picker, until the fetch settles.
  const effectiveStep: Step =
    step ??
    (initialTemplateId !== undefined
      ? initialTemplate
        ? { kind: 'template', template: initialTemplate }
        : templates.isPending || templates.isFetching
          ? { kind: 'loading' }
          : { kind: 'pick' }
      : initialFoodId === undefined
        ? { kind: 'pick' }
        : initialFood
          ? { kind: 'quantity', food: initialFood }
          : foods.isPending || foods.isFetching
            ? { kind: 'loading' }
            : { kind: 'pick' });

  const finish = () => {
    setDone(true);
    closeTimer.current = setTimeout(onClose, CHECK_MS);
  };

  // The product lookup for the scanned step only; '' keeps the query disabled on every other step.
  const scanLookup = useOffLookup(
    effectiveStep.kind === 'scanned' && offEnabled ? effectiveStep.code : '',
  );

  /** A library food with the code goes straight to quantity; anything else to the scanned step. */
  const onScanned = (code: string) => {
    setScanOpen(false);
    const match = (foods.data ?? []).find((f) => sameBarcode(f.offCode, code));
    if (match) {
      setStep({ kind: 'quantity', food: match });
      return;
    }
    setStep({ kind: 'scanned', code });
  };

  /** "Add to library and log": the product becomes a food (code kept), then on to quantity. */
  const addScannedAndLog = async (result: OffResult) => {
    try {
      const food = await createFood.mutateAsync(scannedResultToFoodInput(result));
      toast.success(`${food.name} added to your library`);
      setStep({ kind: 'quantity', food });
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        const details = err.details as { archived?: boolean } | undefined;
        toast.error(
          details?.archived
            ? `An archived food named “${result.name}” exists. Restore it under Foods (show archived) to log it.`
            : `“${result.name}” is already in your library. Pick it from the list instead.`,
        );
      } else if (err instanceof ApiClientError) {
        toast.error(err.message);
      } else {
        toast.error('Could not save the food. Try again.');
      }
    }
  };

  const submitQuantity = (food: Food, values: QuantityFormValues) => {
    const quantity = parsePositive(values.quantity);
    if (quantity === null) return;
    const chosenSlot = Number(values.slotId);
    const minutes = timeStringToMinutes(values.time) ?? nowMinutes();
    const portion = values.portionLabel
      ? food.portions.find((p) => p.label === values.portionLabel)
      : undefined;
    const count = portion ? parsePositive(values.portionCount) : null;
    const note = values.note.trim();
    const input: DiaryEntryInput = {
      day,
      slotId: chosenSlot,
      loggedAt: isoAt(day, minutes),
      foodId: food.id,
      quantity,
      basis: food.basis,
      portionLabel: portion?.label ?? null,
      portionCount: count,
      note: note === '' ? null : note,
    };
    addEntry.mutate({
      input,
      snapshot: { name: food.name, basis: food.basis, per100: food.per100 },
    });
    writeLastQuantity(food.id, {
      quantity,
      portionLabel: portion?.label ?? null,
      portionCount: count,
    });
    setSlotId(chosenSlot);
    if (intent.current === 'log-and-add') {
      toast.success(`${food.name} logged`);
      setQuery('');
      setStep({ kind: 'pick' });
      return;
    }
    finish();
  };

  const submitTemplate = (template: MealTemplate, values: TemplateLogFormValues) => {
    const amounts = template.items.map(
      (item, index) => parsePositive(values.amounts[index] ?? '') ?? item.amount,
    );
    const chosenSlot = Number(values.slotId);
    const minutes = timeStringToMinutes(values.time) ?? nowMinutes();
    logTemplate.mutate({
      template,
      amounts,
      input: {
        day,
        slotId: chosenSlot,
        loggedAt: isoAt(day, minutes),
        overrides: amounts.flatMap((amount, index) =>
          amount === template.items[index]?.amount ? [] : [{ index, amount }],
        ),
      },
    });
    setSlotId(chosenSlot);
    finish();
  };

  const submitAdHoc = async (values: AdHocFormValues) => {
    const unit = adHocUnitNutrients(values);
    const count = parsePositive(values.count) ?? 1;
    const chosenSlot = Number(values.slotId);
    const minutes = timeStringToMinutes(values.time) ?? nowMinutes();
    const note = values.note.trim();
    const common = {
      day,
      slotId: chosenSlot,
      loggedAt: isoAt(day, minutes),
      portionLabel: values.label.trim(),
      portionCount: count,
      note: note === '' ? null : note,
    };

    if (!values.saveToLibrary) {
      // D50: an ad-hoc "100" is one labelled unit, so quantity = 100 × count reproduces the totals.
      addEntry.mutate({
        input: {
          ...common,
          foodId: null,
          name: values.name,
          per100: unit,
          quantity: 100 * count,
          basis: 'g',
        },
        snapshot: { name: values.name, basis: 'g', per100: unit },
      });
      finish();
      return;
    }

    const weight = parsePositive(values.weight);
    if (weight === null) return;
    const per100 = scaleNutrients(unit, (100 * 100) / weight);
    try {
      const food = await createFood.mutateAsync({
        name: values.name,
        basis: 'g',
        per100,
        portions: [{ label: values.label.trim(), amount: weight }],
      });
      addEntry.mutate({
        input: {
          ...common,
          foodId: food.id,
          quantity: weight * count,
          basis: food.basis,
        },
        snapshot: { name: food.name, basis: food.basis, per100: food.per100 },
      });
      writeLastQuantity(food.id, {
        quantity: weight * count,
        portionLabel: values.label.trim(),
        portionCount: count,
      });
      toast.success(`${food.name} saved to your library`);
      finish();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        toast.error(`“${values.name}” is already in your library. Pick it from the list instead.`);
      } else if (err instanceof ApiClientError && err.code === 'VALIDATION_ERROR') {
        const fieldErrors = err.fieldErrors();
        toast.error(
          Object.keys(fieldErrors).some((k) => k.startsWith('per100.'))
            ? `Check the weight: ${roundNutrient('kcal', per100.kcal)} kcal per 100 g is more than pure fat.`
            : err.message,
        );
      } else {
        toast.error('Could not save the food. Try again.');
      }
    }
  };

  const activeSlots = slots.filter((s) => s.archivedAt === null);
  const current = effectiveStep;

  const header =
    current.kind === 'quantity'
      ? {
          title: current.food.name,
          description: `${current.food.brand ? `${current.food.brand} · ` : ''}${roundNutrient('kcal', current.food.per100.kcal)} kcal per 100 ${current.food.basis}`,
          onBack: () => setStep({ kind: 'pick' }),
        }
      : current.kind === 'template'
        ? {
            title: current.template.name,
            description: `Meal template · ${current.template.items.length} ${current.template.items.length === 1 ? 'item' : 'items'}, amounts editable`,
            onBack: () => setStep({ kind: 'pick' }),
          }
        : current.kind === 'adhoc'
          ? {
              title: 'Quick entry',
              description: `Logged to ${formatDayLabel(day)} without a library food.`,
              onBack: () => setStep({ kind: 'pick' }),
            }
          : current.kind === 'scanned'
            ? {
                title: `Barcode ${current.code}`,
                description: 'Not in your library yet.',
                onBack: () => setStep({ kind: 'pick' }),
              }
            : { title: 'Log food', description: formatDayLabel(day), onBack: undefined };

  const scannedProduct =
    current.kind === 'scanned' && offEnabled ? scanLookup.data?.[0] : undefined;
  // Primary only once it is the sole way forward (no product, lookup off); secondary while the
  // lookup is still running or found something.
  const scanLookupPending = current.kind === 'scanned' && offEnabled && scanLookup.isPending;
  const createManually = (code: string) => (
    <Button
      type="button"
      variant={scannedProduct || scanLookupPending ? 'secondary' : 'primary'}
      onClick={() => onCreateFood(scannedProduct?.name ?? '', code)}
      disabled={createFood.isPending}
    >
      Create food manually
    </Button>
  );

  const footer =
    current.kind === 'quantity' ? (
      <>
        <Button
          type="submit"
          form={FORM_ID}
          variant="secondary"
          onClick={() => {
            intent.current = 'log-and-add';
          }}
          disabled={done}
        >
          Log &amp; add another
        </Button>
        <Button
          type="submit"
          form={FORM_ID}
          onClick={() => {
            intent.current = 'log';
          }}
          disabled={done}
          className="min-w-28"
        >
          Log
        </Button>
      </>
    ) : current.kind === 'template' ? (
      <Button type="submit" form={FORM_ID} disabled={done} className="min-w-28">
        Log {current.template.items.length} {current.template.items.length === 1 ? 'item' : 'items'}
      </Button>
    ) : current.kind === 'adhoc' ? (
      <Button
        type="submit"
        form={FORM_ID}
        loading={createFood.isPending}
        disabled={done}
        className="min-w-28"
      >
        Log
      </Button>
    ) : current.kind === 'scanned' ? (
      <>
        {createManually(current.code)}
        {scannedProduct ? (
          <Button
            type="button"
            onClick={() => void addScannedAndLog(scannedProduct)}
            loading={createFood.isPending}
          >
            Add to library and log
          </Button>
        ) : null}
      </>
    ) : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={header.title}
      description={header.description}
      onBack={header.onBack}
      locked={createFood.isPending || done}
      className="h-[92dvh] sm:h-auto sm:min-h-[32rem] sm:max-w-[40rem]"
      {...(footer ? { footer } : {})}
      headerExtra={
        current.kind === 'pick' ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <label htmlFor="log-slot" className="text-fg-muted shrink-0 text-sm">
                Log to
              </label>
              <Select
                id="log-slot"
                value={String(effectiveSlotId)}
                onChange={(e) => setSlotId(Number(e.target.value))}
                className="h-9 text-sm"
                aria-label="Meal"
              >
                {activeSlots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
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
                  placeholder="Search foods"
                  aria-label="Search foods"
                  autoComplete="off"
                  autoCorrect="off"
                  enterKeyHint="search"
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
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Scan barcode"
                title="Scan barcode"
                onClick={() => setScanOpen(true)}
              >
                <ScanBarcode className="size-5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      {current.kind === 'loading' ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-fg-muted size-6" />
        </div>
      ) : current.kind === 'pick' ? (
        <FoodPicker
          query={query}
          onPick={(food) => setStep({ kind: 'quantity', food })}
          onPickTemplate={(template) => setStep({ kind: 'template', template })}
          onCreate={onCreateFood}
          onAdHoc={() => setStep({ kind: 'adhoc', name: query.trim() })}
        />
      ) : current.kind === 'quantity' ? (
        <QuantityStep
          key={current.food.id}
          formId={FORM_ID}
          food={current.food}
          day={day}
          slots={activeSlots}
          initialSlotId={effectiveSlotId}
          dayKcal={dayKcal}
          goalKcal={goalKcal}
          onSubmit={(values) => submitQuantity(current.food, values)}
        />
      ) : current.kind === 'template' ? (
        <TemplateStep
          key={current.template.id}
          formId={FORM_ID}
          template={current.template}
          day={day}
          slots={activeSlots}
          initialSlotId={effectiveSlotId}
          dayKcal={dayKcal}
          goalKcal={goalKcal}
          onSubmit={(values) => submitTemplate(current.template, values)}
        />
      ) : current.kind === 'scanned' ? (
        <ScannedStep code={current.code} offEnabled={offEnabled} lookup={scanLookup} />
      ) : (
        <AdHocStep
          formId={FORM_ID}
          day={day}
          slots={activeSlots}
          initialSlotId={effectiveSlotId}
          initialName={current.name}
          dayKcal={dayKcal}
          goalKcal={goalKcal}
          onSubmit={(values) => void submitAdHoc(values)}
        />
      )}

      <BarcodeScannerSheet open={scanOpen} onOpenChange={setScanOpen} onDetected={onScanned} />

      {done ? (
        <div
          className="bg-surface/80 absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
        >
          <motion.div
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22 }}
            className="bg-success flex size-16 items-center justify-center rounded-full text-white shadow-lg"
          >
            <Check className="size-8" strokeWidth={3} aria-hidden="true" />
          </motion.div>
          <span className="sr-only">Logged</span>
        </div>
      ) : null}
    </Sheet>
  );
}
