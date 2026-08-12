import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DurableJobSqlRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '../src';

const cleanupDirectories: string[] = [];
const openDatabases: WorkerDatabase[] = [];
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

async function createDatabase(): Promise<WorkerDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-jobs-test-'));
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

function insertJob(
  database: WorkerDatabase,
  input: {
    id: string;
    status: string;
    jobType?: string;
    priority?: number;
    createdAt?: number;
    leaseUntil?: number;
  },
): void {
  database.sqlite
    .prepare(
      `insert into jobs (
        id, job_type, status, priority, attempt_count, max_attempts, bytes_processed,
        payload_json, idempotency_key, lease_until, created_at, updated_at
      ) values (?, ?, ?, ?, 0, 5, 0, '{}', ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.jobType ?? 'FORMAT_PROBE',
      input.status,
      input.priority ?? 0,
      `test:${input.id}`,
      input.leaseUntil ?? null,
      input.createdAt ?? 1,
      input.createdAt ?? 1,
    );
}

describe('DurableJobSqlRepository', () => {
  it('claims atomically and honors priority then age ordering', async () => {
    const database = await createDatabase();
    insertJob(database, { id: 'old-low', status: 'READY', priority: 0, createdAt: 1 });
    insertJob(database, { id: 'new-high', status: 'READY', priority: 100, createdAt: 2 });
    const repository = new DurableJobSqlRepository(database);

    expect(repository.claimNext(['FORMAT_PROBE'], 'worker-a', 10, 70)?.id).toBe('new-high');
    expect(repository.claimNext(['FORMAT_PROBE'], 'worker-b', 10, 70)?.id).toBe('old-low');
    expect(repository.claimNext(['FORMAT_PROBE'], 'worker-c', 10, 70)).toBeNull();
  });

  it('recovers every abandoned active state immediately after worker restart', async () => {
    const database = await createDatabase();
    insertJob(database, { id: 'unexpired', status: 'RUNNING', leaseUntil: 500 });
    insertJob(database, { id: 'pausing', status: 'PAUSE_REQUESTED', leaseUntil: 500 });
    insertJob(database, { id: 'cancelling', status: 'CANCEL_REQUESTED', leaseUntil: 500 });
    const repository = new DurableJobSqlRepository(database);

    expect(repository.recoverExpiredLeases(100)).toBe(3);
    expect(repository.requeueInterrupted(101)).toBe(3);
    for (const id of ['unexpired', 'pausing', 'cancelling']) {
      expect(database.sqlite.prepare('select status from jobs where id = ?').get(id)).toEqual({
        status: 'READY',
      });
    }
  });

  it('promotes completed dependencies and blocks failed dependency branches', async () => {
    const database = await createDatabase();
    insertJob(database, { id: 'complete', status: 'COMPLETED' });
    insertJob(database, { id: 'failed', status: 'FAILED' });
    insertJob(database, { id: 'ready-child', status: 'PENDING' });
    insertJob(database, { id: 'blocked-child', status: 'PENDING' });
    database.sqlite
      .prepare('insert into job_dependencies (job_id, depends_on_job_id) values (?, ?)')
      .run('ready-child', 'complete');
    database.sqlite
      .prepare('insert into job_dependencies (job_id, depends_on_job_id) values (?, ?)')
      .run('blocked-child', 'failed');
    const repository = new DurableJobSqlRepository(database);

    repository.promoteDependencies(10);

    expect(
      database.sqlite.prepare('select status from jobs where id = ?').get('ready-child'),
    ).toEqual({ status: 'READY' });
    expect(
      database.sqlite.prepare('select status from jobs where id = ?').get('blocked-child'),
    ).toEqual({ status: 'BLOCKED' });
  });

  it('prevents idle shutdown while durable execution or cleanup work remains', async () => {
    const database = await createDatabase();
    const repository = new DurableJobSqlRepository(database);
    expect(repository.hasExecutionWork()).toBe(false);
    insertJob(database, { id: 'pending', status: 'PENDING' });
    expect(repository.hasExecutionWork()).toBe(true);
    database.sqlite.prepare("update jobs set status = 'COMPLETED' where id = 'pending'").run();
    expect(repository.hasExecutionWork()).toBe(false);
  });

  it('reports full database totals while paging a video-focused waiting list', async () => {
    const database = await createDatabase();
    const insertMany = database.sqlite.transaction(() => {
      for (let index = 0; index < 131; index += 1) {
        insertJob(database, {
          id: crypto.randomUUID(),
          status: index === 0 ? 'READY' : 'PENDING',
          jobType: 'DOWNLOAD_MEDIA',
          createdAt: index + 1,
        });
      }
      for (let index = 0; index < 120; index += 1) {
        insertJob(database, {
          id: crypto.randomUUID(),
          status: 'PENDING',
          jobType: 'POST_PROCESS_MEDIA',
          createdAt: index + 200,
        });
      }
    });
    insertMany();
    const repository = new DurableJobSqlRepository(database);

    const snapshot = repository.snapshot({
      section: 'WAITING_DOWNLOADS',
      page: 1,
      pageSize: 50,
    });

    expect(snapshot).toMatchObject({
      totalJobCount: 251,
      pendingCount: 251,
      waitingDownloadCount: 131,
      totalItems: 131,
      page: 1,
      pageSize: 50,
    });
    expect(snapshot.jobs).toHaveLength(50);
    expect(snapshot.jobs.every((job) => job.jobType === 'DOWNLOAD_MEDIA')).toBe(true);
  });

  it('lists verified media as completed videos instead of completed internal steps', async () => {
    const database = await createDatabase();
    const channelId = crypto.randomUUID();
    const mediaId = crypto.randomUUID();
    const destinationId = crypto.randomUUID();
    database.sqlite
      .prepare(
        `insert into channels (
          id, source_provider, provider_channel_id, title, backup_enabled, source_status,
          first_seen_at, created_at, updated_at
        ) values (?, 'YOUTUBE', 'UCqueue', 'Queue Fixture', 1, 'AVAILABLE', 1, 1, 1)`,
      )
      .run(channelId);
    database.sqlite
      .prepare(
        `insert into media_items (
          id, channel_id, source_provider, provider_media_id, media_type, title,
          original_title, source_url, source_status, first_seen_at, metadata_version,
          created_at, updated_at
        ) values (?, ?, 'YOUTUBE', 'queue-video', 'VIDEO', 'Verified Fixture',
          'Verified Fixture', 'https://www.youtube.com/watch?v=queue-video', 'AVAILABLE',
          1, 1, 1, 1)`,
      )
      .run(mediaId, channelId);
    database.sqlite
      .prepare(
        `insert into destinations (
          id, destination_type, root_path, enabled, availability_status, created_at, updated_at
        ) values (?, 'FILESYSTEM', 'C:\\Archive', 1, 'AVAILABLE', 1, 1)`,
      )
      .run(destinationId);
    database.sqlite
      .prepare(
        `insert into media_copies (
          id, media_item_id, destination_id, relative_path, bytes, sha256, status,
          verified_at, created_at, updated_at
        ) values (?, ?, ?, 'Videos/queue-video/video.webm', 42, ?, 'VERIFIED', 10, 1, 10)`,
      )
      .run(crypto.randomUUID(), mediaId, destinationId, 'a'.repeat(64));
    const repository = new DurableJobSqlRepository(database);

    const snapshot = repository.snapshot({ section: 'COMPLETED', page: 1, pageSize: 50 });

    expect(snapshot.completedMediaCount).toBe(1);
    expect(snapshot.totalItems).toBe(1);
    expect(snapshot.jobs).toEqual([]);
    expect(snapshot.completedMedia).toEqual([
      {
        mediaItemId: mediaId,
        mediaTitle: 'Verified Fixture',
        destinationPaths: ['C:\\Archive'],
        verifiedCopyCount: 1,
        bytes: 42,
        verifiedAt: 10,
      },
    ]);
  });
});
