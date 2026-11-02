import { backupCounts, RESTORE_CONFIRMATION, type Backup } from '@plate/shared';
import { FileJson, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAbout, useRestoreBackup } from './api';
import { readBackupFile, type ReadBackupResult } from './backup-file';

/** Matches the API's body limit for `POST backup/restore`. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const SHOWN_ISSUES = 5;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Restore from a backup file (FR-S4): pick → preview what will be replaced next to the server's
 * current counts → type REPLACE → restore. State lives in the inner component, remounted on open.
 */
export function ImportBackupSheet({ open, onOpenChange }: Props) {
  const [session, setSession] = useState(0);
  const handleOpenChange = (next: boolean) => {
    if (next) setSession((n) => n + 1);
    onOpenChange(next);
  };
  return <ImportBackupInner key={session} open={open} onOpenChange={handleOpenChange} />;
}

interface PickedFile {
  name: string;
  result: ReadBackupResult;
}

function ImportBackupInner({ open, onOpenChange }: Props) {
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const about = useAbout();
  const restore = useRestoreBackup();

  const backup: Backup | null = picked?.result.ok ? picked.result.backup : null;
  const confirmed = confirmation.trim() === RESTORE_CONFIRMATION;
  const pending = restore.isPending;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error('That file is larger than 50 MB.');
      return;
    }
    setRestoreError(null);
    setConfirmation('');
    setPicked({ name: file.name, result: readBackupFile(await file.text()) });
  };

  const onRestore = async () => {
    if (!backup || !confirmed) return;
    setRestoreError(null);
    try {
      const { restored } = await restore.mutateAsync(backup);
      toast.success(
        `Backup restored: ${restored.foods} ${restored.foods === 1 ? 'food' : 'foods'}, ${restored.diaryEntries} diary ${restored.diaryEntries === 1 ? 'entry' : 'entries'}.`,
      );
      onOpenChange(false);
    } catch (err) {
      setRestoreError(
        err instanceof ApiClientError ? err.message : 'The restore failed. Nothing was changed.',
      );
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Import backup"
      description="Replace everything on this server with a Plate backup file."
      locked={pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void onRestore()}
            disabled={!backup || !confirmed}
            loading={pending}
          >
            Restore backup
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label
          className={cn(
            'border-border-strong hover:border-accent hover:bg-accent-soft/40 flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed px-4 text-center transition-colors',
            picked ? 'border-accent bg-accent-soft/30 py-4' : 'py-6',
            pending && 'pointer-events-none opacity-60',
          )}
        >
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            disabled={pending}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {picked ? (
            <FileJson className="text-accent size-7" aria-hidden="true" />
          ) : (
            <Upload className="text-fg-muted size-7" aria-hidden="true" />
          )}
          <span className="text-fg text-sm font-medium">
            {picked ? picked.name : 'Choose a backup file'}
          </span>
          <span className="text-fg-muted text-xs">
            {picked ? (
              'Choose a different file to replace it.'
            ) : (
              <>
                A <code>plate-backup-….json</code> file exported from Plate.
              </>
            )}
          </span>
        </label>

        {picked && !picked.result.ok ? (
          <div role="alert" className="bg-danger/10 text-danger rounded-control px-3 py-2 text-sm">
            <p>{picked.result.message}</p>
            {picked.result.code === 'invalid' && picked.result.issues.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-xs">
                {picked.result.issues.slice(0, SHOWN_ISSUES).map((issue) => (
                  <li key={issue.path}>
                    <code>{issue.path.replace(/^backup\./, '')}</code>: {issue.message}
                  </li>
                ))}
                {picked.result.issues.length > SHOWN_ISSUES ? (
                  <li>and {picked.result.issues.length - SHOWN_ISSUES} more</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        {backup ? (
          <>
            <Preview
              backup={backup}
              server={
                about.isPending
                  ? 'loading'
                  : about.isError
                    ? 'error'
                    : {
                        foods: about.data.counts.foods,
                        entries: about.data.counts.entries,
                        days: about.data.counts.days,
                      }
              }
            />
            <p className="bg-danger/10 text-danger rounded-control px-3 py-2 text-sm">
              Restoring deletes everything on this server and replaces it with the file. Your
              password and this sign-in are kept.
            </p>
            <Field label={`Type ${RESTORE_CONFIRMATION} to confirm`}>
              {(control) => (
                <Input
                  id={control.id}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={pending}
                  placeholder={RESTORE_CONFIRMATION}
                  aria-describedby={control['aria-describedby']}
                />
              )}
            </Field>
          </>
        ) : null}

        {restoreError ? (
          <p role="alert" className="bg-danger/10 text-danger rounded-control px-3 py-2 text-sm">
            {restoreError}
          </p>
        ) : null}

        <p className={cn('text-fg-muted text-sm', !pending && 'sr-only')} aria-live="polite">
          {pending ? 'Restoring… this can take a few seconds.' : null}
        </p>
      </div>
    </Sheet>
  );
}

type ServerCounts = 'loading' | 'error' | { foods: number; entries: number; days: number };

function Preview({ backup, server }: { backup: Backup; server: ServerCounts }) {
  const counts = backupCounts(backup);
  const exported = new Date(backup.exportedAt);
  const exportedText = Number.isNaN(exported.getTime())
    ? backup.exportedAt
    : exported.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const serverCell = (key: 'foods' | 'entries' | 'days'): ReactNode => {
    if (server === 'loading') return <Skeleton className="ml-auto h-4 w-10" />;
    if (server === 'error') {
      return (
        <span className="text-fg-faint" aria-label="unknown">
          —
        </span>
      );
    }
    return server[key].toLocaleString();
  };
  const rows: [label: string, file: number, server: ReactNode][] = [
    ['Foods', counts.foods, serverCell('foods')],
    ['Diary entries', counts.entries, serverCell('entries')],
    ['Days logged', counts.days, serverCell('days')],
    ['Weigh-ins', counts.weights, null],
    ['Goals', counts.goals, null],
  ];
  return (
    <div className="border-border rounded-control border">
      <p className="text-fg-muted border-border border-b px-3 py-2 text-xs">
        Exported {exportedText} · Plate {backup.appVersion}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-fg-muted text-xs">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              <span className="sr-only">Count</span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              In this file
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              On this server
            </th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y border-t border-border">
          {rows.map(([label, file, current]) => (
            <tr key={label}>
              <th scope="row" className="text-fg px-3 py-2 text-left font-normal">
                {label}
              </th>
              <td className="text-fg tabular px-3 py-2 text-right font-medium">
                {file.toLocaleString()}
              </td>
              <td className="text-fg-muted tabular px-3 py-2 text-right">
                {current ?? <span className="text-fg-faint">·</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
