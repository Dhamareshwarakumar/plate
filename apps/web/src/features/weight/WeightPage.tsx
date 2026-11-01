import { Scale } from 'lucide-react';
import { PlaceholderPage } from '@/components/placeholder-page';

export function WeightPage() {
  return (
    <PlaceholderPage
      title="Weight"
      icon={Scale}
      phase="Phase 5"
      summary="Daily weigh-ins with a 7-day trend, rate per week, your goal and an estimated date to reach it."
    />
  );
}
