import {
  ChevronRight,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { ImportCsvSheet } from '@/features/foods/ImportCsvSheet';
import { DOWNLOADS } from './api';
import { ExportDiaryCsvSheet } from './ExportDiaryCsvSheet';
import { ImportBackupSheet } from './ImportBackupSheet';

type OpenSheet = 'backup' | 'foodsCsv' | 'diaryCsv' | null;

interface Action {
  icon: LucideIcon;
  label: string;
  description: string;
  /** Download: navigates to the attachment URL. Otherwise opens a sheet. */
  kind: 'download' | 'sheet';
  onSelect: () => void;
}

/** More → Data (FR-S4, FR-S5): backups and CSV in and out. */
export function DataCard() {
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const download = (url: string) => () => window.location.assign(url);

  const groups: { title: string; actions: Action[] }[] = [
    {
      title: 'Backup',
      actions: [
        {
          icon: FileJson,
          label: 'Export backup',
          description: 'Everything as one JSON file you can restore later.',
          kind: 'download',
          onSelect: download(DOWNLOADS.backupJson),
        },
        {
          icon: Upload,
          label: 'Import backup…',
          description: 'Replace everything on this server with a backup file.',
          kind: 'sheet',
          onSelect: () => setSheet('backup'),
        },
        {
          icon: Database,
          label: 'Download database snapshot',
          description: 'The SQLite file itself, for your own tools.',
          kind: 'download',
          onSelect: download(DOWNLOADS.backupSqlite),
        },
      ],
    },
    {
      title: 'CSV',
      actions: [
        {
          icon: FileSpreadsheet,
          label: 'Export foods CSV',
          description: 'Your food library as a spreadsheet.',
          kind: 'download',
          onSelect: download(DOWNLOADS.foodsCsv),
        },
        {
          icon: Upload,
          label: 'Import foods CSV…',
          description: 'Add or update foods from a spreadsheet.',
          kind: 'sheet',
          onSelect: () => setSheet('foodsCsv'),
        },
        {
          icon: FileSpreadsheet,
          label: 'Export diary CSV…',
          description: 'Every entry in a date range, with totals.',
          kind: 'sheet',
          onSelect: () => setSheet('diaryCsv'),
        },
      ],
    },
  ];

  return (
    <Card className="p-0">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardTitle>Data</CardTitle>
        <CardDescription>Your data is yours: take it with you or bring it back.</CardDescription>
      </div>
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title} className="mt-3">
          <h3 className="text-fg-muted border-border border-t px-4 pt-3 pb-1 text-xs font-medium uppercase sm:px-5">
            {group.title}
          </h3>
          <ul>
            {group.actions.map((action) => (
              <ActionRow key={action.label} action={action} />
            ))}
          </ul>
        </section>
      ))}
      <div className="pb-2" />
      <ImportBackupSheet
        open={sheet === 'backup'}
        onOpenChange={(open) => setSheet(open ? 'backup' : null)}
      />
      <ImportCsvSheet
        open={sheet === 'foodsCsv'}
        onOpenChange={(open) => setSheet(open ? 'foodsCsv' : null)}
      />
      <ExportDiaryCsvSheet
        open={sheet === 'diaryCsv'}
        onOpenChange={(open) => setSheet(open ? 'diaryCsv' : null)}
      />
    </Card>
  );
}

/** Full-width row; the label is the button's name, the description its `aria-describedby`. */
function ActionRow({ action }: { action: Action }) {
  const id = useId();
  const Trailing = action.kind === 'download' ? Download : ChevronRight;
  return (
    <li>
      <button
        type="button"
        onClick={action.onSelect}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-description`}
        className="hover:bg-surface-2 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors sm:px-5"
      >
        <action.icon className="text-fg-muted size-5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span id={`${id}-label`} className="text-fg block text-sm font-medium">
            {action.label}
          </span>
          <span id={`${id}-description`} className="text-fg-muted block text-xs">
            {action.description}
          </span>
        </span>
        <Trailing className="text-fg-faint size-4 shrink-0" aria-hidden="true" />
      </button>
    </li>
  );
}
