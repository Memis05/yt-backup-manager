import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as schema from './schema';

const validOwnershipTokens = new WeakSet<object>();

export interface WorkerDatabaseOwnership {
  readonly owner: 'worker';
}

export function acquireWorkerDatabaseOwnership(): WorkerDatabaseOwnership {
  const token = Object.freeze({ owner: 'worker' as const });
  validOwnershipTokens.add(token);
  return token;
}

export interface OpenWorkerDatabaseOptions {
  databasePath: string;
  ownership: WorkerDatabaseOwnership;
  migrationsFolder?: string;
}

export interface WorkerDatabase {
  readonly orm: BetterSQLite3Database<typeof schema>;
  readonly sqlite: Database.Database;
  close(): void;
}

function defaultMigrationsFolder(): string {
  return fileURLToPath(new URL('../drizzle', import.meta.url));
}

export function openWorkerDatabase(options: OpenWorkerDatabaseOptions): WorkerDatabase {
  if (!validOwnershipTokens.has(options.ownership)) {
    throw new Error('SQLite may only be opened through the worker ownership boundary');
  }

  mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const sqlite = new Database(options.databasePath, { timeout: 5_000 });
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('journal_mode = WAL');
    const orm = drizzle(sqlite, { schema });
    migrate(orm, { migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder() });

    return {
      orm,
      sqlite,
      close: () => sqlite.close(),
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
