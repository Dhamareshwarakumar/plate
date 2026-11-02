import {
  BACKUP_FORMAT,
  BACKUP_TABLE_KEYS,
  BACKUP_TABLES,
  BACKUP_VERSION,
  backupDataSchema,
  parseBackup,
  type AboutResponse,
  type Backup,
  type BackupDataKey,
  type RestoreResult,
} from '@plate/shared';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { CategoryService } from '../categories/service.js';
import type { Db } from '../db/index.js';
import { AppError } from '../errors.js';
import type { MealSlotService } from '../mealSlots/service.js';
import { APP_VERSION } from '../version.js';

export interface BackupServiceDeps {
  db: Db;
  sqlite: Database.Database;
  /** Configured database path; only its basename is ever reported. */
  dbPath: string;
  categories: CategoryService;
  mealSlots: MealSlotService;
}

type Row = Record<string, unknown>;

/** Rows per `JSON.stringify` call while streaming an export. */
const CHUNK_ROWS = 500;

/** Column list of a table, straight from the shared row schema (the test suite checks it against the DB). */
function columnsOf(key: BackupDataKey): string[] {
  return Object.keys(backupDataSchema.shape[key].element.shape);
}

/**
 * Export, restore and snapshot of the whole database (FR-S4). Everything but `auth`, `sessions` and
 * SQLite's own `sqlite_sequence` is covered; a restore therefore keeps the password and every
 * signed-in device.
 */
export class BackupService {
  private readonly db: Db;
  private readonly sqlite: Database.Database;
  private readonly dbPath: string;
  private readonly categories: CategoryService;
  private readonly mealSlots: MealSlotService;

  constructor(deps: BackupServiceDeps) {
    this.db = deps.db;
    this.sqlite = deps.sqlite;
    this.dbPath = deps.dbPath;
    this.categories = deps.categories;
    this.mealSlots = deps.mealSlots;
  }

  /** All tables read inside one transaction, so the document is a consistent snapshot. */
  collect(): Backup {
    const data = this.db.transaction(() => {
      const out: Partial<Record<BackupDataKey, Row[]>> = {};
      for (const key of BACKUP_TABLE_KEYS) {
        const table = BACKUP_TABLES[key];
        const orderBy = key === 'settings' ? 'key' : 'id';
        out[key] = this.sqlite.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all() as Row[];
      }
      return out as Record<BackupDataKey, Row[]>;
    });
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      data: data as unknown as Backup['data'],
    };
  }

  /**
   * The backup as JSON text in pieces (header, then each table's rows in slices), so a large
   * database never has to be serialised into one giant string before the first byte goes out.
   */
  *jsonChunks(backup: Backup): Generator<string> {
    const { data, ...header } = backup;
    yield `${JSON.stringify(header).slice(0, -1)},"data":{`;
    for (const [tableIndex, key] of BACKUP_TABLE_KEYS.entries()) {
      const rows = data[key] as unknown as Row[];
      yield `${tableIndex === 0 ? '' : ','}${JSON.stringify(key)}:[`;
      for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
        const slice = rows.slice(i, i + CHUNK_ROWS).map((row) => JSON.stringify(row));
        yield `${i === 0 ? '' : ','}${slice.join(',')}`;
      }
      yield ']';
    }
    yield '}}';
  }

  /**
   * Replaces every backed-up table with the file's rows in one transaction: children are deleted
   * first, parents inserted first, and the seeding guards run at the end (inside the transaction,
   * as a SAVEPOINT) so a backup without default categories or slots gets them while one with them
   * does not get duplicates. Any constraint failure rolls everything back and is reported as 400.
   */
  restore(input: unknown): RestoreResult {
    const parsed = parseBackup(input);
    if (!parsed.ok) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.message, parsed.issues);
    }
    const { data } = parsed.backup;
    try {
      return this.db.transaction(() => {
        for (const key of [...BACKUP_TABLE_KEYS].reverse()) {
          this.sqlite.prepare(`DELETE FROM ${BACKUP_TABLES[key]}`).run();
        }
        const restored: Partial<Record<BackupDataKey, number>> = {};
        for (const key of BACKUP_TABLE_KEYS) {
          const columns = columnsOf(key);
          const insert = this.sqlite.prepare(
            `INSERT INTO ${BACKUP_TABLES[key]} (${columns.join(', ')}) VALUES (${columns
              .map((c) => `@${c}`)
              .join(', ')})`,
          );
          const rows = data[key] as unknown as Row[];
          for (const row of rows) insert.run(row);
          restored[key] = rows.length;
        }
        this.categories.seedDefaults();
        this.mealSlots.seedDefaults();
        return { restored: restored as Record<BackupDataKey, number> };
      });
    } catch (err) {
      if (err instanceof Database.SqliteError && err.code.startsWith('SQLITE_CONSTRAINT')) {
        const message = `The backup is inconsistent: ${err.message}`;
        throw new AppError(400, 'VALIDATION_ERROR', message, [{ path: 'backup', message }]);
      }
      throw err;
    }
  }

  /**
   * `VACUUM INTO` writes a compact, consistent copy of the live database to a fresh file in the
   * OS temp directory; the caller streams and deletes it.
   */
  writeSnapshot(): string {
    const file = join(tmpdir(), `plate-snapshot-${randomUUID()}.sqlite`);
    this.sqlite.prepare('VACUUM INTO ?').run(file);
    return file;
  }

  /** `GET about`: size from the page count (works for `:memory:` too), file name, headline counts. */
  stats(): AboutResponse {
    const pageCount = this.sqlite.pragma('page_count', { simple: true }) as number;
    const pageSize = this.sqlite.pragma('page_size', { simple: true }) as number;
    const counts = this.sqlite
      .prepare(
        `SELECT (SELECT count(*) FROM foods) AS foods,
                (SELECT count(*) FROM diary_entries) AS entries,
                (SELECT count(DISTINCT day) FROM diary_entries) AS days`,
      )
      .get() as { foods: number; entries: number; days: number };
    return {
      version: APP_VERSION,
      dbSizeBytes: pageCount * pageSize,
      dbPath: basename(this.dbPath),
      counts,
    };
  }
}
