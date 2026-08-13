import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BackupOperationError } from '@ytbm/core';
import {
  DrizzleGoogleAccountRepository,
  LocalBackupRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '@ytbm/database/worker';
import type {
  GoogleDriveObjectStat,
  GoogleDriveStorageProvider,
  VolumeIdentityProvider,
} from '@ytbm/storage-core';
import { afterEach, describe, expect, it } from 'vitest';

import { RecoveryService } from '../src';

const migrationsFolder = fileURLToPath(new URL('../../database/drizzle', import.meta.url));
const directories: string[] = [];
const databases: WorkerDatabase[] = [];
const sha256 = 'a'.repeat(64);
const bytes = Buffer.byteLength('video-data');

const version = { schemaVersion: 1, provider: 'YOUTUBE' } as const;
const metadata = {
  schemaVersion: 1,
  provider: 'YOUTUBE',
  providerMediaId: 'video123',
  channelId: 'UCRecovery123',
  channelTitle: 'Recovered Channel',
  currentTitle: 'Current Recovered Title',
  originalTitle: 'Original Video',
  sourceUrl: 'https://www.youtube.com/watch?v=video123',
  mediaType: 'VIDEO',
  sourceStatus: 'AVAILABLE',
  selectedQualityProfile: 'MAX_1080P',
  container: 'webm',
  width: 1920,
  height: 1080,
  bytes,
  sha256,
  downloadedAt: 100,
  verifiedAt: 200,
  lastSourceSyncAt: 300,
  playlistIds: ['PLRecovery123'],
} as const;
const playlist = {
  schemaVersion: 1,
  provider: 'YOUTUBE',
  providerPlaylistId: 'PLRecovery123',
  channelId: 'UCRecovery123',
  title: 'Recovered Playlist',
  sourceStatus: 'AVAILABLE',
  updatedAt: 300,
  items: [{ providerMediaId: 'video123', position: 0 }],
} as const;
const manifest = {
  schemaVersion: 1,
  provider: 'YOUTUBE',
  providerChannelId: 'UCRecovery123',
  channelTitle: 'Recovered Channel',
  updatedAt: 300,
  media: [
    {
      providerMediaId: 'video123',
      mediaType: 'VIDEO',
      mediaDirectory: 'Videos/Recovered Video [video123]',
      mediaFile: 'Videos/Recovered Video [video123]/video.webm',
      metadataFile: 'Videos/Recovered Video [video123]/metadata.json',
      bytes,
      sha256,
    },
  ],
  playlists: [
    {
      providerPlaylistId: 'PLRecovery123',
      playlistFile: 'Playlists/Recovered Playlist [PLRecovery123]/playlist.json',
      mediaIds: ['video123'],
    },
  ],
} as const;

async function databaseFixture(): Promise<{ database: WorkerDatabase; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-recovery-test-'));
  directories.push(directory);
  const database = openWorkerDatabase({
    databasePath: join(directory, 'app.db'),
    ownership: acquireWorkerDatabaseOwnership(),
    migrationsFolder,
  });
  databases.push(database);
  return { database, directory };
}

async function localBackupFixture(directory: string): Promise<string> {
  const root = join(directory, 'Recovered Channel [UCRecovery123]');
  const mediaDirectory = join(root, 'Videos', 'Recovered Video [video123]');
  const playlistDirectory = join(root, 'Playlists', 'Recovered Playlist [PLRecovery123]');
  await mkdir(join(root, '.ytbackup'), { recursive: true });
  await mkdir(mediaDirectory, { recursive: true });
  await mkdir(playlistDirectory, { recursive: true });
  await writeFile(join(root, '.ytbackup', 'version.json'), JSON.stringify(version));
  await writeFile(
    join(root, '.ytbackup', 'manifest.json'),
    JSON.stringify({
      ...manifest,
      futureManifestField: { ignored: true },
      media: manifest.media.map((entry) => ({ ...entry, futureMediaField: true })),
    }),
  );
  await writeFile(join(mediaDirectory, 'video.webm'), 'video-data');
  await writeFile(
    join(mediaDirectory, 'metadata.json'),
    JSON.stringify({ ...metadata, futureMetadataField: ['ignored'] }),
  );
  await writeFile(join(playlistDirectory, 'playlist.json'), JSON.stringify(playlist));
  return root;
}

function unavailableDrive(): GoogleDriveStorageProvider {
  return {} as GoogleDriveStorageProvider;
}

const volumeIdentity = {
  identify: async () => null,
  findMount: async () => null,
} satisfies VolumeIdentityProvider;

async function waitForStatus(
  service: RecoveryService,
  sessionId: string,
  statuses: string[],
): Promise<ReturnType<RecoveryService['getSession']>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const session = service.getSession(sessionId);
    if (statuses.includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Recovery session did not reach ${statuses.join(', ')}`);
}

function count(database: WorkerDatabase, table: string): number {
  return (
    database.sqlite.prepare(`select count(*) as count from ${table}`).get() as { count: number }
  ).count;
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('Phase 5 disaster recovery', () => {
  it('previews, imports, searches, replans, and reimports a local backup idempotently', async () => {
    const { database, directory } = await databaseFixture();
    const root = await localBackupFixture(directory);
    const service = new RecoveryService({
      database,
      googleDriveStorage: unavailableDrive(),
      volumeIdentity,
      now: () => 1_000,
    });
    const draft = service.createSession();
    await service.addLocalSource(draft.id, root);
    service.startScan(draft.id);
    const preview = await waitForStatus(service, draft.id, ['READY_FOR_REVIEW']);

    expect(preview.counts).toMatchObject({ channels: 1, media: 1, playlists: 1, localCopies: 1 });
    expect(count(database, 'media_items')).toBe(0);
    expect(count(database, 'destinations')).toBe(0);

    service.startImport(draft.id);
    const completed = await waitForStatus(service, draft.id, [
      'COMPLETED',
      'COMPLETED_WITH_WARNINGS',
    ]);
    expect(completed.status).toBe('COMPLETED');
    expect(count(database, 'channels')).toBe(1);
    expect(count(database, 'media_items')).toBe(1);
    expect(count(database, 'playlists')).toBe(1);
    expect(count(database, 'playlist_items')).toBe(1);
    expect(count(database, 'media_copies')).toBe(1);
    expect(database.sqlite.prepare('select title from media_items').get()).toEqual({
      title: 'Current Recovered Title',
    });
    expect(
      database.sqlite
        .prepare("select count(*) as count from media_search where media_search match 'Recovered'")
        .get(),
    ).toEqual({ count: 1 });

    const channel = database.sqlite.prepare('select id from channels').get() as { id: string };
    const destination = database.sqlite.prepare('select id from destinations').get() as {
      id: string;
    };
    const backup = new LocalBackupRepository(database, () => 2_000);
    backup.setChannelSettings(channel.id, null, [destination.id], 'MAX_1080P');
    const planned = backup.planBackup(channel.id, 'MAX_1080P', join(directory, 'staging'));
    expect(planned).toMatchObject({ skippedVerifiedMedia: 1 });
    expect(
      database.sqlite
        .prepare(
          "select count(*) as count from jobs where job_type in ('FORMAT_PROBE', 'DOWNLOAD_MEDIA')",
        )
        .get(),
    ).toEqual({ count: 0 });

    service.startScan(draft.id);
    await waitForStatus(service, draft.id, ['READY_FOR_REVIEW']);
    service.startImport(draft.id);
    await waitForStatus(service, draft.id, ['COMPLETED', 'COMPLETED_WITH_WARNINGS']);
    expect(count(database, 'media_items')).toBe(1);
    expect(count(database, 'media_copies')).toBe(1);
    expect(count(database, 'destinations')).toBe(1);
  });

  it('discovers a renamed Drive root with pagination, then merges Drive and local copies', async () => {
    const { database, directory } = await databaseFixture();
    const rootPath = await localBackupFixture(directory);
    const account = await new DrizzleGoogleAccountRepository(database).upsertConnectedAccount({
      accountId: '11111111-1111-4111-8111-111111111111',
      providerAccountId: 'drive-recovery-subject',
      email: 'drive-recovery@example.test',
      displayName: 'Drive Recovery',
      avatarUrl: null,
      credentialRef: 'google-oauth:drive-recovery',
      grantedScopes: ['https://www.googleapis.com/auth/drive.file'],
      capability: 'GOOGLE_DRIVE',
      connectedAt: 1,
    });
    const object = (
      providerFileId: string,
      name: string,
      parent: string | null,
      logicalKey: string,
      objectType: string,
      objectBytes: number | null = null,
      properties: Record<string, string> = {},
    ): GoogleDriveObjectStat => ({
      providerFileId,
      name,
      mimeType:
        objectType.includes('folder') || objectType === 'backup-root'
          ? 'application/vnd.google-apps.folder'
          : 'application/json',
      bytes: objectBytes,
      parents: parent === null ? [] : [parent],
      appProperties: {
        ytbm: '1',
        ytbmSchemaVersion: '1',
        ytbmObjectKey: logicalKey,
        ytbmObjectType: objectType,
        ...properties,
      },
      modifiedTime: '2026-08-12T00:00:00.000Z',
    });
    const driveSha256 = 'b'.repeat(64);
    const driveManifest = {
      ...manifest,
      media: manifest.media.map((entry) => ({ ...entry, sha256: driveSha256 })),
    };
    const driveMetadata = { ...metadata, sha256: driveSha256 };
    const firstPage = [
      object('root-renamed-123', 'My Renamed Archive', null, 'root', 'backup-root'),
      object(
        'manifest-123',
        'not-the-original-name.json',
        'root-renamed-123',
        'channel:UCRecovery123:manifest',
        'manifest',
      ),
    ];
    const secondPage = [
      object(
        'version-123',
        'version.json',
        'root-renamed-123',
        'channel:UCRecovery123:version',
        'version',
      ),
      object(
        'video-123',
        'renamed-video.webm',
        'root-renamed-123',
        'media:video123:video',
        'video',
        bytes,
        { sha256: driveSha256 },
      ),
      object(
        'metadata-123',
        'metadata.json',
        'root-renamed-123',
        'media:video123:metadata',
        'metadata',
      ),
      object(
        'playlist-123',
        'playlist.json',
        'root-renamed-123',
        'playlist:PLRecovery123:sidecar',
        'json-sidecar',
      ),
    ];
    const texts = new Map([
      ['manifest-123', JSON.stringify(driveManifest)],
      ['version-123', JSON.stringify(version)],
      ['metadata-123', JSON.stringify(driveMetadata)],
      ['playlist-123', JSON.stringify(playlist)],
    ]);
    const requestedTextIds: string[] = [];
    let listedPages = 0;
    let transientFailures = 1;
    const drive = {
      listRecoveryObjects: async ({ pageToken }: { pageToken: string | null }) => {
        if (transientFailures > 0) {
          transientFailures -= 1;
          throw new BackupOperationError('RATE_LIMITED', 'Drive scan is temporarily limited.', {
            disposition: 'RETRY',
            retryAfterMs: 0,
          });
        }
        listedPages += 1;
        return pageToken === null
          ? { objects: firstPage, nextPageToken: 'page-2' }
          : { objects: secondPage, nextPageToken: null };
      },
      getTextContent: async ({ providerFileId }: { providerFileId: string }) => {
        requestedTextIds.push(providerFileId);
        const text = texts.get(providerFileId);
        if (text === undefined) throw new Error('Unexpected binary content request');
        return text;
      },
    } as unknown as GoogleDriveStorageProvider;
    const service = new RecoveryService({ database, googleDriveStorage: drive, volumeIdentity });
    const draft = service.createSession();
    service.addDriveSource(draft.id, account.id);
    service.startScan(draft.id);
    const drivePreview = await waitForStatus(service, draft.id, ['READY_FOR_REVIEW']);
    expect(drivePreview.counts).toMatchObject({ media: 1, driveCopies: 1, localCopies: 0 });
    expect(drivePreview.sources[0]).toMatchObject({ discoveredRootCount: 1 });
    expect(listedPages).toBe(2);
    expect(requestedTextIds).not.toContain('video-123');

    expect(
      service.setDriveRootSelected(
        draft.id,
        drivePreview.sources[0]!.id,
        'root-renamed-123',
        false,
      ),
    ).toMatchObject({ status: 'DRAFT' });
    service.startScan(draft.id);
    const excludedPreview = await waitForStatus(service, draft.id, ['READY_FOR_REVIEW']);
    expect(excludedPreview.counts).toMatchObject({ media: 0, driveCopies: 0 });
    service.setDriveRootSelected(
      draft.id,
      excludedPreview.sources[0]!.id,
      'root-renamed-123',
      true,
    );

    await service.addLocalSource(draft.id, rootPath);
    service.startScan(draft.id);
    const mergedPreview = await waitForStatus(service, draft.id, ['READY_FOR_REVIEW']);
    expect(mergedPreview.counts).toMatchObject({
      media: 1,
      copies: 2,
      localCopies: 1,
      driveCopies: 1,
    });
    expect(mergedPreview.warnings.map((warning) => warning.code)).toContain('HASH_CONFLICT');
    service.startImport(draft.id);
    await waitForStatus(service, draft.id, ['COMPLETED', 'COMPLETED_WITH_WARNINGS']);
    expect(count(database, 'media_items')).toBe(1);
    expect(count(database, 'media_copies')).toBe(2);
    expect(count(database, 'destinations')).toBe(2);
    expect(
      database.sqlite
        .prepare(
          "select provider_root_id from destinations where destination_type = 'GOOGLE_DRIVE'",
        )
        .get(),
    ).toEqual({ provider_root_id: 'root-renamed-123' });
  });

  it('isolates unsafe paths and unsupported manifests without mutating the catalog', async () => {
    const { database, directory } = await databaseFixture();
    const unsafeRoot = await localBackupFixture(directory);
    await writeFile(
      join(unsafeRoot, '.ytbackup', 'manifest.json'),
      JSON.stringify({
        ...manifest,
        media: [{ ...manifest.media[0], mediaFile: '../outside.webm' }],
      }),
    );
    const unsupportedRoot = join(directory, 'Unsupported [UCUnsupported]');
    await mkdir(join(unsupportedRoot, '.ytbackup'), { recursive: true });
    await writeFile(
      join(unsupportedRoot, '.ytbackup', 'version.json'),
      JSON.stringify({ schemaVersion: 2, provider: 'YOUTUBE' }),
    );
    await writeFile(join(unsupportedRoot, '.ytbackup', 'manifest.json'), JSON.stringify(manifest));
    const partialParent = join(directory, 'partial-source');
    await mkdir(partialParent, { recursive: true });
    const partialRoot = await localBackupFixture(partialParent);
    await writeFile(
      join(partialRoot, '.ytbackup', 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, provider: 'YOUTUBE', damaged: true }),
    );
    const service = new RecoveryService({
      database,
      googleDriveStorage: unavailableDrive(),
      volumeIdentity,
    });
    const draft = service.createSession();
    await service.addLocalSource(draft.id, unsafeRoot);
    await service.addLocalSource(draft.id, unsupportedRoot);
    await service.addLocalSource(draft.id, partialRoot);
    service.startScan(draft.id);
    const preview = await waitForStatus(service, draft.id, ['READY_FOR_REVIEW']);

    expect(preview.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['UNSAFE_PATH', 'UNSUPPORTED_SCHEMA', 'PARTIAL_BACKUP']),
    );
    expect(preview.counts.media).toBe(1);
    expect(count(database, 'channels')).toBe(0);
    expect(count(database, 'media_items')).toBe(0);
  });

  it('recovers interrupted scan and import state at worker restart boundaries', async () => {
    const { database } = await databaseFixture();
    const service = new RecoveryService({
      database,
      googleDriveStorage: unavailableDrive(),
      volumeIdentity,
    });
    const session = service.createSession();
    database.sqlite
      .prepare("update recovery_sessions set status = 'SCANNING' where id = ?")
      .run(session.id);
    const afterScanRestart = new RecoveryService({
      database,
      googleDriveStorage: unavailableDrive(),
      volumeIdentity,
    });
    expect(afterScanRestart.getSession(session.id)).toMatchObject({
      status: 'FAILED',
      safeMessage: expect.stringMatching(/interrupted/i),
    });

    database.sqlite
      .prepare("update recovery_sessions set status = 'IMPORTING' where id = ?")
      .run(session.id);
    const afterImportRestart = new RecoveryService({
      database,
      googleDriveStorage: unavailableDrive(),
      volumeIdentity,
    });
    expect(afterImportRestart.getSession(session.id)).toMatchObject({
      status: 'READY_FOR_REVIEW',
      safeMessage: expect.stringMatching(/interrupted/i),
    });
  });
});
