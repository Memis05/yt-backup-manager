import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_APP_SETTINGS } from '@ytbm/core';
import {
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '@ytbm/database/worker';
import type { YtDlpAdapter } from '@ytbm/download-ytdlp';
import { MemoryLogSink, StructuredLogger } from '@ytbm/security';
import type { StorageProvider } from '@ytbm/storage-core';
import { FilesystemStorageProvider } from '@ytbm/storage-filesystem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalBackupRuntime } from '../src/worker-bootstrap/backup-runtime';

const directories: string[] = [];
const databases: WorkerDatabase[] = [];
const runtimes: LocalBackupRuntime[] = [];
const migrationsFolder = fileURLToPath(
  new URL('../../../packages/database/drizzle', import.meta.url),
);

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-local-runtime-'));
  directories.push(directory);
  const database = openWorkerDatabase({
    databasePath: join(directory, 'app.db'),
    ownership: acquireWorkerDatabaseOwnership(),
    migrationsFolder,
  });
  databases.push(database);
  const now = Date.now();
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
        original_title, source_url, thumbnail_url, source_status, first_seen_at, last_seen_at,
        metadata_version, created_at, updated_at
      ) values (?, ?, 'YOUTUBE', 'media123', 'VIDEO', 'Fixture Video', 'Fixture Video',
        'https://www.youtube.com/watch?v=media123',
        'https://i.ytimg.com/vi/media123/default.jpg', 'AVAILABLE', ?, ?, 1, ?, ?)`,
    )
    .run(mediaId, channelId, now, now, now, now);
  const volumeIdentity = {
    identify: async (path: string) => ({
      volumeGuid: 'fixture-volume',
      volumeSerial: 'fixture-serial',
      filesystemType: 'fixturefs',
      mountPath: parse(path).root,
    }),
    findMount: async (identity: { mountPath: string }) => identity.mountPath,
  };
  return {
    directory,
    database,
    channelId,
    mediaId,
    backupRoot: join(directory, 'backup'),
    stagingRoot: join(directory, 'staging'),
    storage: new FilesystemStorageProvider(volumeIdentity),
  };
}

function fakeFfmpeg() {
  return {
    version: async () => 'fixture',
    postProcess: async (input: { videoPath: string }) => ({
      path: input.videoPath,
      container: 'webm' as const,
      merged: false,
    }),
  };
}

function fakeProbe(providerMediaId: string, qualityProfile: 'MAX_1080P', expectedBytes = 16) {
  return {
    providerMediaId,
    qualityProfile,
    videoFormatId: '248',
    audioFormatId: null,
    container: 'webm',
    videoCodec: 'vp9',
    audioCodec: 'opus',
    width: 1920,
    height: 1080,
    fps: 30,
    expectedBytes,
  };
}

function fakeThumbnailFetch(): typeof fetch {
  return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe('error');
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
    });
  }) as typeof fetch;
}

describe('LocalBackupRuntime durable pipeline', () => {
  it('does not accept an idle shutdown while destination reconciliation is active', async () => {
    const fixture = await createFixture();
    let markProbeStarted!: () => void;
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    let releaseProbe!: () => void;
    const probeReleased = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    let delayProbe = false;
    const storage: StorageProvider = {
      type: 'FILESYSTEM',
      probe: async (destination) => {
        if (delayProbe) {
          markProbeStarted();
          await probeReleased;
        }
        return fixture.storage.probe(destination);
      },
      putFile: (input) => fixture.storage.putFile(input),
      resolveCurrentRoot: (destination) => fixture.storage.resolveCurrentRoot(destination),
    };
    const runtime = new LocalBackupRuntime({
      workerId: 'worker-reconciliation-shutdown-test',
      database: fixture.database,
      stagingRoot: fixture.stagingRoot,
      ytDlpExecutable: 'fixture-yt-dlp.exe',
      ffmpegExecutable: 'fixture-ffmpeg.exe',
      logger: new StructuredLogger('local-backup-shutdown-test', new MemoryLogSink()),
      settings: async () => DEFAULT_APP_SETTINGS,
      fetch: fakeThumbnailFetch(),
      storage,
      ytDlp: {
        version: async () => 'fixture',
        probe: async (providerMediaId) => fakeProbe(providerMediaId, 'MAX_1080P'),
        download: vi.fn<YtDlpAdapter['download']>(),
      },
      ffmpeg: fakeFfmpeg(),
    });
    runtimes.push(runtime);
    await runtime.addDestination(fixture.backupRoot);
    delayProbe = true;
    runtime.start();

    await probeStarted;
    expect(runtime.requestShutdownIfIdle()).toBe(false);
    releaseProbe();
    await eventually(() => expect(runtime.isIdle()).toBe(true));
    expect(runtime.requestShutdownIfIdle()).toBe(true);
  });

  it('fails before acquisition when known media size exceeds staging capacity', async () => {
    const fixture = await createFixture();
    const download = vi.fn<YtDlpAdapter['download']>();
    const runtime = new LocalBackupRuntime({
      workerId: 'worker-staging-capacity-fixture',
      database: fixture.database,
      stagingRoot: fixture.stagingRoot,
      ytDlpExecutable: 'fixture-yt-dlp.exe',
      ffmpegExecutable: 'fixture-ffmpeg.exe',
      logger: new StructuredLogger('local-backup-capacity-test', new MemoryLogSink()),
      settings: async () => DEFAULT_APP_SETTINGS,
      fetch: fakeThumbnailFetch(),
      storage: fixture.storage,
      ytDlp: {
        version: async () => 'fixture',
        probe: async (providerMediaId) =>
          fakeProbe(providerMediaId, 'MAX_1080P', Number.MAX_SAFE_INTEGER),
        download,
      },
      ffmpeg: fakeFfmpeg(),
    });
    runtimes.push(runtime);
    runtime.start();
    const destination = await runtime.addDestination(fixture.backupRoot);
    await runtime.setChannelSettings({
      channelId: fixture.channelId,
      qualityProfileOverride: 'MAX_1080P',
      destinationIds: [destination.id],
    });

    await runtime.startBackup(fixture.channelId);
    await eventually(() => {
      expect(
        runtime.queueSnapshot().jobs.find((job) => job.jobType === 'DOWNLOAD_MEDIA'),
      ).toMatchObject({ status: 'FAILED', errorCode: 'STAGING_UNAVAILABLE' });
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('acquires, hashes, copies, verifies, writes recovery metadata, and stays incremental', async () => {
    const fixture = await createFixture();
    const download = vi.fn(async (...args: Parameters<YtDlpAdapter['download']>) => {
      const [, , stagingDirectory, options = {}] = args;
      const path = join(stagingDirectory, 'video.source.webm');
      await writeFile(path, 'verified fixture');
      options.onProgress?.({
        bytesProcessed: 16,
        bytesTotal: 16,
        speedBytesPerSec: 8,
        etaSeconds: 0,
      });
      return { videoPath: path, audioPath: null, resumed: false };
    });
    const runtime = new LocalBackupRuntime({
      workerId: 'worker-fixture',
      database: fixture.database,
      stagingRoot: fixture.stagingRoot,
      ytDlpExecutable: 'fixture-yt-dlp.exe',
      ffmpegExecutable: 'fixture-ffmpeg.exe',
      logger: new StructuredLogger('local-backup-test', new MemoryLogSink()),
      settings: async () => DEFAULT_APP_SETTINGS,
      fetch: fakeThumbnailFetch(),
      storage: fixture.storage,
      ytDlp: {
        version: async () => 'fixture',
        probe: async (providerMediaId) => fakeProbe(providerMediaId, 'MAX_1080P'),
        download,
      },
      ffmpeg: fakeFfmpeg(),
    });
    runtimes.push(runtime);
    runtime.start();
    const destination = await runtime.addDestination(fixture.backupRoot);
    await runtime.setChannelSettings({
      channelId: fixture.channelId,
      qualityProfileOverride: 'MAX_1080P',
      destinationIds: [destination.id],
    });

    const firstRun = await runtime.startBackup(fixture.channelId);
    await eventually(() => {
      const status = runtime.listRuns().find((run) => run.id === firstRun.run.id)?.status;
      if (status !== 'COMPLETED') {
        throw new Error(
          JSON.stringify({
            status,
            jobs: runtime.queueSnapshot().jobs.map((job) => ({
              type: job.jobType,
              status: job.status,
              code: job.errorCode,
              message: job.safeMessage,
            })),
          }),
        );
      }
    });

    const details = runtime.mediaDetails(fixture.mediaId);
    expect(details.copies).toHaveLength(1);
    expect(details.copies[0]).toMatchObject({
      status: 'VERIFIED',
      qualityProfile: 'MAX_1080P',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const copyPath = join(details.copies[0]!.destinationPath, details.copies[0]!.relativePath!);
    await expect(readFile(copyPath, 'utf8')).resolves.toBe('verified fixture');
    await expect(readFile(join(dirname(copyPath), 'metadata.json'), 'utf8')).resolves.toContain(
      '"providerMediaId": "media123"',
    );
    await expect(stat(join(dirname(copyPath), 'thumbnail.jpg'))).resolves.toMatchObject({
      size: 4,
    });
    const manifestPath = join(
      fixture.backupRoot,
      'Fixture Channel [UCfixture]',
      '.ytbackup',
      'manifest.json',
    );
    await expect(readFile(manifestPath, 'utf8')).resolves.toContain('"sha256"');

    const secondRun = await runtime.startBackup(fixture.channelId);
    await eventually(() => {
      expect(runtime.listRuns().find((run) => run.id === secondRun.run.id)?.status).toBe(
        'COMPLETED',
      );
    });
    expect(download).toHaveBeenCalledTimes(1);

    const secondDestination = await runtime.addDestination(join(fixture.directory, 'backup-b'));
    await runtime.setChannelSettings({
      channelId: fixture.channelId,
      qualityProfileOverride: 'MAX_1080P',
      destinationIds: [destination.id, secondDestination.id],
    });
    const thirdRun = await runtime.startBackup(fixture.channelId);
    await eventually(() => {
      expect(runtime.listRuns().find((run) => run.id === thirdRun.run.id)?.status).toBe(
        'COMPLETED',
      );
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(runtime.mediaDetails(fixture.mediaId).copies).toHaveLength(2);
    expect(
      runtime.mediaDetails(fixture.mediaId).copies.every((copy) => copy.status === 'VERIFIED'),
    ).toBe(true);

    const verifiedBeforeDeletion = runtime.mediaDetails(fixture.mediaId).copies;
    await rm(join(fixture.backupRoot, 'Fixture Channel [UCfixture]'), {
      recursive: true,
      force: true,
    });
    await rm(join(fixture.directory, 'backup-b', 'Fixture Channel [UCfixture]'), {
      recursive: true,
      force: true,
    });

    await expect(
      runtime.resolveVerifiedCopyFolder(verifiedBeforeDeletion[0]!.id),
    ).resolves.toMatchObject({
      status: 'MISSING',
      safeMessage: expect.stringContaining('Start Backup now'),
    });
    expect(runtime.mediaDetails(fixture.mediaId).copies[0]?.status).toBe('MISSING');

    const repairRun = await runtime.startBackup(fixture.channelId);
    expect(repairRun.skippedVerifiedMedia).toBe(0);
    await eventually(() => {
      expect(runtime.listRuns().find((run) => run.id === repairRun.run.id)?.status).toBe(
        'COMPLETED',
      );
    });
    expect(download).toHaveBeenCalledTimes(2);
    const repairedCopies = runtime.mediaDetails(fixture.mediaId).copies;
    expect(repairedCopies).toHaveLength(2);
    expect(repairedCopies.every((copy) => copy.status === 'VERIFIED')).toBe(true);
    for (const copy of repairedCopies) {
      await expect(stat(join(copy.destinationPath, copy.relativePath!))).resolves.toMatchObject({
        size: 16,
      });
      await expect(
        stat(join(dirname(join(copy.destinationPath, copy.relativePath!)), 'thumbnail.jpg')),
      ).resolves.toMatchObject({ size: 4 });
    }
  });

  it('retains a partial on shutdown and resumes the interrupted job after restart', async () => {
    const fixture = await createFixture();
    const firstDownload = vi.fn(async (...args: Parameters<YtDlpAdapter['download']>) => {
      const [, , stagingDirectory, options = {}] = args;
      const partial = join(stagingDirectory, 'video.source.webm.part');
      await writeFile(partial, 'partial fixture');
      return new Promise<never>((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(options.signal.reason);
          return;
        }
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
          once: true,
        });
      });
    });
    const common = {
      database: fixture.database,
      stagingRoot: fixture.stagingRoot,
      ytDlpExecutable: 'fixture-yt-dlp.exe',
      ffmpegExecutable: 'fixture-ffmpeg.exe',
      logger: new StructuredLogger('local-backup-restart-test', new MemoryLogSink()),
      settings: async () => DEFAULT_APP_SETTINGS,
      fetch: fakeThumbnailFetch(),
      storage: fixture.storage,
      ffmpeg: fakeFfmpeg(),
    };
    const firstRuntime = new LocalBackupRuntime({
      ...common,
      workerId: 'worker-before-restart',
      ytDlp: {
        version: async () => 'fixture',
        probe: async (providerMediaId) => fakeProbe(providerMediaId, 'MAX_1080P'),
        download: firstDownload,
      },
    });
    runtimes.push(firstRuntime);
    firstRuntime.start();
    const destination = await firstRuntime.addDestination(fixture.backupRoot);
    await firstRuntime.setChannelSettings({
      channelId: fixture.channelId,
      qualityProfileOverride: 'MAX_1080P',
      destinationIds: [destination.id],
    });
    const run = await firstRuntime.startBackup(fixture.channelId);
    await eventually(() => {
      expect(
        firstRuntime.queueSnapshot().jobs.find((job) => job.jobType === 'DOWNLOAD_MEDIA')?.status,
      ).toBe('RUNNING');
    });

    await firstRuntime.stop();
    const partialPath = join(
      fixture.stagingRoot,
      'youtube',
      fixture.mediaId,
      `q1-max_1080p-run-${run.run.id}`,
      'video.source.webm.part',
    );
    await expect(stat(partialPath)).resolves.toMatchObject({ size: 15 });
    expect(
      firstRuntime.queueSnapshot().jobs.find((job) => job.jobType === 'DOWNLOAD_MEDIA')?.status,
    ).toBe('INTERRUPTED');

    const resumedDownload = vi.fn(async (...args: Parameters<YtDlpAdapter['download']>) => {
      const [, , stagingDirectory] = args;
      await expect(stat(join(stagingDirectory, 'video.source.webm.part'))).resolves.toBeDefined();
      const path = join(stagingDirectory, 'video.source.webm');
      await writeFile(path, 'verified fixture');
      return { videoPath: path, audioPath: null, resumed: true };
    });
    const resumedRuntime = new LocalBackupRuntime({
      ...common,
      workerId: 'worker-after-restart',
      ytDlp: {
        version: async () => 'fixture',
        probe: async (providerMediaId) => fakeProbe(providerMediaId, 'MAX_1080P'),
        download: resumedDownload,
      },
    });
    runtimes.push(resumedRuntime);
    resumedRuntime.start();
    await eventually(() => {
      const status = resumedRuntime.listRuns().find((item) => item.id === run.run.id)?.status;
      if (status !== 'COMPLETED') {
        throw new Error(
          JSON.stringify({
            status,
            jobs: resumedRuntime.queueSnapshot().jobs.map((job) => ({
              type: job.jobType,
              status: job.status,
              code: job.errorCode,
              message: job.safeMessage,
            })),
          }),
        );
      }
    });

    expect(resumedDownload).toHaveBeenCalledTimes(1);
    expect(resumedRuntime.mediaDetails(fixture.mediaId).copies[0]?.status).toBe('VERIFIED');
  });

  it('removes retained partial data when a paused download is cancelled with removal', async () => {
    const fixture = await createFixture();
    const download = vi.fn(async (...args: Parameters<YtDlpAdapter['download']>) => {
      const [, , stagingDirectory, options = {}] = args;
      await writeFile(join(stagingDirectory, 'video.source.webm.part'), 'partial fixture');
      return new Promise<never>((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(options.signal.reason);
          return;
        }
        options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
          once: true,
        });
      });
    });
    const runtime = new LocalBackupRuntime({
      database: fixture.database,
      stagingRoot: fixture.stagingRoot,
      ytDlpExecutable: 'fixture-yt-dlp.exe',
      ffmpegExecutable: 'fixture-ffmpeg.exe',
      logger: new StructuredLogger('local-backup-cancel-test', new MemoryLogSink()),
      workerId: 'worker-cancel-test',
      settings: async () => DEFAULT_APP_SETTINGS,
      fetch: fakeThumbnailFetch(),
      storage: fixture.storage,
      ffmpeg: fakeFfmpeg(),
      ytDlp: {
        version: async () => 'fixture',
        probe: async (providerMediaId) => fakeProbe(providerMediaId, 'MAX_1080P'),
        download,
      },
    });
    runtimes.push(runtime);
    runtime.start();
    const destination = await runtime.addDestination(fixture.backupRoot);
    await runtime.setChannelSettings({
      channelId: fixture.channelId,
      qualityProfileOverride: 'MAX_1080P',
      destinationIds: [destination.id],
    });
    await runtime.startBackup(fixture.channelId);
    let downloadJobId = '';
    await eventually(() => {
      const job = runtime.queueSnapshot().jobs.find((item) => item.jobType === 'DOWNLOAD_MEDIA');
      expect(job?.status).toBe('RUNNING');
      downloadJobId = job!.id;
    });

    await runtime.controlJob(downloadJobId, 'PAUSE');
    await eventually(() => {
      expect(runtime.queueSnapshot().jobs.find((job) => job.id === downloadJobId)?.status).toBe(
        'PAUSED',
      );
    });
    await runtime.controlJob(downloadJobId, 'CANCEL_REMOVE_PARTIAL');

    expect(runtime.queueSnapshot().jobs.find((job) => job.id === downloadJobId)?.status).toBe(
      'CANCELLED',
    );
    await expect(stat(fixture.stagingRoot)).resolves.toBeDefined();
    const payload = fixture.database.sqlite
      .prepare('select payload_json from jobs where id = ?')
      .get(downloadJobId) as { payload_json: string };
    await expect(
      stat((JSON.parse(payload.payload_json) as { stagingDirectory: string }).stagingDirectory),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
