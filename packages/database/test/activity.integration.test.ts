import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ActivitySqlRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '../src';

const cleanupDirectories: string[] = [];
const openDatabases: WorkerDatabase[] = [];
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

async function createDatabase(): Promise<WorkerDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-activity-test-'));
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

function seedArchive(database: WorkerDatabase) {
  const channelId = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const localId = crypto.randomUUID();
  const driveId = crypto.randomUUID();
  database.sqlite
    .prepare(
      `insert into channels (
        id, source_provider, provider_channel_id, title, backup_enabled, source_status,
        first_seen_at, created_at, updated_at
      ) values (?, 'YOUTUBE', 'UCactivity', 'Activity Channel', 1, 'AVAILABLE', 1, 1, 1)`,
    )
    .run(channelId);
  database.sqlite
    .prepare(
      `insert into media_items (
        id, channel_id, source_provider, provider_media_id, media_type, title,
        original_title, source_url, source_status, first_seen_at, metadata_version,
        created_at, updated_at
      ) values (?, ?, 'YOUTUBE', 'activity-video', 'VIDEO', 'One media operation',
        'One media operation', 'https://www.youtube.com/watch?v=activity-video',
        'AVAILABLE', 1, 1, 1, 1)`,
    )
    .run(mediaId, channelId);
  database.sqlite
    .prepare(
      `insert into destinations (
        id, destination_type, root_path, enabled, availability_status, created_at, updated_at
      ) values (?, 'FILESYSTEM', 'D:\\Archive', 1, 'AVAILABLE', 1, 1)`,
    )
    .run(localId);
  database.sqlite
    .prepare(
      `insert into destinations (
        id, destination_type, account_id, enabled, availability_status, created_at, updated_at
      ) values (?, 'GOOGLE_DRIVE', null, 1, 'AUTH_REQUIRED', 1, 20)`,
    )
    .run(driveId);
  database.sqlite
    .prepare(
      `insert into backup_runs (
        id, channel_id, trigger_type, status, effective_config_json,
        created_at, updated_at
      ) values (?, ?, 'MANUAL', 'RUNNING', ?, 5, 20)`,
    )
    .run(
      runId,
      channelId,
      JSON.stringify({ qualityProfile: 'MAX_1080P', destinationIds: [localId, driveId] }),
    );
  return { channelId, mediaId, runId, localId, driveId };
}

function insertJob(
  database: WorkerDatabase,
  fixture: ReturnType<typeof seedArchive>,
  input: {
    jobType: string;
    status: string;
    destinationId: string;
    updatedAt: number;
    safeMessage?: string;
  },
): string {
  const id = crypto.randomUUID();
  database.sqlite
    .prepare(
      `insert into jobs (
        id, backup_run_id, channel_id, media_item_id, destination_id, job_type, status,
        priority, attempt_count, max_attempts, progress_ratio, bytes_processed, bytes_total,
        payload_json, idempotency_key, error_code, error_message_safe, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, 0, 1, 5, ?, 50, 100, '{}', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      fixture.runId,
      fixture.channelId,
      fixture.mediaId,
      input.destinationId,
      input.jobType,
      input.status,
      input.status === 'COMPLETED' ? 1 : 0.5,
      `activity:${id}`,
      input.safeMessage === undefined ? null : 'UPLOAD_FAILED',
      input.safeMessage ?? null,
      input.updatedAt,
      input.updatedAt,
    );
  return id;
}

describe('ActivitySqlRepository', () => {
  it('groups durable jobs into one truthful user operation with independent destination branches', async () => {
    const database = await createDatabase();
    const fixture = seedArchive(database);
    const localJob = insertJob(database, fixture, {
      jobType: 'VERIFY_FILESYSTEM_COPY',
      status: 'RUNNING',
      destinationId: fixture.localId,
      updatedAt: 10,
    });
    const driveJob = insertJob(database, fixture, {
      jobType: 'UPLOAD_TO_GOOGLE_DRIVE',
      status: 'FAILED',
      destinationId: fixture.driveId,
      updatedAt: 11,
      safeMessage: 'Google Drive upload could not be completed.',
    });
    const repository = new ActivitySqlRepository(database);

    const page = repository.listOperations({ page: 1, pageSize: 25 });

    expect(page.totalItems).toBe(1);
    expect(page.operations[0]).toMatchObject({
      runId: fixture.runId,
      mediaItemId: fixture.mediaId,
      title: 'One media operation',
      status: 'RUNNING',
      issueCount: 1,
      sourceJobIds: [localJob, driveJob],
    });
    expect(page.operations[0]?.destinationBranches).toEqual([
      expect.objectContaining({ destinationId: fixture.localId, status: 'RUNNING' }),
      expect.objectContaining({ destinationId: fixture.driveId, status: 'FAILED' }),
    ]);
  });

  it('pages technical details and exposes only exact controls supported by each step', async () => {
    const database = await createDatabase();
    const fixture = seedArchive(database);
    insertJob(database, fixture, {
      jobType: 'DOWNLOAD_MEDIA',
      status: 'READY',
      destinationId: fixture.localId,
      updatedAt: 10,
    });
    insertJob(database, fixture, {
      jobType: 'UPLOAD_TO_GOOGLE_DRIVE',
      status: 'PAUSED',
      destinationId: fixture.driveId,
      updatedAt: 11,
    });
    const repository = new ActivitySqlRepository(database);
    const operation = repository.listOperations({ page: 1, pageSize: 25 }).operations[0]!;

    const first = repository.operationDetails({ operationId: operation.id, page: 1, pageSize: 1 });
    const second = repository.operationDetails({ operationId: operation.id, page: 2, pageSize: 1 });

    expect(first.totalJobs).toBe(2);
    expect(first.technicalJobs).toHaveLength(1);
    expect(first.technicalJobs[0]?.availableActions).toContain('CANCEL_REMOVE_PARTIAL');
    expect(second.technicalJobs[0]?.availableActions).toContain('RESUME');
    expect(second.technicalJobs[0]?.availableActions).not.toContain('CANCEL_REMOVE_PARTIAL');
  });

  it('loads details for an operation with a retrying branch and a failed branch', async () => {
    const database = await createDatabase();
    const fixture = seedArchive(database);
    insertJob(database, fixture, {
      jobType: 'VERIFY_FILESYSTEM_COPY',
      status: 'RETRY_WAIT',
      destinationId: fixture.localId,
      updatedAt: 10,
    });
    insertJob(database, fixture, {
      jobType: 'UPLOAD_TO_GOOGLE_DRIVE',
      status: 'FAILED',
      destinationId: fixture.driveId,
      updatedAt: 11,
      safeMessage: 'Reconnect Google Drive.',
    });
    const repository = new ActivitySqlRepository(database);
    const operation = repository.listOperations({ page: 1, pageSize: 25 }).operations[0]!;

    const details = repository.operationDetails({
      operationId: operation.id,
      page: 1,
      pageSize: 25,
    });

    expect(details.operation.status).toBe('RETRY_WAIT');
    expect(details.technicalJobs).toHaveLength(2);
  });

  it('paginates run history and never exposes activity details_json to the renderer DTO', async () => {
    const database = await createDatabase();
    const fixture = seedArchive(database);
    database.sqlite
      .prepare("update backup_runs set status = 'COMPLETED', completed_at = 30 where id = ?")
      .run(fixture.runId);
    database.sqlite
      .prepare(
        `insert into activity_log (
          id, event_type, severity, channel_id, media_item_id, backup_run_id,
          summary, details_json, created_at
        ) values (?, 'TITLE_CHANGED', 'INFO', ?, ?, ?, ?, ?, 30)`,
      )
      .run(
        crypto.randomUUID(),
        fixture.channelId,
        fixture.mediaId,
        fixture.runId,
        'The media title changed.',
        JSON.stringify({ authorizationHeader: 'must-not-cross-ipc' }),
      );
    const repository = new ActivitySqlRepository(database);

    const history = repository.listRunHistory({
      page: 1,
      pageSize: 1,
      status: null,
      triggerType: null,
      channelId: null,
      destinationId: null,
      from: null,
      to: null,
    });
    const log = repository.listLog({
      page: 1,
      pageSize: 25,
      category: 'ARCHIVE_CHANGES',
      channelId: null,
      mediaItemId: null,
      destinationId: null,
      from: null,
      to: null,
    });

    expect(history).toMatchObject({ totalItems: 1, pageSize: 1 });
    expect(log.events[0]).toMatchObject({
      title: 'Title changed',
      summary: 'The media title changed.',
      mediaTitle: 'One media operation',
    });
    expect(JSON.stringify(log)).not.toContain('must-not-cross-ipc');
  });

  it('groups repeated authorization blocks while preserving unrelated operation issues', async () => {
    const database = await createDatabase();
    const fixture = seedArchive(database);
    insertJob(database, fixture, {
      jobType: 'UPLOAD_TO_GOOGLE_DRIVE',
      status: 'BLOCKED',
      destinationId: fixture.driveId,
      updatedAt: 21,
      safeMessage: 'Reconnect Google Drive.',
    });
    const secondAuthJob = insertJob(database, fixture, {
      jobType: 'UPLOAD_TO_GOOGLE_DRIVE',
      status: 'BLOCKED',
      destinationId: fixture.driveId,
      updatedAt: 22,
      safeMessage: 'Reconnect Google Drive.',
    });
    database.sqlite.prepare('update jobs set media_item_id = null where id = ?').run(secondAuthJob);
    insertJob(database, fixture, {
      jobType: 'VERIFY_FILESYSTEM_COPY',
      status: 'FAILED',
      destinationId: fixture.localId,
      updatedAt: 23,
      safeMessage: 'The local copy could not be verified.',
    });
    const repository = new ActivitySqlRepository(database);

    const active = repository.listOperations({ page: 1, pageSize: 25 });
    const attention = repository.listAttention({ page: 1, pageSize: 25 });

    expect(active.operations).toHaveLength(2);
    expect(active.operations).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'BLOCKED' })]),
    );
    expect(attention.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'OPERATION', resolutionLabel: 'Review operation' }),
        expect.objectContaining({
          kind: 'AUTHORIZATION',
          count: 2,
          resolutionLabel: 'Manage accounts',
        }),
      ]),
    );
  });
});
