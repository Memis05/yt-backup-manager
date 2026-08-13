import { z } from 'zod';

import {
  BackupHealthSchema,
  BackupRunStatusSchema,
  CopyStatusSchema,
  DestinationAvailabilitySchema,
  DestinationTypeSchema,
  ScheduleFrequencySchema,
  ScheduleTaskStatusSchema,
  VerificationResultSchema,
  VerificationStrengthSchema,
} from './enums';

const EpochMillisecondsSchema = z.number().int().nonnegative();
const NullableEpochMillisecondsSchema = EpochMillisecondsSchema.nullable();
const UuidSchema = z.string().uuid();
const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const ScheduleDtoSchema = z
  .object({
    id: UuidSchema,
    channelId: UuidSchema.nullable(),
    channelTitle: z.string().nullable(),
    enabled: z.boolean(),
    frequency: ScheduleFrequencySchema,
    localTime: LocalTimeSchema,
    weekday: z.number().int().min(0).max(6).nullable(),
    everyHours: z.number().int().min(1).max(168).nullable(),
    catchUp: z.boolean(),
    backupOnStartup: z.boolean(),
    timezone: z.string().min(1).max(200),
    taskStatus: ScheduleTaskStatusSchema,
    lastErrorSafe: z.string().max(500).nullable(),
    lastTriggeredAt: NullableEpochMillisecondsSchema,
    nextExpectedAt: NullableEpochMillisecondsSchema,
    createdAt: EpochMillisecondsSchema,
    updatedAt: EpochMillisecondsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.frequency === 'WEEKLY' && value.weekday === null) {
      context.addIssue({ code: 'custom', path: ['weekday'], message: 'Weekday is required.' });
    }
    if (value.frequency === 'EVERY_N_HOURS' && value.everyHours === null) {
      context.addIssue({ code: 'custom', path: ['everyHours'], message: 'Interval is required.' });
    }
  });

export const ScheduleUpsertSchema = z
  .object({
    id: UuidSchema.nullable(),
    channelId: UuidSchema.nullable(),
    enabled: z.boolean(),
    frequency: ScheduleFrequencySchema,
    localTime: LocalTimeSchema,
    weekday: z.number().int().min(0).max(6).nullable(),
    everyHours: z.number().int().min(1).max(168).nullable(),
    catchUp: z.boolean(),
    backupOnStartup: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.frequency === 'WEEKLY' && value.weekday === null) {
      context.addIssue({ code: 'custom', path: ['weekday'], message: 'Weekday is required.' });
    }
    if (value.frequency === 'EVERY_N_HOURS' && value.everyHours === null) {
      context.addIssue({ code: 'custom', path: ['everyHours'], message: 'Interval is required.' });
    }
  });

export const SchedulesListResultSchema = z
  .object({ schedules: z.array(ScheduleDtoSchema) })
  .strict();

export const ScheduleTriggerResultSchema = z
  .object({
    accepted: z.boolean(),
    deduplicated: z.boolean(),
    logicalTriggerAt: EpochMillisecondsSchema,
    runIds: z.array(UuidSchema),
    safeMessage: z.string().max(500).nullable(),
  })
  .strict();

export const IntegrityScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('COPY'), id: UuidSchema }).strict(),
  z.object({ kind: z.literal('MEDIA'), id: UuidSchema }).strict(),
  z.object({ kind: z.literal('CHANNEL'), id: UuidSchema }).strict(),
  z.object({ kind: z.literal('DESTINATION'), id: UuidSchema }).strict(),
  z.object({ kind: z.literal('ALL') }).strict(),
]);

export const IntegrityStartRequestSchema = z
  .object({
    scope: IntegrityScopeSchema,
    driveMode: z.enum(['PROVIDER_METADATA_SIZE', 'DOWNLOADED_SHA256']),
  })
  .strict();

export const IntegrityStartResultSchema = z
  .object({
    runId: UuidSchema,
    plannedChecks: z.number().int().nonnegative(),
  })
  .strict();

export const IntegrityCheckDtoSchema = z
  .object({
    id: UuidSchema,
    runId: UuidSchema.nullable(),
    jobId: UuidSchema.nullable(),
    mediaCopyId: UuidSchema,
    mediaItemId: UuidSchema,
    mediaTitle: z.string(),
    destinationId: UuidSchema,
    destinationType: DestinationTypeSchema,
    verificationStrength: VerificationStrengthSchema,
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    actualSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    expectedBytes: z.number().int().nonnegative().nullable(),
    actualBytes: z.number().int().nonnegative().nullable(),
    result: z.union([z.literal('PENDING'), VerificationResultSchema]),
    startedAt: EpochMillisecondsSchema,
    completedAt: NullableEpochMillisecondsSchema,
    safeMessage: z.string().max(500).nullable(),
  })
  .strict();

export const RepairSourceCandidateSchema = z
  .object({
    copyId: UuidSchema,
    destinationId: UuidSchema,
    destinationType: DestinationTypeSchema,
    verificationStrength: VerificationStrengthSchema.nullable(),
    preferred: z.boolean(),
  })
  .strict();

export const IntegrityIssueDtoSchema = z
  .object({
    copyId: UuidSchema,
    mediaItemId: UuidSchema,
    mediaTitle: z.string(),
    channelId: UuidSchema,
    channelTitle: z.string(),
    destinationId: UuidSchema,
    destinationType: DestinationTypeSchema,
    copyStatus: CopyStatusSchema,
    destinationAvailability: DestinationAvailabilitySchema,
    health: BackupHealthSchema,
    lastCheckedAt: NullableEpochMillisecondsSchema,
    safeMessage: z.string().max(500),
    repairSources: z.array(RepairSourceCandidateSchema),
    youtubeFallbackAvailable: z.boolean(),
  })
  .strict();

export const BackupHealthSummarySchema = z
  .object({
    complete: z.number().int().nonnegative(),
    partial: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    corrupt: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
    authRequired: z.number().int().nonnegative(),
  })
  .strict();

export const MediaHealthDtoSchema = z
  .object({
    mediaItemId: UuidSchema,
    mediaTitle: z.string(),
    channelId: UuidSchema,
    channelTitle: z.string(),
    health: BackupHealthSchema,
    intendedCopyCount: z.number().int().nonnegative(),
    verifiedCopyCount: z.number().int().nonnegative(),
  })
  .strict();

export const ChannelHealthDtoSchema = z
  .object({
    channelId: UuidSchema,
    channelTitle: z.string(),
    health: BackupHealthSummarySchema,
  })
  .strict();

export const IntegrityOverviewSchema = z
  .object({
    health: BackupHealthSummarySchema,
    channels: z.array(ChannelHealthDtoSchema),
    media: z.array(MediaHealthDtoSchema),
    issues: z.array(IntegrityIssueDtoSchema),
    history: z.array(IntegrityCheckDtoSchema),
  })
  .strict();

export const RepairStartResultSchema = z
  .object({
    runId: UuidSchema,
    targetCopyId: UuidSchema,
    source: z.enum(['LOCAL', 'GOOGLE_DRIVE', 'YOUTUBE', 'ALREADY_HEALTHY']),
    status: BackupRunStatusSchema,
    plannedJobs: z.number().int().nonnegative(),
  })
  .strict();

export const NotificationCategorySchema = z.enum([
  'BACKUP_COMPLETED',
  'BACKUP_COMPLETED_WITH_ERRORS',
  'BACKUP_FAILED',
  'DESTINATION_DISCONNECTED',
  'DESTINATION_RECONNECTED',
  'DRIVE_AUTH_REQUIRED',
  'INTEGRITY_CORRUPT',
  'INTEGRITY_MISSING',
  'REPAIR_COMPLETED',
  'REPAIR_FAILED',
  'SCHEDULE_ERROR',
]);

export const InternalRouteSchema = z
  .object({
    section: z.enum(['dashboard', 'backup', 'queue', 'storage', 'integrity', 'settings']),
    entityId: UuidSchema.nullable(),
  })
  .strict();

export const NativeNotificationDtoSchema = z
  .object({
    id: UuidSchema,
    category: NotificationCategorySchema,
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(300),
    route: InternalRouteSchema,
    createdAt: EpochMillisecondsSchema,
  })
  .strict();

export const NotificationListResultSchema = z
  .object({ notifications: z.array(NativeNotificationDtoSchema).max(20) })
  .strict();

export type ScheduleDto = z.infer<typeof ScheduleDtoSchema>;
export type ScheduleUpsert = z.infer<typeof ScheduleUpsertSchema>;
export type ScheduleTriggerResult = z.infer<typeof ScheduleTriggerResultSchema>;
export type IntegrityScope = z.infer<typeof IntegrityScopeSchema>;
export type IntegrityStartRequest = z.infer<typeof IntegrityStartRequestSchema>;
export type IntegrityStartResult = z.infer<typeof IntegrityStartResultSchema>;
export type IntegrityCheckDto = z.infer<typeof IntegrityCheckDtoSchema>;
export type IntegrityIssueDto = z.infer<typeof IntegrityIssueDtoSchema>;
export type IntegrityOverview = z.infer<typeof IntegrityOverviewSchema>;
export type RepairStartResult = z.infer<typeof RepairStartResultSchema>;
export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;
export type InternalRoute = z.infer<typeof InternalRouteSchema>;
export type NativeNotificationDto = z.infer<typeof NativeNotificationDtoSchema>;
