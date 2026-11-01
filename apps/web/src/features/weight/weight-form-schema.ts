import {
  isValidDayKey,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
  WEIGHT_NOTE_MAX,
  type Weight,
  type WeightInput,
} from '@plate/shared';
import { z } from 'zod';
import { parseDecimal } from '@/components/ui/number-field';
import { todayKey } from '@/lib/dates';

/** The kg field is a string while editing (see `food-form-schema.ts`). */
const kgString = z.string().superRefine((raw, ctx) => {
  const n = parseDecimal(raw);
  if (n === null) {
    ctx.addIssue({ code: 'custom', message: 'Weight is required' });
    return;
  }
  if (Number.isNaN(n)) {
    ctx.addIssue({ code: 'custom', message: 'Enter a number' });
    return;
  }
  if (n < WEIGHT_KG_MIN) ctx.addIssue({ code: 'custom', message: `At least ${WEIGHT_KG_MIN} kg` });
  else if (n > WEIGHT_KG_MAX)
    ctx.addIssue({ code: 'custom', message: `At most ${WEIGHT_KG_MAX} kg` });
  else if (Math.abs(n * 10 - Math.round(n * 10)) > 1e-9)
    ctx.addIssue({ code: 'custom', message: 'Use at most one decimal' });
});

export const weightFormSchema = z.object({
  day: z
    .string()
    .refine(isValidDayKey, 'Enter a valid date')
    // The scale cannot know tomorrow's weight; the API stays permissive like the diary.
    .refine((day) => !isValidDayKey(day) || day <= todayKey(), 'Cannot be in the future'),
  kg: kgString,
  note: z
    .string()
    .trim()
    .max(WEIGHT_NOTE_MAX, `Note must be at most ${WEIGHT_NOTE_MAX} characters`),
});
export type WeightFormValues = z.infer<typeof weightFormSchema>;

export function emptyWeightForm(today: string): WeightFormValues {
  return { day: today, kg: '', note: '' };
}

export function fromWeight(weight: Weight): WeightFormValues {
  return { day: weight.day, kg: String(weight.kg), note: weight.note ?? '' };
}

export function toWeightInput(values: WeightFormValues): WeightInput {
  const note = values.note.trim();
  return {
    day: values.day,
    kg: Math.round((parseDecimal(values.kg) ?? 0) * 10) / 10,
    note: note === '' ? null : note,
  };
}
