import { DAY_RANGE_MAX_DAYS, daysBetween, isValidDayKey } from '@plate/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { shiftDay, todayKey } from '@/lib/dates';
import { DOWNLOADS } from './api';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** More → Data → Export diary CSV: pick a span (default the last 30 days), then download. Remounts on open. */
export function ExportDiaryCsvSheet({ open, onOpenChange }: Props) {
  const [session, setSession] = useState(0);
  const handleOpenChange = (next: boolean) => {
    if (next) setSession((n) => n + 1);
    onOpenChange(next);
  };
  return <ExportDiaryCsvInner key={session} open={open} onOpenChange={handleOpenChange} />;
}

function validate(from: string, to: string): { from?: string; to?: string } {
  const errors: { from?: string; to?: string } = {};
  if (!isValidDayKey(from)) errors.from = 'Pick a start day';
  if (!isValidDayKey(to)) errors.to = 'Pick an end day';
  if (errors.from || errors.to) return errors;
  if (to < from) errors.to = 'The end must not be before the start';
  else if (daysBetween(from, to) > DAY_RANGE_MAX_DAYS) {
    errors.to = `An export may span at most ${(DAY_RANGE_MAX_DAYS + 1).toLocaleString()} days`;
  }
  return errors;
}

type Preset = { label: string; range: () => [from: string, to: string] };

const PRESETS: Preset[] = [
  { label: 'Last 30 days', range: () => [shiftDay(todayKey(), -29), todayKey()] },
  { label: 'This month', range: () => [`${todayKey().slice(0, 7)}-01`, todayKey()] },
  { label: 'This year', range: () => [`${todayKey().slice(0, 4)}-01-01`, todayKey()] },
];

function ExportDiaryCsvInner({ open, onOpenChange }: Props) {
  const [from, setFrom] = useState(() => shiftDay(todayKey(), -29));
  const [to, setTo] = useState(todayKey);
  const [touched, setTouched] = useState(false);
  const errors = validate(from, to);
  const shown = touched ? errors : {};
  const days = errors.from || errors.to ? null : daysBetween(from, to) + 1;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (errors.from || errors.to) return;
    window.location.assign(DOWNLOADS.diaryCsv(from, to));
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Export diary CSV"
      description="One row per diary entry, with the snapshot nutrition and totals."
      // A focused date field pops the native picker (and zooms the page on phones); let the user tap.
      autoFocusFirstField={false}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="export-diary-csv-form">
            Download CSV
          </Button>
        </>
      }
    >
      <form id="export-diary-csv-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Range presets">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const [f, t] = preset.range();
                setFrom(f);
                setTo(t);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
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
