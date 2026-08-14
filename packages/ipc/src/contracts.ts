import {
  ActivityAttentionPageSchema,
  ActivityAttentionQuerySchema,
  ActivityEntityResolutionSchema,
  ActivityLogPageSchema,
  ActivityLogQuerySchema,
  ActivityOperationControlSchema,
  ActivityOperationDetailsQuerySchema,
  ActivityOperationDetailsSchema,
  ActivityOperationsPageSchema,
  ActivityOperationsQuerySchema,
  ActivityRunDetailsQuerySchema,
  ActivityRunDetailsSchema,
  AccountDtoSchema,
  AccountsListResultSchema,
  AppSettingsSchema,
  ApplicationInfoSchema,
  CatalogQuerySchema,
  ChannelDtoSchema,
  ChannelBackupSettingsDtoSchema,
  ChannelBackupSettingsPatchSchema,
  ChannelQualityChangeApplySchema,
  ChannelQualityChangePreviewSchema,
  ChannelQualityChangeRequestSchema,
  ChannelQualityChangeResultSchema,
  ChannelsListResultSchema,
  DatabaseHealthSchema,
  DashboardSummarySchema,
  FoundationStatusSchema,
  BackupRunsListResultSchema,
  BackupRunHistoryPageSchema,
  BackupRunHistoryQuerySchema,
  BackupStartResultSchema,
  DestinationsListResultSchema,
  DestinationDtoSchema,
  JobControlActionSchema,
  LibraryQueryResultSchema,
  MediaBackupDetailsSchema,
  OAuthBeginResultSchema,
  OAuthBeginWorkerResultSchema,
  OAuthFlowDtoSchema,
  GoogleOAuthCapabilitySchema,
  OpenVerifiedCopyFolderResultSchema,
  PlaylistMembersQuerySchema,
  PlaylistMembersResultSchema,
  PlaylistQueryResultSchema,
  PlaylistQuerySchema,
  RendererSettingsPatchSchema,
  QueueJobDtoSchema,
  QueueQuerySchema,
  QueueSnapshotSchema,
  ResolveVerifiedCopyFolderResultSchema,
  ResolveGoogleDriveObjectResultSchema,
  RecoverySessionDtoSchema,
  OpenGoogleDriveObjectResultSchema,
  RunControlActionSchema,
  SettingsPatchSchema,
  SourceSyncJobDtoSchema,
  WorkerHealthSchema,
  ToolDiagnosticsSchema,
  IntegrityOverviewSchema,
  IntegrityStartRequestSchema,
  IntegrityStartResultSchema,
  NotificationListResultSchema,
  RepairStartResultSchema,
  ScheduleDtoSchema,
  SchedulesListResultSchema,
  ScheduleTriggerResultSchema,
  ScheduleUpsertSchema,
} from '@ytbm/core';
import { z } from 'zod';

const EmptyParamsSchema = z.object({}).strict();

/**
 * Increment whenever the current desktop cannot safely use an already-running older worker.
 * This includes additive methods that the current desktop requires, not only changed results.
 *
 * Version 2 adds the Phase 7B.5 Activity RPC surface.
 */
export const WORKER_RPC_PROTOCOL_VERSION = 2;

export const WorkerRpcProtocolSchema = z
  .object({ version: z.number().int().nonnegative() })
  .strict();

export const WorkerRpcContracts = {
  'worker.health': {
    params: EmptyParamsSchema,
    result: WorkerHealthSchema,
  },
  'worker.protocol': {
    params: EmptyParamsSchema,
    result: WorkerRpcProtocolSchema,
  },
  'worker.scheduledWake': {
    params: z
      .object({ scheduleId: z.string().uuid(), requestedAt: z.string().datetime() })
      .strict(),
    result: ScheduleTriggerResultSchema,
  },
  'worker.scheduledIntegrityWake': {
    params: z
      .object({ scheduleId: z.string().uuid(), requestedAt: z.string().datetime() })
      .strict(),
    result: IntegrityStartResultSchema.nullable(),
  },
  'worker.shutdownIfIdle': {
    params: EmptyParamsSchema,
    result: z.object({ accepted: z.boolean() }).strict(),
  },
  'worker.shutdownWhenIdle': {
    params: EmptyParamsSchema,
    result: z.object({ accepted: z.literal(true) }).strict(),
  },
  'app.info': {
    params: EmptyParamsSchema,
    result: ApplicationInfoSchema,
  },
  'database.health': {
    params: EmptyParamsSchema,
    result: DatabaseHealthSchema,
  },
  'settings.get': {
    params: EmptyParamsSchema,
    result: AppSettingsSchema,
  },
  'settings.update': {
    params: SettingsPatchSchema,
    result: AppSettingsSchema,
  },
  'schedules.list': {
    params: EmptyParamsSchema,
    result: SchedulesListResultSchema,
  },
  'schedules.upsert': {
    params: ScheduleUpsertSchema,
    result: ScheduleDtoSchema,
  },
  'schedules.remove': {
    params: z.object({ scheduleId: z.string().uuid() }).strict(),
    result: z.object({ removed: z.literal(true) }).strict(),
  },
  'schedules.triggerStartup': {
    params: z.object({ requestedAt: z.string().datetime() }).strict(),
    result: z.object({ results: z.array(ScheduleTriggerResultSchema) }).strict(),
  },
  'accounts.oauthBegin': {
    params: z
      .object({
        accountId: z.string().uuid().nullable(),
        capability: GoogleOAuthCapabilitySchema,
      })
      .strict(),
    result: OAuthBeginWorkerResultSchema,
  },
  'accounts.oauthConfigure': {
    params: z
      .object({
        clientId: z.string().min(1).max(300).nullable(),
        clientSecret: z.string().min(1).max(300).nullable(),
      })
      .strict(),
    result: z.object({ configured: z.boolean() }).strict(),
  },
  'accounts.oauthStatus': {
    params: z.object({ flowId: z.string().uuid() }).strict(),
    result: OAuthFlowDtoSchema,
  },
  'accounts.list': {
    params: EmptyParamsSchema,
    result: AccountsListResultSchema,
  },
  'accounts.disconnect': {
    params: z.object({ accountId: z.string().uuid() }).strict(),
    result: AccountDtoSchema,
  },
  'channels.discover': {
    params: z.object({ accountId: z.string().uuid() }).strict(),
    result: ChannelsListResultSchema,
  },
  'channels.list': {
    params: z
      .object({ accountId: z.string().uuid().nullable(), selectedOnly: z.boolean() })
      .strict(),
    result: ChannelsListResultSchema,
  },
  'channels.setEnabled': {
    params: z.object({ channelId: z.string().uuid(), enabled: z.boolean() }).strict(),
    result: ChannelDtoSchema,
  },
  'sync.start': {
    params: z.object({ channelId: z.string().uuid() }).strict(),
    result: SourceSyncJobDtoSchema,
  },
  'sync.status': {
    params: z.object({ syncId: z.string().uuid() }).strict(),
    result: SourceSyncJobDtoSchema,
  },
  'library.query': {
    params: CatalogQuerySchema,
    result: LibraryQueryResultSchema,
  },
  'playlists.query': {
    params: PlaylistQuerySchema,
    result: PlaylistQueryResultSchema,
  },
  'playlists.members': {
    params: PlaylistMembersQuerySchema,
    result: PlaylistMembersResultSchema,
  },
  'destinations.addFilesystem': {
    params: z.object({ rootPath: z.string().trim().min(1).max(1_024) }).strict(),
    result: DestinationDtoSchema,
  },
  'destinations.addGoogleDrive': {
    params: z.object({ accountId: z.string().uuid() }).strict(),
    result: DestinationDtoSchema,
  },
  'destinations.list': {
    params: EmptyParamsSchema,
    result: DestinationsListResultSchema,
  },
  'destinations.disable': {
    params: z.object({ destinationId: z.string().uuid() }).strict(),
    result: z.object({ disabled: z.literal(true) }).strict(),
  },
  'backup.channelSettings': {
    params: z.object({ channelId: z.string().uuid() }).strict(),
    result: ChannelBackupSettingsDtoSchema,
  },
  'backup.updateChannelSettings': {
    params: ChannelBackupSettingsPatchSchema,
    result: ChannelBackupSettingsDtoSchema,
  },
  'backup.previewQualityChange': {
    params: ChannelQualityChangeRequestSchema,
    result: ChannelQualityChangePreviewSchema,
  },
  'backup.applyQualityChange': {
    params: ChannelQualityChangeApplySchema,
    result: ChannelQualityChangeResultSchema,
  },
  'backup.start': {
    params: z.object({ channelId: z.string().uuid() }).strict(),
    result: BackupStartResultSchema,
  },
  'backup.runs': {
    params: EmptyParamsSchema,
    result: BackupRunsListResultSchema,
  },
  'backup.controlRun': {
    params: z.object({ runId: z.string().uuid(), action: RunControlActionSchema }).strict(),
    result: z.object({ accepted: z.literal(true) }).strict(),
  },
  'activity.operations': {
    params: ActivityOperationsQuerySchema,
    result: ActivityOperationsPageSchema,
  },
  'activity.operationDetails': {
    params: ActivityOperationDetailsQuerySchema,
    result: ActivityOperationDetailsSchema,
  },
  'activity.controlOperation': {
    params: ActivityOperationControlSchema,
    result: z.object({ accepted: z.literal(true) }).strict(),
  },
  'activity.runHistory': {
    params: BackupRunHistoryQuerySchema,
    result: BackupRunHistoryPageSchema,
  },
  'activity.runDetails': {
    params: ActivityRunDetailsQuerySchema,
    result: ActivityRunDetailsSchema,
  },
  'activity.log': {
    params: ActivityLogQuerySchema,
    result: ActivityLogPageSchema,
  },
  'activity.attention': {
    params: ActivityAttentionQuerySchema,
    result: ActivityAttentionPageSchema,
  },
  'activity.resolveEntity': {
    params: z.object({ entityId: z.string().min(1).max(200) }).strict(),
    result: ActivityEntityResolutionSchema,
  },
  'jobs.snapshot': {
    params: QueueQuerySchema,
    result: QueueSnapshotSchema,
  },
  'jobs.control': {
    params: z.object({ jobId: z.string().uuid(), action: JobControlActionSchema }).strict(),
    result: QueueJobDtoSchema,
  },
  'media.backupDetails': {
    params: z.object({ mediaItemId: z.string().uuid() }).strict(),
    result: MediaBackupDetailsSchema,
  },
  'media.resolveVerifiedFolder': {
    params: z.object({ mediaCopyId: z.string().uuid() }).strict(),
    result: ResolveVerifiedCopyFolderResultSchema,
  },
  'storage.resolveGoogleDriveObject': {
    params: z
      .object({
        mediaCopyId: z.string().uuid().nullable(),
        destinationId: z.string().uuid().nullable(),
      })
      .strict()
      .refine((value) => (value.mediaCopyId === null) !== (value.destinationId === null)),
    result: ResolveGoogleDriveObjectResultSchema,
  },
  'dashboard.summary': {
    params: EmptyParamsSchema,
    result: DashboardSummarySchema,
  },
  'integrity.start': {
    params: IntegrityStartRequestSchema,
    result: IntegrityStartResultSchema,
  },
  'integrity.overview': {
    params: EmptyParamsSchema,
    result: IntegrityOverviewSchema,
  },
  'repair.start': {
    params: z.object({ copyId: z.string().uuid(), allowYoutubeFallback: z.boolean() }).strict(),
    result: RepairStartResultSchema,
  },
  'notifications.pending': {
    params: EmptyParamsSchema,
    result: NotificationListResultSchema,
  },
  'notifications.ack': {
    params: z.object({ notificationIds: z.array(z.string().uuid()).max(20) }).strict(),
    result: z.object({ acknowledged: z.number().int().nonnegative() }).strict(),
  },
  'tools.diagnostics': {
    params: EmptyParamsSchema,
    result: ToolDiagnosticsSchema,
  },
  'recovery.create': {
    params: EmptyParamsSchema,
    result: RecoverySessionDtoSchema,
  },
  'recovery.latest': {
    params: EmptyParamsSchema,
    result: RecoverySessionDtoSchema.nullable(),
  },
  'recovery.get': {
    params: z.object({ sessionId: z.string().uuid() }).strict(),
    result: RecoverySessionDtoSchema,
  },
  'recovery.addLocalSource': {
    params: z
      .object({ sessionId: z.string().uuid(), rootPath: z.string().trim().min(1).max(1_024) })
      .strict(),
    result: RecoverySessionDtoSchema,
  },
  'recovery.addDriveSource': {
    params: z.object({ sessionId: z.string().uuid(), accountId: z.string().uuid() }).strict(),
    result: RecoverySessionDtoSchema,
  },
  'recovery.setDriveRootSelected': {
    params: z
      .object({
        sessionId: z.string().uuid(),
        sourceId: z.string().uuid(),
        providerRootId: z.string().min(3).max(500),
        selected: z.boolean(),
      })
      .strict(),
    result: RecoverySessionDtoSchema,
  },
  'recovery.scan': {
    params: z.object({ sessionId: z.string().uuid() }).strict(),
    result: RecoverySessionDtoSchema,
  },
  'recovery.import': {
    params: z.object({ sessionId: z.string().uuid() }).strict(),
    result: RecoverySessionDtoSchema,
  },
  'recovery.cancel': {
    params: z.object({ sessionId: z.string().uuid() }).strict(),
    result: RecoverySessionDtoSchema,
  },
} as const;

export type WorkerRpcMethod = keyof typeof WorkerRpcContracts;
export type WorkerRpcParams<Method extends WorkerRpcMethod> = z.input<
  (typeof WorkerRpcContracts)[Method]['params']
>;
export type WorkerRpcParsedParams<Method extends WorkerRpcMethod> = z.output<
  (typeof WorkerRpcContracts)[Method]['params']
>;
export type WorkerRpcResult<Method extends WorkerRpcMethod> = z.output<
  (typeof WorkerRpcContracts)[Method]['result']
>;

export const RPC_ERROR_CODES = [
  'INVALID_REQUEST',
  'METHOD_NOT_FOUND',
  'UNAUTHORIZED',
  'INTERNAL_ERROR',
  'CONNECTION_ERROR',
  'TIMEOUT',
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export class RpcProtocolError extends Error {
  public constructor(
    public readonly code: RpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RpcProtocolError';
  }
}

const RpcRequestEnvelopeSchema = z
  .object({
    id: z.string().uuid(),
    authToken: z.string().min(1).max(256),
    method: z.string().min(1).max(100),
    params: z.unknown(),
  })
  .strict();

export interface ParsedWorkerRpcRequest<Method extends WorkerRpcMethod = WorkerRpcMethod> {
  id: string;
  authToken: string;
  method: Method;
  params: WorkerRpcParsedParams<Method>;
}

export function isWorkerRpcMethod(value: string): value is WorkerRpcMethod {
  return Object.hasOwn(WorkerRpcContracts, value);
}

export function parseWorkerRpcRequest(input: unknown): ParsedWorkerRpcRequest {
  const envelopeResult = RpcRequestEnvelopeSchema.safeParse(input);
  if (!envelopeResult.success) {
    throw new RpcProtocolError('INVALID_REQUEST', 'Worker RPC request is invalid');
  }

  const envelope = envelopeResult.data;
  if (!isWorkerRpcMethod(envelope.method)) {
    throw new RpcProtocolError('METHOD_NOT_FOUND', 'Worker RPC method is not allowed');
  }

  const contract = WorkerRpcContracts[envelope.method];
  const paramsResult = contract.params.safeParse(envelope.params);
  if (!paramsResult.success) {
    throw new RpcProtocolError('INVALID_REQUEST', 'Worker RPC parameters are invalid');
  }

  return {
    id: envelope.id,
    authToken: envelope.authToken,
    method: envelope.method,
    params: paramsResult.data,
  } as ParsedWorkerRpcRequest;
}

export const RpcResponseEnvelopeSchema = z.discriminatedUnion('ok', [
  z
    .object({
      id: z.string().uuid(),
      ok: z.literal(true),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      ok: z.literal(false),
      error: z
        .object({
          code: z.enum(RPC_ERROR_CODES),
          message: z.string().min(1).max(500),
        })
        .strict(),
    })
    .strict(),
]);

export type RpcResponseEnvelope = z.infer<typeof RpcResponseEnvelopeSchema>;

export const DESKTOP_IPC_CHANNELS = {
  foundationStatus: 'ytbm:foundation-status',
  updateSettings: 'ytbm:settings-update',
  openLogFolder: 'ytbm:logs-open',
  beginGoogleOAuth: 'ytbm:accounts-oauth-begin',
  oauthStatus: 'ytbm:accounts-oauth-status',
  accountsList: 'ytbm:accounts-list',
  disconnectAccount: 'ytbm:accounts-disconnect',
  discoverChannels: 'ytbm:channels-discover',
  channelsList: 'ytbm:channels-list',
  setChannelEnabled: 'ytbm:channels-enabled',
  startSync: 'ytbm:sync-start',
  syncStatus: 'ytbm:sync-status',
  libraryQuery: 'ytbm:library-query',
  playlistsQuery: 'ytbm:playlists-query',
  playlistMembers: 'ytbm:playlists-members',
  chooseFilesystemDestination: 'ytbm:destinations-choose-filesystem',
  addGoogleDriveDestination: 'ytbm:destinations-add-google-drive',
  destinationsList: 'ytbm:destinations-list',
  disableDestination: 'ytbm:destinations-disable',
  channelBackupSettings: 'ytbm:backup-channel-settings',
  updateChannelBackupSettings: 'ytbm:backup-update-channel-settings',
  previewChannelQualityChange: 'ytbm:backup-preview-quality-change',
  applyChannelQualityChange: 'ytbm:backup-apply-quality-change',
  startBackup: 'ytbm:backup-start',
  backupRuns: 'ytbm:backup-runs',
  controlBackupRun: 'ytbm:backup-control-run',
  activityOperations: 'ytbm:activity-operations',
  activityOperationDetails: 'ytbm:activity-operation-details',
  controlActivityOperation: 'ytbm:activity-control-operation',
  activityRunHistory: 'ytbm:activity-run-history',
  activityRunDetails: 'ytbm:activity-run-details',
  activityLog: 'ytbm:activity-log',
  activityAttention: 'ytbm:activity-attention',
  activityResolveEntity: 'ytbm:activity-resolve-entity',
  queueSnapshot: 'ytbm:queue-snapshot',
  controlJob: 'ytbm:jobs-control',
  mediaBackupDetails: 'ytbm:media-backup-details',
  openVerifiedCopyFolder: 'ytbm:media-open-verified-folder',
  openGoogleDriveObject: 'ytbm:storage-open-google-drive-object',
  dashboardSummary: 'ytbm:dashboard-summary',
  toolDiagnostics: 'ytbm:tools-diagnostics',
  recoveryCreate: 'ytbm:recovery-create',
  recoveryLatest: 'ytbm:recovery-latest',
  recoveryGet: 'ytbm:recovery-get',
  chooseRecoveryLocalSource: 'ytbm:recovery-choose-local-source',
  addRecoveryDriveSource: 'ytbm:recovery-add-drive-source',
  setRecoveryDriveRootSelected: 'ytbm:recovery-set-drive-root-selected',
  startRecoveryScan: 'ytbm:recovery-scan',
  startRecoveryImport: 'ytbm:recovery-import',
  cancelRecovery: 'ytbm:recovery-cancel',
  schedulesList: 'ytbm:schedules-list',
  upsertSchedule: 'ytbm:schedules-upsert',
  removeSchedule: 'ytbm:schedules-remove',
  integrityStart: 'ytbm:integrity-start',
  integrityOverview: 'ytbm:integrity-overview',
  repairStart: 'ytbm:repair-start',
} as const;

export type DesktopIpcChannel = (typeof DESKTOP_IPC_CHANNELS)[keyof typeof DESKTOP_IPC_CHANNELS];

const DesktopIpcContracts = {
  [DESKTOP_IPC_CHANNELS.foundationStatus]: {
    input: EmptyParamsSchema,
    output: FoundationStatusSchema,
  },
  [DESKTOP_IPC_CHANNELS.updateSettings]: {
    input: RendererSettingsPatchSchema,
    output: AppSettingsSchema,
  },
  [DESKTOP_IPC_CHANNELS.schedulesList]: {
    input: EmptyParamsSchema,
    output: SchedulesListResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.upsertSchedule]: {
    input: ScheduleUpsertSchema,
    output: ScheduleDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.removeSchedule]: {
    input: z.object({ scheduleId: z.string().uuid() }).strict(),
    output: z.object({ removed: z.literal(true) }).strict(),
  },
  [DESKTOP_IPC_CHANNELS.integrityStart]: {
    input: IntegrityStartRequestSchema,
    output: IntegrityStartResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.integrityOverview]: {
    input: EmptyParamsSchema,
    output: IntegrityOverviewSchema,
  },
  [DESKTOP_IPC_CHANNELS.repairStart]: {
    input: z.object({ copyId: z.string().uuid(), allowYoutubeFallback: z.boolean() }).strict(),
    output: RepairStartResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.openLogFolder]: {
    input: EmptyParamsSchema,
    output: z.object({ opened: z.literal(true) }).strict(),
  },
  [DESKTOP_IPC_CHANNELS.beginGoogleOAuth]: {
    input: z
      .object({
        accountId: z.string().uuid().nullable(),
        capability: GoogleOAuthCapabilitySchema,
      })
      .strict(),
    output: OAuthBeginResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.oauthStatus]: {
    input: z.object({ flowId: z.string().uuid() }).strict(),
    output: OAuthFlowDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.accountsList]: {
    input: EmptyParamsSchema,
    output: AccountsListResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.disconnectAccount]: {
    input: z.object({ accountId: z.string().uuid() }).strict(),
    output: AccountDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.discoverChannels]: {
    input: z.object({ accountId: z.string().uuid() }).strict(),
    output: ChannelsListResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.channelsList]: {
    input: z
      .object({ accountId: z.string().uuid().nullable(), selectedOnly: z.boolean() })
      .strict(),
    output: ChannelsListResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.setChannelEnabled]: {
    input: z.object({ channelId: z.string().uuid(), enabled: z.boolean() }).strict(),
    output: ChannelDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.startSync]: {
    input: z.object({ channelId: z.string().uuid() }).strict(),
    output: SourceSyncJobDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.syncStatus]: {
    input: z.object({ syncId: z.string().uuid() }).strict(),
    output: SourceSyncJobDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.libraryQuery]: {
    input: CatalogQuerySchema,
    output: LibraryQueryResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.playlistsQuery]: {
    input: PlaylistQuerySchema,
    output: PlaylistQueryResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.playlistMembers]: {
    input: PlaylistMembersQuerySchema,
    output: PlaylistMembersResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.chooseFilesystemDestination]: {
    input: EmptyParamsSchema,
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('ADDED'), destination: DestinationDtoSchema }).strict(),
      z.object({ status: z.literal('CANCELLED') }).strict(),
    ]),
  },
  [DESKTOP_IPC_CHANNELS.addGoogleDriveDestination]: {
    input: z.object({ accountId: z.string().uuid() }).strict(),
    output: DestinationDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.destinationsList]: {
    input: EmptyParamsSchema,
    output: DestinationsListResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.disableDestination]: {
    input: z.object({ destinationId: z.string().uuid() }).strict(),
    output: z.object({ disabled: z.literal(true) }).strict(),
  },
  [DESKTOP_IPC_CHANNELS.channelBackupSettings]: {
    input: z.object({ channelId: z.string().uuid() }).strict(),
    output: ChannelBackupSettingsDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.updateChannelBackupSettings]: {
    input: ChannelBackupSettingsPatchSchema,
    output: ChannelBackupSettingsDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.previewChannelQualityChange]: {
    input: ChannelQualityChangeRequestSchema,
    output: ChannelQualityChangePreviewSchema,
  },
  [DESKTOP_IPC_CHANNELS.applyChannelQualityChange]: {
    input: ChannelQualityChangeApplySchema,
    output: ChannelQualityChangeResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.startBackup]: {
    input: z.object({ channelId: z.string().uuid() }).strict(),
    output: BackupStartResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.backupRuns]: {
    input: EmptyParamsSchema,
    output: BackupRunsListResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.controlBackupRun]: {
    input: z.object({ runId: z.string().uuid(), action: RunControlActionSchema }).strict(),
    output: z.object({ accepted: z.literal(true) }).strict(),
  },
  [DESKTOP_IPC_CHANNELS.activityOperations]: {
    input: ActivityOperationsQuerySchema,
    output: ActivityOperationsPageSchema,
  },
  [DESKTOP_IPC_CHANNELS.activityOperationDetails]: {
    input: ActivityOperationDetailsQuerySchema,
    output: ActivityOperationDetailsSchema,
  },
  [DESKTOP_IPC_CHANNELS.controlActivityOperation]: {
    input: ActivityOperationControlSchema,
    output: z.object({ accepted: z.literal(true) }).strict(),
  },
  [DESKTOP_IPC_CHANNELS.activityRunHistory]: {
    input: BackupRunHistoryQuerySchema,
    output: BackupRunHistoryPageSchema,
  },
  [DESKTOP_IPC_CHANNELS.activityRunDetails]: {
    input: ActivityRunDetailsQuerySchema,
    output: ActivityRunDetailsSchema,
  },
  [DESKTOP_IPC_CHANNELS.activityLog]: {
    input: ActivityLogQuerySchema,
    output: ActivityLogPageSchema,
  },
  [DESKTOP_IPC_CHANNELS.activityAttention]: {
    input: ActivityAttentionQuerySchema,
    output: ActivityAttentionPageSchema,
  },
  [DESKTOP_IPC_CHANNELS.activityResolveEntity]: {
    input: z.object({ entityId: z.string().min(1).max(200) }).strict(),
    output: ActivityEntityResolutionSchema,
  },
  [DESKTOP_IPC_CHANNELS.queueSnapshot]: {
    input: QueueQuerySchema,
    output: QueueSnapshotSchema,
  },
  [DESKTOP_IPC_CHANNELS.controlJob]: {
    input: z.object({ jobId: z.string().uuid(), action: JobControlActionSchema }).strict(),
    output: QueueJobDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.mediaBackupDetails]: {
    input: z.object({ mediaItemId: z.string().uuid() }).strict(),
    output: MediaBackupDetailsSchema,
  },
  [DESKTOP_IPC_CHANNELS.openVerifiedCopyFolder]: {
    input: z.object({ mediaCopyId: z.string().uuid() }).strict(),
    output: OpenVerifiedCopyFolderResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.openGoogleDriveObject]: {
    input: z
      .object({
        mediaCopyId: z.string().uuid().nullable(),
        destinationId: z.string().uuid().nullable(),
      })
      .strict()
      .refine((value) => (value.mediaCopyId === null) !== (value.destinationId === null)),
    output: OpenGoogleDriveObjectResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.dashboardSummary]: {
    input: EmptyParamsSchema,
    output: DashboardSummarySchema,
  },
  [DESKTOP_IPC_CHANNELS.toolDiagnostics]: {
    input: EmptyParamsSchema,
    output: ToolDiagnosticsSchema,
  },
  [DESKTOP_IPC_CHANNELS.recoveryCreate]: {
    input: EmptyParamsSchema,
    output: RecoverySessionDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.recoveryLatest]: {
    input: EmptyParamsSchema,
    output: RecoverySessionDtoSchema.nullable(),
  },
  [DESKTOP_IPC_CHANNELS.recoveryGet]: {
    input: z.object({ sessionId: z.string().uuid() }).strict(),
    output: RecoverySessionDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.chooseRecoveryLocalSource]: {
    input: z.object({ sessionId: z.string().uuid() }).strict(),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('ADDED'), session: RecoverySessionDtoSchema }).strict(),
      z.object({ status: z.literal('CANCELLED') }).strict(),
    ]),
  },
  [DESKTOP_IPC_CHANNELS.addRecoveryDriveSource]: {
    input: z.object({ sessionId: z.string().uuid(), accountId: z.string().uuid() }).strict(),
    output: RecoverySessionDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.setRecoveryDriveRootSelected]: {
    input: z
      .object({
        sessionId: z.string().uuid(),
        sourceId: z.string().uuid(),
        providerRootId: z.string().min(3).max(500),
        selected: z.boolean(),
      })
      .strict(),
    output: RecoverySessionDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.startRecoveryScan]: {
    input: z.object({ sessionId: z.string().uuid() }).strict(),
    output: RecoverySessionDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.startRecoveryImport]: {
    input: z.object({ sessionId: z.string().uuid() }).strict(),
    output: RecoverySessionDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.cancelRecovery]: {
    input: z.object({ sessionId: z.string().uuid() }).strict(),
    output: RecoverySessionDtoSchema,
  },
} as const;

export function isDesktopIpcChannel(value: string): value is DesktopIpcChannel {
  return Object.hasOwn(DesktopIpcContracts, value);
}

export function parseDesktopIpcInput(channel: string, input: unknown): unknown {
  if (!isDesktopIpcChannel(channel)) {
    throw new RpcProtocolError('METHOD_NOT_FOUND', 'Desktop IPC channel is not allowed');
  }
  const parsed = DesktopIpcContracts[channel].input.safeParse(input);
  if (!parsed.success) {
    throw new RpcProtocolError('INVALID_REQUEST', 'Desktop IPC input is invalid');
  }
  return parsed.data;
}

export function parseDesktopIpcOutput(channel: DesktopIpcChannel, output: unknown): unknown {
  return DesktopIpcContracts[channel].output.parse(output);
}
