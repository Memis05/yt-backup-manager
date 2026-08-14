import { z } from 'zod';

import {
  BackupErrorCodeSchema,
  BackupRunStatusSchema,
  BackupRunTriggerSchema,
  DestinationTypeSchema,
  JobStatusSchema,
  JobTypeSchema,
} from './enums';
import { BackupRunDtoSchema, JobControlActionSchema, RunControlActionSchema } from './backup-dtos';

const EpochMillisecondsSchema = z.number().int().nonnegative();
const NullableEpochMillisecondsSchema = EpochMillisecondsSchema.nullable();
const PageSchema = z.number().int().positive();
const PageSizeSchema = z.number().int().min(1).max(100);
const OperationIdSchema = z.string().min(1).max(160);

export const ActivityOperationStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'PAUSE_REQUESTED',
  'PAUSED',
  'RETRY_WAIT',
  'BLOCKED',
  'CANCEL_REQUESTED',
  'COMPLETED',
  'COMPLETED_WITH_ISSUES',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
]);

export const ActivityUserPhaseSchema = z.enum([
  'PREPARING',
  'DOWNLOADING',
  'PROCESSING_MEDIA',
  'CHECKING_DOWNLOAD',
  'COPYING_LOCAL',
  'VERIFYING_LOCAL',
  'UPLOADING_DRIVE',
  'VERIFYING_DRIVE',
  'DOWNLOADING_DRIVE',
  'VERIFYING_BACKUP',
  'REPAIRING_BACKUP',
  'FINALIZING',
  'WAITING',
]);

export const ActivityDestinationBranchSchema = z
  .object({
    destinationId: z.string().uuid(),
    destinationType: DestinationTypeSchema,
    label: z.string().min(1).max(1_024),
    status: ActivityOperationStatusSchema,
    completedSteps: z.number().int().nonnegative(),
    totalSteps: z.number().int().positive(),
    safeMessage: z.string().max(500).nullable(),
  })
  .strict();

export const ActivityOperationDtoSchema = z
  .object({
    id: OperationIdSchema,
    runId: z.string().uuid(),
    mediaItemId: z.string().uuid().nullable(),
    channelId: z.string().uuid(),
    channelTitle: z.string().min(1),
    title: z.string().min(1),
    triggerType: BackupRunTriggerSchema,
    status: ActivityOperationStatusSchema,
    phase: ActivityUserPhaseSchema,
    progressRatio: z.number().min(0).max(1).nullable(),
    completedSteps: z.number().int().nonnegative(),
    totalSteps: z.number().int().positive(),
    bytesProcessed: z.number().int().nonnegative(),
    bytesTotal: z.number().int().nonnegative().nullable(),
    speedBytesPerSec: z.number().int().nonnegative().nullable(),
    etaSeconds: z.number().int().nonnegative().nullable(),
    nextRetryAt: NullableEpochMillisecondsSchema,
    safeMessage: z.string().max(500).nullable(),
    issueCount: z.number().int().nonnegative(),
    destinationBranches: z.array(ActivityDestinationBranchSchema),
    availableActions: z.array(RunControlActionSchema),
    sourceJobIds: z.array(z.string().uuid()),
    createdAt: EpochMillisecondsSchema,
    updatedAt: EpochMillisecondsSchema,
  })
  .strict();

export const ActivityOperationsQuerySchema = z
  .object({ page: PageSchema, pageSize: PageSizeSchema })
  .strict();

export const ActivityOperationsPageSchema = z
  .object({
    operations: z.array(ActivityOperationDtoSchema),
    page: PageSchema,
    pageSize: PageSizeSchema,
    totalItems: z.number().int().nonnegative(),
    activeCount: z.number().int().nonnegative(),
    pausedCount: z.number().int().nonnegative(),
    retryingCount: z.number().int().nonnegative(),
    attentionCount: z.number().int().nonnegative(),
  })
  .strict();

export const ActivityTechnicalJobDtoSchema = z
  .object({
    id: z.string().uuid(),
    jobType: JobTypeSchema,
    status: JobStatusSchema,
    destinationId: z.string().uuid().nullable(),
    destinationLabel: z.string().max(1_024).nullable(),
    priority: z.number().int(),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    progressRatio: z.number().min(0).max(1).nullable(),
    bytesProcessed: z.number().int().nonnegative(),
    bytesTotal: z.number().int().nonnegative().nullable(),
    errorCode: BackupErrorCodeSchema.nullable(),
    safeMessage: z.string().max(500).nullable(),
    nextRetryAt: NullableEpochMillisecondsSchema,
    dependsOnJobIds: z.array(z.string().uuid()),
    availableActions: z.array(JobControlActionSchema),
    createdAt: EpochMillisecondsSchema,
    updatedAt: EpochMillisecondsSchema,
  })
  .strict();

export const ActivityOperationDetailsQuerySchema = z
  .object({ operationId: OperationIdSchema, page: PageSchema, pageSize: PageSizeSchema })
  .strict();

export const ActivityOperationDetailsSchema = z
  .object({
    operation: ActivityOperationDtoSchema,
    run: BackupRunDtoSchema,
    technicalJobs: z.array(ActivityTechnicalJobDtoSchema),
    page: PageSchema,
    pageSize: PageSizeSchema,
    totalJobs: z.number().int().nonnegative(),
  })
  .strict();

export const ActivityOperationControlSchema = z
  .object({ operationId: OperationIdSchema, action: RunControlActionSchema })
  .strict();

export const BackupRunHistoryQuerySchema = z
  .object({
    page: PageSchema,
    pageSize: PageSizeSchema,
    status: BackupRunStatusSchema.nullable(),
    triggerType: BackupRunTriggerSchema.nullable(),
    channelId: z.string().uuid().nullable(),
    destinationId: z.string().uuid().nullable(),
    from: NullableEpochMillisecondsSchema,
    to: NullableEpochMillisecondsSchema,
  })
  .strict();

export const BackupRunHistoryPageSchema = z
  .object({
    runs: z.array(BackupRunDtoSchema),
    page: PageSchema,
    pageSize: PageSizeSchema,
    totalItems: z.number().int().nonnegative(),
  })
  .strict();

export const ActivityRunDetailsQuerySchema = z
  .object({ runId: z.string().uuid(), page: PageSchema, pageSize: PageSizeSchema })
  .strict();

export const ActivityRunDetailsSchema = z
  .object({
    run: BackupRunDtoSchema,
    technicalJobs: z.array(ActivityTechnicalJobDtoSchema),
    page: PageSchema,
    pageSize: PageSizeSchema,
    totalJobs: z.number().int().nonnegative(),
  })
  .strict();

export const ActivityLogCategorySchema = z.enum([
  'ALL',
  'BACKUPS',
  'ARCHIVE_CHANGES',
  'DESTINATIONS',
  'INTEGRITY',
  'REPAIRS',
  'SCHEDULES',
]);

export const ActivityLogQuerySchema = z
  .object({
    page: PageSchema,
    pageSize: PageSizeSchema,
    category: ActivityLogCategorySchema,
    channelId: z.string().uuid().nullable(),
    mediaItemId: z.string().uuid().nullable(),
    destinationId: z.string().uuid().nullable(),
    from: NullableEpochMillisecondsSchema,
    to: NullableEpochMillisecondsSchema,
  })
  .strict();

export const ActivityLogEventDtoSchema = z
  .object({
    id: z.string().uuid(),
    category: ActivityLogCategorySchema.exclude(['ALL']),
    severity: z.enum(['INFO', 'WARNING', 'ERROR']),
    title: z.string().min(1).max(160),
    summary: z.string().min(1).max(500),
    accountId: z.string().uuid().nullable(),
    channelId: z.string().uuid().nullable(),
    channelTitle: z.string().max(300).nullable(),
    mediaItemId: z.string().uuid().nullable(),
    mediaTitle: z.string().max(500).nullable(),
    destinationId: z.string().uuid().nullable(),
    destinationLabel: z.string().max(1_024).nullable(),
    runId: z.string().uuid().nullable(),
    createdAt: EpochMillisecondsSchema,
  })
  .strict();

export const ActivityLogPageSchema = z
  .object({
    events: z.array(ActivityLogEventDtoSchema),
    page: PageSchema,
    pageSize: PageSizeSchema,
    totalItems: z.number().int().nonnegative(),
  })
  .strict();

export const ActivityResolutionRouteSchema = z.discriminatedUnion('area', [
  z
    .object({
      area: z.literal('activity'),
      view: z.enum(['active', 'history']),
      entityId: z.string(),
    })
    .strict(),
  z.object({ area: z.literal('storage'), destinationId: z.string().uuid() }).strict(),
  z.object({ area: z.literal('integrity'), copyId: z.string().uuid() }).strict(),
  z.object({ area: z.literal('settings'), category: z.enum(['accounts', 'scheduling']) }).strict(),
]);

export const ActivityAttentionIssueDtoSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(['OPERATION', 'DESTINATION', 'AUTHORIZATION', 'INTEGRITY', 'SCHEDULE']),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(500),
    count: z.number().int().positive(),
    createdAt: EpochMillisecondsSchema,
    resolutionLabel: z.string().min(1).max(80),
    resolutionRoute: ActivityResolutionRouteSchema,
  })
  .strict();

export const ActivityAttentionQuerySchema = z
  .object({ page: PageSchema, pageSize: PageSizeSchema })
  .strict();

export const ActivityAttentionPageSchema = z
  .object({
    issues: z.array(ActivityAttentionIssueDtoSchema),
    page: PageSchema,
    pageSize: PageSizeSchema,
    totalItems: z.number().int().nonnegative(),
  })
  .strict();

export const ActivityEntityResolutionSchema = z
  .object({
    found: z.boolean(),
    view: z.enum(['active', 'history', 'attention']).nullable(),
    entityId: z.string().nullable(),
  })
  .strict();

export type ActivityOperationStatus = z.infer<typeof ActivityOperationStatusSchema>;
export type ActivityUserPhase = z.infer<typeof ActivityUserPhaseSchema>;
export type ActivityDestinationBranch = z.infer<typeof ActivityDestinationBranchSchema>;
export type ActivityOperationDto = z.infer<typeof ActivityOperationDtoSchema>;
export type ActivityOperationsQuery = z.infer<typeof ActivityOperationsQuerySchema>;
export type ActivityOperationsPage = z.infer<typeof ActivityOperationsPageSchema>;
export type ActivityTechnicalJobDto = z.infer<typeof ActivityTechnicalJobDtoSchema>;
export type ActivityOperationDetailsQuery = z.infer<typeof ActivityOperationDetailsQuerySchema>;
export type ActivityOperationDetails = z.infer<typeof ActivityOperationDetailsSchema>;
export type ActivityOperationControl = z.infer<typeof ActivityOperationControlSchema>;
export type BackupRunHistoryQuery = z.infer<typeof BackupRunHistoryQuerySchema>;
export type BackupRunHistoryPage = z.infer<typeof BackupRunHistoryPageSchema>;
export type ActivityRunDetailsQuery = z.infer<typeof ActivityRunDetailsQuerySchema>;
export type ActivityRunDetails = z.infer<typeof ActivityRunDetailsSchema>;
export type ActivityLogCategory = z.infer<typeof ActivityLogCategorySchema>;
export type ActivityLogQuery = z.infer<typeof ActivityLogQuerySchema>;
export type ActivityLogEventDto = z.infer<typeof ActivityLogEventDtoSchema>;
export type ActivityLogPage = z.infer<typeof ActivityLogPageSchema>;
export type ActivityAttentionIssueDto = z.infer<typeof ActivityAttentionIssueDtoSchema>;
export type ActivityAttentionQuery = z.infer<typeof ActivityAttentionQuerySchema>;
export type ActivityAttentionPage = z.infer<typeof ActivityAttentionPageSchema>;
export type ActivityEntityResolution = z.infer<typeof ActivityEntityResolutionSchema>;
