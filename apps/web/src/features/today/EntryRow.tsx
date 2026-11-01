import type { DiaryEntry } from '@plate/shared';
import { Copy, Pencil, Trash2 } from 'lucide-react';
import { animate, motion, useMotionValue, type PanInfo } from 'motion/react';
import { useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { timeOfIso } from '@/lib/dates';
import { formatGrams, formatKcal } from '@/lib/format';
import { ENTRY_COLS, quantityText } from './entry-helpers';

export interface EntryRowProps {
  entry: DiaryEntry;
  onEdit: (entry: DiaryEntry) => void;
  onDuplicate: (entry: DiaryEntry) => void;
  onDelete: (entry: DiaryEntry) => void;
}

const REVEAL = 88;
const REVEAL_THRESHOLD = 40;
const COMMIT_THRESHOLD = 180;
const SPRING = { type: 'spring', stiffness: 500, damping: 40 } as const;

/**
 * One diary line. Drag left to reveal Delete, right to reveal Duplicate; a long drag commits the
 * action directly. Wide containers (`@2xl`) lay the values out in columns and show hover actions.
 * Optimistic rows (negative ids) render slightly faded until the server confirms.
 */
export function EntryRow({ entry, onEdit, onDuplicate, onDelete }: EntryRowProps) {
  const x = useMotionValue(0);
  const dragging = useRef(false);
  const [revealed, setRevealed] = useState<'delete' | 'duplicate' | null>(null);
  const pending = entry.id < 0;

  const settle = (target: number, next: typeof revealed) => {
    void animate(x, target, SPRING);
    setRevealed(next);
  };

  const onDragEnd = (_event: unknown, info: PanInfo) => {
    const offset = info.offset.x;
    // Let the click that may follow the pointer release know it was a drag.
    setTimeout(() => {
      dragging.current = false;
    }, 0);
    if (offset < -COMMIT_THRESHOLD) {
      settle(0, null);
      onDelete(entry);
    } else if (offset > COMMIT_THRESHOLD) {
      settle(0, null);
      onDuplicate(entry);
    } else if (offset < -REVEAL_THRESHOLD && revealed !== 'duplicate') {
      settle(-REVEAL, 'delete');
    } else if (offset > REVEAL_THRESHOLD && revealed !== 'delete') {
      settle(REVEAL, 'duplicate');
    } else {
      settle(0, null);
    }
  };

  const onRowClick = () => {
    if (dragging.current) return;
    if (revealed) settle(0, null);
    else onEdit(entry);
  };

  const { totals } = entry;
  const macros = `P ${formatGrams(totals.protein)} · C ${formatGrams(totals.carbs)} · F ${formatGrams(totals.fat)}`;
  const label = `${entry.name}, ${quantityText(entry)}, ${formatKcal(totals.kcal)} kcal at ${timeOfIso(entry.loggedAt)}`;

  return (
    <div className={cn('group relative overflow-hidden', pending && 'opacity-60')}>
      {/* Action layers under the draggable row. */}
      <div
        className="absolute inset-y-0 left-0 flex w-[88px]"
        aria-hidden={revealed !== 'duplicate'}
      >
        <button
          type="button"
          tabIndex={revealed === 'duplicate' ? 0 : -1}
          onClick={() => {
            settle(0, null);
            onDuplicate(entry);
          }}
          className="bg-accent-soft text-accent flex w-full flex-col items-center justify-center gap-1 text-xs font-medium"
        >
          <Copy className="size-5" aria-hidden="true" />
          Duplicate
        </button>
      </div>
      <div className="absolute inset-y-0 right-0 flex w-[88px]" aria-hidden={revealed !== 'delete'}>
        <button
          type="button"
          tabIndex={revealed === 'delete' ? 0 : -1}
          onClick={() => {
            settle(0, null);
            onDelete(entry);
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
        dragConstraints={{ left: -REVEAL, right: REVEAL }}
        dragElastic={0.12}
        dragMomentum={false}
        onDragStart={() => {
          dragging.current = true;
        }}
        onDragEnd={onDragEnd}
        style={{ x }}
        className="bg-surface relative"
      >
        <div className={cn('relative flex items-center gap-3 px-4 py-3 @2xl:py-2.5', ENTRY_COLS)}>
          {/* The whole row is one tap target; the action buttons sit above it. */}
          <button
            type="button"
            onClick={onRowClick}
            aria-label={`Edit ${label}`}
            className="focus-visible:ring-ring absolute inset-0 rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-inset"
          />

          <span className="min-w-0 flex-1">
            <span className="text-fg block truncate font-medium">{entry.name}</span>
            <span className="text-fg-muted mt-0.5 block text-xs @2xl:hidden">
              {timeOfIso(entry.loggedAt)} · {macros}
            </span>
          </span>

          {/* Narrow: kcal + quantity block. */}
          <span className="text-right @2xl:hidden">
            <span className="text-fg tabular block text-sm font-semibold">
              {formatKcal(totals.kcal)}
              <span className="text-fg-faint text-xs font-normal"> kcal</span>
            </span>
            <span className="text-fg-muted tabular mt-0.5 block text-xs">
              {quantityText(entry)}
            </span>
          </span>

          {/* Wide: one cell per column. */}
          <span className="text-fg-muted tabular hidden truncate text-right text-sm @2xl:block">
            {quantityText(entry)}
          </span>
          <span className="text-fg-muted tabular hidden text-right text-sm @2xl:block">
            {timeOfIso(entry.loggedAt)}
          </span>
          <span className="text-protein tabular hidden text-right text-sm @2xl:block">
            {formatGrams(totals.protein)}
          </span>
          <span className="text-carbs tabular hidden text-right text-sm @2xl:block">
            {formatGrams(totals.carbs)}
          </span>
          <span className="text-fat tabular hidden text-right text-sm @2xl:block">
            {formatGrams(totals.fat)}
          </span>
          <span className="text-fg tabular hidden text-right text-sm font-semibold @2xl:block">
            {formatKcal(totals.kcal)}
          </span>
          <span className="relative hidden justify-end gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 @2xl:flex">
            <RowAction label={`Edit ${entry.name}`} onClick={() => onEdit(entry)}>
              <Pencil className="size-4" />
            </RowAction>
            <RowAction label={`Duplicate ${entry.name}`} onClick={() => onDuplicate(entry)}>
              <Copy className="size-4" />
            </RowAction>
            <RowAction label={`Delete ${entry.name}`} onClick={() => onDelete(entry)} destructive>
              <Trash2 className="size-4" />
            </RowAction>
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function RowAction({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-[0.5rem] transition-colors',
        destructive
          ? 'text-fg-muted hover:bg-danger/10 hover:text-danger'
          : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
