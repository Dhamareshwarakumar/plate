import type { BySlot as BySlotData } from '@plate/shared';
import { Tag } from '@/components/ui/chip';
import { formatKcal } from '@/lib/format';

export interface BySlotProps {
  data: BySlotData;
}

/** Average kcal per meal slot over the logged days of the range, as relative bars (FR-I7). */
export function BySlot({ data }: BySlotProps) {
  const max = Math.max(0, ...data.slots.map((s) => s.avgKcal));
  const dayWord = data.loggedDays === 1 ? 'day' : 'days';
  return (
    <div>
      {data.loggedDays === 0 ? (
        <p className="text-fg-faint text-sm">Nothing logged in this range.</p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Average calories by meal">
          {data.slots.map((slot) => (
            <li key={slot.slotId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-fg flex min-w-0 items-center gap-2 font-medium">
                  <span className="truncate">{slot.name}</span>
                  {slot.archived ? <Tag>Archived</Tag> : null}
                </span>
                <span className="tabular shrink-0">
                  <span className="text-fg font-semibold">{formatKcal(slot.avgKcal)}</span>
                  <span className="text-fg-muted"> kcal</span>
                  <span className="text-fg-faint text-xs">
                    {' · '}
                    {slot.days} {slot.days === 1 ? 'day' : 'days'}
                  </span>
                </span>
              </div>
              <div
                className="bg-surface-2 mt-1.5 h-2.5 overflow-hidden rounded-full"
                role="progressbar"
                aria-label={`${slot.name}: ${formatKcal(slot.avgKcal)} kcal per logged day`}
                aria-valuemin={0}
                aria-valuemax={Math.round(max)}
                aria-valuenow={Math.round(slot.avgKcal)}
              >
                <div
                  className="bg-accent h-full rounded-full transition-[width]"
                  style={{ width: max === 0 ? 0 : `${Math.round((slot.avgKcal / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-fg-muted mt-4 text-xs">
        Average over {data.loggedDays} logged {dayWord}; the slots add up to the daily average.
      </p>
    </div>
  );
}
