import {
  foodInputSchema,
  type Category,
  type Food,
  type FoodInputParsed,
  type ImportConflictStrategy,
  type ImportResult,
  type ImportRowResult,
} from '@plate/shared';
import { AppError } from '../errors.js';
import type { CategoryService } from '../categories/service.js';
import { CsvParseError, parseCsv, toCsvLine } from './csv.js';
import type { FoodService } from './service.js';

/** Column order of the export; import accepts these columns in any order and ignores unknown ones. */
export const FOOD_CSV_COLUMNS = [
  'name',
  'brand',
  'category',
  'basis',
  'kcal',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'sugar',
  'saturated_fat',
  'sodium_mg',
  'portions',
] as const;

const REQUIRED_COLUMNS = ['name', 'kcal', 'protein', 'carbs', 'fat'] as const;
const MAX_IMPORT_ROWS = 5000;

export function foodsToCsv(items: readonly Food[], categoryList: readonly Category[]): string {
  const categoryName = new Map(categoryList.map((c) => [c.id, c.name]));
  const lines = [toCsvLine(FOOD_CSV_COLUMNS)];
  for (const f of items) {
    lines.push(
      toCsvLine([
        f.name,
        f.brand,
        f.categoryId === null ? '' : (categoryName.get(f.categoryId) ?? ''),
        f.basis,
        f.per100.kcal,
        f.per100.protein,
        f.per100.carbs,
        f.per100.fat,
        f.per100.fiber,
        f.per100.sugar,
        f.per100.saturatedFat,
        f.per100.sodiumMg,
        f.portions.map((p) => `${p.label.replace(/[=;]/g, ' ')}=${p.amount}`).join(';'),
      ]),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

interface ParsedRow {
  line: number;
  name: string;
  brand: string | null;
  input?: FoodInputParsed;
  errors: string[];
}

function parseNumber(
  raw: string | undefined,
  column: string,
  errors: string[],
  required: boolean,
): number | null {
  const value = (raw ?? '').trim().replace(',', '.');
  if (value === '') {
    if (required) errors.push(`${column} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.push(`${column} is not a number: "${raw}"`);
    return null;
  }
  return n;
}

function parsePortions(
  raw: string | undefined,
  errors: string[],
): { label: string; amount: number }[] {
  const text = (raw ?? '').trim();
  if (text === '') return [];
  const out: { label: string; amount: number }[] = [];
  for (const part of text.split(';')) {
    const piece = part.trim();
    if (piece === '') continue;
    const eq = piece.lastIndexOf('=');
    if (eq === -1) {
      errors.push(`portion "${piece}" must look like "label=grams"`);
      continue;
    }
    const label = piece.slice(0, eq).trim();
    const amount = Number(
      piece
        .slice(eq + 1)
        .trim()
        .replace(',', '.'),
    );
    if (label === '' || !Number.isFinite(amount) || amount <= 0) {
      errors.push(`portion "${piece}" has an empty label or a non-positive amount`);
      continue;
    }
    out.push({ label, amount });
  }
  return out;
}

export class FoodImporter {
  constructor(
    private readonly foodService: FoodService,
    private readonly categoryService: CategoryService,
  ) {}

  /** Validates every row, decides create/update/skip per the strategy, and applies unless dryRun. */
  run(
    csvText: string,
    options: { dryRun: boolean; onConflict: ImportConflictStrategy },
  ): ImportResult {
    let parsed;
    try {
      parsed = parseCsv(csvText);
    } catch (err) {
      if (err instanceof CsvParseError) {
        throw new AppError(400, 'VALIDATION_ERROR', `Could not parse CSV: ${err.message}`);
      }
      throw err;
    }

    const header = parsed.header.map((h) => h.toLowerCase().replace(/\s+/g, '_'));
    const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `CSV is missing required column(s): ${missing.join(', ')}`,
      );
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Import at most ${MAX_IMPORT_ROWS} rows at a time`,
      );
    }

    const categoryList = this.categoryService.list(true);
    const categoryByName = new Map(categoryList.map((c) => [c.name.toLowerCase(), c]));
    const col = (cells: string[], name: string): string | undefined => {
      const idx = header.indexOf(name);
      return idx === -1 ? undefined : cells[idx];
    };

    const rows: ParsedRow[] = parsed.rows.map(({ line, cells }) => {
      const errors: string[] = [];
      const name = (col(cells, 'name') ?? '').trim();
      const brandRaw = (col(cells, 'brand') ?? '').trim();
      const brand = brandRaw === '' ? null : brandRaw;

      const categoryRaw = (col(cells, 'category') ?? '').trim();
      let categoryId: number | null = null;
      if (categoryRaw !== '') {
        const match = categoryByName.get(categoryRaw.toLowerCase());
        if (!match) errors.push(`unknown category "${categoryRaw}"`);
        else categoryId = match.id;
      }

      const basisRaw = (col(cells, 'basis') ?? 'g').trim().toLowerCase() || 'g';
      if (basisRaw !== 'g' && basisRaw !== 'ml')
        errors.push(`basis must be "g" or "ml", got "${basisRaw}"`);

      const candidate = {
        name,
        brand,
        categoryId,
        basis: basisRaw === 'ml' ? 'ml' : 'g',
        per100: {
          kcal: parseNumber(col(cells, 'kcal'), 'kcal', errors, true) ?? 0,
          protein: parseNumber(col(cells, 'protein'), 'protein', errors, true) ?? 0,
          carbs: parseNumber(col(cells, 'carbs'), 'carbs', errors, true) ?? 0,
          fat: parseNumber(col(cells, 'fat'), 'fat', errors, true) ?? 0,
          fiber: parseNumber(col(cells, 'fiber'), 'fiber', errors, false),
          sugar: parseNumber(col(cells, 'sugar'), 'sugar', errors, false),
          saturatedFat: parseNumber(col(cells, 'saturated_fat'), 'saturated_fat', errors, false),
          sodiumMg: parseNumber(col(cells, 'sodium_mg'), 'sodium_mg', errors, false),
        },
        portions: parsePortions(col(cells, 'portions'), errors),
      };

      if (errors.length > 0) return { line, name, brand, errors };
      const result = foodInputSchema.safeParse(candidate);
      if (!result.success) {
        return {
          line,
          name,
          brand,
          errors: result.error.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`),
        };
      }
      return { line, name, brand, input: result.data, errors: [] };
    });

    // Duplicates inside the file itself are errors: the outcome would depend on row order.
    const seen = new Map<string, number>();
    for (const row of rows) {
      if (row.errors.length > 0) continue;
      const key = `${row.name.toLowerCase()}\u0000${(row.brand ?? '').toLowerCase()}`;
      const first = seen.get(key);
      if (first !== undefined) row.errors.push(`duplicate of line ${first} in this file`);
      else seen.set(key, row.line);
    }

    const results: ImportRowResult[] = [];
    const summary = { create: 0, update: 0, skip: 0, error: 0 };
    for (const row of rows) {
      if (row.errors.length > 0 || !row.input) {
        results.push({
          line: row.line,
          name: row.name,
          brand: row.brand,
          action: 'error',
          errors: row.errors,
        });
        summary.error++;
        continue;
      }
      const existing = this.foodService.findByNameAndBrand(row.input.name, row.input.brand);
      let action: ImportRowResult['action'];
      if (!existing) action = 'create';
      else if (existing.kind === 'dish') {
        results.push({
          line: row.line,
          name: row.name,
          brand: row.brand,
          action: 'error',
          errors: ['a dish with this name exists'],
        });
        summary.error++;
        continue;
      } else action = options.onConflict === 'update' ? 'update' : 'skip';

      if (!options.dryRun) {
        if (action === 'create') this.foodService.create(row.input);
        else if (action === 'update' && existing) this.foodService.update(existing.id, row.input);
      }
      results.push({ line: row.line, name: row.name, brand: row.brand, action, errors: [] });
      summary[action]++;
    }

    return { dryRun: options.dryRun, rows: results, summary };
  }
}
