import {
  GOAL_KCAL_MAX,
  GOAL_KCAL_MIN,
  GOAL_MACRO_MAX,
  GOAL_WATER_MAX,
  isValidDayKey,
  KCAL_PER_GRAM,
  macroTargetsFromPreset,
  MACRO_PRESETS,
  type Goal,
  type GoalInput,
  type MacroPreset,
} from '@plate/shared';
import { z } from 'zod';
import { parseDecimal } from '@/components/ui/number-field';

/** Numeric fields are strings while editing (see `food-form-schema.ts`). */
function numberString(options: {
  label: string;
  min: number;
  max: number;
  required: boolean;
  unit: string;
}) {
  return z.string().superRefine((raw, ctx) => {
    const n = parseDecimal(raw);
    if (n === null) {
      if (options.required)
        ctx.addIssue({ code: 'custom', message: `${options.label} is required` });
      return;
    }
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a number' });
      return;
    }
    if (n < options.min) {
      ctx.addIssue({
        code: 'custom',
        message:
          options.min === 0
            ? 'Cannot be negative'
            : `At least ${options.min.toLocaleString()} ${options.unit}`,
      });
    }
    if (n > options.max) {
      ctx.addIssue({
        code: 'custom',
        message: `At most ${options.max.toLocaleString()} ${options.unit}`,
      });
    }
  });
}

const grams = (label: string, required: boolean) =>
  numberString({ label, min: 0, max: GOAL_MACRO_MAX, required, unit: 'g' });

export const goalFormSchema = z.object({
  effectiveFrom: z.string().refine(isValidDayKey, 'Enter a valid date'),
  kcal: numberString({
    label: 'Calories',
    min: GOAL_KCAL_MIN,
    max: GOAL_KCAL_MAX,
    required: true,
    unit: 'kcal',
  }),
  proteinG: grams('Protein', true),
  carbsG: grams('Carbs', true),
  fatG: grams('Fat', true),
  fiberG: grams('Fiber', false),
  waterMl: numberString({
    label: 'Water',
    min: 0,
    max: GOAL_WATER_MAX,
    required: false,
    unit: 'ml',
  }),
});
export type GoalFormValues = z.infer<typeof goalFormSchema>;

export type PresetChoice = MacroPreset | 'custom';

export const PRESET_OPTIONS: { value: PresetChoice; label: string }[] = [
  { value: 'balanced', label: 'Balanced 30/40/30' },
  { value: 'high_protein', label: 'High protein 40/30/30' },
  { value: 'custom', label: 'Custom' },
];

export function emptyGoalForm(today: string): GoalFormValues {
  return {
    effectiveFrom: today,
    kcal: '',
    proteinG: '',
    carbsG: '',
    fatG: '',
    fiberG: '',
    waterMl: '',
  };
}

const fmt = (n: number | null): string => (n === null ? '' : String(n));

/** Prefill from an existing goal; the new goal applies from `effectiveFrom` (today when editing, D68). */
export function fromGoal(goal: Goal, effectiveFrom: string): GoalFormValues {
  return {
    effectiveFrom,
    kcal: fmt(goal.kcal),
    proteinG: fmt(goal.proteinG),
    carbsG: fmt(goal.carbsG),
    fatG: fmt(goal.fatG),
    fiberG: fmt(goal.fiberG),
    waterMl: fmt(goal.waterMl),
  };
}

const num = (raw: string): number => parseDecimal(raw) ?? 0;
const optionalNum = (raw: string): number | null => {
  const n = parseDecimal(raw);
  return n === null || Number.isNaN(n) ? null : n;
};

export function toGoalInput(values: GoalFormValues): GoalInput {
  return {
    effectiveFrom: values.effectiveFrom,
    kcal: num(values.kcal),
    proteinG: num(values.proteinG),
    carbsG: num(values.carbsG),
    fatG: num(values.fatG),
    fiberG: optionalNum(values.fiberG),
    waterMl: optionalNum(values.waterMl),
  };
}

/** Parsed macro fields of the form (null while one is empty or not a number). */
export function parsedMacros(
  values: Pick<GoalFormValues, 'kcal' | 'proteinG' | 'carbsG' | 'fatG'>,
): { kcal: number; proteinG: number; carbsG: number; fatG: number } | null {
  const kcal = parseDecimal(values.kcal);
  const proteinG = parseDecimal(values.proteinG);
  const carbsG = parseDecimal(values.carbsG);
  const fatG = parseDecimal(values.fatG);
  const all = [kcal, proteinG, carbsG, fatG];
  if (all.some((n) => n === null || Number.isNaN(n))) return null;
  return { kcal: kcal!, proteinG: proteinG!, carbsG: carbsG!, fatG: fatG! };
}

/** 4P + 4C + 9F of the gram fields. */
export function macroKcal(m: { proteinG: number; carbsG: number; fatG: number }): number {
  return (
    m.proteinG * KCAL_PER_GRAM.protein + m.carbsG * KCAL_PER_GRAM.carbs + m.fatG * KCAL_PER_GRAM.fat
  );
}

/** Which preset (if any) produced the goal's grams, so the editor highlights the right chip. */
export function detectPreset(
  goal: Pick<Goal, 'kcal' | 'proteinG' | 'carbsG' | 'fatG'>,
): PresetChoice {
  for (const preset of Object.keys(MACRO_PRESETS) as MacroPreset[]) {
    const t = macroTargetsFromPreset(goal.kcal, preset);
    if (t.proteinG === goal.proteinG && t.carbsG === goal.carbsG && t.fatG === goal.fatG) {
      return preset;
    }
  }
  return 'custom';
}
