import { Fragment } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { Sheet } from '@/components/ui/sheet';

interface ShortcutGroup {
  title: string;
  items: { keys: string[]; label: string }[];
}

// Only what exists: lib/keyboard.ts handlers in AppShell, TodayPage and InsightsPage.
const GROUPS: ShortcutGroup[] = [
  {
    title: 'Everywhere',
    items: [
      { keys: ['?'], label: 'Show this help' },
      { keys: ['Esc'], label: 'Close a sheet or dialog' },
    ],
  },
  {
    title: 'Today',
    items: [
      { keys: ['←', '→'], label: 'Previous or next day' },
      { keys: ['T'], label: 'Jump to today' },
      { keys: ['N'], label: 'Log food' },
    ],
  },
  {
    title: 'Insights',
    items: [{ keys: ['←', '→'], label: 'Previous or next period' }],
  },
];

interface ShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Desktop keyboard shortcut reference, opened with `?` or from the sidebar (DESIGN §9). */
export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Shortcuts are ignored while typing in a field or while a sheet is open."
      autoFocusFirstField={false}
    >
      <div className="flex flex-col gap-5 pt-1">
        {GROUPS.map((group) => (
          <section key={group.title} aria-labelledby={`shortcuts-${group.title}`}>
            <h3
              id={`shortcuts-${group.title}`}
              className="text-fg-muted text-xs font-medium tracking-wide uppercase"
            >
              {group.title}
            </h3>
            <dl className="mt-2 flex flex-col divide-y divide-border">
              {group.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 py-2.5">
                  <dt className="text-fg text-sm">{item.label}</dt>
                  <dd className="flex items-center gap-1">
                    {item.keys.map((key, i) => (
                      <Fragment key={key}>
                        {i > 0 ? (
                          <span className="text-fg-faint text-xs" aria-hidden="true">
                            /
                          </span>
                        ) : null}
                        <Kbd>{key}</Kbd>
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
