import type { TopFood, TopFoods as TopFoodsData } from '@plate/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { CardTitle } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { formatKcal } from '@/lib/format';

export interface TopFoodsProps {
  data: TopFoodsData;
}

type Measure = 'count' | 'kcal';

/** Dishes are edited through their ingredients, on their own route (see app/router.tsx). */
const editPath = (foodId: number, kind: TopFood['kind']) =>
  kind === 'dish' ? `/foods/dishes/${foodId}` : `/foods/${foodId}`;

const MEASURE_OPTIONS = [
  { value: 'count', label: 'count' },
  { value: 'kcal', label: 'kcal' },
] as const satisfies readonly { value: Measure; label: string }[];

/** The ten most-logged or most-caloric foods of the range with proportional bars (FR-I6). */
export function TopFoods({ data }: TopFoodsProps) {
  const [measure, setMeasure] = useState<Measure>('count');
  const list = measure === 'count' ? data.byCount : data.byKcal;
  const max = Math.max(0, ...list.map((f) => (measure === 'count' ? f.count : f.kcal)));

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Top foods</CardTitle>
        <Segmented<Measure>
          aria-label="Rank top foods by"
          value={measure}
          onChange={setMeasure}
          options={MEASURE_OPTIONS}
          className="w-[10rem]"
        />
      </div>
      {list.length === 0 ? (
        <p className="text-fg-faint mt-4 text-sm">Nothing logged in this range.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-1" aria-label={`Top foods by ${measure}`}>
          {list.map((food, i) => (
            <TopFoodRow
              key={food.foodId ?? `adhoc:${food.name}`}
              rank={i + 1}
              food={food}
              share={max === 0 ? 0 : (measure === 'count' ? food.count : food.kcal) / max}
              primary={measure}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function TopFoodRow({
  rank,
  food,
  share,
  primary,
}: {
  rank: number;
  food: TopFood;
  share: number;
  primary: Measure;
}) {
  const count = `${food.count}×`;
  const kcal = `${formatKcal(food.kcal)} kcal`;
  return (
    <li className="relative overflow-hidden rounded-md">
      <span
        aria-hidden="true"
        className="bg-accent/15 absolute inset-y-0 left-0 rounded-md transition-[width]"
        style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
      />
      <div className="relative flex min-h-10 items-center gap-3 px-2 py-1.5 text-sm">
        <span className="text-fg-faint tabular w-5 shrink-0 text-right text-xs">{rank}.</span>
        {food.foodId !== null ? (
          <Link
            to={editPath(food.foodId, food.kind)}
            className="text-fg min-w-0 flex-1 truncate font-medium hover:underline"
          >
            {food.name}
          </Link>
        ) : (
          <span className="text-fg min-w-0 flex-1 truncate font-medium">
            {food.name}
            <span className="text-fg-faint font-normal"> · ad hoc</span>
          </span>
        )}
        <span
          className={cn(
            'tabular shrink-0 text-right',
            primary === 'count' ? 'text-fg font-semibold' : 'text-fg-muted',
          )}
        >
          {count}
        </span>
        <span
          className={cn(
            'tabular w-24 shrink-0 text-right',
            primary === 'kcal' ? 'text-fg font-semibold' : 'text-fg-muted',
          )}
        >
          {kcal}
        </span>
      </div>
    </li>
  );
}
