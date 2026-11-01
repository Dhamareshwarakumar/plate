/**
 * Minimal RFC 4180 CSV support: quoted fields, escaped quotes, embedded newlines, CRLF.
 * Written in-house because the surface we need is tiny and must behave identically on import and export.
 */

export interface ParsedCsv {
  header: string[];
  /** Data rows with their 1-based line number in the source (for error messages). */
  rows: { line: number; cells: string[] }[];
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'CsvParseError';
  }
}

export function parseCsv(text: string): ParsedCsv {
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let i = 0;

  // Strip a UTF-8 BOM, which spreadsheets like to add.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => {
    cells.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    // Skip fully empty lines (a single empty cell).
    if (!(cells.length === 1 && cells[0] === '')) records.push({ line: recordLine, cells });
    cells = [];
    recordLine = line;
  };

  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.length > 0)
        throw new CsvParseError('Unexpected quote inside an unquoted field', line);
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r') {
      // Handled by the following \n; a lone \r also ends the record.
      if (text[i + 1] !== '\n') {
        line++;
        endRecord();
      }
    } else if (ch === '\n') {
      line++;
      endRecord();
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new CsvParseError('Unterminated quoted field', recordLine);
  if (field.length > 0 || cells.length > 0) endRecord();

  const [headerRecord, ...rows] = records;
  if (!headerRecord) return { header: [], rows: [] };
  return { header: headerRecord.cells.map((h) => h.trim()), rows };
}

export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvLine(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(csvEscape).join(',');
}
