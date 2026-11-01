import { ChartColumn } from 'lucide-react';
import { PlaceholderPage } from '@/components/placeholder-page';

export function InsightsPage() {
  return (
    <PlaceholderPage
      title="Insights"
      icon={ChartColumn}
      phase="Phase 6"
      summary="Calories and macros over time, adherence, streaks, a calendar heatmap, weight against intake, and your top foods."
    />
  );
}
