import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { DevicesCard } from './DevicesCard';
import { ScheduleCard } from './ScheduleCard';

/** More → Reminders (FR-N): the schedule and the devices that receive it. */
export function RemindersPage() {
  return (
    <>
      <PageHeader
        title="Reminders"
        description="A nudge when a meal is still unlogged, to weigh in, and to drink up."
        className="pt-2 lg:pt-6"
      />
      <Link
        to="/more"
        className="text-fg-muted hover:text-fg -mt-2 mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to More
      </Link>
      {/* minmax(0, 1fr): a long device label or status line must never widen the page. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ScheduleCard />
        <DevicesCard />
      </div>
    </>
  );
}
