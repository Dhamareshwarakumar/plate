import {
  ACTIVITY_LEVELS,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  isValidDayKey,
  PROFILE_BIRTH_MIN,
  type Profile,
} from '@plate/shared';
import { z } from 'zod';
import { parseDecimal } from '@/components/ui/number-field';
import { todayKey } from '@/lib/dates';

/**
 * Profile fields as the form holds them: choices start empty (''), numbers are strings
 * (see `food-form-schema.ts`). `toProfileInput` converts a validated form into the API shape.
 */
export const profileFormSchema = z.object({
  // `.length > 0` rather than `!== ''` so TypeScript does not infer a narrowing type predicate,
  // which would make the schema's output type differ from its input type (breaks react-hook-form).
  sex: z.enum(['', 'male', 'female']).refine((v) => v.length > 0, 'Choose one'),
  birthDate: z.string().superRefine((raw, ctx) => {
    if (raw === '') {
      ctx.addIssue({ code: 'custom', message: 'Birth date is required' });
      return;
    }
    if (!isValidDayKey(raw)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid date' });
      return;
    }
    if (raw < PROFILE_BIRTH_MIN) ctx.addIssue({ code: 'custom', message: 'Must be after 1900' });
    if (raw > todayKey()) ctx.addIssue({ code: 'custom', message: 'Cannot be in the future' });
  }),
  heightCm: z.string().superRefine((raw, ctx) => {
    const n = parseDecimal(raw);
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: 'Height is required' });
      return;
    }
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a number' });
      return;
    }
    if (n < HEIGHT_CM_MIN || n > HEIGHT_CM_MAX) {
      ctx.addIssue({
        code: 'custom',
        message: `Between ${HEIGHT_CM_MIN} and ${HEIGHT_CM_MAX} cm`,
      });
    }
  }),
  activity: z.enum(['', ...ACTIVITY_LEVELS]).refine((v) => v.length > 0, 'Choose one'),
});
export type ProfileFormValues = z.infer<typeof profileFormSchema>;

export const EMPTY_PROFILE_FORM: ProfileFormValues = {
  sex: '',
  birthDate: '',
  heightCm: '',
  activity: '',
};

/** Short enough for a half-width select on a 390 px phone. */
export const ACTIVITY_LABELS: Record<(typeof ACTIVITY_LEVELS)[number], string> = {
  sedentary: 'Sedentary',
  light: 'Light',
  moderate: 'Moderate',
  active: 'Active',
  very_active: 'Very active',
};

/** Form → API shape; null while a choice or the height is still missing. */
export function toProfileInput(values: ProfileFormValues): Profile | null {
  const heightCm = parseDecimal(values.heightCm);
  if (
    values.sex === '' ||
    values.activity === '' ||
    heightCm === null ||
    Number.isNaN(heightCm) ||
    !isValidDayKey(values.birthDate)
  ) {
    return null;
  }
  return { sex: values.sex, birthDate: values.birthDate, heightCm, activity: values.activity };
}

export function fromProfile(profile: Profile | null): ProfileFormValues {
  if (!profile) return EMPTY_PROFILE_FORM;
  return {
    sex: profile.sex,
    birthDate: profile.birthDate,
    heightCm: String(profile.heightCm),
    activity: profile.activity,
  };
}

export function sameProfile(a: Profile | null, b: Profile | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.sex === b.sex &&
    a.birthDate === b.birthDate &&
    a.heightCm === b.heightCm &&
    a.activity === b.activity
  );
}
