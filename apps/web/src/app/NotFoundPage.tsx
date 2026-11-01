import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <EmptyState
        icon={Compass}
        title="This page doesn't exist"
        description="The link may be old, or the address was mistyped."
        action={
          <Link to="/today" className={buttonVariants({ variant: 'primary', size: 'md' })}>
            Go to Today
          </Link>
        }
      />
    </main>
  );
}
