import { UtensilsCrossed } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { InitialPasswordBanner } from '@/features/auth/InitialPasswordBanner';

export function TodayPage() {
  return (
    <>
      <InitialPasswordBanner />
      <PageHeader title="Today" />
      <Card className="p-0">
        <EmptyState
          icon={UtensilsCrossed}
          title="Today arrives in Phase 2"
          description="Your day at a glance: calorie ring, macro bars, meals with every entry, and the + button to log food in three taps."
        />
      </Card>
    </>
  );
}
