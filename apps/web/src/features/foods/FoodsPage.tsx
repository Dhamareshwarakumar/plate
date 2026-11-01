import { Apple } from 'lucide-react';
import { PlaceholderPage } from '@/components/placeholder-page';

export function FoodsPage() {
  return (
    <PlaceholderPage
      title="Foods"
      icon={Apple}
      phase="Phase 1"
      summary="Your library of foods with nutrition per 100 g, portion presets, categories, search, and CSV import."
    />
  );
}
