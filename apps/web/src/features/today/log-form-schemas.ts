import {
  DIARY_NOTE_MAX,
  FOOD_NAME_MAX,
  PORTION_COUNT_MAX,
  PORTION_LABEL_MAX,
  QUANTITY_MAX,
  isValidDayKey,
} from '@plate/shared';
import { z } from 'zod';
import { parseDecimal } from '@/components/ui/number-field';

/** Positive decimal typed as a string (`NumberField`); null when blank, NaN when garbage. */
export function parsePositive(raw: string): number | null {
  const n = parseDecimal(raw);
  return n === null || Number.isNaN(n) || n <= 0 ? null : n;
}

const positiveString = (label: string, max: number) =>
  z.string().superRefine((raw, ctx) => {
    const n = parseDecimal(raw);
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: `${label} is required` });
      return;
    }
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a number' });
      return;
    }
    if (n <= 0) ctx.addIssue({ code: 'custom', message: `${label} must be above 0` });
    if (n > max) ctx.addIssue({ code: 'custom', message: `${label} is unrealistically large` });
  });

const nonNegativeString = (label: string, required: boolean) =>
  z.string().superRefine((raw, ctx) => {
    const n = parseDecimal(raw);
    if (n === null) {
      if (required) ctx.addIssue({ code: 'custom', message: `${label} is required` });
      return;
    }
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a number' });
      return;
    }
    if (n < 0) ctx.addIssue({ code: 'custom', message: 'Cannot be negative' });
  });

const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Enter a time');
const slotString = z.string().min(1, 'Pick a meal');
const noteString = z.string().trim().max(DIARY_NOTE_MAX, `At most ${DIARY_NOTE_MAX} characters`);

/** Quantity typed in grams/ml, or derived from a portion chip × count. */
export const quantityFieldsSchema = z.object({
  quantity: positiveString('Quantity', QUANTITY_MAX),
  /** '' when no portion chip is selected. */
  portionLabel: z.string(),
  portionCount: z.string(),
});
export type QuantityFields = z.infer<typeof quantityFieldsSchema>;

export const quantityFormSchema = quantityFieldsSchema.extend({
  slotId: slotString,
  time: timeString,
  note: noteString,
});
export type QuantityFormValues = z.infer<typeof quantityFormSchema>;

export const entryEditFormSchema = quantityFormSchema.extend({
  day: z.string().refine(isValidDayKey, 'Pick a date'),
});
export type EntryEditFormValues = z.infer<typeof entryEditFormSchema>;

export const adHocFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(FOOD_NAME_MAX, `At most ${FOOD_NAME_MAX} characters`),
    kcal: nonNegativeString('Calories', true),
    protein: nonNegativeString('Protein', false),
    carbs: nonNegativeString('Carbs', false),
    fat: nonNegativeString('Fat', false),
    /** What the numbers describe, e.g. "1 slice". */
    label: z
      .string()
      .trim()
      .min(1, 'Describe the amount, e.g. "1 slice"')
      .max(PORTION_LABEL_MAX, `At most ${PORTION_LABEL_MAX} characters`),
    count: positiveString('Count', PORTION_COUNT_MAX),
    saveToLibrary: z.boolean(),
    /** Grams of one labelled unit; required only when saving to the library. */
    weight: z.string(),
    slotId: slotString,
    time: timeString,
    note: noteString,
  })
  .superRefine((values, ctx) => {
    if (!values.saveToLibrary) return;
    const n = parsePositive(values.weight);
    if (n === null || n > QUANTITY_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['weight'],
        message: 'Enter the weight of one unit in grams to save per-100 g values',
      });
    }
  });
export type AdHocFormValues = z.infer<typeof adHocFormSchema>;

const optionalNumber = (raw: string): number => {
  const n = parseDecimal(raw);
  return n === null || Number.isNaN(n) ? 0 : n;
};

/** Nutrition of one labelled unit as typed in the ad-hoc form. */
export function adHocUnitNutrients(
  values: Pick<AdHocFormValues, 'kcal' | 'protein' | 'carbs' | 'fat'>,
) {
  return {
    kcal: optionalNumber(values.kcal),
    protein: optionalNumber(values.protein),
    carbs: optionalNumber(values.carbs),
    fat: optionalNumber(values.fat),
    fiber: null,
    sugar: null,
    saturatedFat: null,
    sodiumMg: null,
  };
}
