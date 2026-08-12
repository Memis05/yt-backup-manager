import { describe, expect, it } from 'vitest';

import {
  DEFAULT_APP_SETTINGS,
  SettingsService,
  type AppSettings,
  type SettingsRepository,
} from '../src';

class MemorySettingsRepository implements SettingsRepository {
  public value: unknown | null = null;

  public async readApplicationSettings(): Promise<unknown | null> {
    return this.value;
  }

  public async writeApplicationSettings(value: AppSettings): Promise<void> {
    this.value = value;
  }
}

describe('SettingsService', () => {
  it('returns typed defaults and persists an allowed update', async () => {
    const repository = new MemorySettingsRepository();
    const service = new SettingsService(repository, () => 123);

    expect(await service.get()).toEqual(DEFAULT_APP_SETTINGS);
    await expect(service.update({ startMinimized: true })).resolves.toMatchObject({
      startMinimized: true,
      defaultQualityProfile: 'UP_TO_1080P',
    });
    expect(repository.value).toMatchObject({ startMinimized: true });
  });

  it('rejects unknown, empty, and out-of-range settings', async () => {
    const service = new SettingsService(new MemorySettingsRepository());

    await expect(service.update({})).rejects.toThrow();
    await expect(service.update({ arbitrary: true })).rejects.toThrow();
    await expect(service.update({ concurrentDownloads: 100 })).rejects.toThrow();
  });

  it('rejects malformed persisted data instead of silently accepting it', async () => {
    const repository = new MemorySettingsRepository();
    repository.value = { startMinimized: 'yes' };

    await expect(new SettingsService(repository).get()).rejects.toThrow();
  });
});
