import { constants } from 'node:fs';
import { access, mkdir, open, rename, rm, stat, statfs, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  BackupOperationError,
  DestinationDtoSchema,
  QualityProfileSchema,
  ToolDiagnosticsSchema,
  type AppSettings,
  type BackupStartResult,
  type ChannelBackupSettingsDto,
  type DestinationDto,
  type JobType,
  type MediaBackupDetails,
  type ResolveVerifiedCopyFolderResult,
  type QualityProfile,
  type QueueQuery,
  type QueueSnapshot,
  type ToolDiagnostics,
} from '@ytbm/core';
import {
  DurableJobSqlRepository,
  LocalBackupRepository,
  type BackupMediaContext,
  type MediaCopyContext,
} from '@ytbm/database/worker';
import { YtDlpAdapter } from '@ytbm/download-ytdlp';
import { hashFileSha256, verifyFileSha256 } from '@ytbm/integrity';
import {
  DurableJobEngine,
  type DurableJobHandler,
  type JobExecutionContext,
} from '@ytbm/job-engine';
import {
  ChannelManifestSchema,
  ManifestVersionSchema,
  MediaMetadataSchema,
  PlaylistSidecarSchema,
  writeJsonAtomic,
} from '@ytbm/manifest';
import { FfmpegAdapter } from '@ytbm/media-ffmpeg';
import type { LogContext, StructuredLogger } from '@ytbm/security';
import type { DestinationProbe, StorageProvider } from '@ytbm/storage-core';
import {
  FilesystemStorageProvider,
  archiveFolderName,
  assertPathPhysicallyUnderRoot,
  channelRelativeDirectory,
  mediaRelativeDirectory,
  resolvePathUnderRoot,
} from '@ytbm/storage-filesystem';
import { z } from 'zod';

import type { WorkerDatabase } from '@ytbm/database/worker';

const STAGING_CAPACITY_SAFETY_BYTES = 16 * 1024 * 1024;

const ProbeResultSchema = z
  .object({
    providerMediaId: z.string(),
    qualityProfile: z.enum(['BEST_AVAILABLE', 'MAX_4K', 'MAX_1080P', 'MAX_720P']),
    videoFormatId: z.string(),
    audioFormatId: z.string().nullable(),
    container: z.string().nullable(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    fps: z.number().nullable(),
    expectedBytes: z.number().nullable(),
  })
  .strict();

const DownloadResultSchema = ProbeResultSchema.extend({
  videoPath: z.string(),
  audioPath: z.string().nullable(),
  resumed: z.boolean(),
  generation: z.string(),
}).strict();

const StagingResultSchema = ProbeResultSchema.extend({
  path: z.string(),
  container: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  downloadedAt: z.number().int().nonnegative(),
  generation: z.string(),
}).passthrough();

const CopyJobPayloadSchema = z
  .object({
    mediaCopyId: z.string().uuid(),
    qualityProfile: z.enum(['BEST_AVAILABLE', 'MAX_4K', 'MAX_1080P', 'MAX_720P']),
    contentGeneration: z.string(),
    sourceCopyId: z.string().uuid().nullable(),
  })
  .passthrough();

const CopyResultSchema = z
  .object({
    mediaCopyId: z.string().uuid(),
    relativePath: z.string(),
    absolutePath: z.string(),
    container: z.string(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    fps: z.number().nullable(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    qualityProfile: z.enum(['BEST_AVAILABLE', 'MAX_4K', 'MAX_1080P', 'MAX_720P']),
    contentGeneration: z.string(),
    reconciled: z.boolean(),
  })
  .strict();

export interface LocalBackupRuntimeOptions {
  workerId: string;
  database: WorkerDatabase;
  stagingRoot: string;
  ytDlpExecutable: string;
  ffmpegExecutable: string;
  logger: StructuredLogger;
  settings(): Promise<AppSettings>;
  now?: () => number;
  fetch?: typeof fetch;
  ytDlp?: Pick<YtDlpAdapter, 'version' | 'probe' | 'download'>;
  ffmpeg?: Pick<FfmpegAdapter, 'version' | 'postProcess'>;
  storage?: StorageProvider;
}

function errorCodeForProbe(probe: DestinationProbe): string | null {
  if (probe.availability === 'AVAILABLE') return null;
  if (probe.availability === 'DISCONNECTED') return 'DESTINATION_DISCONNECTED';
  if (probe.availability === 'READ_ONLY') return 'DESTINATION_READ_ONLY';
  if (probe.availability === 'FULL') return 'DESTINATION_FULL';
  return 'COPY_FAILED';
}

function relativeProgress(processed: number, total: number | null): number | null {
  return total === null || total === 0 ? null : Math.min(1, processed / total);
}

function nodeErrorCode(error: unknown): string | null {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}

function thumbnailUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    !(
      host === 'img.youtube.com' ||
      host.endsWith('.ytimg.com') ||
      host.endsWith('.ggpht.com') ||
      host.endsWith('.googleusercontent.com')
    )
  ) {
    throw new BackupOperationError('SOURCE_UNAVAILABLE', 'The catalog thumbnail URL is invalid.', {
      disposition: 'FAIL',
    });
  }
  return url.toString();
}

async function writeBufferAtomic(root: string, path: string, value: Uint8Array): Promise<void> {
  await assertPathPhysicallyUnderRoot(root, path, { allowMissing: true });
  await mkdir(dirname(path), { recursive: true });
  await assertPathPhysicallyUnderRoot(root, path, { allowMissing: true });
  const temporaryPath = join(dirname(path), `.${crypto.randomUUID()}.ytbm-file-tmp`);
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, path);
    await assertPathPhysicallyUnderRoot(root, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function writeJsonConfined(root: string, path: string, value: unknown): Promise<void> {
  await assertPathPhysicallyUnderRoot(root, path, { allowMissing: true });
  await writeJsonAtomic(path, value);
  await assertPathPhysicallyUnderRoot(root, path);
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel('Response exceeded the configured byte limit');
        throw new BackupOperationError(
          'SOURCE_UNAVAILABLE',
          'The thumbnail response was unexpectedly large.',
          { disposition: 'FAIL' },
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const value = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    value.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return value;
}

export class LocalBackupRuntime {
  private readonly now: () => number;
  private readonly fetchImplementation: typeof fetch;
  private readonly storage: StorageProvider;
  private readonly repository: LocalBackupRepository;
  private readonly jobs: DurableJobSqlRepository;
  private readonly ytDlp: Pick<YtDlpAdapter, 'version' | 'probe' | 'download'>;
  private readonly ffmpeg: Pick<FfmpegAdapter, 'version' | 'postProcess'>;
  private readonly engine: DurableJobEngine;
  private destinationProbeTimer: NodeJS.Timeout | null = null;
  private reconciliationCursor: string | null = null;
  private refreshPromise: Promise<void> | null = null;

  public constructor(private readonly options: LocalBackupRuntimeOptions) {
    this.now = options.now ?? Date.now;
    this.fetchImplementation = options.fetch ?? fetch;
    this.repository = new LocalBackupRepository(options.database, this.now);
    this.jobs = new DurableJobSqlRepository(options.database);
    this.storage = options.storage ?? new FilesystemStorageProvider();
    this.ytDlp = options.ytDlp ?? new YtDlpAdapter(options.ytDlpExecutable);
    this.ffmpeg = options.ffmpeg ?? new FfmpegAdapter(options.ffmpegExecutable);
    const handlers = this.createHandlers();
    this.engine = new DurableJobEngine({
      workerId: options.workerId,
      repository: this.jobs,
      handlers,
      concurrency: {
        probe: 2,
        download: 2,
        ffmpeg: 1,
        hash: 2,
        copy: 2,
        sidecar: 2,
        manifest: 1,
        cleanup: 1,
      },
      now: this.now,
      onJobSettled: () => this.repository.reconcileAllRuns(),
    });
  }

  public start(): void {
    this.engine.start();
    this.scheduleDestinationRefresh();
    this.destinationProbeTimer = setInterval(() => {
      this.scheduleDestinationRefresh();
    }, 10_000);
    this.destinationProbeTimer.unref();
  }

  public async stop(): Promise<void> {
    if (this.destinationProbeTimer !== null) clearInterval(this.destinationProbeTimer);
    this.destinationProbeTimer = null;
    await this.engine.stop();
    await this.refreshPromise;
  }

  public isIdle(): boolean {
    return this.engine.isIdle();
  }

  public async addDestination(rootPath: string): Promise<DestinationDto> {
    if (!isAbsolute(rootPath) || rootPath.includes('\u0000')) {
      throw new Error('A local destination must be an absolute filesystem path');
    }
    const absolutePath = resolve(rootPath);
    await mkdir(absolutePath, { recursive: true });
    const provisional = {
      id: crypto.randomUUID(),
      rootPath: absolutePath,
      volumeGuid: null,
      volumeSerial: null,
      filesystemType: null,
      lastKnownMountPath: null,
    };
    const probe = await this.storage.probe(provisional);
    if (probe.availability !== 'AVAILABLE') {
      throw new Error(probe.safeMessage ?? 'The local backup destination is not available');
    }
    const stored = this.repository.addDestination({
      rootPath: absolutePath,
      identity: probe.identity,
      availabilityStatus: probe.availability,
      lastErrorCode: null,
    });
    return this.destinationDto(stored.id, probe);
  }

  public async listDestinations(): Promise<DestinationDto[]> {
    const destinations = this.repository.listDestinations();
    return Promise.all(
      destinations.map(async (destination) => {
        const probe = await this.probeDestination(destination.id);
        return this.destinationDto(destination.id, probe);
      }),
    );
  }

  public disableDestination(destinationId: string): void {
    this.repository.disableDestination(destinationId);
  }

  public async getChannelSettings(channelId: string): Promise<ChannelBackupSettingsDto> {
    const settings = await this.options.settings();
    return this.repository.getChannelSettings(channelId, settings.defaultQualityProfile);
  }

  public async setChannelSettings(input: {
    channelId: string;
    qualityProfileOverride: QualityProfile | null;
    destinationIds: string[];
  }): Promise<ChannelBackupSettingsDto> {
    const settings = await this.options.settings();
    return this.repository.setChannelSettings(
      input.channelId,
      input.qualityProfileOverride,
      input.destinationIds,
      settings.defaultQualityProfile,
    );
  }

  public async startBackup(channelId: string): Promise<BackupStartResult> {
    const settings = await this.options.settings();
    await this.probeAllDestinations();
    await this.reconcileVerifiedCopyPresence({ channelId, exhaust: true });
    const result = this.repository.planBackup(
      channelId,
      settings.defaultQualityProfile,
      this.options.stagingRoot,
    );
    this.engine.wake();
    return result;
  }

  public queueSnapshot(
    query: QueueQuery = { section: 'ALL', page: 1, pageSize: 100 },
  ): QueueSnapshot {
    return this.jobs.snapshot(query);
  }

  public async controlJob(
    jobId: string,
    action: Parameters<DurableJobSqlRepository['controlJob']>[1],
  ) {
    const current = this.jobs.getExecutionJob(jobId);
    if (
      action === 'CANCEL_REMOVE_PARTIAL' &&
      current.jobType === 'DOWNLOAD_MEDIA' &&
      !['RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED'].includes(current.status)
    ) {
      await this.removeDownloadPayload(current.payload);
    }
    const job = this.jobs.controlJob(jobId, action, this.now());
    this.engine.wake();
    this.repository.reconcileAllRuns();
    return job;
  }

  public controlRun(
    runId: string,
    action: Parameters<DurableJobSqlRepository['controlRun']>[1],
  ): void {
    this.jobs.controlRun(runId, action, this.now());
    this.engine.wake();
    this.repository.reconcileAllRuns();
  }

  public listRuns() {
    this.repository.reconcileAllRuns();
    return this.repository.listRuns();
  }

  public mediaDetails(mediaItemId: string): MediaBackupDetails {
    return this.repository.mediaBackupDetails(mediaItemId);
  }

  public async reconciledMediaDetails(mediaItemId: string): Promise<MediaBackupDetails> {
    await this.reconcileVerifiedCopyPresence({ mediaItemId, exhaust: true });
    return this.repository.mediaBackupDetails(mediaItemId);
  }

  public async diagnostics(): Promise<ToolDiagnostics> {
    const [ytDlp, ffmpeg] = await Promise.all([
      this.ytDlp
        .version()
        .then((version) => ({ available: true, version }))
        .catch(() => ({ available: false, version: null })),
      this.ffmpeg
        .version()
        .then((version) => ({ available: true, version }))
        .catch(() => ({ available: false, version: null })),
    ]);
    return ToolDiagnosticsSchema.parse({ ytDlp, ffmpeg });
  }

  public async resolveVerifiedCopyFolder(
    mediaCopyId: string,
  ): Promise<ResolveVerifiedCopyFolderResult> {
    const copy = this.repository.getMediaCopy(mediaCopyId);
    if (copy.status !== 'VERIFIED' || copy.relativePath === null) {
      return {
        status: copy.status === 'MISSING' ? 'MISSING' : 'UNAVAILABLE',
        safeMessage:
          copy.status === 'MISSING'
            ? 'This backup file is missing. Start Backup now to recreate it.'
            : 'Only a currently verified local copy can be opened.',
      };
    }
    const destination = this.repository.getDestination(copy.destinationId);
    const root = await this.storage.resolveCurrentRoot(destination);
    if (root === null) {
      return {
        status: 'UNAVAILABLE',
        safeMessage: 'The local backup destination is disconnected.',
      };
    }
    const file = resolvePathUnderRoot(root, copy.relativePath);
    try {
      await assertPathPhysicallyUnderRoot(root, file);
      const current = await stat(file);
      if (!current.isFile()) {
        this.recordCopyProblem(copy, 'MISSING', 'COPY_MISSING');
        return {
          status: 'MISSING',
          safeMessage: 'This backup file is missing. Start Backup now to recreate it.',
        };
      }
      if (copy.bytes !== null && current.size !== copy.bytes) {
        this.recordCopyProblem(copy, 'CORRUPT', 'COPY_CORRUPT');
        return {
          status: 'UNAVAILABLE',
          safeMessage: 'This backup file no longer matches its verified size and needs repair.',
        };
      }
      await access(file, constants.R_OK);
      return { status: 'AVAILABLE', folderPath: dirname(file) };
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') {
        this.recordCopyProblem(copy, 'MISSING', 'COPY_MISSING');
        return {
          status: 'MISSING',
          safeMessage: 'This backup file is missing. Start Backup now to recreate it.',
        };
      }
      return {
        status: 'UNAVAILABLE',
        safeMessage: 'The verified backup folder is currently unavailable.',
      };
    }
  }

  private createHandlers(): ReadonlyMap<JobType, DurableJobHandler> {
    return new Map<JobType, DurableJobHandler>([
      ['FORMAT_PROBE', this.jobHandler('probe', (context) => this.formatProbe(context))],
      [
        'DOWNLOAD_MEDIA',
        this.jobHandler(
          'download',
          (context) => this.downloadMedia(context),
          (context) => this.removeDownloadPartial(context),
        ),
      ],
      ['POST_PROCESS_MEDIA', this.jobHandler('ffmpeg', (context) => this.postProcess(context))],
      ['HASH_STAGING_MEDIA', this.jobHandler('hash', (context) => this.hashStaging(context))],
      ['VERIFY_STAGING_MEDIA', this.jobHandler('hash', (context) => this.verifyStaging(context))],
      ['COPY_TO_FILESYSTEM', this.jobHandler('copy', (context) => this.copyToFilesystem(context))],
      [
        'VERIFY_FILESYSTEM_COPY',
        this.jobHandler('hash', (context) => this.verifyFilesystemCopy(context)),
      ],
      [
        'WRITE_DESTINATION_METADATA',
        this.jobHandler('sidecar', (context) => this.writeDestinationMetadata(context)),
      ],
      [
        'DOWNLOAD_THUMBNAIL',
        this.jobHandler('sidecar', (context) => this.downloadThumbnail(context)),
      ],
      ['UPDATE_MANIFEST', this.jobHandler('manifest', (context) => this.updateManifest(context))],
      ['CLEANUP_STAGING', this.jobHandler('cleanup', (context) => this.cleanupStaging(context))],
    ]);
  }

  private jobHandler(
    pool: string,
    execute: (context: JobExecutionContext) => Promise<unknown>,
    cleanupCancelled?: (context: JobExecutionContext) => Promise<void>,
  ): DurableJobHandler {
    return {
      pool,
      execute: async (context) => {
        const logContext: LogContext = {
          workerInstanceId: this.options.workerId,
          jobId: context.job.id,
          ...(context.job.backupRunId === null ? {} : { backupRunId: context.job.backupRunId }),
          ...(context.job.mediaItemId === null ? {} : { mediaId: context.job.mediaItemId }),
          jobType: context.job.jobType,
          destinationId: context.job.destinationId,
        };
        this.options.logger.info('Backup job started', logContext);
        try {
          const result = await execute(context);
          this.options.logger.info('Backup job finished', logContext);
          return result;
        } catch (error) {
          this.options.logger.warn('Backup job stopped', {
            ...logContext,
            errorCode: error instanceof BackupOperationError ? error.code : 'INTERNAL_ERROR',
          });
          throw error;
        }
      },
      ...(cleanupCancelled === undefined ? {} : { cleanupCancelled }),
    };
  }

  private async formatProbe(context: JobExecutionContext): Promise<unknown> {
    const media = this.requiredMedia(context);
    const payload = z
      .object({ qualityProfile: QualityProfileSchema, stagingDirectory: z.string() })
      .passthrough()
      .parse(context.job.payload);
    await this.prepareStagingDirectory(payload.stagingDirectory);
    return this.ytDlp.probe(
      media.providerMediaId,
      media.sourceUrl,
      payload.qualityProfile,
      context.signal,
    );
  }

  private async downloadMedia(context: JobExecutionContext): Promise<unknown> {
    const media = this.requiredMedia(context);
    const payload = z
      .object({ stagingDirectory: z.string(), generation: z.string() })
      .passthrough()
      .parse(context.job.payload);
    const stagingDirectory = await this.prepareStagingDirectory(payload.stagingDirectory);
    const selection = ProbeResultSchema.parse(
      this.repository.getDependencyResult(context.job.id, 'FORMAT_PROBE'),
    );
    if (selection.expectedBytes !== null) {
      try {
        const capacity = await statfs(stagingDirectory, { bigint: true });
        const availableBytes = Number(capacity.bavail * capacity.bsize);
        if (availableBytes < selection.expectedBytes + STAGING_CAPACITY_SAFETY_BYTES) {
          throw new BackupOperationError(
            'STAGING_UNAVAILABLE',
            'Application staging does not have enough free space for this media file.',
            { disposition: 'FAIL' },
          );
        }
      } catch (error) {
        if (error instanceof BackupOperationError) throw error;
        throw new BackupOperationError(
          'STAGING_UNAVAILABLE',
          'Application staging could not be checked before download.',
          { disposition: 'BLOCK', cause: error },
        );
      }
    }
    const result = await this.ytDlp.download(media.sourceUrl, selection, stagingDirectory, {
      signal: context.signal,
      onProgress: (progress) =>
        context.progress({
          bytesProcessed: progress.bytesProcessed,
          bytesTotal: progress.bytesTotal,
          progressRatio: relativeProgress(progress.bytesProcessed, progress.bytesTotal),
          speedBytesPerSec: progress.speedBytesPerSec,
          etaSeconds: progress.etaSeconds,
        }),
    });
    await this.assertStagingPath(result.videoPath, false);
    if (result.audioPath !== null) await this.assertStagingPath(result.audioPath, false);
    const bytes =
      (await stat(result.videoPath)).size +
      (result.audioPath === null ? 0 : (await stat(result.audioPath)).size);
    context.progress({
      bytesProcessed: bytes,
      bytesTotal: bytes,
      progressRatio: 1,
      speedBytesPerSec: null,
      etaSeconds: 0,
    });
    this.repository.setStagingArtifact({
      mediaItemId: media.id,
      jobId: context.job.id,
      artifactType: 'SOURCE_VIDEO',
      path: result.videoPath,
      bytes,
      sha256: null,
      state: 'DOWNLOADED',
      generation: payload.generation,
    });
    return { ...selection, ...result, generation: payload.generation };
  }

  private async postProcess(context: JobExecutionContext): Promise<unknown> {
    const media = this.requiredMedia(context);
    const download = DownloadResultSchema.parse(
      this.repository.getDependencyResult(context.job.id, 'DOWNLOAD_MEDIA'),
    );
    const stagingRoot = dirname(download.videoPath);
    const result = await this.ffmpeg.postProcess({
      stagingRoot,
      videoPath: download.videoPath,
      audioPath: download.audioPath,
      signal: context.signal,
    });
    await this.assertStagingPath(result.path, false);
    this.repository.setStagingArtifact({
      mediaItemId: media.id,
      jobId: context.job.id,
      artifactType: 'MEDIA',
      path: result.path,
      bytes: (await stat(result.path)).size,
      sha256: null,
      state: 'POST_PROCESSED',
      generation: download.generation,
    });
    return { ...download, path: result.path, container: result.container };
  }

  private async hashStaging(context: JobExecutionContext): Promise<unknown> {
    const media = this.requiredMedia(context);
    const post = DownloadResultSchema.extend({ path: z.string(), container: z.string() })
      .passthrough()
      .parse(this.repository.getDependencyResult(context.job.id, 'POST_PROCESS_MEDIA'));
    await this.assertStagingPath(post.path, false);
    const size = (await stat(post.path)).size;
    const hash = await hashFileSha256(post.path, {
      bytesTotal: size,
      signal: context.signal,
      onProgress: (progress) =>
        context.progress({
          bytesProcessed: progress.bytesProcessed,
          bytesTotal: progress.bytesTotal,
          progressRatio: relativeProgress(progress.bytesProcessed, progress.bytesTotal),
          speedBytesPerSec: null,
          etaSeconds: null,
        }),
    });
    this.repository.setStagingArtifact({
      mediaItemId: media.id,
      jobId: context.job.id,
      artifactType: 'MEDIA',
      path: post.path,
      bytes: hash.bytes,
      sha256: hash.sha256,
      state: 'HASHED',
      generation: post.generation,
    });
    return { ...post, ...hash, downloadedAt: this.now() };
  }

  private async verifyStaging(context: JobExecutionContext): Promise<unknown> {
    const media = this.requiredMedia(context);
    const hashed = StagingResultSchema.parse(
      this.repository.getDependencyResult(context.job.id, 'HASH_STAGING_MEDIA'),
    );
    await this.assertStagingPath(hashed.path, false);
    const verified = await verifyFileSha256(hashed.path, hashed.sha256, hashed.bytes, {
      signal: context.signal,
      onProgress: (progress) =>
        context.progress({
          bytesProcessed: progress.bytesProcessed,
          bytesTotal: progress.bytesTotal,
          progressRatio: relativeProgress(progress.bytesProcessed, progress.bytesTotal),
          speedBytesPerSec: null,
          etaSeconds: null,
        }),
    });
    if (!verified.verified) {
      throw new BackupOperationError(
        'VERIFY_FAILED',
        'The staging media failed SHA-256 verification.',
        {
          disposition: 'RETRY',
        },
      );
    }
    this.repository.setStagingArtifact({
      mediaItemId: media.id,
      jobId: context.job.id,
      artifactType: 'MEDIA',
      path: hashed.path,
      bytes: hashed.bytes,
      sha256: hashed.sha256,
      state: 'VERIFIED',
      generation: hashed.generation,
    });
    return hashed;
  }

  private async copyToFilesystem(context: JobExecutionContext): Promise<unknown> {
    const media = this.requiredMedia(context);
    const payload = CopyJobPayloadSchema.parse(context.job.payload);
    const targetCopy = this.repository.getMediaCopy(payload.mediaCopyId);
    const targetDestination = this.repository.getDestination(targetCopy.destinationId);
    let source: {
      path: string;
      container: string;
      videoCodec: string | null;
      audioCodec: string | null;
      width: number | null;
      height: number | null;
      fps: number | null;
      bytes: number;
      sha256: string;
      qualityProfile: QualityProfile;
    };
    if (payload.sourceCopyId !== null) {
      const sourceCopy = this.repository.getMediaCopy(payload.sourceCopyId);
      if (
        sourceCopy.status !== 'VERIFIED' ||
        sourceCopy.relativePath === null ||
        sourceCopy.sha256 === null ||
        sourceCopy.bytes === null ||
        sourceCopy.container === null
      ) {
        throw new BackupOperationError(
          'COPY_MISSING',
          'The selected existing backup source is not verified.',
          {
            disposition: 'FAIL',
          },
        );
      }
      const sourceDestination = this.repository.getDestination(sourceCopy.destinationId);
      const sourceRoot = await this.storage.resolveCurrentRoot(sourceDestination);
      if (sourceRoot === null) {
        throw new BackupOperationError(
          'DESTINATION_DISCONNECTED',
          'The existing verified source drive is disconnected.',
          { disposition: 'BLOCK' },
        );
      }
      const sourcePath = resolvePathUnderRoot(sourceRoot, sourceCopy.relativePath);
      await assertPathPhysicallyUnderRoot(sourceRoot, sourcePath);
      const current = await verifyFileSha256(sourcePath, sourceCopy.sha256, sourceCopy.bytes, {
        signal: context.signal,
      });
      await assertPathPhysicallyUnderRoot(sourceRoot, sourcePath);
      if (!current.verified) {
        this.repository.markMediaCopyFailure(sourceCopy.id, 'CORRUPT', 'COPY_CORRUPT');
        throw new BackupOperationError(
          'COPY_CORRUPT',
          'The existing local source copy is corrupt.',
          {
            disposition: 'FAIL',
          },
        );
      }
      source = {
        path: sourcePath,
        container: sourceCopy.container,
        videoCodec: sourceCopy.videoCodec,
        audioCodec: sourceCopy.audioCodec,
        width: sourceCopy.width,
        height: sourceCopy.height,
        fps: sourceCopy.fps,
        bytes: sourceCopy.bytes,
        sha256: sourceCopy.sha256,
        qualityProfile: sourceCopy.qualityProfile ?? payload.qualityProfile,
      };
    } else {
      const staging = StagingResultSchema.parse(
        this.repository.getDependencyResult(context.job.id, 'VERIFY_STAGING_MEDIA'),
      );
      await this.assertStagingPath(staging.path, false);
      source = {
        path: staging.path,
        container: staging.container,
        videoCodec: staging.videoCodec,
        audioCodec: staging.audioCodec,
        width: staging.width,
        height: staging.height,
        fps: staging.fps,
        bytes: staging.bytes,
        sha256: staging.sha256,
        qualityProfile: staging.qualityProfile,
      };
    }
    const relativePath = join(
      channelRelativeDirectory(media.channelTitle, media.providerChannelId),
      mediaRelativeDirectory(media.mediaType, media.title, media.providerMediaId),
      `video.${source.container}`,
    );
    this.repository.markMediaCopyTransferring(targetCopy.id);
    const copied = await this.storage.putFile({
      destination: targetDestination,
      sourcePath: source.path,
      relativePath,
      expectedSha256: source.sha256,
      expectedBytes: source.bytes,
      signal: context.signal,
      onProgress: (bytesProcessed) =>
        context.progress({
          bytesProcessed,
          bytesTotal: source.bytes,
          progressRatio: relativeProgress(bytesProcessed, source.bytes),
          speedBytesPerSec: null,
          etaSeconds: null,
        }),
    });
    const result = CopyResultSchema.parse({
      mediaCopyId: targetCopy.id,
      relativePath: copied.relativePath,
      absolutePath: copied.absolutePath,
      container: source.container,
      videoCodec: source.videoCodec,
      audioCodec: source.audioCodec,
      width: source.width,
      height: source.height,
      fps: source.fps,
      bytes: copied.bytes,
      sha256: copied.sha256,
      qualityProfile: source.qualityProfile,
      contentGeneration: payload.contentGeneration,
      reconciled: copied.reconciled,
    });
    this.repository.updateMediaCopyTransferred(targetCopy.id, result);
    return result;
  }

  private async verifyFilesystemCopy(context: JobExecutionContext): Promise<unknown> {
    const result = CopyResultSchema.parse(
      this.repository.getDependencyResult(context.job.id, 'COPY_TO_FILESYSTEM'),
    );
    const copy = this.repository.getMediaCopy(result.mediaCopyId);
    const destination = this.repository.getDestination(copy.destinationId);
    const root = await this.storage.resolveCurrentRoot(destination);
    if (root === null || copy.relativePath === null) throw this.disconnected();
    const verifiedPath = resolvePathUnderRoot(root, copy.relativePath);
    if (resolve(verifiedPath) !== resolve(result.absolutePath)) {
      throw new BackupOperationError(
        'VERIFY_FAILED',
        'The destination copy path changed before verification.',
        { disposition: 'FAIL' },
      );
    }
    let verification;
    try {
      await assertPathPhysicallyUnderRoot(root, verifiedPath);
      verification = await verifyFileSha256(verifiedPath, result.sha256, result.bytes, {
        signal: context.signal,
        onProgress: (progress) =>
          context.progress({
            bytesProcessed: progress.bytesProcessed,
            bytesTotal: progress.bytesTotal,
            progressRatio: relativeProgress(progress.bytesProcessed, progress.bytesTotal),
            speedBytesPerSec: null,
            etaSeconds: null,
          }),
      });
      await assertPathPhysicallyUnderRoot(root, verifiedPath);
    } catch (error) {
      this.repository.markMediaCopyFailure(result.mediaCopyId, 'MISSING', 'COPY_MISSING');
      throw new BackupOperationError(
        'COPY_MISSING',
        'The destination copy disappeared before verification.',
        {
          disposition: 'RETRY',
          cause: error,
        },
      );
    }
    if (!verification.verified) {
      this.repository.markMediaCopyFailure(result.mediaCopyId, 'CORRUPT', 'COPY_CORRUPT');
      throw new BackupOperationError(
        'COPY_CORRUPT',
        'The final destination copy failed SHA-256 verification.',
        {
          disposition: 'RETRY',
        },
      );
    }
    if (!this.repository.markMediaCopyVerified(result.mediaCopyId)) {
      throw new BackupOperationError(
        'VERIFY_FAILED',
        'The local copy state changed before verification could be committed.',
        { disposition: 'RETRY' },
      );
    }
    this.repository.recordActivity({
      eventType: 'LOCAL_COPY_VERIFIED',
      mediaItemId: this.requiredMedia(context).id,
      destinationId: this.repository.getMediaCopy(result.mediaCopyId).destinationId,
      jobId: context.job.id,
      summary: 'A local media copy was verified with SHA-256.',
    });
    return result;
  }

  private async writeDestinationMetadata(context: JobExecutionContext): Promise<unknown> {
    const media = this.requiredMedia(context);
    const payload = z
      .object({ mediaCopyId: z.string().uuid(), contentGeneration: z.string() })
      .passthrough()
      .parse(context.job.payload);
    const copy = this.repository.getMediaCopy(payload.mediaCopyId);
    this.assertVerifiedCopy(copy);
    const destination = this.repository.getDestination(copy.destinationId);
    const root = await this.storage.resolveCurrentRoot(destination);
    if (root === null) throw this.disconnected();
    const mediaPath = resolvePathUnderRoot(root, copy.relativePath!);
    const metadataPath = join(dirname(mediaPath), 'metadata.json');
    const verifiedAt = copy.verifiedAt ?? this.now();
    const metadata = MediaMetadataSchema.parse({
      schemaVersion: 1,
      provider: 'YOUTUBE',
      providerMediaId: media.providerMediaId,
      channelId: media.providerChannelId,
      channelTitle: media.channelTitle,
      currentTitle: media.title,
      originalTitle: media.originalTitle,
      sourceUrl: media.sourceUrl,
      mediaType: media.mediaType,
      sourceStatus: media.sourceStatus,
      ...(media.publishedAt === null ? {} : { publishedAt: media.publishedAt }),
      ...(media.durationSeconds === null ? {} : { duration: media.durationSeconds }),
      selectedQualityProfile: copy.qualityProfile,
      container: copy.container,
      ...(copy.videoCodec === null ? {} : { videoCodec: copy.videoCodec }),
      ...(copy.audioCodec === null ? {} : { audioCodec: copy.audioCodec }),
      ...(copy.width === null ? {} : { width: copy.width }),
      ...(copy.height === null ? {} : { height: copy.height }),
      ...(copy.fps === null ? {} : { fps: copy.fps }),
      bytes: copy.bytes,
      sha256: copy.sha256,
      downloadedAt: verifiedAt,
      verifiedAt,
      ...(media.lastSourceSyncAt === null ? {} : { lastSourceSyncAt: media.lastSourceSyncAt }),
      playlistIds: media.playlistIds,
    });
    await writeJsonConfined(root, metadataPath, metadata);
    const hash = await hashFileSha256(metadataPath);
    this.repository.upsertMediaArtifact({
      mediaItemId: media.id,
      destinationId: copy.destinationId,
      artifactType: 'METADATA',
      relativePath: relative(root, metadataPath),
      bytes: hash.bytes,
      sha256: hash.sha256,
      contentGeneration: payload.contentGeneration,
    });
    return { relativePath: relative(root, metadataPath), ...hash };
  }

  private async downloadThumbnail(context: JobExecutionContext): Promise<unknown> {
    const media = this.requiredMedia(context);
    if (media.thumbnailUrl === null) return { skipped: true };
    const payload = z
      .object({ contentGeneration: z.string() })
      .passthrough()
      .parse(context.job.payload);
    if (context.job.id === '') throw new Error('Invalid job');
    const destinationId = this.requiredDestinationId(context);
    const copy = this.findVerifiedCopy(media.id, destinationId);
    const destination = this.repository.getDestination(destinationId);
    const root = await this.storage.resolveCurrentRoot(destination);
    if (root === null) throw this.disconnected();
    const mediaPath = resolvePathUnderRoot(root, copy.relativePath!);
    const response = await this.fetchImplementation(thumbnailUrl(media.thumbnailUrl), {
      signal: context.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new BackupOperationError(
        'NETWORK_UNAVAILABLE',
        'The current YouTube thumbnail could not be downloaded.',
        {
          disposition: response.status >= 500 ? 'RETRY' : 'FAIL',
        },
      );
    }
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 20 * 1024 * 1024) {
      throw new BackupOperationError(
        'SOURCE_UNAVAILABLE',
        'The thumbnail response was unexpectedly large.',
        {
          disposition: 'FAIL',
        },
      );
    }
    const value = await readBoundedBody(response, 20 * 1024 * 1024);
    const path = join(dirname(mediaPath), 'thumbnail.jpg');
    await writeBufferAtomic(root, path, value);
    const hash = await hashFileSha256(path);
    this.repository.upsertMediaArtifact({
      mediaItemId: media.id,
      destinationId,
      artifactType: 'THUMBNAIL',
      relativePath: relative(root, path),
      bytes: hash.bytes,
      sha256: hash.sha256,
      contentGeneration: payload.contentGeneration,
    });
    return { relativePath: relative(root, path), ...hash };
  }

  private async updateManifest(context: JobExecutionContext): Promise<unknown> {
    const channelId = this.requiredChannelId(context);
    const destinationId = this.requiredDestinationId(context);
    const destination = this.repository.getDestination(destinationId);
    const root = await this.storage.resolveCurrentRoot(destination);
    if (root === null) throw this.disconnected();
    const data = this.repository.getChannelManifestData(channelId, destinationId);
    const channelDirectory = channelRelativeDirectory(data.channelTitle, data.providerChannelId);
    const channelRoot = resolvePathUnderRoot(root, channelDirectory);
    for (const playlist of data.playlists) {
      const playlistDirectory = join(
        'Playlists',
        archiveFolderName(playlist.title, playlist.providerPlaylistId),
      );
      await writeJsonConfined(
        root,
        resolvePathUnderRoot(channelRoot, join(playlistDirectory, 'playlist.json')),
        PlaylistSidecarSchema.parse({
          schemaVersion: 1,
          provider: 'YOUTUBE',
          providerPlaylistId: playlist.providerPlaylistId,
          channelId: data.providerChannelId,
          title: playlist.title,
          sourceStatus: playlist.sourceStatus,
          updatedAt: this.now(),
          items: playlist.items,
        }),
      );
    }
    const manifest = ChannelManifestSchema.parse({
      schemaVersion: 1,
      provider: 'YOUTUBE',
      providerChannelId: data.providerChannelId,
      channelTitle: data.channelTitle,
      updatedAt: this.now(),
      media: data.media.map((media) => {
        const absoluteMedia = resolvePathUnderRoot(root, media.relativePath);
        const mediaFile = relative(channelRoot, absoluteMedia);
        if (
          mediaFile === '..' ||
          mediaFile.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
        ) {
          throw new BackupOperationError(
            'MANIFEST_INVALID',
            'A media path escaped its channel archive.',
            {
              disposition: 'FAIL',
            },
          );
        }
        return {
          providerMediaId: media.providerMediaId,
          mediaType: media.mediaType,
          mediaDirectory: dirname(mediaFile),
          mediaFile,
          metadataFile: join(dirname(mediaFile), 'metadata.json'),
          bytes: media.bytes,
          sha256: media.sha256,
        };
      }),
      playlists: data.playlists.map((playlist) => ({
        providerPlaylistId: playlist.providerPlaylistId,
        playlistFile: join(
          'Playlists',
          archiveFolderName(playlist.title, playlist.providerPlaylistId),
          'playlist.json',
        ),
        mediaIds: playlist.items.map((item) => item.providerMediaId),
      })),
    });
    const internal = resolvePathUnderRoot(channelRoot, '.ytbackup');
    await writeJsonConfined(
      root,
      resolvePathUnderRoot(internal, 'version.json'),
      ManifestVersionSchema.parse({ schemaVersion: 1, provider: 'YOUTUBE' }),
    );
    await writeJsonConfined(root, resolvePathUnderRoot(internal, 'manifest.json'), manifest);
    return { mediaCount: manifest.media.length, playlistCount: manifest.playlists.length };
  }

  private async cleanupStaging(context: JobExecutionContext): Promise<unknown> {
    const media = this.requiredMedia(context);
    const payload = z
      .object({ stagingDirectory: z.string(), generation: z.string() })
      .passthrough()
      .parse(context.job.payload);
    const generationDirectory = this.stagingPath(payload.stagingDirectory);
    await this.assertStagingPath(generationDirectory, true);
    await rm(generationDirectory, { recursive: true, force: true });
    this.repository.deleteStagingArtifacts(media.id, payload.generation);
    return { cleaned: true };
  }

  private async removeDownloadPartial(context: JobExecutionContext): Promise<void> {
    await this.removeDownloadPayload(context.job.payload);
  }

  private async removeDownloadPayload(jobPayload: unknown): Promise<void> {
    const payload = z.object({ stagingDirectory: z.string() }).passthrough().parse(jobPayload);
    const staging = this.stagingPath(payload.stagingDirectory);
    await mkdir(resolve(this.options.stagingRoot), { recursive: true });
    await this.assertStagingPath(staging, true);
    await rm(staging, { recursive: true, force: true });
  }

  private async prepareStagingDirectory(path: string): Promise<string> {
    const staging = this.stagingPath(path);
    await mkdir(resolve(this.options.stagingRoot), { recursive: true });
    await this.assertStagingPath(staging, true);
    await mkdir(staging, { recursive: true });
    await this.assertStagingPath(staging, false);
    return staging;
  }

  private async assertStagingPath(path: string, allowMissing: boolean): Promise<void> {
    await assertPathPhysicallyUnderRoot(resolve(this.options.stagingRoot), path, {
      allowMissing,
    });
  }

  private stagingPath(path: string): string {
    const root = resolve(this.options.stagingRoot);
    const candidate = resolve(path);
    const relationship = relative(root, candidate);
    if (
      relationship === '' ||
      relationship === '..' ||
      relationship.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      isAbsolute(relationship)
    ) {
      throw new BackupOperationError(
        'STAGING_UNAVAILABLE',
        'A staging path escaped application storage.',
        {
          disposition: 'FAIL',
        },
      );
    }
    return candidate;
  }

  private requiredMedia(context: JobExecutionContext): BackupMediaContext {
    if (context.job.mediaItemId === null) {
      throw new Error('Backup job does not reference media');
    }
    return this.repository.getMediaContext(context.job.mediaItemId);
  }

  private requiredChannelId(context: JobExecutionContext): string {
    if (context.job.channelId === null) {
      throw new Error('Backup job does not reference a channel');
    }
    return context.job.channelId;
  }

  private requiredDestinationId(context: JobExecutionContext): string {
    if (context.job.destinationId === null) {
      throw new Error('Backup job does not reference a destination');
    }
    return context.job.destinationId;
  }

  private findVerifiedCopy(mediaItemId: string, destinationId: string): MediaCopyContext {
    const row = this.options.database.sqlite
      .prepare(
        `select id from media_copies where media_item_id = ? and destination_id = ? and status = 'VERIFIED'`,
      )
      .get(mediaItemId, destinationId) as { id: string } | undefined;
    if (row === undefined) throw new Error('A verified media copy is required for this sidecar');
    return this.repository.getMediaCopy(row.id);
  }

  private assertVerifiedCopy(copy: MediaCopyContext): void {
    if (
      copy.status !== 'VERIFIED' ||
      copy.relativePath === null ||
      copy.container === null ||
      copy.bytes === null ||
      copy.sha256 === null ||
      copy.qualityProfile === null
    ) {
      throw new BackupOperationError('VERIFY_FAILED', 'The metadata source copy is not verified.', {
        disposition: 'RETRY',
      });
    }
  }

  private disconnected(): BackupOperationError {
    return new BackupOperationError(
      'DESTINATION_DISCONNECTED',
      'The local backup destination is disconnected.',
      {
        disposition: 'BLOCK',
      },
    );
  }

  private scheduleDestinationRefresh(): void {
    if (this.refreshPromise !== null) return;
    this.refreshPromise = this.refreshDestinationState().finally(() => {
      this.refreshPromise = null;
    });
  }

  private async refreshDestinationState(): Promise<void> {
    try {
      await this.probeAllDestinations();
      await this.reconcileVerifiedCopyPresence({ exhaust: false });
    } catch (error) {
      this.options.logger.warn('Local backup presence reconciliation could not complete', {
        errorCode: nodeErrorCode(error),
      });
    }
  }

  private async reconcileVerifiedCopyPresence(input: {
    channelId?: string;
    mediaItemId?: string;
    exhaust: boolean;
  }): Promise<void> {
    let afterId = input.exhaust ? null : this.reconciliationCursor;
    while (true) {
      const copies = this.repository.listVerifiedMediaCopies({
        ...(input.channelId === undefined ? {} : { channelId: input.channelId }),
        ...(input.mediaItemId === undefined ? {} : { mediaItemId: input.mediaItemId }),
        ...(afterId === null ? {} : { afterId }),
        limit: 250,
      });
      for (const copy of copies) await this.reconcileVerifiedCopy(copy);
      if (copies.length < 250) {
        if (!input.exhaust) this.reconciliationCursor = null;
        break;
      }
      afterId = copies.at(-1)!.id;
      if (!input.exhaust) {
        this.reconciliationCursor = afterId;
        break;
      }
    }
  }

  private async reconcileVerifiedCopy(copy: MediaCopyContext): Promise<void> {
    if (copy.relativePath === null) {
      this.recordCopyProblem(copy, 'MISSING', 'COPY_MISSING');
      return;
    }
    const destination = this.repository.getDestination(copy.destinationId);
    const root = await this.storage.resolveCurrentRoot(destination);
    if (root === null) return;
    const path = resolvePathUnderRoot(root, copy.relativePath);
    try {
      const current = await stat(path);
      if (!current.isFile()) {
        this.recordCopyProblem(copy, 'MISSING', 'COPY_MISSING');
      } else if (copy.bytes !== null && current.size !== copy.bytes) {
        this.recordCopyProblem(copy, 'CORRUPT', 'COPY_CORRUPT');
      }
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') {
        this.recordCopyProblem(copy, 'MISSING', 'COPY_MISSING');
      } else {
        this.options.logger.warn('A verified local copy could not be checked', {
          mediaId: copy.mediaItemId,
          errorCode: nodeErrorCode(error),
        });
      }
    }
  }

  private recordCopyProblem(
    copy: MediaCopyContext,
    status: 'MISSING' | 'CORRUPT',
    errorCode: 'COPY_MISSING' | 'COPY_CORRUPT',
  ): void {
    if (!this.repository.markMediaCopyFailure(copy.id, status, errorCode)) return;
    this.repository.recordActivity({
      eventType: status === 'MISSING' ? 'LOCAL_COPY_MISSING' : 'LOCAL_COPY_CORRUPT',
      mediaItemId: copy.mediaItemId,
      destinationId: copy.destinationId,
      summary:
        status === 'MISSING'
          ? 'A previously verified local media copy is missing.'
          : 'A previously verified local media copy no longer matches its expected size.',
      severity: 'WARNING',
      details: { errorCode },
    });
  }

  private async probeAllDestinations(): Promise<void> {
    for (const destination of this.repository.listDestinations(true)) {
      await this.probeDestination(destination.id);
    }
    this.engine.wake();
  }

  private async probeDestination(destinationId: string): Promise<DestinationProbe> {
    const destination = this.repository.getDestination(destinationId);
    const probe = await this.storage.probe(destination);
    const currentRoot = await this.storage.resolveCurrentRoot(destination);
    this.repository.updateDestinationProbe(destinationId, {
      rootPath: currentRoot ?? destination.rootPath,
      identity: probe.identity,
      availabilityStatus: probe.availability,
      lastErrorCode: errorCodeForProbe(probe),
    });
    if (probe.availability === 'AVAILABLE') {
      this.jobs.unblockDestination(destinationId, this.now());
    }
    return probe;
  }

  private destinationDto(destinationId: string, probe: DestinationProbe): DestinationDto {
    const destination = this.repository.getDestination(destinationId);
    return DestinationDtoSchema.parse({
      id: destination.id,
      destinationType: 'FILESYSTEM',
      rootPath: destination.rootPath,
      volumeGuid: destination.volumeGuid,
      volumeSerial: destination.volumeSerial,
      filesystemType: destination.filesystemType,
      lastKnownMountPath: destination.lastKnownMountPath,
      enabled: destination.enabled,
      availabilityStatus: probe.availability,
      availableBytes: probe.availableBytes,
      totalBytes: probe.totalBytes,
      lastProbeAt: destination.lastProbeAt,
      safeMessage: probe.safeMessage,
    });
  }
}
