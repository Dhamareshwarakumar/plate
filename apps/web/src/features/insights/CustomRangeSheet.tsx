import { daysBetween, INSIGHTS_RANGE_MAX_DAYS, isValidDayKey } from '@plate/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import type { InsightsRange } from './insights-range';

export interface CustomRangeSheetProps {
  open: boolean;
  /** The range shown when the sheet opens; its bounds prefill the fields. */
  range: InsightsRange;
  onClose: () => void;
  onApply: (range: InsightsRange) => void;
}

/** Two date fields for an arbitrary span of up to 731 days (D99). Remounts on every open. */
export function CustomRangeSheet(props: CustomRangeSheetProps) {
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <CustomRangeSheetInner key={session} {...props} />;
}

function validate(from: string, to: string): { from?: string; to?: string } {
  const errors: { from?: string; to?: string } = {};
  if (!isValidDayKey(from)) errors.from = 'Pick a start day';
  if (!isValidDayKey(to)) errors.to = 'Pick an end day';
  if (errors.from || errors.to) return errors;
  if (to < from) errors.to = 'The end must not be before the start';
  else if (daysBetween(from, to) + 1 > INSIGHTS_RANGE_MAX_DAYS) {
    errors.to = `A range may span at most ${INSIGHTS_RANGE_MAX_DAYS.toLocaleString()} days (two years)`;
  }
  return errors;
}

function CustomRangeSheetInner({ open, range, onClose, onApply }: CustomRangeSheetProps) {
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [touched, setTouched] = useState(false);
  const errors = validate(from, to);
  const shown = touched ? errors : {};
  const days = errors.from || errors.to ? null : daysBetween(from, to) + 1;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (errors.from || errors.to) return;
    onApply({ kind: 'custom', from, to });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Custom range"
      description="Any span of up to two years."
      // A focused date field pops the native picker (and zooms the page on phones); let the user tap.
      autoFocusFirstField={false}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="custom-range-form">
            Apply
          </Button>
        </>
      }
    >
      <form id="custom-range-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="From" error={shown.from}>
          {(control) => (
            <Input
              id={control.id}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-describedby={control['aria-describedby']}
              invalid={control.invalid}
            />
          )}
        </Field>
        <Field
          label="To"
          error={shown.to}
          {...(days !== null && !shown.to
            ? { description: `${days.toLocaleString()} ${days === 1 ? 'day' : 'days'}` }
            : {})}
        >
          {(control) => (
            <Input
              id={control.id}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-describedby={control['aria-describedby']}
              invalid={control.invalid}
            />
          )}
        </Field>
      </form>
    </Sheet>
  );
}
