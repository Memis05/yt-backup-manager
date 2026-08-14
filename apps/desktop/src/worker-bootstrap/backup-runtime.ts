import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, open, rename, rm, stat, statfs, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';

import {
  BackupOperationError,
  DestinationAvailabilitySchema,
  DestinationDtoSchema,
  QualityProfileSchema,
  ToolDiagnosticsSchema,
  destinationAvailabilityError,
  type AppSettings,
  type BackupStartResult,
  type BackupRunTrigger,
  type ChannelBackupSettingsDto,
  type DestinationDto,
  type DashboardSummary,
  type IntegrityOverview,
  type IntegrityScope,
  type IntegrityStartResult,
  type JobType,
  type MediaBackupDetails,
  type ResolveVerifiedCopyFolderResult,
  type ResolveGoogleDriveObjectResult,
  type QualityProfile,
  type QueueQuery,
  type QueueSnapshot,
  type RepairStartResult,
  type NativeNotificationDto,
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
  serializeDeterministicJson,
  writeJsonAtomic,
} from '@ytbm/manifest';
import { FfmpegAdapter } from '@ytbm/media-ffmpeg';
import type { LogContext, StructuredLogger } from '@ytbm/security';
import type {
  DestinationProbe,
  GoogleDriveObjectStat,
  GoogleDriveStorageProvider,
  StorageProvider,
} from '@ytbm/storage-core';
import {
  FilesystemStorageProvider,
  archiveFolderName,
  assertPathPhysicallyUnderRoot,
  channelRelativeDirectory,
  mediaRelativeDirectory,
  resolvePathUnderRoot,
} from '@ytbm/storage-filesystem';
import { GOOGLE_DRIVE_ROOT_NAME, googleDriveMediaMimeType } from '@ytbm/storage-google-drive';
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
    replaceUnhealthy: z.boolean().optional(),
    repairOriginalStatus: z.string().optional(),
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

const DriveUploadResultSchema = z
  .object({
    mediaCopyId: z.string().uuid(),
    relativePath: z.string(),
    providerFileId: z.string(),
    container: z.string(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    fps: z.number().nullable(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    qualityProfile: QualityProfileSchema,
    contentGeneration: z.string(),
    parentProviderId: z.string(),
    reconciled: z.boolean(),
  })
  .strict();

interface VerifiedTransferSource {
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
  reference: unknown;
}

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
  googleDriveStorage?: GoogleDriveStorageProvider;
}

function errorCodeForProbe(probe: DestinationProbe): string | null {
  if (probe.availability === 'AVAILABLE') return null;
  if (probe.availability === 'DISCONNECTED') return 'DESTINATION_DISCONNECTED';
  if (probe.availability === 'READ_ONLY') return 'DESTINATION_READ_ONLY';
  if (probe.availability === 'FULL') return 'DESTINATION_FULL';
  if (probe.availability === 'AUTH_REQUIRED') return 'AUTH_REVOKED';
  return 'COPY_FAILED';
}

function persistedDestinationProbe(availability: unknown): DestinationProbe {
  const parsedAvailability = DestinationAvailabilitySchema.parse(availability);
  return {
    availability: parsedAvailability,
    availableBytes: null,
    totalBytes: null,
    identity: null,
    safeMessage: destinationAvailabilityError(parsedAvailability)?.message ?? null,
  };
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

function hashBytes(value: Uint8Array): { bytes: number; sha256: string } {
  return {
    bytes: value.byteLength,
    sha256: createHash('sha256').update(value).digest('hex'),
  };
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
  private readonly googleDriveStorage: GoogleDriveStorageProvider | null;
  private readonly repository: LocalBackupRepository;
  private readonly jobs: DurableJobSqlRepository;
  private readonly ytDlp: Pick<YtDlpAdapter, 'version' | 'probe' | 'download'>;
  private readonly ffmpeg: Pick<FfmpegAdapter, 'version' | 'postProcess'>;
  private readonly engine: DurableJobEngine;
  private destinationProbeTimer: NodeJS.Timeout | null = null;
  private readonly destinationProbes = new Map<string, DestinationProbe>();
  private reconciliationCursor: string | null = null;
  private refreshPromise: Promise<void> | null = null;
  private stopping = false;

  public constructor(private readonly options: LocalBackupRuntimeOptions) {
    this.now = options.now ?? Date.now;
    this.fetchImplementation = options.fetch ?? fetch;
    this.repository = new LocalBackupRepository(options.database, this.now);
    this.jobs = new DurableJobSqlRepository(options.database);
    this.storage = options.storage ?? new FilesystemStorageProvider();
    this.googleDriveStorage = options.googleDriveStorage ?? null;
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
        driveTransfer: 2,
        driveControl: 1,
        sidecar: 2,
        manifest: 1,
        cleanup: 1,
      },
      now: this.now,
      onJobSettled: () => this.repository.reconcileAllRuns(),
    });
  }

  public start(): void {
    this.stopping = false;
    this.engine.start();
    this.scheduleDestinationRefresh();
    this.destinationProbeTimer = setInterval(() => {
      this.scheduleDestinationRefresh();
    }, 10_000);
    this.destinationProbeTimer.unref();
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    if (this.destinationProbeTimer !== null) clearInterval(this.destinationProbeTimer);
    this.destinationProbeTimer = null;
    await this.engine.stop();
    await this.refreshPromise;
  }

  public isIdle(): boolean {
    return !this.stopping && this.refreshPromise === null && this.engine.isIdle();
  }

  public requestShutdownIfIdle(): boolean {
    if (!this.isIdle()) return false;
    this.stopping = true;
    if (this.destinationProbeTimer !== null) clearInterval(this.destinationProbeTimer);
    this.destinationProbeTimer = null;
    return true;
  }

  public prepareShutdownWhenIdle(): void {
    if (this.destinationProbeTimer !== null) clearInterval(this.destinationProbeTimer);
    this.destinationProbeTimer = null;
    this.engine.prepareShutdownWhenIdle();
  }

  public lastIntegrityStartedAt(): number | null {
    const latest = this.options.database.sqlite
      .prepare(
        `select max(created_at) as created_at from backup_runs
         where trigger_type = 'VERIFY' and status <> 'CANCELLED'`,
      )
      .get() as { created_at: number | null };
    return latest.created_at;
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
    this.destinationProbes.set(stored.id, probe);
    return this.destinationDto(stored.id, probe);
  }

  public async addGoogleDriveDestination(accountId: string): Promise<DestinationDto> {
    const drive = this.requiredGoogleDriveStorage();
    const destination = this.repository.addGoogleDriveDestination(accountId);
    const probe = await drive.probe(destination);
    this.repository.updateGoogleDriveDestinationProbe(
      destination.id,
      probe.availability,
      errorCodeForProbe(probe),
    );
    if (probe.availability !== 'AVAILABLE') {
      throw new Error(probe.safeMessage ?? 'Google Drive is not available for this account');
    }
    await this.ensureDriveRootForDestination(destination.id);
    this.destinationProbes.set(destination.id, probe);
    return this.googleDriveDestinationDto(destination.id, probe);
  }

  public async listDestinations(): Promise<DestinationDto[]> {
    const filesystem = this.repository
      .listDestinations()
      .map((destination) =>
        this.destinationDto(
          destination.id,
          this.destinationProbes.get(destination.id) ??
            persistedDestinationProbe(destination.availabilityStatus),
        ),
      );
    const drive = this.repository
      .listGoogleDriveDestinations()
      .map((destination) =>
        this.googleDriveDestinationDto(
          destination.id,
          this.destinationProbes.get(destination.id) ??
            persistedDestinationProbe(destination.availabilityStatus),
        ),
      );
    return [...filesystem, ...drive];
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

  public async startBackup(
    channelId: string,
    triggerType: Extract<
      BackupRunTrigger,
      'MANUAL' | 'CUSTOM_MANUAL' | 'SCHEDULED' | 'STARTUP'
    > = 'MANUAL',
  ): Promise<BackupStartResult> {
    const settings = await this.options.settings();
    await this.probeAllDestinations();
    await this.reconcileVerifiedCopyPresence({ channelId, exhaust: true });
    const result = this.repository.planBackup(
      channelId,
      settings.defaultQualityProfile,
      this.options.stagingRoot,
      triggerType,
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
      (current.jobType === 'DOWNLOAD_MEDIA' || current.jobType === 'DOWNLOAD_FROM_GOOGLE_DRIVE') &&
      !['RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED'].includes(current.status)
    ) {
      await this.removeDownloadPayload(current.payload);
    }
    if (
      action === 'CANCEL_REMOVE_PARTIAL' &&
      current.jobType === 'UPLOAD_TO_GOOGLE_DRIVE' &&
      !['RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED'].includes(current.status)
    ) {
      this.repository.deleteDriveUploadSession(current.id);
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

  public dashboardSummary(): DashboardSummary {
    return this.repository.dashboardSummary();
  }

  public startIntegrity(
    scope: IntegrityScope,
    driveMode: 'PROVIDER_METADATA_SIZE' | 'DOWNLOADED_SHA256',
  ): IntegrityStartResult {
    const result = this.repository.planIntegrity(scope, driveMode);
    this.engine.wake();
    return result;
  }

  public integrityOverview(): IntegrityOverview {
    this.repository.reconcileAllRuns();
    return this.repository.integrityOverview();
  }

  public async startRepair(
    copyId: string,
    allowYoutubeFallback: boolean,
  ): Promise<RepairStartResult> {
    await this.probeAllDestinations();
    await this.reconcileVerifiedCopyPresence({
      mediaItemId: this.repository.getMediaCopy(copyId).mediaItemId,
      exhaust: true,
    });
    const settings = await this.options.settings();
    const result = this.repository.planRepair(
      copyId,
      allowYoutubeFallback,
      settings.defaultQualityProfile,
      this.options.stagingRoot,
    );
    this.engine.wake();
    return result;
  }

  public async pendingNotifications(): Promise<NativeNotificationDto[]> {
    return this.repository.pendingNotifications(await this.options.settings());
  }

  public acknowledgeNotifications(notificationIds: string[]): number {
    return this.repository.ackNotifications(notificationIds);
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
    const driveDestinations = this.repository.listGoogleDriveDestinations();
    const activeUploads = (
      this.options.database.sqlite
        .prepare(
          `select count(*) as count from jobs where job_type = 'UPLOAD_TO_GOOGLE_DRIVE'
           and status in ('RUNNING','READY','PENDING','RETRY_WAIT')`,
        )
        .get() as { count: number }
    ).count;
    const lastDriveError = this.options.database.sqlite
      .prepare(
        `select last_error_code from destinations where destination_type = 'GOOGLE_DRIVE'
         and last_error_code is not null order by last_error_at desc limit 1`,
      )
      .get() as { last_error_code: string } | undefined;
    return ToolDiagnosticsSchema.parse({
      ytDlp,
      ffmpeg,
      googleDrive: {
        configuredDestinations: driveDestinations.length,
        availableDestinations: driveDestinations.filter(
          (destination) => destination.availabilityStatus === 'AVAILABLE',
        ).length,
        activeUploads,
        lastSafeErrorCode: lastDriveError?.last_error_code ?? null,
      },
    });
  }

  public resolveGoogleDriveObject(
    mediaCopyId: string | null,
    destinationId: string | null,
  ): ResolveGoogleDriveObjectResult {
    if ((mediaCopyId === null) === (destinationId === null)) {
      throw new Error('Select exactly one Google Drive object to open');
    }
    if (mediaCopyId !== null) {
      const copy = this.repository.getMediaCopy(mediaCopyId);
      if (copy.destinationType !== 'GOOGLE_DRIVE' || copy.providerFileId === null) {
        return {
          status: copy.status === 'MISSING' ? 'MISSING' : 'UNAVAILABLE',
          safeMessage: 'This Google Drive media object is not available.',
        };
      }
      return { status: 'AVAILABLE', providerId: copy.providerFileId };
    }
    const destination = this.repository.getGoogleDriveDestination(destinationId!);
    if (destination.providerRootId === null) {
      return {
        status: 'UNAVAILABLE',
        safeMessage: 'The Google Drive backup root is not configured.',
      };
    }
    return { status: 'AVAILABLE', providerId: destination.providerRootId };
  }

  public async resolveVerifiedCopyFolder(
    mediaCopyId: string,
  ): Promise<ResolveVerifiedCopyFolderResult> {
    const copy = this.repository.getMediaCopy(mediaCopyId);
    if (
      copy.destinationType !== 'FILESYSTEM' ||
      copy.status !== 'VERIFIED' ||
      copy.relativePath === null
    ) {
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
        this.jobHandler(
          'hash',
          (context) => this.verifyFilesystemCopyWithRepairRollback(context),
          (context) => this.restoreRepairTarget(context),
        ),
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
      [
        'ENSURE_GOOGLE_DRIVE_ROOT',
        this.jobHandler('driveControl', (context) => this.ensureGoogleDriveRoot(context)),
      ],
      [
        'ENSURE_GOOGLE_DRIVE_FOLDER',
        this.jobHandler('driveControl', (context) => this.ensureGoogleDriveFolders(context)),
      ],
      [
        'UPLOAD_TO_GOOGLE_DRIVE',
        this.jobHandler(
          'driveTransfer',
          (context) => this.uploadToGoogleDrive(context),
          (context) => this.removeDriveUploadState(context),
        ),
      ],
      [
        'VERIFY_GOOGLE_DRIVE_COPY',
        this.jobHandler(
          'driveControl',
          (context) => this.verifyGoogleDriveCopyWithRepairRollback(context),
          (context) => this.restoreRepairTarget(context),
        ),
      ],
      [
        'DOWNLOAD_FROM_GOOGLE_DRIVE',
        this.jobHandler(
          'driveTransfer',
          (context) => this.downloadFromGoogleDrive(context),
          (context) => this.removeDownloadPartial(context),
        ),
      ],
      [
        'RECONCILE_GOOGLE_DRIVE_OBJECT',
        this.jobHandler('driveControl', (context) => this.reconcileGoogleDriveObject(context)),
      ],
      [
        'UPDATE_GOOGLE_DRIVE_METADATA',
        this.jobHandler('sidecar', (context) => this.updateGoogleDriveMetadata(context)),
      ],
      [
        'UPDATE_GOOGLE_DRIVE_THUMBNAIL',
        this.jobHandler('sidecar', (context) => this.updateGoogleDriveThumbnail(context)),
      ],
      [
        'UPDATE_GOOGLE_DRIVE_MANIFEST',
        this.jobHandler('manifest', (context) => this.updateGoogleDriveManifest(context)),
      ],
      ['CLEANUP_STAGING', this.jobHandler('cleanup', (context) => this.cleanupStaging(context))],
      [
        'VERIFY_EXISTING_COPY',
        this.jobHandler(
          'hash',
          (context) => this.verifyExistingCopy(context),
          (context) => this.cleanupIntegrityVerification(context),
        ),
      ],
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
        sourceCopy.destinationType !== 'FILESYSTEM' ||
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
      const stagingDependency =
        this.repository.getDependencyResult(context.job.id, 'VERIFY_STAGING_MEDIA') ??
        this.repository.getDependencyResult(context.job.id, 'DOWNLOAD_FROM_GOOGLE_DRIVE');
      const staging = StagingResultSchema.parse(stagingDependency);
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
    const relativePath =
      payload.replaceUnhealthy === true && targetCopy.relativePath !== null
        ? targetCopy.relativePath
        : join(
            channelRelativeDirectory(media.channelTitle, media.providerChannelId),
            mediaRelativeDirectory(media.mediaType, media.title, media.providerMediaId),
            `video.${source.container}`,
          );
    this.repository.markMediaCopyTransferring(targetCopy.id);
    const put =
      payload.replaceUnhealthy === true
        ? this.storage.replaceFile?.bind(this.storage)
        : this.storage.putFile.bind(this.storage);
    if (put === undefined) {
      this.repository.restoreUnhealthyCopyStatus(
        targetCopy.id,
        payload.repairOriginalStatus ?? 'FAILED',
      );
      throw new BackupOperationError(
        'COPY_FAILED',
        'The filesystem adapter does not support safe replacement repair.',
        { disposition: 'FAIL' },
      );
    }
    let copied: Awaited<ReturnType<StorageProvider['putFile']>>;
    try {
      copied = await put({
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
    } catch (error) {
      if (payload.replaceUnhealthy === true) {
        this.repository.restoreUnhealthyCopyStatus(
          targetCopy.id,
          payload.repairOriginalStatus ?? 'FAILED',
        );
      }
      throw error;
    }
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

  private async verifyFilesystemCopyWithRepairRollback(
    context: JobExecutionContext,
  ): Promise<unknown> {
    try {
      return await this.verifyFilesystemCopy(context);
    } catch (error) {
      await this.restoreRepairTarget(context);
      throw error;
    }
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

  private async ensureGoogleDriveRoot(context: JobExecutionContext): Promise<unknown> {
    const destinationId = this.requiredDestinationId(context);
    const root = await this.ensureDriveRootForDestination(destinationId);
    return { providerRootId: root.providerFileId };
  }

  private async ensureGoogleDriveFolders(context: JobExecutionContext): Promise<unknown> {
    const destinationId = this.requiredDestinationId(context);
    const channelId = this.requiredChannelId(context);
    const media = this.options.database.sqlite
      .prepare(`select provider_channel_id, title from channels where id = ?`)
      .get(channelId) as { provider_channel_id: string; title: string } | undefined;
    if (media === undefined) throw new Error('Channel was not found');
    const folders = await this.ensureDriveChannelFolders(
      destinationId,
      media.provider_channel_id,
      media.title,
    );
    return {
      channelFolderId: folders.channel.providerFileId,
      categoryFolderIds: Object.fromEntries(
        Object.entries(folders.categories).map(([key, value]) => [key, value.providerFileId]),
      ),
    };
  }

  private async uploadToGoogleDrive(context: JobExecutionContext): Promise<unknown> {
    const drive = this.requiredGoogleDriveStorage();
    const media = this.requiredMedia(context);
    const payload = CopyJobPayloadSchema.parse(context.job.payload);
    const copy = this.repository.getMediaCopy(payload.mediaCopyId);
    if (copy.destinationType !== 'GOOGLE_DRIVE') {
      throw new BackupOperationError(
        'INTERNAL_ERROR',
        'A Google Drive upload targeted the wrong destination type.',
        { disposition: 'FAIL' },
      );
    }
    const destination = this.repository.getGoogleDriveDestination(copy.destinationId);
    const source = await this.resolveVerifiedTransferSource(context, payload);
    const folders = await this.ensureDriveChannelFolders(
      copy.destinationId,
      media.providerChannelId,
      media.channelTitle,
    );
    const category = this.driveCategory(media.mediaType);
    const mediaFolder = await this.ensureDriveFolder(
      destination,
      `media:${media.providerMediaId}`,
      folders.categories[category].providerFileId,
      archiveFolderName(media.title, media.providerMediaId),
      'MEDIA_FOLDER',
      {
        ytbm: '1',
        ytbmObjectType: 'media',
        ytbmObjectKey: `media:${media.providerMediaId}`,
        ytbmSchemaVersion: '1',
        sourceProvider: 'youtube',
        providerMediaId: media.providerMediaId,
        channelId: media.providerChannelId,
        providerChannelId: media.providerChannelId,
      },
    );
    const name = `video.${source.container}`;
    const relativePath = posix.join(
      archiveFolderName(media.channelTitle, media.providerChannelId),
      category,
      archiveFolderName(media.title, media.providerMediaId),
      name,
    );
    const objectKey = `media:${media.providerMediaId}:video`;
    this.repository.markMediaCopyTransferring(copy.id);
    const persisted = this.repository.getDriveUploadSession(context.job.id);
    let uploaded: Awaited<ReturnType<GoogleDriveStorageProvider['putFile']>>;
    try {
      uploaded = await drive.putFile({
        destination,
        sourcePath: source.path,
        parentProviderId: mediaFolder.providerFileId,
        name,
        mimeType: googleDriveMediaMimeType(source.container),
        expectedSha256: source.sha256,
        expectedBytes: source.bytes,
        appProperties: {
          ytbm: '1',
          ytbmObjectType: 'video',
          ytbmObjectKey: objectKey,
          ytbmSchemaVersion: '1',
          sourceProvider: 'youtube',
          providerMediaId: media.providerMediaId,
          channelId: media.providerChannelId,
          providerChannelId: media.providerChannelId,
          artifactType: 'video',
          sha256: source.sha256,
        },
        knownProviderFileId: copy.providerFileId,
        resumableState: persisted,
        signal: context.signal,
        onProgress: (bytesProcessed) =>
          context.progress({
            bytesProcessed,
            bytesTotal: source.bytes,
            progressRatio: relativeProgress(bytesProcessed, source.bytes),
            speedBytesPerSec: null,
            etaSeconds: null,
          }),
        onCheckpoint: (checkpoint) => {
          this.repository.saveDriveUploadSession({
            jobId: context.job.id,
            destinationId: destination.id,
            mediaCopyId: copy.id,
            parentProviderObjectId: mediaFolder.providerFileId,
            sessionUri: checkpoint.sessionUri,
            providerFileId: checkpoint.providerFileId,
            bytesAcknowledged: checkpoint.bytesAcknowledged,
            expectedBytes: source.bytes,
            expectedSha256: source.sha256,
            sourceReference: source.reference,
          });
        },
      });
    } catch (error) {
      if (payload.replaceUnhealthy === true) {
        this.repository.restoreUnhealthyCopyStatus(
          copy.id,
          payload.repairOriginalStatus ?? 'FAILED',
        );
      }
      throw error;
    }
    const result = DriveUploadResultSchema.parse({
      mediaCopyId: copy.id,
      relativePath,
      providerFileId: uploaded.providerFileId,
      container: source.container,
      videoCodec: source.videoCodec,
      audioCodec: source.audioCodec,
      width: source.width,
      height: source.height,
      fps: source.fps,
      bytes: uploaded.bytes,
      sha256: source.sha256,
      qualityProfile: source.qualityProfile,
      contentGeneration: payload.contentGeneration,
      parentProviderId: mediaFolder.providerFileId,
      reconciled: uploaded.reconciled,
    });
    this.repository.updateDriveMediaCopyTransferred(copy.id, {
      ...result,
      providerMetadata: {
        parents: uploaded.parents,
        appProperties: uploaded.appProperties,
        verificationStrength: 'PROVIDER_METADATA_SIZE',
      },
    });
    this.repository.upsertProviderObject({
      destinationId: destination.id,
      logicalKey: objectKey,
      objectType: 'VIDEO',
      providerObjectId: uploaded.providerFileId,
      parentProviderObjectId: uploaded.parents[0] ?? null,
      currentName: uploaded.name,
    });
    this.repository.deleteDriveUploadSession(context.job.id);
    return result;
  }

  private async verifyGoogleDriveCopy(context: JobExecutionContext): Promise<unknown> {
    const drive = this.requiredGoogleDriveStorage();
    const result = DriveUploadResultSchema.parse(
      this.repository.getDependencyResult(context.job.id, 'UPLOAD_TO_GOOGLE_DRIVE'),
    );
    const copy = this.repository.getMediaCopy(result.mediaCopyId);
    const destination = this.repository.getGoogleDriveDestination(copy.destinationId);
    const current = await drive.stat({
      destination,
      providerFileId: result.providerFileId,
    });
    if (current === null) {
      this.repository.markMediaCopyFailure(copy.id, 'MISSING', 'PROVIDER_OBJECT_MISSING');
      throw new BackupOperationError(
        'PROVIDER_OBJECT_MISSING',
        'The uploaded Google Drive object could not be found.',
        { disposition: 'RETRY' },
      );
    }
    if (
      current.bytes !== result.bytes ||
      current.appProperties.sha256 !== result.sha256 ||
      current.appProperties.providerMediaId !== this.requiredMedia(context).providerMediaId
    ) {
      this.repository.markMediaCopyFailure(copy.id, 'CORRUPT', 'VERIFY_FAILED');
      throw new BackupOperationError(
        'VERIFY_FAILED',
        'Google Drive metadata did not match the verified upload source.',
        { disposition: 'RETRY' },
      );
    }
    if (!this.repository.markMediaCopyVerified(copy.id, 'PROVIDER_METADATA_SIZE')) {
      throw new BackupOperationError(
        'VERIFY_FAILED',
        'The Google Drive copy state changed before verification could be committed.',
        { disposition: 'RETRY' },
      );
    }
    this.repository.recordActivity({
      eventType: 'GOOGLE_DRIVE_COPY_VERIFIED',
      mediaItemId: copy.mediaItemId,
      destinationId: copy.destinationId,
      jobId: context.job.id,
      summary:
        'A Google Drive media copy was verified by provider identity, size, and app metadata.',
      details: { verificationStrength: 'PROVIDER_METADATA_SIZE' },
    });
    return { ...result, providerName: current.name, parents: current.parents };
  }

  private async verifyGoogleDriveCopyWithRepairRollback(
    context: JobExecutionContext,
  ): Promise<unknown> {
    try {
      return await this.verifyGoogleDriveCopy(context);
    } catch (error) {
      await this.restoreRepairTarget(context);
      throw error;
    }
  }

  private async restoreRepairTarget(context: JobExecutionContext): Promise<void> {
    const repair = z
      .object({
        mediaCopyId: z.string().uuid().optional(),
        repairOriginalStatus: z.string().optional(),
      })
      .passthrough()
      .parse(context.job.payload);
    if (repair.mediaCopyId === undefined || repair.repairOriginalStatus === undefined) return;
    this.repository.restoreUnhealthyCopyStatus(repair.mediaCopyId, repair.repairOriginalStatus);
  }

  private async downloadFromGoogleDrive(context: JobExecutionContext): Promise<unknown> {
    const drive = this.requiredGoogleDriveStorage();
    const media = this.requiredMedia(context);
    const payload = z
      .object({
        sourceCopyId: z.string().uuid(),
        generation: z.string(),
        stagingDirectory: z.string(),
      })
      .strict()
      .parse(context.job.payload);
    const source = this.repository.getMediaCopy(payload.sourceCopyId);
    if (
      source.destinationType !== 'GOOGLE_DRIVE' ||
      source.status !== 'VERIFIED' ||
      source.providerFileId === null ||
      source.sha256 === null ||
      source.bytes === null ||
      source.container === null
    ) {
      throw new BackupOperationError(
        'COPY_MISSING',
        'The Google Drive source copy is not trusted or is missing.',
        { disposition: 'FAIL' },
      );
    }
    const stagingDirectory = await this.prepareStagingDirectory(payload.stagingDirectory);
    const destinationPath = join(stagingDirectory, `drive-source.${source.container}`);
    const destination = this.repository.getGoogleDriveDestination(source.destinationId);
    try {
      const downloaded = await drive.getFile({
        destination,
        providerFileId: source.providerFileId,
        destinationPath,
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
      await this.assertStagingPath(downloaded.path, false);
      this.repository.setStagingArtifact({
        mediaItemId: media.id,
        jobId: context.job.id,
        artifactType: 'MEDIA',
        path: downloaded.path,
        bytes: downloaded.bytes,
        sha256: downloaded.sha256,
        state: 'VERIFIED',
        generation: payload.generation,
      });
      this.repository.recordDownloadedDriveVerification(source.id);
      return StagingResultSchema.parse({
        providerMediaId: media.providerMediaId,
        qualityProfile: source.qualityProfile ?? 'MAX_1080P',
        videoFormatId: 'google-drive',
        audioFormatId: null,
        container: source.container,
        videoCodec: source.videoCodec,
        audioCodec: source.audioCodec,
        width: source.width,
        height: source.height,
        fps: source.fps,
        expectedBytes: source.bytes,
        path: downloaded.path,
        sha256: downloaded.sha256,
        bytes: downloaded.bytes,
        downloadedAt: this.now(),
        generation: payload.generation,
      });
    } catch (error) {
      if (error instanceof BackupOperationError && error.code === 'COPY_CORRUPT') {
        this.repository.markMediaCopyFailure(source.id, 'CORRUPT', 'COPY_CORRUPT');
      } else if (
        error instanceof BackupOperationError &&
        error.code === 'PROVIDER_OBJECT_MISSING'
      ) {
        this.repository.markMediaCopyFailure(source.id, 'MISSING', 'PROVIDER_OBJECT_MISSING');
      }
      throw error;
    }
  }

  private async reconcileGoogleDriveObject(context: JobExecutionContext): Promise<unknown> {
    const payload = z
      .object({ mediaCopyId: z.string().uuid() })
      .passthrough()
      .parse(context.job.payload);
    const copy = this.repository.getMediaCopy(payload.mediaCopyId);
    await this.reconcileVerifiedCopy(copy);
    return { status: this.repository.getMediaCopy(copy.id).status };
  }

  private async updateGoogleDriveMetadata(context: JobExecutionContext): Promise<unknown> {
    const drive = this.requiredGoogleDriveStorage();
    const media = this.requiredMedia(context);
    const payload = z
      .object({ mediaCopyId: z.string().uuid(), contentGeneration: z.string() })
      .passthrough()
      .parse(context.job.payload);
    const copy = this.repository.getMediaCopy(payload.mediaCopyId);
    this.assertVerifiedCopy(copy);
    if (copy.destinationType !== 'GOOGLE_DRIVE') {
      throw new BackupOperationError('INTERNAL_ERROR', 'Drive metadata targeted a local copy.', {
        disposition: 'FAIL',
      });
    }
    const destination = this.repository.getGoogleDriveDestination(copy.destinationId);
    const mediaFolder = await this.ensureDriveMediaFolder(destination, media);
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
    const content = new TextEncoder().encode(serializeDeterministicJson(metadata));
    const hash = hashBytes(content);
    const knownProviderFileId = this.repository.getMediaArtifactProviderId(
      media.id,
      destination.id,
      'METADATA',
    );
    const uploaded = await drive.putContent({
      destination,
      parentProviderId: mediaFolder.providerFileId,
      name: 'metadata.json',
      mimeType: 'application/json',
      content,
      appProperties: {
        ytbm: '1',
        ytbmObjectType: 'metadata',
        ytbmObjectKey: `media:${media.providerMediaId}:metadata`,
        ytbmSchemaVersion: '1',
        sourceProvider: 'youtube',
        providerMediaId: media.providerMediaId,
        providerChannelId: media.providerChannelId,
        artifactType: 'metadata',
        sha256: hash.sha256,
      },
      knownProviderFileId,
      signal: context.signal,
    });
    const relativePath = posix.join(
      archiveFolderName(media.channelTitle, media.providerChannelId),
      this.driveCategory(media.mediaType),
      archiveFolderName(media.title, media.providerMediaId),
      'metadata.json',
    );
    this.repository.upsertMediaArtifact({
      mediaItemId: media.id,
      destinationId: destination.id,
      artifactType: 'METADATA',
      relativePath,
      providerFileId: uploaded.providerFileId,
      ...hash,
      contentGeneration: payload.contentGeneration,
    });
    return { relativePath, providerFileId: uploaded.providerFileId, ...hash };
  }

  private async updateGoogleDriveThumbnail(context: JobExecutionContext): Promise<unknown> {
    const drive = this.requiredGoogleDriveStorage();
    const media = this.requiredMedia(context);
    if (media.thumbnailUrl === null) return { skipped: true };
    const payload = z
      .object({ contentGeneration: z.string() })
      .passthrough()
      .parse(context.job.payload);
    const destinationId = this.requiredDestinationId(context);
    const copy = this.findVerifiedCopy(media.id, destinationId);
    if (copy.destinationType !== 'GOOGLE_DRIVE') {
      throw new BackupOperationError('INTERNAL_ERROR', 'Drive thumbnail targeted a local copy.', {
        disposition: 'FAIL',
      });
    }
    const destination = this.repository.getGoogleDriveDestination(destinationId);
    const mediaFolder = await this.ensureDriveMediaFolder(destination, media);
    const response = await this.fetchImplementation(thumbnailUrl(media.thumbnailUrl), {
      signal: context.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new BackupOperationError(
        'NETWORK_UNAVAILABLE',
        'The current YouTube thumbnail could not be downloaded.',
        { disposition: response.status >= 500 ? 'RETRY' : 'FAIL' },
      );
    }
    const content = await readBoundedBody(response, 20 * 1024 * 1024);
    const hash = hashBytes(content);
    const knownProviderFileId = this.repository.getMediaArtifactProviderId(
      media.id,
      destination.id,
      'THUMBNAIL',
    );
    const uploaded = await drive.putContent({
      destination,
      parentProviderId: mediaFolder.providerFileId,
      name: 'thumbnail.jpg',
      mimeType: 'image/jpeg',
      content,
      appProperties: {
        ytbm: '1',
        ytbmObjectType: 'thumbnail',
        ytbmObjectKey: `media:${media.providerMediaId}:thumbnail`,
        ytbmSchemaVersion: '1',
        sourceProvider: 'youtube',
        providerMediaId: media.providerMediaId,
        providerChannelId: media.providerChannelId,
        artifactType: 'thumbnail',
        sha256: hash.sha256,
      },
      knownProviderFileId,
      signal: context.signal,
    });
    const relativePath = posix.join(
      archiveFolderName(media.channelTitle, media.providerChannelId),
      this.driveCategory(media.mediaType),
      archiveFolderName(media.title, media.providerMediaId),
      'thumbnail.jpg',
    );
    this.repository.upsertMediaArtifact({
      mediaItemId: media.id,
      destinationId,
      artifactType: 'THUMBNAIL',
      relativePath,
      providerFileId: uploaded.providerFileId,
      ...hash,
      contentGeneration: payload.contentGeneration,
    });
    return { relativePath, providerFileId: uploaded.providerFileId, ...hash };
  }

  private async updateGoogleDriveManifest(context: JobExecutionContext): Promise<unknown> {
    const channelId = this.requiredChannelId(context);
    const destinationId = this.requiredDestinationId(context);
    const destination = this.repository.getGoogleDriveDestination(destinationId);
    const data = this.repository.getChannelManifestData(channelId, destinationId);
    const folders = await this.ensureDriveChannelFolders(
      destinationId,
      data.providerChannelId,
      data.channelTitle,
    );
    const playlistEntries: Array<{
      providerPlaylistId: string;
      playlistFile: string;
      mediaIds: string[];
    }> = [];
    for (const playlist of data.playlists) {
      const playlistFolder = await this.ensureDriveFolder(
        destination,
        `playlist:${playlist.providerPlaylistId}`,
        folders.categories.Playlists.providerFileId,
        archiveFolderName(playlist.title, playlist.providerPlaylistId),
        'PLAYLIST_FOLDER',
        {
          ytbm: '1',
          ytbmObjectType: 'playlist',
          ytbmObjectKey: `playlist:${playlist.providerPlaylistId}`,
          ytbmSchemaVersion: '1',
          sourceProvider: 'youtube',
          providerPlaylistId: playlist.providerPlaylistId,
          channelId: data.providerChannelId,
          providerChannelId: data.providerChannelId,
        },
      );
      const playlistDocument = PlaylistSidecarSchema.parse({
        schemaVersion: 1,
        provider: 'YOUTUBE',
        providerPlaylistId: playlist.providerPlaylistId,
        channelId: data.providerChannelId,
        title: playlist.title,
        sourceStatus: playlist.sourceStatus,
        updatedAt: this.now(),
        items: playlist.items,
      });
      await this.putDriveJson(
        destination,
        playlistFolder.providerFileId,
        `playlist:${playlist.providerPlaylistId}:sidecar`,
        'playlist.json',
        playlistDocument,
        context.signal,
      );
      playlistEntries.push({
        providerPlaylistId: playlist.providerPlaylistId,
        playlistFile: posix.join(
          'Playlists',
          archiveFolderName(playlist.title, playlist.providerPlaylistId),
          'playlist.json',
        ),
        mediaIds: playlist.items.map((item) => item.providerMediaId),
      });
    }
    const channelDirectory = archiveFolderName(data.channelTitle, data.providerChannelId);
    const manifest = ChannelManifestSchema.parse({
      schemaVersion: 1,
      provider: 'YOUTUBE',
      providerChannelId: data.providerChannelId,
      channelTitle: data.channelTitle,
      updatedAt: this.now(),
      media: data.media.map((media) => {
        const relativeMedia = media.relativePath.startsWith(`${channelDirectory}/`)
          ? media.relativePath.slice(channelDirectory.length + 1)
          : media.relativePath;
        return {
          providerMediaId: media.providerMediaId,
          mediaType: media.mediaType,
          mediaDirectory: posix.dirname(relativeMedia),
          mediaFile: relativeMedia,
          metadataFile: posix.join(posix.dirname(relativeMedia), 'metadata.json'),
          bytes: media.bytes,
          sha256: media.sha256,
        };
      }),
      playlists: playlistEntries,
    });
    await this.putDriveJson(
      destination,
      folders.categories.Internal.providerFileId,
      `channel:${data.providerChannelId}:version`,
      'version.json',
      ManifestVersionSchema.parse({ schemaVersion: 1, provider: 'YOUTUBE' }),
      context.signal,
    );
    await this.putDriveJson(
      destination,
      folders.categories.Internal.providerFileId,
      `channel:${data.providerChannelId}:manifest`,
      'manifest.json',
      manifest,
      context.signal,
    );
    return { mediaCount: manifest.media.length, playlistCount: manifest.playlists.length };
  }

  private async verifyExistingCopy(context: JobExecutionContext): Promise<unknown> {
    const payload = z
      .object({
        integrityCheckId: z.string().uuid(),
        mediaCopyId: z.string().uuid(),
        verificationStrength: z.enum([
          'LOCAL_SHA256',
          'PROVIDER_METADATA_SIZE',
          'DOWNLOADED_SHA256',
        ]),
      })
      .strict()
      .parse(context.job.payload);
    const copy = this.repository.getMediaCopy(payload.mediaCopyId);
    const finish = (
      result: 'VERIFIED' | 'MISSING' | 'CORRUPT' | 'UNAVAILABLE' | 'ERROR',
      actualSha256: string | null,
      actualBytes: number | null,
      errorCode: string | null,
      safeMessage: string | null,
    ): void => {
      this.repository.completeIntegrityCheck({
        checkId: payload.integrityCheckId,
        copyId: copy.id,
        result,
        verificationStrength: payload.verificationStrength,
        actualSha256,
        actualBytes,
        errorCode,
        safeMessage,
      });
    };
    if (copy.sha256 === null || copy.bytes === null) {
      finish(
        'ERROR',
        null,
        null,
        'VERIFY_FAILED',
        'This copy does not have a trusted expected hash and size.',
      );
      return { result: 'ERROR' };
    }
    if (copy.destinationType === 'FILESYSTEM') {
      const destination = this.repository.getDestination(copy.destinationId);
      const probe = await this.probeDestination(copy.destinationId);
      if (probe.availability === 'DISCONNECTED') {
        finish(
          'UNAVAILABLE',
          null,
          null,
          'DESTINATION_DISCONNECTED',
          'The local destination is disconnected; the copy was not marked missing.',
        );
        throw this.disconnected();
      }
      const root = await this.storage.resolveCurrentRoot(destination);
      if (root === null || copy.relativePath === null) {
        finish(
          'UNAVAILABLE',
          null,
          null,
          'DESTINATION_DISCONNECTED',
          'The local destination is unavailable.',
        );
        throw this.disconnected();
      }
      const path = resolvePathUnderRoot(root, copy.relativePath);
      try {
        await assertPathPhysicallyUnderRoot(root, path);
        const verified = await verifyFileSha256(path, copy.sha256, copy.bytes, {
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
        if (verified.verified) {
          finish('VERIFIED', verified.sha256, verified.bytes, null, null);
          return { result: 'VERIFIED', ...verified };
        }
        finish(
          'CORRUPT',
          verified.sha256,
          verified.bytes,
          'COPY_CORRUPT',
          'The local copy failed SHA-256 verification.',
        );
        return { result: 'CORRUPT', ...verified };
      } catch (error) {
        if (context.signal.aborted) throw error;
        if (nodeErrorCode(error) === 'ENOENT') {
          finish('MISSING', null, null, 'COPY_MISSING', 'The local backup file is missing.');
          return { result: 'MISSING' };
        }
        finish('ERROR', null, null, 'VERIFY_FAILED', 'The local backup file could not be read.');
        return { result: 'ERROR' };
      }
    }

    if (copy.providerFileId === null) {
      finish(
        'MISSING',
        null,
        null,
        'PROVIDER_OBJECT_MISSING',
        'The Google Drive object is missing.',
      );
      return { result: 'MISSING' };
    }
    const destination = this.repository.getGoogleDriveDestination(copy.destinationId);
    let current: GoogleDriveObjectStat | null;
    try {
      current = await this.requiredGoogleDriveStorage().stat({
        destination,
        providerFileId: copy.providerFileId,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      if (
        error instanceof BackupOperationError &&
        ['AUTH_REVOKED', 'AUTH_REFRESH_FAILED'].includes(error.code)
      ) {
        finish('UNAVAILABLE', null, null, error.code, 'Google Drive authorization is required.');
        throw new BackupOperationError(error.code, 'Google Drive authorization is required.', {
          disposition: 'BLOCK',
        });
      }
      if (error instanceof BackupOperationError && error.code === 'NETWORK_UNAVAILABLE') {
        throw error;
      }
      finish('ERROR', null, null, 'VERIFY_FAILED', 'Google Drive metadata could not be checked.');
      return { result: 'ERROR' };
    }
    if (current === null) {
      finish(
        'MISSING',
        null,
        null,
        'PROVIDER_OBJECT_MISSING',
        'The Google Drive object is missing.',
      );
      return { result: 'MISSING' };
    }
    const media = this.requiredMedia(context);
    if (
      current.bytes !== copy.bytes ||
      current.appProperties.sha256 !== copy.sha256 ||
      current.appProperties.providerMediaId !== media.providerMediaId
    ) {
      finish(
        'CORRUPT',
        null,
        current.bytes,
        'COPY_CORRUPT',
        'Google Drive identity, size, or expected hash metadata did not match.',
      );
      return { result: 'CORRUPT', actualBytes: current.bytes };
    }
    if (payload.verificationStrength === 'PROVIDER_METADATA_SIZE') {
      finish('VERIFIED', null, current.bytes, null, null);
      return { result: 'VERIFIED', actualBytes: current.bytes };
    }
    const directory = await this.prepareStagingDirectory(
      join(this.options.stagingRoot, 'integrity', payload.integrityCheckId),
    );
    const path = join(directory, `drive-copy.${copy.container ?? 'bin'}`);
    try {
      const downloaded = await this.requiredGoogleDriveStorage().getFile({
        destination,
        providerFileId: copy.providerFileId,
        destinationPath: path,
        expectedSha256: copy.sha256,
        expectedBytes: copy.bytes,
        signal: context.signal,
        onProgress: (bytesProcessed) =>
          context.progress({
            bytesProcessed,
            bytesTotal: copy.bytes,
            progressRatio: relativeProgress(bytesProcessed, copy.bytes),
            speedBytesPerSec: null,
            etaSeconds: null,
          }),
      });
      finish('VERIFIED', downloaded.sha256, downloaded.bytes, null, null);
      await rm(directory, { recursive: true, force: true });
      return { result: 'VERIFIED', actualSha256: downloaded.sha256, actualBytes: downloaded.bytes };
    } catch (error) {
      if (context.signal.aborted) throw error;
      if (error instanceof BackupOperationError && error.code === 'COPY_CORRUPT') {
        finish(
          'CORRUPT',
          null,
          null,
          'COPY_CORRUPT',
          'The downloaded Google Drive bytes failed SHA-256 verification.',
        );
        await rm(directory, { recursive: true, force: true });
        return { result: 'CORRUPT' };
      }
      if (error instanceof BackupOperationError && error.code === 'PROVIDER_OBJECT_MISSING') {
        finish(
          'MISSING',
          null,
          null,
          'PROVIDER_OBJECT_MISSING',
          'The Google Drive object is missing.',
        );
        await rm(directory, { recursive: true, force: true });
        return { result: 'MISSING' };
      }
      if (
        error instanceof BackupOperationError &&
        ['AUTH_REVOKED', 'AUTH_REFRESH_FAILED'].includes(error.code)
      ) {
        finish('UNAVAILABLE', null, null, error.code, 'Google Drive authorization is required.');
        throw new BackupOperationError(error.code, 'Google Drive authorization is required.', {
          disposition: 'BLOCK',
        });
      }
      if (error instanceof BackupOperationError && error.code === 'NETWORK_UNAVAILABLE')
        throw error;
      finish('ERROR', null, null, 'VERIFY_FAILED', 'The Google Drive copy could not be verified.');
      return { result: 'ERROR' };
    }
  }

  private async cleanupIntegrityVerification(context: JobExecutionContext): Promise<void> {
    const payload = z
      .object({ integrityCheckId: z.string().uuid(), mediaCopyId: z.string().uuid() })
      .passthrough()
      .parse(context.job.payload);
    this.repository.cancelIntegrityCheck(payload.integrityCheckId, payload.mediaCopyId);
    const directory = this.stagingPath(
      join(this.options.stagingRoot, 'integrity', payload.integrityCheckId),
    );
    await rm(directory, { recursive: true, force: true });
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

  private async removeDriveUploadState(context: JobExecutionContext): Promise<void> {
    this.repository.deleteDriveUploadSession(context.job.id);
  }

  private requiredGoogleDriveStorage(): GoogleDriveStorageProvider {
    if (this.googleDriveStorage === null) {
      throw new BackupOperationError(
        'INTERNAL_ERROR',
        'Google Drive storage is not configured in this worker.',
        { disposition: 'FAIL' },
      );
    }
    return this.googleDriveStorage;
  }

  private driveCategory(mediaType: BackupMediaContext['mediaType']): 'Videos' | 'Shorts' | 'Live' {
    if (mediaType === 'SHORT') return 'Shorts';
    if (mediaType === 'LIVE') return 'Live';
    return 'Videos';
  }

  private async ensureDriveRootForDestination(
    destinationId: string,
  ): Promise<GoogleDriveObjectStat> {
    const drive = this.requiredGoogleDriveStorage();
    const destination = this.repository.getGoogleDriveDestination(destinationId);
    const known = this.repository.getProviderObject(destinationId, 'root');
    const ensured = await drive.ensureFolder({
      destination,
      knownProviderId: destination.providerRootId ?? known?.providerObjectId ?? null,
      parentProviderId: null,
      name: GOOGLE_DRIVE_ROOT_NAME,
      logicalKey: 'root',
      appProperties: {
        ytbm: '1',
        ytbmObjectType: 'backup-root',
        ytbmObjectKey: 'root',
        ytbmSchemaVersion: '1',
        artifactType: 'backup-root',
      },
    });
    this.repository.setGoogleDriveRoot(destinationId, ensured.providerFolderId);
    this.repository.upsertProviderObject({
      destinationId,
      logicalKey: 'root',
      objectType: 'ROOT_FOLDER',
      providerObjectId: ensured.providerFolderId,
      parentProviderObjectId: ensured.parentProviderId,
      currentName: ensured.name,
    });
    const current = await drive.stat({
      destination: this.repository.getGoogleDriveDestination(destinationId),
      providerFileId: ensured.providerFolderId,
    });
    if (current === null) {
      throw new BackupOperationError(
        'PROVIDER_OBJECT_MISSING',
        'The Google Drive backup root disappeared during setup.',
        { disposition: 'RETRY' },
      );
    }
    return current;
  }

  private async ensureDriveFolder(
    destination: ReturnType<LocalBackupRepository['getGoogleDriveDestination']>,
    logicalKey: string,
    parentProviderId: string,
    name: string,
    objectType: string,
    appProperties: Readonly<Record<string, string>>,
  ): Promise<GoogleDriveObjectStat> {
    const drive = this.requiredGoogleDriveStorage();
    const known = this.repository.getProviderObject(destination.id, logicalKey);
    const ensured = await drive.ensureFolder({
      destination,
      knownProviderId: known?.providerObjectId ?? null,
      parentProviderId,
      name,
      logicalKey,
      appProperties,
    });
    this.repository.upsertProviderObject({
      destinationId: destination.id,
      logicalKey,
      objectType,
      providerObjectId: ensured.providerFolderId,
      parentProviderObjectId: ensured.parentProviderId,
      currentName: ensured.name,
    });
    const current = await drive.stat({
      destination,
      providerFileId: ensured.providerFolderId,
    });
    if (current === null) {
      throw new BackupOperationError(
        'PROVIDER_OBJECT_MISSING',
        'A Google Drive backup folder disappeared during setup.',
        { disposition: 'RETRY' },
      );
    }
    return current;
  }

  private async ensureDriveChannelFolders(
    destinationId: string,
    providerChannelId: string,
    channelTitle: string,
  ): Promise<{
    channel: GoogleDriveObjectStat;
    categories: Record<
      'Videos' | 'Shorts' | 'Live' | 'Playlists' | 'Internal',
      GoogleDriveObjectStat
    >;
  }> {
    const root = await this.ensureDriveRootForDestination(destinationId);
    const destination = this.repository.getGoogleDriveDestination(destinationId);
    const channel = await this.ensureDriveFolder(
      destination,
      `channel:${providerChannelId}`,
      root.providerFileId,
      archiveFolderName(channelTitle, providerChannelId),
      'CHANNEL_FOLDER',
      {
        ytbm: '1',
        ytbmObjectType: 'channel',
        ytbmObjectKey: `channel:${providerChannelId}`,
        ytbmSchemaVersion: '1',
        sourceProvider: 'youtube',
        channelId: providerChannelId,
        providerChannelId,
      },
    );
    const categories = {} as Record<
      'Videos' | 'Shorts' | 'Live' | 'Playlists' | 'Internal',
      GoogleDriveObjectStat
    >;
    for (const [key, name] of [
      ['Videos', 'Videos'],
      ['Shorts', 'Shorts'],
      ['Live', 'Live'],
      ['Playlists', 'Playlists'],
      ['Internal', '.ytbackup'],
    ] as const) {
      categories[key] = await this.ensureDriveFolder(
        destination,
        `channel:${providerChannelId}:folder:${key}`,
        channel.providerFileId,
        name,
        'CATEGORY_FOLDER',
        {
          ytbm: '1',
          ytbmObjectType: 'category',
          ytbmObjectKey: `channel:${providerChannelId}:folder:${key}`,
          ytbmSchemaVersion: '1',
          sourceProvider: 'youtube',
          channelId: providerChannelId,
          providerChannelId,
          artifactType: key.toLowerCase(),
        },
      );
    }
    return { channel, categories };
  }

  private async ensureDriveMediaFolder(
    destination: ReturnType<LocalBackupRepository['getGoogleDriveDestination']>,
    media: BackupMediaContext,
  ): Promise<GoogleDriveObjectStat> {
    const folders = await this.ensureDriveChannelFolders(
      destination.id,
      media.providerChannelId,
      media.channelTitle,
    );
    const category = this.driveCategory(media.mediaType);
    return this.ensureDriveFolder(
      destination,
      `media:${media.providerMediaId}`,
      folders.categories[category].providerFileId,
      archiveFolderName(media.title, media.providerMediaId),
      'MEDIA_FOLDER',
      {
        ytbm: '1',
        ytbmObjectType: 'media',
        ytbmObjectKey: `media:${media.providerMediaId}`,
        ytbmSchemaVersion: '1',
        sourceProvider: 'youtube',
        providerMediaId: media.providerMediaId,
        channelId: media.providerChannelId,
        providerChannelId: media.providerChannelId,
      },
    );
  }

  private async putDriveJson(
    destination: ReturnType<LocalBackupRepository['getGoogleDriveDestination']>,
    parentProviderId: string,
    logicalKey: string,
    name: string,
    value: unknown,
    signal: AbortSignal,
  ): Promise<GoogleDriveObjectStat> {
    const content = new TextEncoder().encode(serializeDeterministicJson(value));
    const hash = hashBytes(content);
    const known = this.repository.getProviderObject(destination.id, logicalKey);
    const uploaded = await this.requiredGoogleDriveStorage().putContent({
      destination,
      parentProviderId,
      name,
      mimeType: 'application/json',
      content,
      appProperties: {
        ytbm: '1',
        ytbmObjectType: 'json-sidecar',
        ytbmObjectKey: logicalKey,
        ytbmSchemaVersion: '1',
        artifactType: 'json-sidecar',
        sha256: hash.sha256,
      },
      knownProviderFileId: known?.providerObjectId ?? null,
      signal,
    });
    this.repository.upsertProviderObject({
      destinationId: destination.id,
      logicalKey,
      objectType: 'JSON_SIDECAR',
      providerObjectId: uploaded.providerFileId,
      parentProviderObjectId: uploaded.parents[0] ?? parentProviderId,
      currentName: uploaded.name,
    });
    return uploaded;
  }

  private async resolveVerifiedTransferSource(
    context: JobExecutionContext,
    payload: z.infer<typeof CopyJobPayloadSchema>,
  ): Promise<VerifiedTransferSource> {
    if (payload.sourceCopyId !== null) {
      const sourceCopy = this.repository.getMediaCopy(payload.sourceCopyId);
      if (
        sourceCopy.destinationType !== 'FILESYSTEM' ||
        sourceCopy.status !== 'VERIFIED' ||
        sourceCopy.relativePath === null ||
        sourceCopy.sha256 === null ||
        sourceCopy.bytes === null ||
        sourceCopy.container === null
      ) {
        throw new BackupOperationError(
          'COPY_MISSING',
          'The selected local upload source is not verified.',
          { disposition: 'FAIL' },
        );
      }
      const sourceDestination = this.repository.getDestination(sourceCopy.destinationId);
      const sourceRoot = await this.storage.resolveCurrentRoot(sourceDestination);
      if (sourceRoot === null) throw this.disconnected();
      const path = resolvePathUnderRoot(sourceRoot, sourceCopy.relativePath);
      await assertPathPhysicallyUnderRoot(sourceRoot, path);
      const verified = await verifyFileSha256(path, sourceCopy.sha256, sourceCopy.bytes, {
        signal: context.signal,
      });
      if (!verified.verified) {
        this.repository.markMediaCopyFailure(sourceCopy.id, 'CORRUPT', 'COPY_CORRUPT');
        throw new BackupOperationError(
          'COPY_CORRUPT',
          'The existing local upload source failed SHA-256 verification.',
          { disposition: 'FAIL' },
        );
      }
      return {
        path,
        container: sourceCopy.container,
        videoCodec: sourceCopy.videoCodec,
        audioCodec: sourceCopy.audioCodec,
        width: sourceCopy.width,
        height: sourceCopy.height,
        fps: sourceCopy.fps,
        bytes: sourceCopy.bytes,
        sha256: sourceCopy.sha256,
        qualityProfile: sourceCopy.qualityProfile ?? payload.qualityProfile,
        reference: { kind: 'LOCAL_COPY', copyId: sourceCopy.id },
      };
    }
    const stagingDependency =
      this.repository.getDependencyResult(context.job.id, 'VERIFY_STAGING_MEDIA') ??
      this.repository.getDependencyResult(context.job.id, 'DOWNLOAD_FROM_GOOGLE_DRIVE');
    const staging = StagingResultSchema.parse(stagingDependency);
    await this.assertStagingPath(staging.path, false);
    return {
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
      reference: { kind: 'STAGING', generation: staging.generation },
    };
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
    if (this.stopping || this.refreshPromise !== null) return;
    this.refreshPromise = this.refreshDestinationState().finally(() => {
      this.refreshPromise = null;
    });
  }

  private async refreshDestinationState(): Promise<void> {
    try {
      await this.probeAllDestinations();
      await this.reconcileVerifiedCopyPresence({ exhaust: false });
    } catch (error) {
      this.options.logger.warn('Backup destination presence reconciliation could not complete', {
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
    if (copy.destinationType === 'GOOGLE_DRIVE') {
      if (copy.providerFileId === null) {
        this.recordCopyProblem(copy, 'MISSING', 'COPY_MISSING');
        return;
      }
      const destination = this.repository.getGoogleDriveDestination(copy.destinationId);
      try {
        const current = await this.requiredGoogleDriveStorage().stat({
          destination,
          providerFileId: copy.providerFileId,
        });
        if (current === null) {
          this.recordCopyProblem(copy, 'MISSING', 'COPY_MISSING');
        } else if (
          (copy.bytes !== null && current.bytes !== copy.bytes) ||
          (copy.sha256 !== null && current.appProperties.sha256 !== copy.sha256) ||
          current.appProperties.providerMediaId !==
            this.repository.getMediaContext(copy.mediaItemId).providerMediaId
        ) {
          this.recordCopyProblem(copy, 'CORRUPT', 'COPY_CORRUPT');
        } else {
          this.repository.upsertProviderObject({
            destinationId: copy.destinationId,
            logicalKey: `media:${this.repository.getMediaContext(copy.mediaItemId).providerMediaId}:video`,
            objectType: 'VIDEO',
            providerObjectId: current.providerFileId,
            parentProviderObjectId: current.parents[0] ?? null,
            currentName: current.name,
          });
        }
      } catch (error) {
        if (error instanceof BackupOperationError && error.code === 'AUTH_REVOKED') return;
        this.options.logger.warn('A verified Google Drive copy could not be checked', {
          mediaId: copy.mediaItemId,
          errorCode: error instanceof BackupOperationError ? error.code : nodeErrorCode(error),
        });
      }
      return;
    }
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
      eventType:
        copy.destinationType === 'GOOGLE_DRIVE'
          ? status === 'MISSING'
            ? 'GOOGLE_DRIVE_COPY_MISSING'
            : 'GOOGLE_DRIVE_COPY_CORRUPT'
          : status === 'MISSING'
            ? 'LOCAL_COPY_MISSING'
            : 'LOCAL_COPY_CORRUPT',
      mediaItemId: copy.mediaItemId,
      destinationId: copy.destinationId,
      summary:
        status === 'MISSING'
          ? `A previously verified ${copy.destinationType === 'GOOGLE_DRIVE' ? 'Google Drive' : 'local'} media copy is missing.`
          : `A previously verified ${copy.destinationType === 'GOOGLE_DRIVE' ? 'Google Drive' : 'local'} media copy no longer matches its expected size.`,
      severity: 'WARNING',
      details: { errorCode },
    });
  }

  private async probeAllDestinations(): Promise<void> {
    for (const destination of this.repository.listDestinations(true)) {
      await this.probeDestination(destination.id);
    }
    for (const destination of this.repository.listGoogleDriveDestinations(true)) {
      await this.probeGoogleDriveDestination(destination.id);
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
    this.destinationProbes.set(destinationId, probe);
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

  private async probeGoogleDriveDestination(destinationId: string): Promise<DestinationProbe> {
    const destination = this.repository.getGoogleDriveDestination(destinationId);
    if (this.googleDriveStorage === null) {
      const probe: DestinationProbe = {
        availability: 'ERROR',
        availableBytes: null,
        totalBytes: null,
        identity: null,
        safeMessage: 'Google Drive storage is not configured in this worker.',
      };
      this.repository.updateGoogleDriveDestinationProbe(
        destinationId,
        probe.availability,
        'INTERNAL_ERROR',
      );
      this.destinationProbes.set(destinationId, probe);
      return probe;
    }
    const probe = await this.googleDriveStorage.probe(destination);
    this.repository.updateGoogleDriveDestinationProbe(
      destinationId,
      probe.availability,
      errorCodeForProbe(probe),
    );
    if (probe.availability === 'AVAILABLE') {
      this.jobs.unblockDestination(destinationId, this.now());
    }
    this.destinationProbes.set(destinationId, probe);
    return probe;
  }

  private googleDriveDestinationDto(
    destinationId: string,
    probe: DestinationProbe,
  ): DestinationDto {
    const destination = this.repository.getGoogleDriveDestination(destinationId);
    return DestinationDtoSchema.parse({
      id: destination.id,
      destinationType: 'GOOGLE_DRIVE',
      accountId: destination.accountId,
      accountEmail: destination.accountEmail,
      accountDisplayName: destination.accountDisplayName,
      providerRootId: destination.providerRootId,
      rootName: GOOGLE_DRIVE_ROOT_NAME,
      enabled: destination.enabled,
      availabilityStatus: probe.availability,
      availableBytes: probe.availableBytes,
      totalBytes: probe.totalBytes,
      lastProbeAt: destination.lastProbeAt,
      safeMessage: probe.safeMessage,
    });
  }
}
