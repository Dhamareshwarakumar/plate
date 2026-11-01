import {
  pickSlotForTime,
  roundNutrient,
  scaleNutrients,
  timeStringToMinutes,
  type DiaryEntryInput,
  type Food,
  type MealSlot,
} from '@plate/shared';
import { Check, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useCreateFood, useFoods } from '@/features/foods/api';
import { ApiClientError } from '@/lib/api';
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
} from './log-form-schemas';
import { QuantityStep } from './QuantityStep';

export interface LogSheetProps {
  open: boolean;
  onClose: () => void;
  day: string;
  /** Active meal slots in order. */
  slots: MealSlot[];
  dayKcal: number;
  /** Preselects the meal (launched from "Add to <meal>"). */
  initialSlotId?: number | undefined;
  /** Opens straight at the quantity step for this food (`?log=<id>` after creating it). */
  initialFoodId?: number | undefined;
  /** Where "Create as new food" goes. */
  onCreateFood: (name: string) => void;
}

type Step =
  | { kind: 'pick' }
  | { kind: 'quantity'; food: Food }
  | { kind: 'adhoc'; name: string }
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
  initialSlotId,
  initialFoodId,
  onCreateFood,
}: LogSheetProps) {
  const foods = useFoods();
  const addEntry = useAddEntry();
  const createFood = useCreateFood();
  const [step, setStep] = useState<Step | null>(null);
  const [query, setQuery] = useState('');
  const [slotId, setSlotId] = useState<number | undefined>(initialSlotId);
  const [done, setDone] = useState(false);
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
  const effectiveStep: Step =
    step ??
    (initialFoodId === undefined
      ? { kind: 'pick' }
      : initialFood
        ? { kind: 'quantity', food: initialFood }
        : foods.isPending
          ? { kind: 'loading' }
          : { kind: 'pick' });

  const finish = () => {
    setDone(true);
    closeTimer.current = setTimeout(onClose, CHECK_MS);
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
      : current.kind === 'adhoc'
        ? {
            title: 'Quick entry',
            description: `Logged to ${formatDayLabel(day)} without a library food.`,
            onBack: () => setStep({ kind: 'pick' }),
          }
        : { title: 'Log food', description: formatDayLabel(day), onBack: undefined };

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
            <div className="relative">
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
          onSubmit={(values) => submitQuantity(current.food, values)}
        />
      ) : (
        <AdHocStep
          formId={FORM_ID}
          day={day}
          slots={activeSlots}
          initialSlotId={effectiveSlotId}
          initialName={current.name}
          dayKcal={dayKcal}
          onSubmit={(values) => void submitAdHoc(values)}
        />
      )}

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
