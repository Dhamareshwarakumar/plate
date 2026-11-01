import type { Food } from '@plate/shared';
import { Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { FoodPicker } from '@/features/today/FoodPicker';

export interface FoodPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Called with the chosen food; the sheet closes itself afterwards. */
  onPick: (food: Food) => void;
  /** Narrows the library (e.g. dish ingredients cannot be dishes). */
  filter?: ((food: Food) => boolean) | undefined;
}

/** The log flow's pick list in a sheet of its own, for choosing ingredients and template items. */
export function FoodPickerSheet(props: FoodPickerSheetProps) {
  // Fresh search state on every open; the same instance stays mounted during the close animation.
  const [session, setSession] = useState(0);
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setSession((n) => n + 1);
  }
  return <FoodPickerSheetInner key={session} {...props} />;
}

function FoodPickerSheetInner({
  open,
  onOpenChange,
  title,
  description,
  onPick,
  filter,
}: FoodPickerSheetProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description ? { description } : {})}
      className="h-[92dvh] sm:h-auto sm:min-h-[32rem] sm:max-w-[40rem]"
      headerExtra={
        <div className="relative">
          <Search
            className="text-fg-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search foods"
            aria-label="Search foods"
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="search"
            className="pr-10 pl-10"
            data-autofocus
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="text-fg-muted hover:text-fg absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      }
    >
      <FoodPicker
        query={query}
        filter={filter}
        onPick={(food) => {
          onPick(food);
          onOpenChange(false);
        }}
      />
    </Sheet>
  );
}
