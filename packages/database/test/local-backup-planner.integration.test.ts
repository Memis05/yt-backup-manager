import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DurableJobSqlRepository,
  LocalBackupRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '../src';

const directories: string[] = [];
const databases: WorkerDatabase[] = [];
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-planner-'));
  directories.push(directory);
  const database = openWorkerDatabase({
    databasePath: join(directory, 'app.db'),
    ownership: acquireWorkerDatabaseOwnership(),
    migrationsFolder,
  });
  databases.push(database);
  const now = 100;
  const channelId = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  database.sqlite
    .prepare(
      `insert into channels (
        id, source_provider, provider_channel_id, title, backup_enabled, source_status,
        first_seen_at, last_seen_at, last_sync_at, created_at, updated_at
      ) values (?, 'YOUTUBE', 'UCfixture', 'Fixture Channel', 1, 'AVAILABLE', ?, ?, ?, ?, ?)`,
    )
    .run(channelId, now, now, now, now, now);
  database.sqlite
    .prepare(
      `insert into media_items (
        id, channel_id, source_provider, provider_media_id, media_type, title,
        original_title, source_url, source_status, first_seen_at, last_seen_at,
        metadata_version, created_at, updated_at
      ) values (?, ?, 'YOUTUBE', 'media123', 'VIDEO', 'Fixture Video', 'Fixture Video',
        'https://www.youtube.com/watch?v=media123', 'AVAILABLE', ?, ?, 1, ?, ?)`,
    )
    .run(mediaId, channelId, now, now, now, now);
  const repository = new LocalBackupRepository(database, () => now);
  const destinationA = repository.addDestination({
    rootPath: join(directory, 'backup-a'),
    identity: null,
    availabilityStatus: 'AVAILABLE',
    lastErrorCode: null,
  });
  repository.setChannelSettings(channelId, null, [destinationA.id], 'MAX_1080P');
  return { database, repository, channelId, mediaId, destinationA, directory };
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function markVerified(database: WorkerDatabase, mediaId: string, destinationId: string): string {
  const copyId = crypto.randomUUID();
  database.sqlite
    .prepare(
      `insert or replace into media_copies (
        id, media_item_id, destination_id, relative_path, container, bytes, sha256,
        quality_profile, content_generation, status, verified_at, created_at, updated_at
      ) values (?, ?, ?, 'Fixture [UC]/Videos/Fixture [media123]/video.webm',
        'webm', 7, ?, 'MAX_1080P', 'q1:MAX_1080P', 'VERIFIED', 100, 100, 100)`,
    )
    .run(copyId, mediaId, destinationId, 'a'.repeat(64));
  return copyId;
}

describe('local backup planner', () => {
  it('creates an independent durable acquisition DAG for each backup run', async () => {
    const { database, repository, channelId, directory } = await fixture();

    repository.planBackup(channelId, 'MAX_1080P', join(directory, 'staging'));
    repository.planBackup(channelId, 'MAX_1080P', join(directory, 'staging'));

    const counts = database.sqlite
      .prepare(
        `select job_type, count(*) as count from jobs where job_type <> 'CHANNEL_SYNC'
         group by job_type order by job_type`,
      )
      .all() as Array<{ job_type: string; count: number }>;
    expect(Object.fromEntries(counts.map((row) => [row.job_type, row.count]))).toMatchObject({
      FORMAT_PROBE: 2,
      DOWNLOAD_MEDIA: 2,
      POST_PROCESS_MEDIA: 2,
      HASH_STAGING_MEDIA: 2,
      VERIFY_STAGING_MEDIA: 2,
      COPY_TO_FILESYSTEM: 2,
      VERIFY_FILESYSTEM_COPY: 2,
      WRITE_DESTINATION_METADATA: 2,
      UPDATE_MANIFEST: 2,
      CLEANUP_STAGING: 2,
    });
  });

  it('does not re-download verified media on a second backup', async () => {
    const { database, repository, channelId, mediaId, destinationA, directory } = await fixture();
    markVerified(database, mediaId, destinationA.id);

    const result = repository.planBackup(channelId, 'MAX_1080P', join(directory, 'staging'));

    expect(result.skippedVerifiedMedia).toBe(1);
    expect(
      database.sqlite
        .prepare("select count(*) as count from jobs where job_type = 'DOWNLOAD_MEDIA'")
        .get(),
    ).toEqual({ count: 0 });
  });

  it('updates metadata without downloading media bytes after a title change', async () => {
    const { database, repository, channelId, mediaId, destinationA, directory } = await fixture();
    markVerified(database, mediaId, destinationA.id);
    database.sqlite
      .prepare("update media_items set title = 'Renamed', metadata_version = 2 where id = ?")
      .run(mediaId);

    repository.planBackup(channelId, 'MAX_1080P', join(directory, 'staging'));

    expect(
      database.sqlite
        .prepare("select count(*) as count from jobs where job_type = 'DOWNLOAD_MEDIA'")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database.sqlite
        .prepare("select count(*) as count from jobs where job_type = 'WRITE_DESTINATION_METADATA'")
        .get(),
    ).toEqual({ count: 1 });
  });

  it('reuses a verified local copy when a second destination is added', async () => {
    const { database, repository, channelId, mediaId, destinationA, directory } = await fixture();
    const sourceCopyId = markVerified(database, mediaId, destinationA.id);
    const destinationB = repository.addDestination({
      rootPath: join(directory, 'backup-b'),
      identity: null,
      availabilityStatus: 'AVAILABLE',
      lastErrorCode: null,
    });
    repository.setChannelSettings(channelId, null, [destinationA.id, destinationB.id], 'MAX_1080P');

    repository.planBackup(channelId, 'MAX_1080P', join(directory, 'staging'));

    expect(
      database.sqlite
        .prepare("select count(*) as count from jobs where job_type = 'DOWNLOAD_MEDIA'")
        .get(),
    ).toEqual({ count: 0 });
    const copyJob = database.sqlite
      .prepare("select payload_json from jobs where job_type = 'COPY_TO_FILESYSTEM'")
      .get() as { payload_json: string };
    expect(JSON.parse(copyJob.payload_json)).toMatchObject({ sourceCopyId });
  });

  it('preserves a verified archive after the YouTube source is removed', async () => {
    const { database, repository, channelId, mediaId, destinationA, directory } = await fixture();
    const copyId = markVerified(database, mediaId, destinationA.id);
    database.sqlite
      .prepare("update media_items set source_status = 'REMOVED' where id = ?")
      .run(mediaId);

    repository.planBackup(channelId, 'MAX_1080P', join(directory, 'staging'));

    expect(
      database.sqlite.prepare('select status from media_copies where id = ?').get(copyId),
    ).toEqual({
      status: 'VERIFIED',
    });
    expect(
      database.sqlite
        .prepare("select count(*) as count from jobs where job_type = 'DOWNLOAD_MEDIA'")
        .get(),
    ).toEqual({ count: 0 });
  });

  it('creates a new idempotent repair generation for a missing verified copy', async () => {
    const { database, repository, channelId, mediaId, destinationA, directory } = await fixture();
    repository.planBackup(channelId, 'MAX_1080P', join(directory, 'staging'));
    const copyId = markVerified(database, mediaId, destinationA.id);
    database.sqlite
      .prepare(
        `update media_copies set status = 'MISSING', missing_since = 200,
          last_error_code = 'COPY_MISSING', updated_at = 200 where id = ?`,
      )
      .run(copyId);

    const repair = repository.planBackup(channelId, 'MAX_1080P', join(directory, 'staging'));

    expect(repair.skippedVerifiedMedia).toBe(0);
    expect(
      database.sqlite
        .prepare("select count(*) as count from jobs where job_type = 'DOWNLOAD_MEDIA'")
        .get(),
    ).toEqual({ count: 2 });
    expect(
      database.sqlite
        .prepare(
          `select count(*) as count from jobs
           where backup_run_id = ? and idempotency_key like '%:repair:200:run:%'`,
        )
        .get(repair.run.id),
    ).toEqual({ count: repair.plannedJobs });
  });

  it('finishes a run with errors after a permanent branch failure propagates', async () => {
    const { database, repository, channelId, directory } = await fixture();
    const planned = repository.planBackup(channelId, 'MAX_1080P', join(directory, 'staging'));
    database.sqlite
      .prepare(
        `update jobs set status = 'FAILED', error_code = 'SOURCE_UNAVAILABLE'
         where backup_run_id = ? and job_type = 'FORMAT_PROBE'`,
      )
      .run(planned.run.id);
    const jobs = new DurableJobSqlRepository(database);

    for (let pass = 0; pass < 12; pass += 1) jobs.promoteDependencies(200 + pass);
    repository.reconcileAllRuns();

    expect(repository.getRun(planned.run.id)).toMatchObject({
      status: 'COMPLETED_WITH_ERRORS',
      failedCount: expect.any(Number),
    });
    expect(repository.getRun(planned.run.id).failedCount).toBeGreaterThan(0);
  });
});
