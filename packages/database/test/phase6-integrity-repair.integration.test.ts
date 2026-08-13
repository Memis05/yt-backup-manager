import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_APP_SETTINGS } from '@ytbm/core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  LocalBackupRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '../src';

const directories: string[] = [];
const databases: WorkerDatabase[] = [];
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-phase6-'));
  directories.push(directory);
  const database = openWorkerDatabase({
    databasePath: join(directory, 'app.db'),
    ownership: acquireWorkerDatabaseOwnership(),
    migrationsFolder,
  });
  databases.push(database);
  const now = 1_000;
  const channelId = crypto.randomUUID();
  const mediaId = crypto.randomUUID();
  database.sqlite
    .prepare(
      `insert into channels (
        id, source_provider, provider_channel_id, title, backup_enabled, source_status,
        first_seen_at, created_at, updated_at
      ) values (?, 'YOUTUBE', 'UCphase6', 'Phase 6 channel', 1, 'AVAILABLE', ?, ?, ?)`,
    )
    .run(channelId, now, now, now);
  database.sqlite
    .prepare(
      `insert into media_items (
        id, channel_id, source_provider, provider_media_id, media_type, title, original_title,
        source_url, source_status, first_seen_at, metadata_version, created_at, updated_at
      ) values (?, ?, 'YOUTUBE', 'phase6media', 'VIDEO', 'Phase 6 media', 'Phase 6 media',
        'https://www.youtube.com/watch?v=phase6media', 'AVAILABLE', ?, 1, ?, ?)`,
    )
    .run(mediaId, channelId, now, now, now);
  const repository = new LocalBackupRepository(database, () => now);
  const localA = repository.addDestination({
    rootPath: join(directory, 'local-a'),
    identity: null,
    availabilityStatus: 'AVAILABLE',
    lastErrorCode: null,
  });
  const localB = repository.addDestination({
    rootPath: join(directory, 'local-b'),
    identity: null,
    availabilityStatus: 'AVAILABLE',
    lastErrorCode: null,
  });
  const insertAccount = database.sqlite.prepare(
    `insert into accounts (
        id, provider, provider_account_id, email, credential_ref, drive_credential_ref,
        capabilities_json, connection_state, connected_at, created_at, updated_at
      ) values (?, 'GOOGLE', ?, 'phase6@example.test', ?, ?, ?, 'CONNECTED', ?, ?, ?)`,
  );
  const addDrive = (): ReturnType<LocalBackupRepository['addGoogleDriveDestination']> => {
    const accountId = crypto.randomUUID();
    insertAccount.run(
      accountId,
      `subject-${accountId}`,
      `youtube:${accountId}`,
      `drive:${accountId}`,
      JSON.stringify({
        youtubeReadonly: true,
        driveFile: true,
        driveConnectionState: 'CONNECTED',
        grantedScopes: [],
      }),
      now,
      now,
      now,
    );
    const destination = repository.addGoogleDriveDestination(accountId);
    repository.updateGoogleDriveDestinationProbe(destination.id, 'AVAILABLE', null);
    return repository.getGoogleDriveDestination(destination.id);
  };
  const driveA = addDrive();
  const driveB = addDrive();
  return { database, repository, directory, channelId, mediaId, localA, localB, driveA, driveB };
}

function copy(
  database: WorkerDatabase,
  mediaId: string,
  destinationId: string,
  status: 'VERIFIED' | 'MISSING' | 'CORRUPT',
  drive = false,
): string {
  const id = crypto.randomUUID();
  database.sqlite
    .prepare(
      `insert into channel_destinations (channel_id, destination_id, enabled, created_at, updated_at)
       select channel_id, ?, 1, 1000, 1000 from media_items where id = ?
       on conflict(channel_id, destination_id) do update set enabled = 1, updated_at = 1000`,
    )
    .run(destinationId, mediaId);
  database.sqlite
    .prepare(
      `insert into media_copies (
        id, media_item_id, destination_id, relative_path, provider_file_id, container,
        bytes, sha256, quality_profile, content_generation, verification_strength,
        status, verified_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, 'webm', 7, ?, 'MAX_1080P', 'q1:MAX_1080P', ?, ?, ?, 1000, 1000)`,
    )
    .run(
      id,
      mediaId,
      destinationId,
      drive ? null : 'Channel [UCphase6]/Videos/Media [phase6media]/video.webm',
      drive ? `provider-${id}` : null,
      'a'.repeat(64),
      drive ? 'PROVIDER_METADATA_SIZE' : 'LOCAL_SHA256',
      status,
      status === 'VERIFIED' ? 1000 : null,
    );
  return id;
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('Phase 6 integrity and repair persistence', () => {
  it('plans scoped durable verification and persists accurately labeled history', async () => {
    const { database, repository, mediaId, localA, driveA } = await fixture();
    const localCopy = copy(database, mediaId, localA.id, 'VERIFIED');
    copy(database, mediaId, driveA.id, 'VERIFIED', true);
    const result = repository.planIntegrity({ kind: 'ALL' }, 'DOWNLOADED_SHA256');
    expect(result.plannedChecks).toBe(2);
    const jobs = database.sqlite
      .prepare(
        `select id, payload_json from jobs where job_type = 'VERIFY_EXISTING_COPY' order by id`,
      )
      .all() as Array<{ id: string; payload_json: string }>;
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => JSON.parse(job.payload_json).verificationStrength).sort()).toEqual([
      'DOWNLOADED_SHA256',
      'LOCAL_SHA256',
    ]);
    const localCheck = database.sqlite
      .prepare('select id from integrity_checks where media_copy_id = ?')
      .get(localCopy) as { id: string };
    repository.completeIntegrityCheck({
      checkId: localCheck.id,
      copyId: localCopy,
      result: 'CORRUPT',
      verificationStrength: 'LOCAL_SHA256',
      actualSha256: 'b'.repeat(64),
      actualBytes: 7,
      errorCode: 'COPY_CORRUPT',
      safeMessage: 'The local copy failed SHA-256 verification.',
    });
    const overview = repository.integrityOverview();
    expect(overview.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ copyId: localCopy, health: 'CORRUPT' })]),
    );
    expect(overview.history[0]).toMatchObject({
      mediaCopyId: localCopy,
      verificationStrength: 'LOCAL_SHA256',
      result: 'CORRUPT',
    });
    expect(overview.channels).toEqual([
      expect.objectContaining({
        channelId: expect.any(String),
        health: expect.objectContaining({ corrupt: 1 }),
      }),
    ]);
    expect(overview.media).toEqual([
      expect.objectContaining({ mediaItemId: mediaId, health: 'CORRUPT', intendedCopyCount: 2 }),
    ]);
    const notification = repository.pendingNotifications(DEFAULT_APP_SETTINGS);
    expect(notification).toEqual([
      expect.objectContaining({
        category: 'INTEGRITY_CORRUPT',
        route: { section: 'integrity', entityId: localCopy },
      }),
    ]);
    expect(repository.ackNotifications([notification[0]!.id])).toBe(1);
    repository.completeIntegrityCheck({
      checkId: localCheck.id,
      copyId: localCopy,
      result: 'CORRUPT',
      verificationStrength: 'LOCAL_SHA256',
      actualSha256: 'b'.repeat(64),
      actualBytes: 7,
      errorCode: 'COPY_CORRUPT',
      safeMessage: 'The local copy still failed SHA-256 verification.',
    });
    expect(repository.pendingNotifications(DEFAULT_APP_SETTINGS)).toEqual([]);
    repository.completeIntegrityCheck({
      checkId: localCheck.id,
      copyId: localCopy,
      result: 'VERIFIED',
      verificationStrength: 'LOCAL_SHA256',
      actualSha256: 'a'.repeat(64),
      actualBytes: 7,
      errorCode: null,
      safeMessage: null,
    });
    repository.completeIntegrityCheck({
      checkId: localCheck.id,
      copyId: localCopy,
      result: 'CORRUPT',
      verificationStrength: 'LOCAL_SHA256',
      actualSha256: 'b'.repeat(64),
      actualBytes: 7,
      errorCode: 'COPY_CORRUPT',
      safeMessage: 'The local copy failed again.',
    });
    expect(repository.pendingNotifications(DEFAULT_APP_SETTINGS)).toHaveLength(1);
  });

  it.each([
    ['LOCAL', false, false, 'COPY_TO_FILESYSTEM'],
    ['LOCAL_TO_DRIVE', false, true, 'UPLOAD_TO_GOOGLE_DRIVE'],
    ['DRIVE_TO_LOCAL', true, false, 'COPY_TO_FILESYSTEM'],
    ['DRIVE_TO_DRIVE', true, true, 'UPLOAD_TO_GOOGLE_DRIVE'],
  ] as const)(
    'plans trusted %s repair without yt-dlp',
    async (_name, sourceDrive, targetDrive, transferType) => {
      const { database, repository, directory, mediaId, localA, localB, driveA, driveB } =
        await fixture();
      const source = copy(
        database,
        mediaId,
        sourceDrive ? driveA.id : localA.id,
        'VERIFIED',
        sourceDrive,
      );
      const target = copy(
        database,
        mediaId,
        targetDrive ? driveB.id : localB.id,
        'MISSING',
        targetDrive,
      );
      const result = repository.planRepair(target, false, 'MAX_1080P', join(directory, 'staging'));
      expect(result.source).toBe(sourceDrive ? 'GOOGLE_DRIVE' : 'LOCAL');
      const jobs = database.sqlite
        .prepare(
          'select job_type, payload_json from jobs where backup_run_id = ? order by created_at, id',
        )
        .all(result.runId) as Array<{ job_type: string; payload_json: string }>;
      expect(jobs.map((job) => job.job_type)).toContain(transferType);
      expect(jobs.map((job) => job.job_type)).not.toContain('DOWNLOAD_MEDIA');
      if (sourceDrive)
        expect(jobs.map((job) => job.job_type)).toContain('DOWNLOAD_FROM_GOOGLE_DRIVE');
      const transfer = jobs.find((job) => job.job_type === transferType)!;
      expect(JSON.parse(transfer.payload_json)).toMatchObject({
        mediaCopyId: target,
        replaceUnhealthy: true,
        ...(sourceDrive ? { sourceCopyId: null } : { sourceCopyId: source }),
      });
    },
  );

  it('uses YouTube only as an explicitly approved last source', async () => {
    const { database, repository, directory, mediaId, localA } = await fixture();
    const target = copy(database, mediaId, localA.id, 'MISSING');
    expect(() =>
      repository.planRepair(target, false, 'MAX_1080P', join(directory, 'staging')),
    ).toThrow(/No trusted archive source/);
    const result = repository.planRepair(target, true, 'MAX_1080P', join(directory, 'staging'));
    expect(result.source).toBe('YOUTUBE');
    const acquisition = database.sqlite
      .prepare('select count(*) as count from jobs where backup_run_id = ? and job_type = ?')
      .get(result.runId, 'DOWNLOAD_MEDIA') as { count: number };
    expect(acquisition.count).toBe(1);
  });
});
