import type { Profile } from '@plate/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { ApiClientError } from '@/lib/api';
import { useProfile, useSaveProfile } from './api';
import {
  fromProfile,
  profileFormSchema,
  toProfileInput,
  type ProfileFormValues,
} from './profile-form-schema';
import { ProfileFields } from './ProfileFields';

/** More → Profile: what the goal calculator needs (FR-G4). Remounts the form when the saved profile changes. */
export function ProfileCard() {
  const profile = useProfile();
  return (
    <Card>
      <CardTitle>Profile</CardTitle>
      <CardDescription>
        Used only by the goal calculator. Your weight comes from the weight log.
      </CardDescription>
      {profile.isPending ? (
        <div className="mt-4 grid grid-cols-2 gap-4" aria-busy="true">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      ) : profile.isError ? (
        <ErrorState
          message={profile.error.message}
          onRetry={() => void profile.refetch()}
          retrying={profile.isFetching}
          className="py-6"
        />
      ) : (
        <ProfileForm key={profileKey(profile.data)} profile={profile.data} />
      )}
    </Card>
  );
}

function profileKey(profile: Profile | null): string {
  return profile
    ? `${profile.sex}|${profile.birthDate}|${profile.heightCm}|${profile.activity}`
    : '';
}

function ProfileForm({ profile }: { profile: Profile | null }) {
  const save = useSaveProfile();
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: fromProfile(profile),
  });

  const submit = async (values: ProfileFormValues) => {
    const input = toProfileInput(values);
    if (!input) return;
    try {
      await save.mutateAsync(input);
      toast.success('Profile saved');
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'VALIDATION_ERROR') {
        let applied = false;
        for (const [path, message] of Object.entries(err.fieldErrors())) {
          if (path in values) {
            form.setError(path as keyof ProfileFormValues, { message });
            applied = true;
          }
        }
        if (applied) return;
      }
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not save the profile. Try again.',
      );
    }
  };

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="mt-4 flex flex-col gap-4">
      <ProfileFields form={form} />
      <div className="flex justify-end">
        <Button
          type="submit"
          variant={profile ? 'secondary' : 'primary'}
          loading={save.isPending}
          disabled={profile !== null && !form.formState.isDirty}
        >
          {profile ? 'Save changes' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}
