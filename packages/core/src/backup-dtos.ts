import { z } from 'zod';

import {
  BackupErrorCodeSchema,
  BackupRunStatusSchema,
  CopyStatusSchema,
  DestinationAvailabilitySchema,
  JobStatusSchema,
  JobTypeSchema,
  MediaTypeSchema,
  QualityProfileSchema,
  SourceStatusSchema,
} from './enums';

const EpochMillisecondsSchema = z.number().int().nonnegative();
const NullableEpochMillisecondsSchema = EpochMillisecondsSchema.nullable();

export const QUALITY_PROFILE_LABELS = {
  BEST_AVAILABLE: 'Best available',
  MAX_4K: 'Up to 4K',
  MAX_1080P: 'Up to 1080p',
  MAX_720P: 'Up to 720p',
} as const satisfies Readonly<Record<z.infer<typeof QualityProfileSchema>, string>>;

export const FilesystemDestinationDtoSchema = z
  .object({
    id: z.string().uuid(),
    destinationType: z.literal('FILESYSTEM'),
    rootPath: z.string().min(1).max(1_024),
    volumeGuid: z.string().max(300).nullable(),
    volumeSerial: z.string().max(100).nullable(),
    filesystemType: z.string().max(100).nullable(),
    lastKnownMountPath: z.string().max(1_024).nullable(),
    enabled: z.boolean(),
    availabilityStatus: DestinationAvailabilitySchema,
    availableBytes: z.number().int().nonnegative().nullable(),
    totalBytes: z.number().int().nonnegative().nullable(),
    lastProbeAt: NullableEpochMillisecondsSchema,
    safeMessage: z.string().max(500).nullable(),
  })
  .strict();

export const GoogleDriveDestinationDtoSchema = z
  .object({
    id: z.string().uuid(),
    destinationType: z.literal('GOOGLE_DRIVE'),
    accountId: z.string().uuid(),
    accountEmail: z.string().email().nullable(),
    accountDisplayName: z.string().nullable(),
    providerRootId: z.string().min(1).max(500).nullable(),
    rootName: z.string().min(1).max(200),
    enabled: z.boolean(),
    availabilityStatus: DestinationAvailabilitySchema,
    availableBytes: z.number().int().nonnegative().nullable(),
    totalBytes: z.number().int().nonnegative().nullable(),
    lastProbeAt: NullableEpochMillisecondsSchema,
    safeMessage: z.string().max(500).nullable(),
  })
  .strict();

export const DestinationDtoSchema = z.discriminatedUnion('destinationType', [
  FilesystemDestinationDtoSchema,
  GoogleDriveDestinationDtoSchema,
]);

export const DestinationsListResultSchema = z
  .object({ destinations: z.array(DestinationDtoSchema) })
  .strict();

export const ChannelBackupSettingsDtoSchema = z
  .object({
    channelId: z.string().uuid(),
    qualityProfileOverride: QualityProfileSchema.nullable(),
    effectiveQualityProfile: QualityProfileSchema,
    destinationIds: z.array(z.string().uuid()),
  })
  .strict();

export const ChannelBackupSettingsPatchSchema = z
  .object({
    channelId: z.string().uuid(),
    qualityProfileOverride: QualityProfileSchema.nullable(),
    destinationIds: z.array(z.string().uuid()).max(32),
  })
  .strict();

export const BackupRunDtoSchema = z
  .object({
    id: z.string().uuid(),
    channelId: z.string().uuid(),
    channelTitle: z.string().min(1),
    triggerType: z.literal('MANUAL'),
    status: BackupRunStatusSchema,
    effectiveQualityProfile: QualityProfileSchema,
    destinationIds: z.array(z.string().uuid()),
    discoveredCount: z.number().int().nonnegative(),
    downloadedCount: z.number().int().nonnegative(),
    localCopyCount: z.number().int().nonnegative(),
    driveUploadCount: z.number().int().nonnegative(),
    metadataUpdateCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    bytesDownloaded: z.number().int().nonnegative(),
    bytesTransferred: z.number().int().nonnegative(),
    startedAt: NullableEpochMillisecondsSchema,
    completedAt: NullableEpochMillisecondsSchema,
    createdAt: EpochMillisecondsSchema,
  })
  .strict();

export const BackupRunsListResultSchema = z.object({ runs: z.array(BackupRunDtoSchema) }).strict();

export const BackupStartResultSchema = z
  .object({
    run: BackupRunDtoSchema,
    plannedJobs: z.number().int().nonnegative(),
    skippedVerifiedMedia: z.number().int().nonnegative(),
  })
  .strict();

export const QueueJobDtoSchema = z
  .object({
    id: z.string().uuid(),
    backupRunId: z.string().uuid().nullable(),
    channelId: z.string().uuid().nullable(),
    mediaItemId: z.string().uuid().nullable(),
    mediaTitle: z.string().nullable(),
    destinationId: z.string().uuid().nullable(),
    destinationPath: z.string().nullable(),
    destinationType: z.enum(['FILESYSTEM', 'GOOGLE_DRIVE']).nullable(),
    jobType: JobTypeSchema,
    status: JobStatusSchema,
    priority: z.number().int(),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    progressRatio: z.number().min(0).max(1).nullable(),
    bytesProcessed: z.number().int().nonnegative(),
    bytesTotal: z.number().int().nonnegative().nullable(),
    speedBytesPerSec: z.number().int().nonnegative().nullable(),
    etaSeconds: z.number().int().nonnegative().nullable(),
    errorCode: BackupErrorCodeSchema.nullable(),
    safeMessage: z.string().max(500).nullable(),
    nextRetryAt: NullableEpochMillisecondsSchema,
    createdAt: EpochMillisecondsSchema,
    updatedAt: EpochMillisecondsSchema,
  })
  .strict();

export const QueueSectionSchema = z.enum([
  'ACTIVE',
  'WAITING_DOWNLOADS',
  'RETRYING',
  'PAUSED',
  'ATTENTION',
  'COMPLETED',
  'ALL',
]);

export const QueueQuerySchema = z
  .object({
    section: QueueSectionSchema,
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();

export const QueueCompletedMediaDtoSchema = z
  .object({
    mediaItemId: z.string().uuid(),
    mediaTitle: z.string().min(1),
    destinationPaths: z.array(z.string().min(1)),
    verifiedCopyCount: z.number().int().positive(),
    bytes: z.number().int().nonnegative().nullable(),
    verifiedAt: EpochMillisecondsSchema,
  })
  .strict();

export const QueueSnapshotSchema = z
  .object({
    jobs: z.array(QueueJobDtoSchema),
    completedMedia: z.array(QueueCompletedMediaDtoSchema),
    section: QueueSectionSchema,
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalJobCount: z.number().int().nonnegative(),
    activeCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    waitingDownloadCount: z.number().int().nonnegative(),
    pausedCount: z.number().int().nonnegative(),
    retryWaitingCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    completedMediaCount: z.number().int().nonnegative(),
  })
  .strict();

export const JobControlActionSchema = z.enum([
  'PAUSE',
  'RESUME',
  'CANCEL_KEEP_PARTIAL',
  'CANCEL_REMOVE_PARTIAL',
  'MOVE_TOP',
  'PRIORITY_UP',
  'PRIORITY_DOWN',
]);

export const RunControlActionSchema = z.enum(['PAUSE', 'RESUME', 'CANCEL_KEEP_PARTIAL']);

export const MediaCopyDtoSchema = z
  .object({
    id: z.string().uuid(),
    destinationId: z.string().uuid(),
    destinationPath: z.string(),
    destinationType: z.enum(['FILESYSTEM', 'GOOGLE_DRIVE']),
    destinationAccountEmail: z.string().email().nullable(),
    relativePath: z.string().nullable(),
    providerFileIdAvailable: z.boolean(),
    status: CopyStatusSchema,
    availabilityStatus: DestinationAvailabilitySchema,
    container: z.string().nullable(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    fps: z.number().positive().nullable(),
    bytes: z.number().int().nonnegative().nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    qualityProfile: QualityProfileSchema.nullable(),
    verificationStrength: z
      .enum(['LOCAL_SHA256', 'PROVIDER_METADATA_SIZE', 'DOWNLOADED_SHA256'])
      .nullable(),
    verifiedAt: NullableEpochMillisecondsSchema,
  })
  .strict();

export const MediaBackupDetailsSchema = z
  .object({
    mediaItemId: z.string().uuid(),
    providerMediaId: z.string(),
    title: z.string(),
    mediaType: MediaTypeSchema,
    sourceStatus: SourceStatusSchema,
    copies: z.array(MediaCopyDtoSchema),
  })
  .strict();

export const OpenVerifiedCopyFolderResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('OPENED') }).strict(),
  z
    .object({
      status: z.enum(['MISSING', 'UNAVAILABLE']),
      safeMessage: z.string().min(1).max(500),
    })
    .strict(),
]);

export const ResolveVerifiedCopyFolderResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('AVAILABLE'), folderPath: z.string().min(1).max(4_096) }).strict(),
  z
    .object({
      status: z.enum(['MISSING', 'UNAVAILABLE']),
      safeMessage: z.string().min(1).max(500),
    })
    .strict(),
]);

export const ToolDiagnosticsSchema = z
  .object({
    ytDlp: z.object({ available: z.boolean(), version: z.string().nullable() }).strict(),
    ffmpeg: z.object({ available: z.boolean(), version: z.string().nullable() }).strict(),
    googleDrive: z
      .object({
        configuredDestinations: z.number().int().nonnegative(),
        availableDestinations: z.number().int().nonnegative(),
        activeUploads: z.number().int().nonnegative(),
        lastSafeErrorCode: BackupErrorCodeSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const OpenGoogleDriveObjectResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('OPENED') }).strict(),
  z
    .object({
      status: z.enum(['MISSING', 'UNAVAILABLE']),
      safeMessage: z.string().min(1).max(500),
    })
    .strict(),
]);

export const ResolveGoogleDriveObjectResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('AVAILABLE'), providerId: z.string().min(1).max(500) }).strict(),
  z
    .object({
      status: z.enum(['MISSING', 'UNAVAILABLE']),
      safeMessage: z.string().min(1).max(500),
    })
    .strict(),
]);

export const DashboardSummarySchema = z
  .object({
    selectedChannelCount: z.number().int().nonnegative(),
    mediaCount: z.number().int().nonnegative(),
    intendedCopyCount: z.number().int().nonnegative(),
    verifiedCopyCount: z.number().int().nonnegative(),
    pendingCopyCount: z.number().int().nonnegative(),
    failedCopyCount: z.number().int().nonnegative(),
    verifiedBytes: z.number().int().nonnegative(),
    localVerifiedCount: z.number().int().nonnegative(),
    driveVerifiedCount: z.number().int().nonnegative(),
    lastBackupAt: NullableEpochMillisecondsSchema,
  })
  .strict();

export type DestinationDto = z.infer<typeof DestinationDtoSchema>;
export type FilesystemDestinationDto = z.infer<typeof FilesystemDestinationDtoSchema>;
export type GoogleDriveDestinationDto = z.infer<typeof GoogleDriveDestinationDtoSchema>;
export type ChannelBackupSettingsDto = z.infer<typeof ChannelBackupSettingsDtoSchema>;
export type ChannelBackupSettingsPatch = z.infer<typeof ChannelBackupSettingsPatchSchema>;
export type BackupRunDto = z.infer<typeof BackupRunDtoSchema>;
export type BackupStartResult = z.infer<typeof BackupStartResultSchema>;
export type QueueJobDto = z.infer<typeof QueueJobDtoSchema>;
export type QueueSection = z.infer<typeof QueueSectionSchema>;
export type QueueQuery = z.infer<typeof QueueQuerySchema>;
export type QueueCompletedMediaDto = z.infer<typeof QueueCompletedMediaDtoSchema>;
export type QueueSnapshot = z.infer<typeof QueueSnapshotSchema>;
export type JobControlAction = z.infer<typeof JobControlActionSchema>;
export type RunControlAction = z.infer<typeof RunControlActionSchema>;
export type MediaCopyDto = z.infer<typeof MediaCopyDtoSchema>;
export type MediaBackupDetails = z.infer<typeof MediaBackupDetailsSchema>;
export type OpenVerifiedCopyFolderResult = z.infer<typeof OpenVerifiedCopyFolderResultSchema>;
export type ResolveVerifiedCopyFolderResult = z.infer<typeof ResolveVerifiedCopyFolderResultSchema>;
export type ToolDiagnostics = z.infer<typeof ToolDiagnosticsSchema>;
export type OpenGoogleDriveObjectResult = z.infer<typeof OpenGoogleDriveObjectResultSchema>;
export type ResolveGoogleDriveObjectResult = z.infer<typeof ResolveGoogleDriveObjectResultSchema>;
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;
