import type { AppSettings, SettingsRepository } from '@ytbm/core';
import { eq } from 'drizzle-orm';

import type { WorkerDatabase } from '../database';
import { appSettings } from '../schema';

const APPLICATION_SETTINGS_KEY = 'application';

export class DrizzleSettingsRepository implements SettingsRepository {
  public constructor(private readonly database: WorkerDatabase) {}

  public async readApplicationSettings(): Promise<unknown | null> {
    const row = this.database.orm
      .select({ valueJson: appSettings.valueJson })
      .from(appSettings)
      .where(eq(appSettings.key, APPLICATION_SETTINGS_KEY))
      .get();

    if (row === undefined) return null;
    return JSON.parse(row.valueJson) as unknown;
  }

  public async writeApplicationSettings(value: AppSettings, updatedAt: number): Promise<void> {
    const valueJson = JSON.stringify(value);
    this.database.orm
      .insert(appSettings)
      .values({ key: APPLICATION_SETTINGS_KEY, valueJson, updatedAt })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { valueJson, updatedAt },
      })
      .run();
  }
}
