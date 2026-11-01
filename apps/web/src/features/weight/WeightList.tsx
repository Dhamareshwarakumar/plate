import type { Weight } from '@plate/shared';
import { Trash2 } from 'lucide-react';
import { animate, motion, useMotionValue, type PanInfo } from 'motion/react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDayLabel, formatDayWithYear, todayKey } from '@/lib/dates';
import { formatKg, formatSignedKg } from '@/lib/format';

export interface WeightListProps {
  /** Weigh-ins of the selected range, any order; rendered newest first. */
  entries: readonly Weight[];
  /** The weigh-in just before the oldest visible one, so the first delta is still shown. */
  previous?: Weight | undefined;
  onEdit: (weight: Weight) => void;
  onDelete: (weight: Weight) => void;
}

const REVEAL = 88;
const REVEAL_THRESHOLD = 40;
const COMMIT_THRESHOLD = 180;
const SPRING = { type: 'spring', stiffness: 500, damping: 40 } as const;

/** The entries list of the Weight page (DESIGN §6): tap to edit, swipe left or hover to delete. */
export function WeightList({ entries, previous, onEdit, onDelete }: WeightListProps) {
  const sorted = [...entries].sort((a, b) => b.day.localeCompare(a.day));
  const year = todayKey().slice(0, 4);
  return (
    <ul className="@container divide-border divide-y" aria-label="Weigh-ins">
      {sorted.map((weight, i) => {
        const older = sorted[i + 1] ?? previous;
        return (
          <WeightRow
            key={weight.day}
            weight={weight}
            delta={older ? weight.kg - older.kg : null}
            showYear={weight.day.slice(0, 4) !== year}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );
      })}
    </ul>
  );
}

function WeightRow({
  weight,
  delta,
  showYear,
  onEdit,
  onDelete,
}: {
  weight: Weight;
  delta: number | null;
  showYear: boolean;
  onEdit: (weight: Weight) => void;
  onDelete: (weight: Weight) => void;
}) {
  const x = useMotionValue(0);
  const dragging = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const pending = weight.id < 0;

  const settle = (target: number, next: boolean) => {
    void animate(x, target, SPRING);
    setRevealed(next);
  };

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    const offset = info.offset.x;
    setTimeout(() => {
      dragging.current = false;
    }, 0);
    if (offset < -COMMIT_THRESHOLD) {
      settle(0, false);
      onDelete(weight);
    } else if (offset < -REVEAL_THRESHOLD) {
      settle(-REVEAL, true);
    } else {
      settle(0, false);
    }
  };

  const onRowClick = () => {
    if (dragging.current || pending) return;
    if (revealed) settle(0, false);
    else onEdit(weight);
  };

  const dayLabel = showYear ? formatDayWithYear(weight.day) : formatDayLabel(weight.day);
  const label = `${dayLabel}, ${formatKg(weight.kg)} kg${weight.note ? `, ${weight.note}` : ''}`;

  return (
    <li className={cn('group relative overflow-hidden', pending && 'opacity-60')}>
      <div className="absolute inset-y-0 right-0 flex w-[88px]" aria-hidden={!revealed}>
        <button
          type="button"
          tabIndex={revealed ? 0 : -1}
          onClick={() => {
            settle(0, false);
            onDelete(weight);
          }}
          className="bg-danger flex w-full flex-col items-center justify-center gap-1 text-xs font-medium text-white"
        >
          <Trash2 className="size-5" aria-hidden="true" />
          Delete
        </button>
      </div>

      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={0.12}
        dragMomentum={false}
        onDragStart={() => {
          dragging.current = true;
        }}
        onDragEnd={onDragEnd}
        style={{ x }}
        className="bg-surface relative"
      >
        <div className="relative flex min-h-14 items-center gap-3 px-4 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={onRowClick}
            aria-label={`Edit weigh-in on ${label}`}
            className="focus-visible:ring-ring absolute inset-0 rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-inset"
          />
          <span className="min-w-0 flex-1">
            <span className="text-fg block text-sm font-medium">{dayLabel}</span>
            {weight.note ? (
              <span className="text-fg-muted mt-0.5 block truncate text-xs">{weight.note}</span>
            ) : null}
          </span>
          <span className="text-right">
            <span className="text-fg tabular block text-base font-semibold">
              {formatKg(weight.kg)}
              <span className="text-fg-faint text-xs font-normal"> kg</span>
            </span>
            {delta !== null ? (
              <span
                className={cn(
                  'tabular mt-0.5 block text-xs',
                  Math.abs(delta) < 0.05 ? 'text-fg-faint' : 'text-fg-muted',
                )}
              >
                {formatSignedKg(delta)}
              </span>
            ) : null}
          </span>
          <span className="relative hidden opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 @xl:flex">
            <button
              type="button"
              aria-label={`Delete weigh-in on ${dayLabel}`}
              onClick={() => onDelete(weight)}
              className="text-fg-muted hover:bg-danger/10 hover:text-danger flex size-9 items-center justify-center rounded-[0.5rem] transition-colors"
            >
              <Trash2 className="size-4" />
            </button>
          </span>
        </div>
      </motion.div>
    </li>
  );
}
