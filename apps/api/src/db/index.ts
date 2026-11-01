import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface OpenDbOptions {
  /** File path, or ':memory:' for tests. */
  path: string;
  /** Directory with drizzle migrations. Defaults to the package's ./drizzle directory. */
  migrationsDir?: string | undefined;
}

export interface OpenedDb {
  db: Db;
  sqlite: Database.Database;
  close: () => void;
}

/**
 * Finds the package's `drizzle/` directory by walking up from this file. The source layout
 * (src/db/) and the bundled layout (dist/) sit at different depths, so a fixed relative path
 * would break one of them.
 */
function defaultMigrationsDir(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 4; i++) {
    const candidate = join(dir, 'drizzle');
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error(
    'Could not locate the drizzle migrations directory; set MIGRATIONS_DIR explicitly.',
  );
}

/** Opens (creating if needed) the SQLite database, applies pragmas and pending migrations. */
export function openDb(options: OpenDbOptions): OpenedDb {
  if (options.path !== ':memory:') {
    mkdirSync(dirname(resolve(options.path)), { recursive: true });
  }
  const sqlite = new Database(options.path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: options.migrationsDir ?? defaultMigrationsDir() });

  return {
    db,
    sqlite,
    close: () => {
      sqlite.close();
    },
  };
}

/** Cheap liveness probe used by the health endpoint. */
export function pingDb(sqlite: Database.Database): boolean {
  try {
    const row = sqlite.prepare('SELECT 1 AS one').get() as { one: number } | undefined;
    return row?.one === 1;
  } catch {
    return false;
  }
}
