import { DatabaseHealthSchema, type DatabaseHealth } from '@ytbm/core';

import type { WorkerDatabase } from '../database';

export class DatabaseHealthService {
  public constructor(private readonly database: WorkerDatabase) {}

  public getHealth(): DatabaseHealth {
    const foreignKeys = Number(this.database.sqlite.pragma('foreign_keys', { simple: true }));
    const journalMode = String(this.database.sqlite.pragma('journal_mode', { simple: true }));
    const migration = this.database.sqlite
      .prepare('select count(*) as schema_version from __drizzle_migrations')
      .get() as { schema_version: number };
    const quickCheck = String(this.database.sqlite.pragma('quick_check', { simple: true }));

    if (quickCheck !== 'ok') {
      throw new Error('SQLite quick check failed');
    }

    return DatabaseHealthSchema.parse({
      status: 'READY',
      schemaVersion: migration.schema_version,
      foreignKeysEnabled: foreignKeys === 1,
      journalMode,
    });
  }
}
