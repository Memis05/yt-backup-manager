import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SettingsService } from '@ytbm/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DatabaseHealthService,
  DrizzleSettingsRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
  type WorkerDatabaseOwnership,
} from '../src';

const cleanupDirectories: string[] = [];
const openDatabases: WorkerDatabase[] = [];
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

async function createDatabase(): Promise<WorkerDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-database-test-'));
  cleanupDirectories.push(directory);
  const database = openWorkerDatabase({
    databasePath: join(directory, 'app.db'),
    ownership: acquireWorkerDatabaseOwnership(),
    migrationsFolder,
  });
  openDatabases.push(database);
  return database;
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const directory of cleanupDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('worker-owned SQLite foundation', () => {
  it('migrates an empty database and enables durable SQLite settings', async () => {
    const database = await createDatabase();
    const tables = database.sqlite
      .prepare("select name from sqlite_master where type in ('table', 'view')")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((table) => table.name));

    expect(names).toContain('media_items');
    expect(names).toContain('jobs');
    expect(names).toContain('media_search');
    expect(new DatabaseHealthService(database).getHealth()).toMatchObject({
      status: 'READY',
      schemaVersion: 3,
      foreignKeysEnabled: true,
      journalMode: 'wal',
    });
  });

  it('rejects orphan records through foreign-key enforcement', async () => {
    const database = await createDatabase();
    const now = Date.now();

    expect(() =>
      database.sqlite
        .prepare(
          `insert into destinations (
            id, destination_type, account_id, enabled, availability_status, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('destination-1', 'GOOGLE_DRIVE', 'missing-account', 1, 'UNKNOWN', now, now),
    ).toThrow(/foreign key/i);
  });

  it('persists settings only through the typed repository and service', async () => {
    const database = await createDatabase();
    const service = new SettingsService(new DrizzleSettingsRepository(database), () => 123);

    await service.update({ startMinimized: true });
    const reopenedService = new SettingsService(new DrizzleSettingsRepository(database));
    await expect(reopenedService.get()).resolves.toMatchObject({ startMinimized: true });
  });

  it('rejects a counterfeit database owner token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-owner-test-'));
    cleanupDirectories.push(directory);
    const counterfeit = { owner: 'worker' } as WorkerDatabaseOwnership;

    expect(() =>
      openWorkerDatabase({
        databasePath: join(directory, 'app.db'),
        ownership: counterfeit,
        migrationsFolder,
      }),
    ).toThrow(/worker ownership boundary/i);
  });
});
