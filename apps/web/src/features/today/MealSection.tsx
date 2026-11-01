import type { DiaryDaySlot, DiaryEntry } from '@plate/shared';
import {
  BookmarkPlus,
  CalendarArrowDown,
  CalendarArrowUp,
  Eraser,
  History,
  Plus,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/menu';
import { cn } from '@/lib/cn';
import { formatKcal } from '@/lib/format';
import { ENTRY_COLS } from './entry-helpers';
import { EntryRow } from './EntryRow';

export interface MealSectionProps {
  section: DiaryDaySlot;
  onAdd: (slotId: number) => void;
  onEdit: (entry: DiaryEntry) => void;
  onDuplicate: (entry: DiaryEntry) => void;
  onDelete: (entry: DiaryEntry) => void;
  onCopyFromYesterday: (slotId: number) => void;
  onCopyFrom: (slotId: number) => void;
  onCopyTo: (slotId: number) => void;
  onSaveAsTemplate: (section: DiaryDaySlot) => void;
  onClear: (section: DiaryDaySlot) => void;
}

/** One meal: header with subtotal and menu, entry rows, and a ghost "add" row. */
export function MealSection({
  section,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
  onCopyFromYesterday,
  onCopyFrom,
  onCopyTo,
  onSaveAsTemplate,
  onClear,
}: MealSectionProps) {
  const { slot, entries, totals } = section;
  const archived = slot.archivedAt !== null;
  const empty = entries.length === 0;
  // Templates hold library foods only; a meal of quick entries has nothing to save (FR-R3).
  const hasLibraryEntries = entries.some((e) => e.foodId !== null);

  return (
    <section
      aria-labelledby={`meal-${slot.id}`}
      className="@container bg-surface border-border shadow-card rounded-card overflow-hidden border"
    >
      <header className="flex items-center gap-2 pr-2 pl-4 pt-3 pb-2">
        <h2
          id={`meal-${slot.id}`}
          className="text-fg min-w-0 flex-1 truncate text-base font-semibold"
        >
          {slot.name}
          {archived ? (
            <span className="text-fg-faint ml-2 text-xs font-normal">archived</span>
          ) : null}
        </h2>
        <span className="text-fg-muted tabular text-sm">
          {empty ? '—' : <span className="text-fg font-semibold">{formatKcal(totals.kcal)}</span>}{' '}
          kcal
        </span>
        <Menu
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={`${slot.name} actions`}>
              <span className="text-lg leading-none">⋯</span>
            </Button>
          }
        >
          {!archived ? (
            <MenuItem icon={<Plus />} onSelect={() => onAdd(slot.id)}>
              Add food
            </MenuItem>
          ) : null}
          {!archived ? (
            <MenuItem icon={<History />} onSelect={() => onCopyFromYesterday(slot.id)}>
              Copy from yesterday
            </MenuItem>
          ) : null}
          {!archived ? (
            <MenuItem icon={<CalendarArrowDown />} onSelect={() => onCopyFrom(slot.id)}>
              Copy from another day…
            </MenuItem>
          ) : null}
          <MenuItem icon={<CalendarArrowUp />} onSelect={() => onCopyTo(slot.id)} disabled={empty}>
            Copy to another day…
          </MenuItem>
          <MenuItem
            icon={<BookmarkPlus />}
            onSelect={() => onSaveAsTemplate(section)}
            disabled={!hasLibraryEntries}
          >
            Save as meal template…
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<Eraser />}
            onSelect={() => onClear(section)}
            disabled={empty}
            destructive
          >
            Clear meal
          </MenuItem>
        </Menu>
      </header>

      {!empty ? (
        <div
          className={cn(
            'text-fg-muted border-border hidden border-t px-4 py-1.5 text-[0.6875rem] font-medium',
            ENTRY_COLS,
          )}
          aria-hidden="true"
        >
          <span>Food</span>
          <span className="text-right">Quantity</span>
          <span className="text-right">Time</span>
          <span className="text-protein text-right">P</span>
          <span className="text-carbs text-right">C</span>
          <span className="text-fat text-right">F</span>
          <span className="text-right">kcal</span>
          <span />
        </div>
      ) : null}

      <ul className="divide-border border-border divide-y border-t">
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.li
              key={entry.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 36 }}
              className="overflow-hidden"
            >
              <EntryRow
                entry={entry}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            </motion.li>
          ))}
        </AnimatePresence>
        {!archived ? (
          <li>
            <button
              type="button"
              onClick={() => onAdd(slot.id)}
              className={cn(
                'text-fg-muted hover:text-accent hover:bg-surface-2 flex h-11 w-full items-center gap-2 px-4 text-sm font-medium transition-colors',
                empty && 'text-fg-faint',
              )}
            >
              <Plus className="size-4" aria-hidden="true" />
              {empty ? `Nothing yet · Add to ${slot.name}` : `Add to ${slot.name}`}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
