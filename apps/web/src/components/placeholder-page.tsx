import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { PageHeader } from './page-header';

export interface PlaceholderPageProps {
  title: string;
  icon: LucideIcon;
  phase: string;
  /** One sentence on what this screen will do, so the shell already reads like the finished app. */
  summary: string;
}

/** Stand-in for screens that arrive in a later build phase. Removed as each phase lands. */
export function PlaceholderPage({ title, icon, phase, summary }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} />
      <Card className="p-0">
        <EmptyState icon={icon} title={`${title} arrives in ${phase}`} description={summary} />
      </Card>
    </>
  );
}
