import type { ImportConflictStrategy, ImportResult } from '@plate/shared';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Sheet } from '@/components/ui/sheet';
import { ApiClientError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useImportFoods } from './api';

const TEMPLATE_CSV =
  'name,brand,category,basis,kcal,protein,carbs,fat,fiber,sugar,saturated_fat,sodium_mg,portions\r\n' +
  'Banana,,Fruit,g,89,1.1,22.8,0.3,2.6,12.2,,1,1 medium=118;1 large=136\r\n' +
  '"Milk, whole",Arla,Dairy,ml,64,3.3,4.8,3.6,,,2.3,44,1 cup=240\r\n';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Two-step CSV import: pick a file → preview (dry run) → import. All state lives in the inner
 * component, which is remounted (fresh state) every time the sheet opens.
 */
export function ImportCsvSheet({ open, onOpenChange }: Props) {
  const [session, setSession] = useState(0);
  const handleOpenChange = (next: boolean) => {
    if (next) setSession((n) => n + 1);
    onOpenChange(next);
  };
  return <ImportSheetInner key={session} open={open} onOpenChange={handleOpenChange} />;
}

function ImportSheetInner({ open, onOpenChange }: Props) {
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [onConflict, setOnConflict] = useState<ImportConflictStrategy>('skip');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const importFoods = useImportFoods();

  const runPreview = async (text: string, strategy: ImportConflictStrategy) => {
    setPreviewError(null);
    try {
      setPreview(await importFoods.mutateAsync({ csv: text, dryRun: true, onConflict: strategy }));
    } catch (err) {
      setPreview(null);
      setPreviewError(err instanceof ApiClientError ? err.message : 'Could not read this file.');
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error('That file is larger than 20 MB.');
      return;
    }
    const text = await file.text();
    setCsv({ name: file.name, text });
    await runPreview(text, onConflict);
  };

  const onStrategy = async (strategy: ImportConflictStrategy) => {
    setOnConflict(strategy);
    if (csv) await runPreview(csv.text, strategy);
  };

  const importable = preview ? preview.summary.create + preview.summary.update : 0;
  const importing = importFoods.isPending && importFoods.variables?.dryRun === false;
  const previewing = importFoods.isPending && importFoods.variables?.dryRun === true;

  const onImport = async () => {
    if (!csv || !preview) return;
    try {
      const result = await importFoods.mutateAsync({ csv: csv.text, dryRun: false, onConflict });
      const { create, update, skip, error } = result.summary;
      toast.success(
        `Imported ${create} new${update ? `, updated ${update}` : ''}${skip ? `, skipped ${skip}` : ''}${error ? `, ${error} with errors` : ''}.`,
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Import failed. Try again.');
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Import foods from CSV"
      description="Preview first; nothing is written until you confirm."
      locked={importing}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button
            onClick={() => void onImport()}
            disabled={!preview || importable === 0}
            loading={importing}
          >
            {importable > 0 ? `Import ${importable} food${importable === 1 ? '' : 's'}` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label
          className={cn(
            'border-border-strong hover:border-accent hover:bg-accent-soft/40 focus-within:outline-ring flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed px-4 py-6 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2',
            csv && 'border-accent bg-accent-soft/30',
          )}
        >
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {csv ? (
            <FileSpreadsheet className="text-accent size-7" aria-hidden="true" />
          ) : (
            <Upload className="text-fg-muted size-7" aria-hidden="true" />
          )}
          <span className="text-fg text-sm font-medium">
            {csv ? csv.name : 'Choose a CSV file'}
          </span>
          <span className="text-fg-muted text-xs">
            Columns: name, kcal, protein, carbs, fat (required); brand, category, basis, fiber,
            sugar, saturated_fat, sodium_mg, portions.
          </span>
        </label>

        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`}
          download="plate-foods-template.csv"
          className="text-accent self-start text-sm font-medium underline-offset-4 hover:underline"
        >
          Download a template
        </a>

        {csv ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-fg text-sm font-medium">When a food already exists</span>
            <Segmented
              aria-label="Conflict handling"
              value={onConflict}
              onChange={(v) => void onStrategy(v)}
              options={[
                { value: 'skip', label: 'Keep mine' },
                { value: 'update', label: 'Overwrite with file' },
              ]}
            />
          </div>
        ) : null}

        {previewError ? (
          <p role="alert" className="bg-danger/10 text-danger rounded-control px-3 py-2 text-sm">
            {previewError}
          </p>
        ) : null}

        {preview ? <Preview result={preview} loading={previewing} /> : null}
      </div>
    </Sheet>
  );
}

function Preview({ result, loading }: { result: ImportResult; loading: boolean }) {
  const { create, update, skip, error } = result.summary;
  const problems = result.rows.filter((r) => r.action === 'error');
  return (
    <div
      className={cn('flex flex-col gap-3 transition-opacity', loading && 'opacity-60')}
      aria-busy={loading}
    >
      <dl className="grid grid-cols-4 gap-2 text-center">
        <Stat label="New" value={create} tone="text-success" />
        <Stat label="Update" value={update} tone="text-accent" />
        <Stat label="Skip" value={skip} tone="text-fg-muted" />
        <Stat label="Errors" value={error} tone={error > 0 ? 'text-danger' : 'text-fg-muted'} />
      </dl>
      {problems.length > 0 ? (
        <div className="border-border rounded-control border">
          <p className="text-fg-muted border-border border-b px-3 py-2 text-xs font-medium">
            Rows with errors are skipped. Fix them in the file and import again if you need them.
          </p>
          <ul className="divide-border max-h-56 divide-y overflow-y-auto text-sm">
            {problems.map((row) => (
              <li key={row.line} className="px-3 py-2">
                <span className="text-fg font-medium">
                  Line {row.line}
                  {row.name ? `: ${row.name}` : ''}
                </span>
                <ul className="text-danger mt-0.5 list-inside list-disc text-xs">
                  {row.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="bg-surface-2 rounded-control px-2 py-2">
      <dt className="text-fg-muted text-[0.6875rem] font-medium uppercase">{label}</dt>
      <dd className={cn('tabular text-lg font-semibold', tone)}>{value}</dd>
    </div>
  );
}
