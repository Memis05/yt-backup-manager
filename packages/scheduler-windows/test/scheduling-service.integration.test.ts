import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SchedulingRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '@ytbm/database/worker';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SchedulingService,
  type WindowsScheduledTaskDefinition,
  type WindowsScheduledTaskRecord,
  type WindowsTaskSchedulerAdapter,
} from '../src/index';

const directories: string[] = [];
const databases: WorkerDatabase[] = [];
const migrationsFolder = fileURLToPath(new URL('../../database/drizzle', import.meta.url));

class FakeTaskScheduler implements WindowsTaskSchedulerAdapter {
  public readonly available = true;
  public readonly definitions = new Map<string, WindowsScheduledTaskDefinition>();
  public readonly removed: string[] = [];
  public listed: WindowsScheduledTaskRecord[] = [];

  public async listOwnedTasks(): Promise<WindowsScheduledTaskRecord[]> {
    return [...this.listed];
  }

  public async upsertTask(definition: WindowsScheduledTaskDefinition): Promise<void> {
    this.definitions.set(definition.scheduleId, definition);
  }

  public async removeTask(scheduleId: string): Promise<void> {
    this.removed.push(scheduleId);
    this.definitions.delete(scheduleId);
  }
}

async function fixture(now = Date.parse('2026-08-13T08:00:00+02:00')) {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-scheduling-'));
  directories.push(directory);
  const database = openWorkerDatabase({
    databasePath: join(directory, 'app.db'),
    ownership: acquireWorkerDatabaseOwnership(),
    migrationsFolder,
  });
  databases.push(database);
  const channelId = crypto.randomUUID();
  database.sqlite
    .prepare(
      `insert into channels (
        id, source_provider, provider_channel_id, title, backup_enabled, source_status,
        first_seen_at, created_at, updated_at
      ) values (?, 'YOUTUBE', 'UCschedule', 'Scheduled channel', 1, 'AVAILABLE', ?, ?, ?)`,
    )
    .run(channelId, now, now, now);
  const adapter = new FakeTaskScheduler();
  const repository = new SchedulingRepository(database, () => now);
  const started: Array<{ channelId: string; trigger: string; runId: string }> = [];
  const service = new SchedulingService({
    repository,
    adapter,
    executablePath: 'C:\\Program Files\\YouTube Backup Manager\\YouTubeBackupManager.exe',
    now: () => now,
    timezone: () => 'Europe/Sarajevo',
    startBackup: async (startedChannelId, trigger) => {
      const runId = crypto.randomUUID();
      started.push({ channelId: startedChannelId, trigger, runId });
      return { run: { id: runId } };
    },
  });
  return { database, repository, adapter, service, channelId, started, now };
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('DB-backed Windows schedule reconciliation', () => {
  it.each([
    ['DAILY', null, null],
    ['WEEKLY', 4, null],
    ['EVERY_N_HOURS', null, 3],
  ] as const)('creates and updates a %s schedule', async (frequency, weekday, everyHours) => {
    const { service, adapter, channelId } = await fixture();
    const saved = await service.upsert({
      id: null,
      channelId,
      enabled: true,
      frequency,
      localTime: '02:15',
      weekday,
      everyHours,
      catchUp: true,
      backupOnStartup: false,
    });
    expect(adapter.definitions.get(saved.id)).toMatchObject({
      frequency,
      localTime: '02:15',
      weekday,
      everyHours,
    });
    expect(saved.timezone).toBe('Europe/Sarajevo');
    expect(
      (
        await service.upsert({
          id: saved.id,
          channelId,
          enabled: false,
          frequency,
          localTime: '03:15',
          weekday,
          everyHours,
          catchUp: false,
          backupOnStartup: true,
        })
      ).enabled,
    ).toBe(false);
    expect(adapter.removed).toContain(saved.id);
  });

  it('recreates missing tasks, updates the executable, and removes only stale owned tasks', async () => {
    const { service, adapter, channelId } = await fixture();
    const saved = await service.upsert({
      id: null,
      channelId,
      enabled: true,
      frequency: 'DAILY',
      localTime: '04:00',
      weekday: null,
      everyHours: null,
      catchUp: true,
      backupOnStartup: false,
    });
    const staleId = crypto.randomUUID();
    adapter.listed = [
      {
        operationKind: 'BACKUP',
        scheduleId: staleId,
        taskName: `\\YouTubeBackupManager-Schedule-${staleId}`,
      },
    ];
    adapter.definitions.clear();
    await service.reconcile();
    expect(adapter.removed).toContain(staleId);
    expect(adapter.definitions.get(saved.id)?.executablePath).toBe(
      'C:\\Program Files\\YouTube Backup Manager\\YouTubeBackupManager.exe',
    );
  });

  it('deletes the app-owned task and its database schedule', async () => {
    const { service, adapter, repository, channelId } = await fixture();
    const saved = await service.upsert({
      id: null,
      channelId,
      enabled: true,
      frequency: 'DAILY',
      localTime: '04:00',
      weekday: null,
      everyHours: null,
      catchUp: true,
      backupOnStartup: false,
    });

    await service.remove(saved.id);

    expect(adapter.removed).toContain(saved.id);
    expect(() => repository.get(saved.id)).toThrow(/not found/);
  });

  it('deduplicates duplicate triggers and suppresses a scheduled run when manual work is active', async () => {
    const { service, database, channelId, started, now } = await fixture();
    const schedule = await service.upsert({
      id: null,
      channelId,
      enabled: true,
      frequency: 'DAILY',
      localTime: '08:00',
      weekday: null,
      everyHours: null,
      catchUp: true,
      backupOnStartup: true,
    });
    const first = await service.trigger(schedule.id, now);
    const duplicate = await service.trigger(schedule.id, now + 30_000);
    expect(first.accepted).toBe(true);
    expect(duplicate).toMatchObject({ accepted: false, deduplicated: true });
    expect(started).toHaveLength(1);

    const nextDay = now + 86_400_000;
    database.sqlite
      .prepare(
        `insert into backup_runs (
          id, channel_id, trigger_type, status, effective_config_json,
          created_at, updated_at
        ) values (?, ?, 'MANUAL', 'RUNNING', ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        channelId,
        JSON.stringify({ qualityProfile: 'MAX_1080P', destinationIds: [] }),
        nextDay,
        nextDay,
      );
    await expect(service.trigger(schedule.id, nextDay)).resolves.toMatchObject({
      accepted: false,
      deduplicated: true,
    });
  });

  it('collapses a missed occurrence into one catch-up run', async () => {
    const { service, database, channelId, started, now } = await fixture();
    const schedule = await service.upsert({
      id: null,
      channelId,
      enabled: true,
      frequency: 'EVERY_N_HOURS',
      localTime: '00:00',
      weekday: null,
      everyHours: 1,
      catchUp: true,
      backupOnStartup: false,
    });
    database.sqlite
      .prepare('update schedules set next_expected_at = ? where id = ?')
      .run(now - 5 * 60 * 60_000, schedule.id);
    await service.catchUpDue(now);
    await service.catchUpDue(now + 30_000);
    expect(started).toHaveLength(1);
    expect(
      database.sqlite
        .prepare(
          "select count(*) as count from activity_log where event_type = 'SCHEDULE_CATCH_UP'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });
});
