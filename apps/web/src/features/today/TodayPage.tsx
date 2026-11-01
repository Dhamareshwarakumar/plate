import { UtensilsCrossed } from 'lucide-react';
import { PlaceholderPage } from '@/components/placeholder-page';

export function TodayPage() {
  return (
    <PlaceholderPage
      title="Today"
      icon={UtensilsCrossed}
      phase="Phase 2"
      summary="Your day at a glance: calorie ring, macro bars, meals with every entry, and the + button to log food in three taps."
    />
  );
}
