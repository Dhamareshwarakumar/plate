import { macroPercentOfKcal, macroTargetsFromPreset, type Goal, type Profile } from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Calculator, ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NumberField, parseDecimal } from '@/components/ui/number-field';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useProfile, useSaveProfile } from '@/features/settings/api';
import { sameProfile } from '@/features/settings/profile-form-schema';
import { useWeightStats } from '@/features/weight/api';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { todayKey } from '@/lib/dates';
import { formatKcal } from '@/lib/format';
import { useCreateGoal } from './api';
import { CalculatorPanel } from './CalculatorPanel';
import {
  detectPreset,
  emptyGoalForm,
  fromGoal,
  goalFormSchema,
  macroKcal,
  parsedMacros,
  PRESET_OPTIONS,
  toGoalInput,
  type GoalFormValues,
  type PresetChoice,
} from './goal-form-schema';

export interface GoalEditorSheetProps {
  open: boolean;
  onClose: () => void;
  /** Prefills the fields; the new goal still applies from the chosen date (FR-G1, D68). */
  goal: Goal | null;
}

const FORM_ID = 'goal-editor-form';
const MACRO_FIELDS = ['proteinG', 'carbsG', 'fatG'] as const;

/** Set or edit the goal (DESIGN §7). Remounts its form on every open so it starts fresh. */
export function GoalEditorSheet(props: GoalEditorSheetProps) {
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <GoalEditorSheetInner key={session} {...props} />;
}

function GoalEditorSheetInner({ open, onClose, goal }: GoalEditorSheetProps) {
  const profile = useProfile();
  const weightStats = useWeightStats();
  const createGoal = useCreateGoal();
  const saveProfile = useSaveProfile();
  const today = todayKey();

  const form = useForm<GoalFormValues>({
    resolver: zodResolver(goalFormSchema),
    defaultValues: goal ? fromGoal(goal, today) : emptyGoalForm(today),
  });
  const errors = form.formState.errors;
  const [preset, setPreset] = useState<PresetChoice>(goal ? detectPreset(goal) : 'balanced');
  const [calcOpen, setCalcOpen] = useState(false);
  // The calculator reports its inline profile here; saving the goal also saves a changed profile.
  const calcProfile = useRef<Profile | null>(null);

  const [kcal, proteinG, carbsG, fatG] = useWatch({
    control: form.control,
    name: ['kcal', 'proteinG', 'carbsG', 'fatG'],
  });
  const macros = parsedMacros({ kcal, proteinG, carbsG, fatG });
  const percents = macros ? macroPercentOfKcal(macros) : null;
  const macroSum = macros ? macroKcal(macros) : null;

  const applyPreset = (choice: PresetChoice, forKcal: number | null) => {
    setPreset(choice);
    if (choice === 'custom' || forKcal === null || Number.isNaN(forKcal) || forKcal < 0) return;
    const targets = macroTargetsFromPreset(forKcal, choice);
    for (const field of MACRO_FIELDS) {
      form.setValue(field, String(targets[field]), { shouldDirty: true, shouldValidate: true });
    }
  };

  const pickKcal = (value: number) => {
    form.setValue('kcal', String(value), { shouldDirty: true, shouldValidate: true });
    applyPreset(preset, value);
  };

  const submit = async (values: GoalFormValues) => {
    try {
      await createGoal.mutateAsync(toGoalInput(values));
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'VALIDATION_ERROR') {
        let applied = false;
        for (const [path, message] of Object.entries(err.fieldErrors())) {
          if (path in values) {
            form.setError(path as keyof GoalFormValues, { message });
            applied = true;
          }
        }
        if (applied) return;
      }
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not save the goal. Try again.',
      );
      return;
    }
    const inline = calcProfile.current;
    if (inline && !sameProfile(inline, profile.data ?? null)) {
      try {
        await saveProfile.mutateAsync(inline);
      } catch {
        toast.error('Goal saved, but the profile could not be saved.');
        onClose();
        return;
      }
    }
    toast.success('Goal saved');
    onClose();
  };

  const pending = createGoal.isPending || saveProfile.isPending;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={goal ? 'Edit goal' : 'Set your goal'}
      description="Applies from the chosen date; earlier days keep the goal they had."
      locked={pending}
      className="sm:max-w-[36rem]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={pending} className="min-w-28">
            Save goal
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        // Bound inside the handler so the calculator ref is read on submit, not during render.
        onSubmit={(event) => void form.handleSubmit(submit)(event)}
        className="flex flex-col gap-5 pt-1"
      >
        <Field label="Calories per day" error={errors.kcal?.message}>
          {(c) => (
            <NumberField
              id={c.id}
              suffix="kcal"
              data-autofocus
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              className="text-lg font-semibold"
              {...form.register('kcal', {
                onChange: (e: { target: { value: string } }) => {
                  if (preset !== 'custom') applyPreset(preset, parseDecimal(e.target.value));
                },
              })}
            />
          )}
        </Field>

        <button
          type="button"
          onClick={() => setCalcOpen((v) => !v)}
          aria-expanded={calcOpen}
          className="text-accent -mt-2 flex items-center gap-1.5 self-start text-sm font-medium"
        >
          <Calculator className="size-4" aria-hidden="true" />
          Calculate for me
          <ChevronDown
            className={cn('size-4 transition-transform', calcOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        {calcOpen ? (
          // The panel mounts with the saved profile and latest weight as defaults, so it waits for
          // both requests to settle (cold cache) instead of starting empty.
          profile.isPending || weightStats.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <CalculatorPanel
              profile={profile.data ?? null}
              defaultWeightKg={weightStats.data?.latest?.kg}
              onPickKcal={pickKcal}
              onProfileChange={(p) => {
                calcProfile.current = p;
              }}
            />
          )
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Macro split">
            {PRESET_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                selected={preset === option.value}
                onClick={() => applyPreset(option.value, macros?.kcal ?? parseDecimal(kcal))}
              >
                {option.label}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                ['proteinG', 'Protein', 'protein'],
                ['carbsG', 'Carbs', 'carbs'],
                ['fatG', 'Fat', 'fat'],
              ] as const
            ).map(([field, label, key]) => (
              <Field
                key={field}
                label={label}
                labelExtra={percents ? `${percents[key]} %` : undefined}
                error={errors[field]?.message}
              >
                {(c) => (
                  <NumberField
                    id={c.id}
                    suffix="g"
                    aria-describedby={c['aria-describedby']}
                    invalid={c.invalid}
                    {...form.register(field, { onChange: () => setPreset('custom') })}
                  />
                )}
              </Field>
            ))}
          </div>
          {macros && macroSum !== null ? (
            <p className="text-fg-muted text-xs" aria-live="polite">
              Macros add up to{' '}
              <span className="text-fg tabular font-medium">{formatKcal(macroSum)}</span> of{' '}
              <span className="tabular">{formatKcal(macros.kcal)}</span> kcal
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fiber" description="Optional" error={errors.fiberG?.message}>
            {(c) => (
              <NumberField
                id={c.id}
                suffix="g"
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                {...form.register('fiberG')}
              />
            )}
          </Field>
          <Field label="Water" description="Optional" error={errors.waterMl?.message}>
            {(c) => (
              <NumberField
                id={c.id}
                suffix="ml"
                aria-describedby={c['aria-describedby']}
                invalid={c.invalid}
                {...form.register('waterMl')}
              />
            )}
          </Field>
        </div>

        <fieldset className="border-border rounded-card flex flex-col gap-3 border p-4">
          <legend className="text-fg px-1 text-sm font-medium">Weight goal</legend>
          <p className="text-fg-muted -mt-1 text-xs">
            Optional · shown on the Weight page with your remaining kg and an ETA.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Goal weight" error={errors.goalWeightKg?.message}>
              {(c) => (
                <NumberField
                  id={c.id}
                  suffix="kg"
                  aria-describedby={c['aria-describedby']}
                  invalid={c.invalid}
                  {...form.register('goalWeightKg')}
                />
              )}
            </Field>
            <Field label="Target date" error={errors.goalWeightDate?.message}>
              {(c) => (
                <Input
                  id={c.id}
                  type="date"
                  aria-describedby={c['aria-describedby']}
                  invalid={c.invalid}
                  {...form.register('goalWeightDate')}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <Field
          label="Applies from"
          description="Days before this date keep their current goal."
          error={errors.effectiveFrom?.message}
        >
          {(c) => (
            <Input
              id={c.id}
              type="date"
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              {...form.register('effectiveFrom')}
            />
          )}
        </Field>
      </form>
    </Sheet>
  );
}
