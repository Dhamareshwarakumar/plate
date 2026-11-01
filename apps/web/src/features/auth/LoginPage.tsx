import { loginRequestSchema, type LoginRequest } from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/input';
import { BrandMark } from '@/components/brand-mark';
import { ApiClientError } from '@/lib/api';
import { useLogin, useSession } from './use-session';

interface LocationState {
  from?: string;
}

function describeLoginError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return 'Incorrect password.';
    if (error.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
    if (error.status === 403) return error.message;
    return error.message;
  }
  return 'Something went wrong. Try again.';
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
  const loginMutation = useLogin();

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { password: '' },
  });

  const from = (location.state as LocationState | null)?.from ?? '/today';

  if (session.data) {
    return <Navigate to={from} replace />;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await loginMutation.mutateAsync(values);
      void navigate(from, { replace: true });
    } catch (err) {
      form.setError('password', { message: describeLoginError(err) });
      form.setFocus('password');
    }
  });

  return (
    <main className="pt-safe pb-safe flex min-h-dvh items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-16" />
          <h1 className="text-fg mt-5 text-2xl font-semibold tracking-tight">Plate</h1>
          <p className="text-fg-muted mt-1 text-sm">Your diet ledger. Sign in to continue.</p>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          className="bg-surface border-border shadow-card rounded-card border p-5 sm:p-6"
        >
          {/* Single-user app: a fixed, hidden username lets password managers file the credential properly. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value="plate"
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
          />
          <Field label="Password" error={form.formState.errors.password?.message}>
            {(control) => (
              <PasswordInput
                id={control.id}
                aria-describedby={control['aria-describedby']}
                invalid={control.invalid}
                autoComplete="current-password"
                autoFocus
                enterKeyHint="go"
                {...form.register('password')}
              />
            )}
          </Field>
          <Button type="submit" size="lg" className="mt-5 w-full" loading={loginMutation.isPending}>
            Sign in
          </Button>
        </form>
      </motion.div>
    </main>
  );
}
