import { changePasswordRequestSchema } from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/input';
import { ApiClientError } from '@/lib/api';
import { useChangePassword } from '@/features/auth/use-session';

const formSchema = changePasswordRequestSchema
  .safeExtend({ confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type FormValues = z.infer<typeof formSchema>;

export function ChangePasswordForm() {
  const mutation = useChangePassword();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const result = await mutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.reset();
      toast.success(
        result.signedOutOtherDevices > 0
          ? `Password changed. Signed out ${result.signedOutOtherDevices} other device${
              result.signedOutOtherDevices === 1 ? '' : 's'
            }.`
          : 'Password changed.',
      );
    } catch (err) {
      if (err instanceof ApiClientError) {
        const fieldErrors = err.fieldErrors();
        const known = (['currentPassword', 'newPassword'] as const).filter((k) => k in fieldErrors);
        const first = known[0];
        if (first) {
          for (const key of known) {
            const message = fieldErrors[key];
            if (message) form.setError(key, { message });
          }
          form.setFocus(first);
          return;
        }
        if (err.status === 429) {
          form.setError('currentPassword', { message: 'Too many attempts. Wait a few minutes.' });
          return;
        }
        toast.error(err.message);
        return;
      }
      toast.error('Could not change the password. Try again.');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Current password" error={form.formState.errors.currentPassword?.message}>
        {(c) => (
          <PasswordInput
            id={c.id}
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            autoComplete="current-password"
            {...form.register('currentPassword')}
          />
        )}
      </Field>
      <Field
        label="New password"
        description="At least 8 characters."
        error={form.formState.errors.newPassword?.message}
      >
        {(c) => (
          <PasswordInput
            id={c.id}
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            autoComplete="new-password"
            {...form.register('newPassword')}
          />
        )}
      </Field>
      <Field label="Confirm new password" error={form.formState.errors.confirmPassword?.message}>
        {(c) => (
          <PasswordInput
            id={c.id}
            aria-describedby={c['aria-describedby']}
            invalid={c.invalid}
            autoComplete="new-password"
            {...form.register('confirmPassword')}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={mutation.isPending}>
          Change password
        </Button>
      </div>
    </form>
  );
}
