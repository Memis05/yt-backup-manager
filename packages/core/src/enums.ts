import { z } from 'zod';

export const ProviderSchema = z.enum(['GOOGLE', 'YOUTUBE']);
export const MediaTypeSchema = z.enum(['VIDEO', 'SHORT', 'LIVE']);
export const SourceStatusSchema = z.enum([
  'AVAILABLE',
  'PRIVATE',
  'UNLISTED',
  'REMOVED',
  'UNAVAILABLE',
  'UNKNOWN',
]);
export const DestinationTypeSchema = z.enum(['FILESYSTEM', 'GOOGLE_DRIVE']);
export const DestinationAvailabilitySchema = z.enum([
  'AVAILABLE',
  'DISCONNECTED',
  'READ_ONLY',
  'FULL',
  'AUTH_REQUIRED',
  'ERROR',
  'UNKNOWN',
]);
export const CopyStatusSchema = z.enum([
  'PENDING',
  'TRANSFERRING',
  'VERIFYING',
  'VERIFIED',
  'MISSING',
  'CORRUPT',
  'FAILED',
  'UNAVAILABLE',
]);
export const BackupRunTriggerSchema = z.enum([
  'MANUAL',
  'CUSTOM_MANUAL',
  'SCHEDULED',
  'STARTUP',
  'RECOVERY',
  'REPAIR',
  'VERIFY',
]);
export const BackupRunStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
]);
export const JobStatusSchema = z.enum([
  'PENDING',
  'READY',
  'RUNNING',
  'PAUSE_REQUESTED',
  'PAUSED',
  'RETRY_WAIT',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'COMPLETED',
  'FAILED',
  'INTERRUPTED',
  'BLOCKED',
]);
export const VerificationResultSchema = z.enum([
  'VERIFIED',
  'MISSING',
  'CORRUPT',
  'UNAVAILABLE',
  'ERROR',
]);
export const QualityProfileSchema = z.enum(['BEST_AVAILABLE', 'MAX_4K', 'MAX_1080P', 'MAX_720P']);
export const JobTypeSchema = z.enum([
  'CHANNEL_SYNC',
  'FORMAT_PROBE',
  'DOWNLOAD_MEDIA',
  'DOWNLOAD_THUMBNAIL',
  'POST_PROCESS_MEDIA',
  'HASH_STAGING_MEDIA',
  'VERIFY_STAGING_MEDIA',
  'WRITE_STAGING_METADATA',
  'COPY_TO_FILESYSTEM',
  'VERIFY_FILESYSTEM_COPY',
  'WRITE_DESTINATION_METADATA',
  'UPDATE_MANIFEST',
  'ENSURE_GOOGLE_DRIVE_ROOT',
  'ENSURE_GOOGLE_DRIVE_FOLDER',
  'UPLOAD_TO_GOOGLE_DRIVE',
  'VERIFY_GOOGLE_DRIVE_COPY',
  'DOWNLOAD_FROM_GOOGLE_DRIVE',
  'RECONCILE_GOOGLE_DRIVE_OBJECT',
  'UPDATE_GOOGLE_DRIVE_METADATA',
  'UPDATE_GOOGLE_DRIVE_THUMBNAIL',
  'UPDATE_GOOGLE_DRIVE_MANIFEST',
  'CLEANUP_STAGING',
]);
export const StagingStateSchema = z.enum([
  'PARTIAL',
  'DOWNLOADED',
  'POST_PROCESSED',
  'HASHED',
  'VERIFIED',
  'DISTRIBUTING',
  'CLEANUP_PENDING',
]);
export const BackupErrorCodeSchema = z.enum([
  'NETWORK_TIMEOUT',
  'NETWORK_UNAVAILABLE',
  'RATE_LIMITED',
  'PROVIDER_5XX',
  'AUTH_EXPIRED',
  'AUTH_REFRESH_FAILED',
  'AUTH_REVOKED',
  'YOUTUBE_SESSION_REQUIRED',
  'YOUTUBE_SESSION_INVALID',
  'SOURCE_REMOVED',
  'SOURCE_UNAVAILABLE',
  'FORMAT_UNAVAILABLE',
  'DESTINATION_DISCONNECTED',
  'DESTINATION_READ_ONLY',
  'DESTINATION_FULL',
  'DESTINATION_PERMISSION_DENIED',
  'STAGING_UNAVAILABLE',
  'STAGING_FULL',
  'DOWNLOAD_FAILED',
  'FFMPEG_FAILED',
  'HASH_FAILED',
  'COPY_FAILED',
  'UPLOAD_FAILED',
  'VERIFY_FAILED',
  'COPY_MISSING',
  'COPY_CORRUPT',
  'PROVIDER_OBJECT_MISSING',
  'RESUMABLE_SESSION_EXPIRED',
  'MANIFEST_INVALID',
  'MANIFEST_WRITE_FAILED',
  'DATABASE_ERROR',
  'INTERNAL_ERROR',
]);
export const AccountConnectionStateSchema = z.enum([
  'CONNECTED',
  'REAUTH_REQUIRED',
  'DISCONNECTED',
  'ERROR',
]);
export const OAuthFlowStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED']);
export const GoogleOAuthCapabilitySchema = z.enum(['YOUTUBE', 'GOOGLE_DRIVE']);
export const DriveCapabilityStateSchema = z.enum([
  'AUTHORIZATION_REQUIRED',
  'CONNECTED',
  'REAUTH_REQUIRED',
]);
export const SourceSyncStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'RETRY_WAIT',
  'COMPLETED',
  'FAILED',
]);
export const RecoverySessionStatusSchema = z.enum([
  'DRAFT',
  'SCANNING',
  'READY_FOR_REVIEW',
  'IMPORTING',
  'COMPLETED',
  'COMPLETED_WITH_WARNINGS',
  'FAILED',
  'CANCELLED',
]);
export const RecoverySourceTypeSchema = z.enum(['FILESYSTEM', 'GOOGLE_DRIVE']);
export const RecoverySourceStatusSchema = z.enum([
  'PENDING',
  'SCANNING',
  'SCANNED',
  'FAILED',
  'CANCELLED',
]);
export const RecoveryWarningCodeSchema = z.enum([
  'MANIFEST_MISSING',
  'MANIFEST_INVALID',
  'UNSUPPORTED_SCHEMA',
  'METADATA_INVALID',
  'PLAYLIST_INVALID',
  'FILE_MISSING',
  'SIZE_MISMATCH',
  'HASH_CONFLICT',
  'DUPLICATE_OBJECT',
  'AMBIGUOUS_DESTINATION',
  'DRIVE_ROOT_DUPLICATE',
  'DRIVE_OBJECT_MISSING',
  'DRIVE_AUTH_REQUIRED',
  'PARTIAL_BACKUP',
  'ORPHAN_MEDIA_FILE',
  'ORPHAN_METADATA',
  'UNSAFE_PATH',
  'UNKNOWN_MEDIA_REFERENCE',
]);
export const SourceErrorCodeSchema = z.enum([
  'AUTH_EXPIRED',
  'AUTH_REFRESH_FAILED',
  'AUTH_REVOKED',
  'RATE_LIMITED',
  'PROVIDER_5XX',
  'NETWORK_UNAVAILABLE',
  'PARTIAL_SYNC_FAILED',
  'OAUTH_CONFIGURATION_REQUIRED',
  'OAUTH_STATE_INVALID',
  'OAUTH_FLOW_EXPIRED',
  'OAUTH_CALLBACK_FAILED',
  'SOURCE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

export type Provider = z.infer<typeof ProviderSchema>;
export type MediaType = z.infer<typeof MediaTypeSchema>;
export type SourceStatus = z.infer<typeof SourceStatusSchema>;
export type DestinationType = z.infer<typeof DestinationTypeSchema>;
export type DestinationAvailability = z.infer<typeof DestinationAvailabilitySchema>;
export type CopyStatus = z.infer<typeof CopyStatusSchema>;
export type BackupRunTrigger = z.infer<typeof BackupRunTriggerSchema>;
export type BackupRunStatus = z.infer<typeof BackupRunStatusSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type QualityProfile = z.infer<typeof QualityProfileSchema>;
export type JobType = z.infer<typeof JobTypeSchema>;
export type StagingState = z.infer<typeof StagingStateSchema>;
export type BackupErrorCode = z.infer<typeof BackupErrorCodeSchema>;
export type AccountConnectionState = z.infer<typeof AccountConnectionStateSchema>;
export type OAuthFlowStatus = z.infer<typeof OAuthFlowStatusSchema>;
export type GoogleOAuthCapability = z.infer<typeof GoogleOAuthCapabilitySchema>;
export type DriveCapabilityState = z.infer<typeof DriveCapabilityStateSchema>;
export type SourceSyncStatus = z.infer<typeof SourceSyncStatusSchema>;
export type RecoverySessionStatus = z.infer<typeof RecoverySessionStatusSchema>;
export type RecoverySourceType = z.infer<typeof RecoverySourceTypeSchema>;
export type RecoverySourceStatus = z.infer<typeof RecoverySourceStatusSchema>;
export type RecoveryWarningCode = z.infer<typeof RecoveryWarningCodeSchema>;
export type SourceErrorCode = z.infer<typeof SourceErrorCodeSchema>;
