import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useSession } from './use-session';

/** Shown until the bootstrap password has been changed in More → Security. */
export function InitialPasswordBanner() {
  const session = useSession();
  if (!session.data?.passwordIsInitial) return null;
  return (
    <Link
      to="/more"
      className="bg-under/10 text-under hover:bg-under/15 mt-4 flex items-start gap-3 rounded-card border border-under/30 px-4 py-3 text-sm transition-colors lg:mt-6"
    >
      <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <span>
        <span className="font-semibold">You're still using the initial password.</span>{' '}
        <span className="text-fg">
          Change it in More → Security before exposing Plate to the internet.
        </span>
      </span>
    </Link>
  );
}
