import type { DiaryDay } from '@plate/shared';
import { Check, ChevronRight, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useFoods } from '@/features/foods/api';
import { useGoals } from '@/features/goals/api';
import { cn } from '@/lib/cn';
import { useRecentFoods } from './api';
import { readFirstRunDismissed, writeFirstRunDismissed } from './first-run';

interface FirstRunChecklistProps {
  day: DiaryDay | undefined;
  onLog: () => void;
  className?: string | undefined;
}

/**
 * FR-O1: three steps shown above the summary until all are done or the card is dismissed (both
 * remembered in localStorage). Signals (D75): any goal exists, the library is non-empty, and any
 * food has been logged (recent foods, or entries on the viewed day).
 */
export function FirstRunChecklist({ day, onLog, className }: FirstRunChecklistProps) {
  const [dismissed, setDismissed] = useState(readFirstRunDismissed);
  const goals = useGoals();
  const foods = useFoods();
  const recent = useRecentFoods();

  const ready = goals.data !== undefined && foods.data !== undefined && recent.data !== undefined;
  const hasGoal = (goals.data?.length ?? 0) > 0;
  const hasFoods = (foods.data?.length ?? 0) > 0;
  const hasLog = (recent.data?.length ?? 0) > 0 || (day?.entryCount ?? 0) > 0;
  const allDone = ready && hasGoal && hasFoods && hasLog;

  // Once every step has been seen done the card stays hidden on later visits too.
  useEffect(() => {
    if (allDone) writeFirstRunDismissed();
  }, [allDone]);

  if (dismissed || !ready || allDone) return null;

  const dismiss = () => {
    writeFirstRunDismissed();
    setDismissed(true);
  };

  return (
    <section
      aria-label="Getting started"
      className={cn(
        'rounded-card border-border bg-surface shadow-card relative overflow-hidden border',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-fg text-base font-semibold">Welcome to Plate</h2>
          <p className="text-fg-muted mt-0.5 text-sm">Three steps and you are set.</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss getting started"
          className="text-fg-muted hover:bg-surface-2 hover:text-fg -mt-1 -mr-2 flex size-9 shrink-0 items-center justify-center rounded-full"
        >
          <X className="size-5" />
        </button>
      </div>
      <ol className="mt-3 flex flex-col pb-2">
        <Step index={1} done={hasGoal} to="/more?goal=edit">
          Set your goal
        </Step>
        <Step index={2} done={hasFoods} to="/foods/new">
          Add some foods
        </Step>
        <Step index={3} done={hasLog} onClick={onLog}>
          Log your first meal
        </Step>
      </ol>
    </section>
  );
}

interface StepProps {
  index: number;
  done: boolean;
  children: ReactNode;
  to?: string;
  onClick?: () => void;
}

function Step({ index, done, children, to, onClick }: StepProps) {
  const content = (
    <>
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
          done ? 'bg-on-target text-white' : 'bg-accent-soft text-accent',
        )}
        aria-hidden="true"
      >
        {done ? (
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            className="flex"
          >
            <Check className="size-4" strokeWidth={3} />
          </motion.span>
        ) : (
          index
        )}
      </span>
      <span
        className={cn('flex-1 text-left text-sm font-medium', done ? 'text-fg-muted' : 'text-fg')}
      >
        {children}
        {done ? <span className="sr-only"> (done)</span> : null}
      </span>
      {!done ? <ChevronRight className="text-fg-faint size-4" aria-hidden="true" /> : null}
    </>
  );
  const rowClass = 'flex min-h-11 w-full items-center gap-3 px-5 py-1.5 transition-colors';
  return (
    <li>
      {done ? (
        <div className={rowClass}>{content}</div>
      ) : to ? (
        <Link to={to} className={cn(rowClass, 'hover:bg-surface-2')}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={cn(rowClass, 'hover:bg-surface-2')}>
          {content}
        </button>
      )}
    </li>
  );
}
