import { CAUTION_KCAL, mifflinStJeor, type CalculatorResult, type Profile } from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useId, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { NumberField, parseDecimal } from '@/components/ui/number-field';
import {
  profileFormSchema,
  toProfileInput,
  fromProfile,
} from '@/features/settings/profile-form-schema';
import { ProfileFields } from '@/features/settings/ProfileFields';
import { cn } from '@/lib/cn';
import { todayKey } from '@/lib/dates';
import { formatKcal } from '@/lib/format';

const WEIGHT_MIN = 20;
const WEIGHT_MAX = 500;

const calculatorFormSchema = profileFormSchema.extend({
  weightKg: z.string().superRefine((raw, ctx) => {
    const n = parseDecimal(raw);
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: 'Weight is required' });
      return;
    }
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a number' });
      return;
    }
    if (n < WEIGHT_MIN || n > WEIGHT_MAX) {
      ctx.addIssue({ code: 'custom', message: `Between ${WEIGHT_MIN} and ${WEIGHT_MAX} kg` });
    }
  }),
});
type CalculatorFormValues = z.infer<typeof calculatorFormSchema>;

interface CalculatorPanelProps {
  /** Saved profile to prefill the inline fields from. */
  profile: Profile | null;
  /** Prefills the weight field; the latest logged weight once the log exists (FR-G4). */
  defaultWeightKg?: number | undefined;
  /** A suggestion chip was tapped. */
  onPickKcal: (kcal: number) => void;
  /** The inline profile fields currently form a valid profile (or not). Called on every change. */
  onProfileChange: (profile: Profile | null) => void;
}

const SUGGESTIONS: { key: keyof CalculatorResult['suggestions']; label: string }[] = [
  { key: 'maintain', label: 'Maintain' },
  { key: 'lose025', label: 'Lose 0.25 kg/wk' },
  { key: 'lose05', label: 'Lose 0.5 kg/wk' },
  { key: 'gain025', label: 'Gain 0.25 kg/wk' },
];

/**
 * "Calculate for me" (FR-G4): profile fields plus the current weight; the Mifflin-St Jeor estimate
 * updates per keystroke and the four suggestions are tappable chips. Nothing is applied until the
 * user taps one, and the goal is only saved by the sheet's Save button.
 */
export function CalculatorPanel({
  profile,
  defaultWeightKg,
  onPickKcal,
  onProfileChange,
}: CalculatorPanelProps) {
  const form = useForm<CalculatorFormValues>({
    resolver: zodResolver(calculatorFormSchema),
    defaultValues: {
      ...fromProfile(profile),
      weightKg: defaultWeightKg === undefined ? '' : String(defaultWeightKg),
    },
    mode: 'onChange',
  });
  const cautionId = useId();
  const [sex, birthDate, heightCm, activity, weightKg] = useWatch({
    control: form.control,
    name: ['sex', 'birthDate', 'heightCm', 'activity', 'weightKg'],
  });

  const validProfile = useMemo(() => {
    const values = { sex, birthDate, heightCm, activity };
    return profileFormSchema.safeParse(values).success ? toProfileInput(values) : null;
  }, [sex, birthDate, heightCm, activity]);
  const weight = parseDecimal(weightKg);
  const validWeight =
    weight !== null && !Number.isNaN(weight) && weight >= WEIGHT_MIN && weight <= WEIGHT_MAX
      ? weight
      : null;

  // Reported through a ref-writing callback upstream, so firing on every change is harmless.
  useEffect(() => {
    onProfileChange(validProfile);
  }, [validProfile, onProfileChange]);

  const result =
    validProfile && validWeight !== null
      ? mifflinStJeor({ ...validProfile, weightKg: validWeight, today: todayKey() })
      : null;
  const anyLow = result ? Object.values(result.suggestions).some((k) => k < CAUTION_KCAL) : false;

  return (
    <div className="bg-surface-2 rounded-card flex flex-col gap-4 p-4">
      <ProfileFields form={form} />
      <Field label="Current weight" error={form.formState.errors.weightKg?.message}>
        {(c) => (
          <NumberField
            id={c.id}
            suffix="kg"
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            {...form.register('weightKg')}
          />
        )}
      </Field>

      <div aria-live="polite" className="flex flex-col gap-3">
        {result ? (
          <>
            <p className="text-fg-muted text-sm">
              Basal rate{' '}
              <span className="text-fg tabular font-medium">{formatKcal(result.bmr)}</span> · Daily
              expenditure{' '}
              <span className="text-fg tabular font-medium">{formatKcal(result.tdee)}</span> kcal
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested calorie goals">
              {SUGGESTIONS.map(({ key, label }) => {
                const kcal = result.suggestions[key];
                const low = kcal < CAUTION_KCAL;
                return (
                  <Chip
                    key={key}
                    onClick={() => onPickKcal(kcal)}
                    aria-describedby={low ? cautionId : undefined}
                    className={cn('h-10', low && 'border-over/60 text-over-fg hover:text-over-fg')}
                  >
                    {low ? <AlertTriangle className="size-3.5" aria-hidden="true" /> : null}
                    {label}
                    <span className="tabular font-semibold">{formatKcal(kcal)}</span>
                  </Chip>
                );
              })}
            </div>
            {anyLow ? (
              <p
                id={cautionId}
                role="alert"
                className="text-over-fg flex items-start gap-2 text-sm"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Below {formatKcal(CAUTION_KCAL)} kcal a day is not advisable without medical advice.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-fg-faint text-sm">
            Fill in every field to see your estimate and suggestions.
          </p>
        )}
      </div>
    </div>
  );
}
