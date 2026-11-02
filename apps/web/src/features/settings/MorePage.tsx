import { ChevronRight, Clock, FolderCog, LogOut, Moon, Sun, SunMoon } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { useLogout } from '@/features/auth/use-session';
import { activeGoalFor, useGoals } from '@/features/goals/api';
import { GoalCard } from '@/features/goals/GoalCard';
import { GoalEditorSheet } from '@/features/goals/GoalEditorSheet';
import { todayKey } from '@/lib/dates';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { AboutCard } from './AboutCard';
import { AdherenceCard } from './AdherenceCard';
import { ChangePasswordForm } from './ChangePasswordForm';
import { DataCard } from './DataCard';
import { ProfileCard } from './ProfileCard';
import { WeekStartCard } from './WeekStartCard';

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: <SunMoon className="size-4" aria-hidden="true" /> },
  { value: 'light', label: 'Light', icon: <Sun className="size-4" aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="size-4" aria-hidden="true" /> },
] as const satisfies readonly { value: ThemePreference; label: string; icon: React.ReactNode }[];

export function MorePage() {
  // The goal editor is URL state (`?goal=edit`) so Today's "Set a goal" and the first-run checklist
  // can deep-link into it and Back closes it (D63 pattern).
  const [searchParams, setSearchParams] = useSearchParams();
  const editorOpen = searchParams.get('goal') === 'edit';
  const openEditor = () => {
    const next = new URLSearchParams(searchParams);
    next.set('goal', 'edit');
    setSearchParams(next);
  };
  const closeEditor = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('goal');
    setSearchParams(next, { replace: true });
  };
  const goals = useGoals();
  // Prefill from the goal in effect today, else the newest one; a brand-new goal otherwise. The
  // sheet waits for the list so the form mounts with the right defaults.
  const prefill = activeGoalFor(goals.data, todayKey()) ?? goals.data?.[0] ?? null;

  // Section order follows DESIGN §7: goal, adherence (+ week start), library, appearance, profile,
  // data, security, about. On desktop only the goal spans both columns, so the eight other cards
  // pair up without an orphan row.
  return (
    <>
      <PageHeader title="More" description="Goal, preferences, data, security and app details." />
      <div className="grid gap-4 lg:grid-cols-2">
        <GoalCard onEdit={openEditor} className="lg:col-span-2" />
        <AdherenceCard />
        <WeekStartCard />
        <LibraryCard />
        <AppearanceCard />
        <ProfileCard />
        <DataCard />
        <SecurityCard />
        <AboutCard />
      </div>
      <GoalEditorSheet open={editorOpen && !goals.isPending} onClose={closeEditor} goal={prefill} />
    </>
  );
}

function AppearanceCard() {
  const { preference, setPreference } = useTheme();
  return (
    <Card>
      <CardTitle>Appearance</CardTitle>
      <CardDescription>Follow your device, or pick a side.</CardDescription>
      <Segmented
        className="mt-4"
        aria-label="Theme"
        value={preference}
        onChange={setPreference}
        options={THEME_OPTIONS}
      />
    </Card>
  );
}

function LibraryCard() {
  return (
    <Card className="p-0">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardTitle>Library</CardTitle>
        <CardDescription>Meal slots and the categories your foods are filed under.</CardDescription>
      </div>
      <Link
        to="/more/meal-slots"
        className="hover:bg-surface-2 mt-3 flex items-center gap-3 border-t border-border px-4 py-3.5 transition-colors sm:px-5"
      >
        <Clock className="text-fg-muted size-5" aria-hidden="true" />
        <span className="text-fg flex-1 text-sm font-medium">Meal slots</span>
        <ChevronRight className="text-fg-faint size-4" aria-hidden="true" />
      </Link>
      <Link
        to="/more/categories"
        className="hover:bg-surface-2 flex items-center gap-3 border-t border-border px-4 py-3.5 transition-colors sm:px-5"
      >
        <FolderCog className="text-fg-muted size-5" aria-hidden="true" />
        <span className="text-fg flex-1 text-sm font-medium">Categories</span>
        <ChevronRight className="text-fg-faint size-4" aria-hidden="true" />
      </Link>
    </Card>
  );
}

function SecurityCard() {
  const navigate = useNavigate();
  const logoutMutation = useLogout();

  const onLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // The local session is cleared regardless; the server-side row expires on its own.
      toast.error('Signed out locally; the server could not be reached.');
    }
    void navigate('/login', { replace: true });
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardTitle>Security</CardTitle>
          <CardDescription>
            Changing the password signs out every other device. Keep this one signed in.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onLogout} loading={logoutMutation.isPending}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </Button>
      </div>
      <div className="mt-5 max-w-md">
        <ChangePasswordForm />
      </div>
    </Card>
  );
}
