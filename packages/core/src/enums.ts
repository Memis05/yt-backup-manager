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
export const QualityProfileSchema = z.enum([
  'BEST_AVAILABLE',
  'UP_TO_4K',
  'UP_TO_1080P',
  'UP_TO_720P',
]);
export const AccountConnectionStateSchema = z.enum([
  'CONNECTED',
  'REAUTH_REQUIRED',
  'DISCONNECTED',
  'ERROR',
]);
export const OAuthFlowStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED', 'EXPIRED']);
export const SourceSyncStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'RETRY_WAIT',
  'COMPLETED',
  'FAILED',
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
export type AccountConnectionState = z.infer<typeof AccountConnectionStateSchema>;
export type OAuthFlowStatus = z.infer<typeof OAuthFlowStatusSchema>;
export type SourceSyncStatus = z.infer<typeof SourceSyncStatusSchema>;
export type SourceErrorCode = z.infer<typeof SourceErrorCodeSchema>;
