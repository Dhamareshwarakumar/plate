import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends ComponentProps<'input'> {
  invalid?: boolean;
}

export function Input({ className, invalid = false, type = 'text', ...props }: InputProps) {
  return (
    <input
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        'bg-surface text-fg placeholder:text-fg-faint h-11 w-full rounded-control border px-3.5 text-base',
        'border-border-strong transition-colors focus:border-accent focus:outline-none focus:ring-3 focus:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
        invalid && 'border-danger focus:border-danger focus:ring-danger/30',
        className,
      )}
      {...props}
    />
  );
}

export function PasswordInput({ className, ...props }: Omit<InputProps, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={cn('pr-12', className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="text-fg-muted hover:text-fg absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-control"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}
