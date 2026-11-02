import { Switch as RadixSwitch } from 'radix-ui';
import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  /** One of the two is needed: a label of its own, or the id of the visible label text. */
  'aria-label'?: string | undefined;
  'aria-labelledby'?: string | undefined;
  'aria-describedby'?: string | undefined;
  className?: string;
}

/**
 * On/off toggle on Radix (`role="switch"`, Space/Enter toggle, visible focus ring). The track is
 * 28 px tall, so put it in a row of at least 44 px (a `<label>` row works) for the touch target.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
  className,
  ...aria
}: SwitchProps) {
  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}
      aria-describedby={aria['aria-describedby']}
      className={cn(
        'bg-surface-3 data-[state=checked]:bg-accent relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
        'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <RadixSwitch.Thumb className="block size-6 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </RadixSwitch.Root>
  );
}
