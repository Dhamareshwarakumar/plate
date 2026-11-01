import {
  MEAL_TEMPLATE_AMOUNT_MAX,
  MEAL_TEMPLATE_ITEMS_MAX,
  MEAL_TEMPLATE_NAME_MAX,
  type MealTemplate,
  type MealTemplateInput,
} from '@plate/shared';
import { z } from 'zod';
import { parseDecimal } from '@/components/ui/number-field';

/** Positive decimal typed as a string; null when blank or not a number above 0. */
export function parseAmount(raw: string): number | null {
  const n = parseDecimal(raw);
  return n === null || Number.isNaN(n) || n <= 0 ? null : n;
}

export const amountString = z.string().superRefine((raw, ctx) => {
  const n = parseDecimal(raw);
  if (n === null) {
    ctx.addIssue({ code: 'custom', message: 'Amount is required' });
    return;
  }
  if (Number.isNaN(n)) {
    ctx.addIssue({ code: 'custom', message: 'Enter a number' });
    return;
  }
  if (n <= 0) ctx.addIssue({ code: 'custom', message: 'Amount must be above 0' });
  if (n > MEAL_TEMPLATE_AMOUNT_MAX)
    ctx.addIssue({ code: 'custom', message: 'Amount is unrealistically large' });
});

export const mealFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(MEAL_TEMPLATE_NAME_MAX, `At most ${MEAL_TEMPLATE_NAME_MAX} characters`),
  items: z
    .array(z.object({ foodId: z.number().int().positive(), amount: amountString }))
    .min(1, 'Add at least one item')
    .max(MEAL_TEMPLATE_ITEMS_MAX, `At most ${MEAL_TEMPLATE_ITEMS_MAX} items`),
});
export type MealFormValues = z.infer<typeof mealFormSchema>;

export const EMPTY_MEAL_FORM: MealFormValues = { name: '', items: [] };

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

export function toMealInput(values: MealFormValues): MealTemplateInput {
  return {
    name: values.name,
    items: values.items.map((i) => ({ foodId: i.foodId, amount: parseAmount(i.amount) ?? 0 })),
  };
}

export function fromTemplate(template: MealTemplate): MealFormValues {
  return {
    name: template.name,
    items: template.items.map((i) => ({ foodId: i.foodId, amount: fmt(i.amount) })),
  };
}
