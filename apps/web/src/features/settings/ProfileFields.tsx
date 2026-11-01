import { ACTIVITY_LEVELS } from '@plate/shared';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { todayKey } from '@/lib/dates';
import { ACTIVITY_LABELS, type ProfileFormValues } from './profile-form-schema';

const SEX_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
] as const;

interface ProfileFieldsProps<T extends ProfileFormValues> {
  /** Any form whose values include the profile fields (the calculator adds a weight). */
  form: UseFormReturn<T>;
}

/** Sex, birth date, height and activity level; shared by the Profile card and the goal calculator. */
export function ProfileFields<T extends ProfileFormValues>({ form }: ProfileFieldsProps<T>) {
  // Only the profile fields are read or written here, so the wider form type is safe to narrow.
  const f = form as unknown as UseFormReturn<ProfileFormValues>;
  const errors = f.formState.errors;
  const sex = useWatch({ control: f.control, name: 'sex' });

  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label="Sex" error={errors.sex?.message} className="col-span-2 sm:col-span-1">
        {() => (
          <Segmented
            aria-label="Sex"
            value={sex}
            onChange={(value) =>
              f.setValue('sex', value, { shouldDirty: true, shouldValidate: true })
            }
            options={SEX_OPTIONS}
          />
        )}
      </Field>
      <Field
        label="Birth date"
        error={errors.birthDate?.message}
        className="col-span-2 sm:col-span-1"
      >
        {(c) => (
          <Input
            id={c.id}
            type="date"
            max={todayKey()}
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            {...f.register('birthDate')}
          />
        )}
      </Field>
      <Field label="Height" error={errors.heightCm?.message}>
        {(c) => (
          <NumberField
            id={c.id}
            suffix="cm"
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            {...f.register('heightCm')}
          />
        )}
      </Field>
      <Field label="Activity" error={errors.activity?.message}>
        {(c) => (
          <Select
            id={c.id}
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            {...f.register('activity')}
          >
            <option value="">Choose…</option>
            {ACTIVITY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {ACTIVITY_LABELS[level]}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
