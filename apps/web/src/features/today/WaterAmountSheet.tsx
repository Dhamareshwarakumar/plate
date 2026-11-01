import { WATER_ML_MAX, WATER_ML_MIN } from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Field } from '@/components/ui/field';
import { NumberField, parseDecimal } from '@/components/ui/number-field';
import { Sheet } from '@/components/ui/sheet';

export interface WaterAmountSheetProps {
  open: boolean;
  onClose: () => void;
  onAdd: (ml: number) => void;
}

/** Common glass and bottle sizes; tapping one fills the field, Add confirms. */
const PRESETS_ML = [100, 150, 200, 330, 750, 1000] as const;
const FORM_ID = 'water-amount-form';

const amountSchema = z.object({
  ml: z.string().superRefine((raw, ctx) => {
    const n = parseDecimal(raw);
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter an amount' });
      return;
    }
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a number' });
      return;
    }
    const whole = Math.round(n);
    if (whole < WATER_ML_MIN) {
      ctx.addIssue({ code: 'custom', message: `At least ${WATER_ML_MIN} ml` });
    } else if (whole > WATER_ML_MAX) {
      ctx.addIssue({
        code: 'custom',
        message: `At most ${WATER_ML_MAX.toLocaleString()} ml at once`,
      });
    }
  }),
});
type AmountValues = z.infer<typeof amountSchema>;

/** "+…" on the water card (FR-D9): a custom amount in millilitres. Remounts its form per open. */
export function WaterAmountSheet(props: WaterAmountSheetProps) {
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <WaterAmountSheetInner key={session} {...props} />;
}

function WaterAmountSheetInner({ open, onClose, onAdd }: WaterAmountSheetProps) {
  const form = useForm<AmountValues>({
    resolver: zodResolver(amountSchema),
    defaultValues: { ml: '' },
  });
  const error = form.formState.errors.ml?.message;

  const submit = (values: AmountValues) => {
    const n = parseDecimal(values.ml);
    if (n === null || Number.isNaN(n)) return;
    onAdd(Math.round(n));
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Add water"
      description="Any amount in millilitres; whole numbers only."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} className="min-w-24">
            Add
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={form.handleSubmit(submit)}
        className="flex flex-col gap-4 pt-1"
      >
        <Field label="Amount" error={error}>
          {(c) => (
            <NumberField
              id={c.id}
              suffix="ml"
              data-autofocus
              aria-describedby={c['aria-describedby']}
              invalid={c.invalid}
              className="text-lg font-semibold"
              {...form.register('ml')}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Common amounts">
          {PRESETS_ML.map((ml) => (
            <Chip
              key={ml}
              onClick={() =>
                form.setValue('ml', String(ml), { shouldDirty: true, shouldValidate: true })
              }
            >
              {ml.toLocaleString()} ml
            </Chip>
          ))}
        </div>
      </form>
    </Sheet>
  );
}
