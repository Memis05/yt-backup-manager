import { contextBridge, ipcRenderer } from 'electron';

import {
  AccountDtoSchema,
  AccountsListResultSchema,
  AppSettingsSchema,
  BackupRunsListResultSchema,
  BackupStartResultSchema,
  CatalogQuerySchema,
  ChannelDtoSchema,
  ChannelBackupSettingsDtoSchema,
  ChannelBackupSettingsPatchSchema,
  ChannelsListResultSchema,
  DestinationsListResultSchema,
  DestinationDtoSchema,
  DashboardSummarySchema,
  FoundationStatusSchema,
  LibraryQueryResultSchema,
  MediaBackupDetailsSchema,
  OAuthBeginResultSchema,
  OAuthFlowDtoSchema,
  OpenGoogleDriveObjectResultSchema,
  OpenVerifiedCopyFolderResultSchema,
  PlaylistMembersQuerySchema,
  PlaylistMembersResultSchema,
  PlaylistQueryResultSchema,
  PlaylistQuerySchema,
  RendererSettingsPatchSchema,
  QueueJobDtoSchema,
  QueueQuerySchema,
  QueueSnapshotSchema,
  RecoverySessionDtoSchema,
  SourceSyncJobDtoSchema,
  ToolDiagnosticsSchema,
  type AccountDto,
  type AppSettings,
  type BackupRunDto,
  type BackupStartResult,
  type CatalogQuery,
  type ChannelDto,
  type ChannelBackupSettingsDto,
  type ChannelBackupSettingsPatch,
  type DestinationDto,
  type DashboardSummary,
  type FoundationStatus,
  type LibraryQueryResult,
  type MediaBackupDetails,
  type OAuthBeginResult,
  type OAuthFlowDto,
  type OpenGoogleDriveObjectResult,
  type OpenVerifiedCopyFolderResult,
  type PlaylistMembersQuery,
  type PlaylistMembersResult,
  type PlaylistQuery,
  type PlaylistQueryResult,
  type JobControlAction,
  type QueueJobDto,
  type QueueQuery,
  type QueueSnapshot,
  type RecoverySessionDto,
  type RunControlAction,
  type SourceSyncJobDto,
  type ToolDiagnostics,
  type GoogleOAuthCapability,
} from '@ytbm/core';
import { DESKTOP_IPC_CHANNELS } from '@ytbm/ipc/renderer';

export interface YouTubeBackupManagerApi {
  getFoundationStatus(): Promise<FoundationStatus>;
  updateStartMinimized(startMinimized: boolean): Promise<AppSettings>;
  updateDefaultQuality(
    defaultQualityProfile: AppSettings['defaultQualityProfile'],
  ): Promise<AppSettings>;
  openLogFolder(): Promise<void>;
  listAccounts(): Promise<AccountDto[]>;
  beginGoogleOAuth(
    accountId?: string | null,
    capability?: GoogleOAuthCapability,
  ): Promise<OAuthBeginResult>;
  getOAuthStatus(flowId: string): Promise<OAuthFlowDto>;
  disconnectAccount(accountId: string): Promise<AccountDto>;
  discoverChannels(accountId: string): Promise<ChannelDto[]>;
  listChannels(options?: {
    accountId?: string | null;
    selectedOnly?: boolean;
  }): Promise<ChannelDto[]>;
  setChannelEnabled(channelId: string, enabled: boolean): Promise<ChannelDto>;
  startChannelSync(channelId: string): Promise<SourceSyncJobDto>;
  getSyncStatus(syncId: string): Promise<SourceSyncJobDto>;
  queryLibrary(query: CatalogQuery): Promise<LibraryQueryResult>;
  queryPlaylists(query: PlaylistQuery): Promise<PlaylistQueryResult>;
  queryPlaylistMembers(query: PlaylistMembersQuery): Promise<PlaylistMembersResult>;
  addFilesystemDestination(): Promise<DestinationDto | null>;
  addGoogleDriveDestination(accountId: string): Promise<DestinationDto>;
  listDestinations(): Promise<DestinationDto[]>;
  disableDestination(destinationId: string): Promise<void>;
  getChannelBackupSettings(channelId: string): Promise<ChannelBackupSettingsDto>;
  updateChannelBackupSettings(input: ChannelBackupSettingsPatch): Promise<ChannelBackupSettingsDto>;
  startBackup(channelId: string): Promise<BackupStartResult>;
  listBackupRuns(): Promise<BackupRunDto[]>;
  controlBackupRun(runId: string, action: RunControlAction): Promise<void>;
  getQueueSnapshot(query: QueueQuery): Promise<QueueSnapshot>;
  controlJob(jobId: string, action: JobControlAction): Promise<QueueJobDto>;
  getMediaBackupDetails(mediaItemId: string): Promise<MediaBackupDetails>;
  openVerifiedCopyFolder(mediaCopyId: string): Promise<OpenVerifiedCopyFolderResult>;
  openGoogleDriveObject(input: {
    mediaCopyId?: string;
    destinationId?: string;
  }): Promise<OpenGoogleDriveObjectResult>;
  getDashboardSummary(): Promise<DashboardSummary>;
  getToolDiagnostics(): Promise<ToolDiagnostics>;
  createRecoverySession(): Promise<RecoverySessionDto>;
  getLatestRecoverySession(): Promise<RecoverySessionDto | null>;
  getRecoverySession(sessionId: string): Promise<RecoverySessionDto>;
  addRecoveryLocalSource(sessionId: string): Promise<RecoverySessionDto | null>;
  addRecoveryDriveSource(sessionId: string, accountId: string): Promise<RecoverySessionDto>;
  setRecoveryDriveRootSelected(input: {
    sessionId: string;
    sourceId: string;
    providerRootId: string;
    selected: boolean;
  }): Promise<RecoverySessionDto>;
  startRecoveryScan(sessionId: string): Promise<RecoverySessionDto>;
  startRecoveryImport(sessionId: string): Promise<RecoverySessionDto>;
  cancelRecovery(sessionId: string): Promise<RecoverySessionDto>;
}

const api: YouTubeBackupManagerApi = Object.freeze({
  async getFoundationStatus(): Promise<FoundationStatus> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.foundationStatus, {});
    return FoundationStatusSchema.parse(response);
  },
  async updateStartMinimized(startMinimized: boolean): Promise<AppSettings> {
    const input = RendererSettingsPatchSchema.parse({ startMinimized });
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateSettings, input);
    return AppSettingsSchema.parse(response);
  },
  async updateDefaultQuality(
    defaultQualityProfile: AppSettings['defaultQualityProfile'],
  ): Promise<AppSettings> {
    const input = RendererSettingsPatchSchema.parse({ defaultQualityProfile });
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateSettings, input);
    return AppSettingsSchema.parse(response);
  },
  async openLogFolder(): Promise<void> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.openLogFolder, {});
    if (response?.opened !== true)
      throw new Error('The application log folder could not be opened.');
  },
  async listAccounts(): Promise<AccountDto[]> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.accountsList, {});
    return AccountsListResultSchema.parse(response).accounts;
  },
  async beginGoogleOAuth(
    accountId: string | null = null,
    capability: GoogleOAuthCapability = 'YOUTUBE',
  ): Promise<OAuthBeginResult> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.beginGoogleOAuth, {
      accountId,
      capability,
    });
    return OAuthBeginResultSchema.parse(response);
  },
  async getOAuthStatus(flowId: string): Promise<OAuthFlowDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.oauthStatus, { flowId });
    return OAuthFlowDtoSchema.parse(response);
  },
  async disconnectAccount(accountId: string): Promise<AccountDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.disconnectAccount, {
      accountId,
    });
    return AccountDtoSchema.parse(response);
  },
  async discoverChannels(accountId: string): Promise<ChannelDto[]> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.discoverChannels, {
      accountId,
    });
    return ChannelsListResultSchema.parse(response).channels;
  },
  async listChannels(
    options: { accountId?: string | null; selectedOnly?: boolean } = {},
  ): Promise<ChannelDto[]> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.channelsList, {
      accountId: options.accountId ?? null,
      selectedOnly: options.selectedOnly ?? false,
    });
    return ChannelsListResultSchema.parse(response).channels;
  },
  async setChannelEnabled(channelId: string, enabled: boolean): Promise<ChannelDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.setChannelEnabled, {
      channelId,
      enabled,
    });
    return ChannelDtoSchema.parse(response);
  },
  async startChannelSync(channelId: string): Promise<SourceSyncJobDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.startSync, { channelId });
    return SourceSyncJobDtoSchema.parse(response);
  },
  async getSyncStatus(syncId: string): Promise<SourceSyncJobDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.syncStatus, { syncId });
    return SourceSyncJobDtoSchema.parse(response);
  },
  async queryLibrary(query: CatalogQuery): Promise<LibraryQueryResult> {
    const input = CatalogQuerySchema.parse(query);
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.libraryQuery, input);
    return LibraryQueryResultSchema.parse(response);
  },
  async queryPlaylists(query: PlaylistQuery): Promise<PlaylistQueryResult> {
    const input = PlaylistQuerySchema.parse(query);
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.playlistsQuery, input);
    return PlaylistQueryResultSchema.parse(response);
  },
  async queryPlaylistMembers(query: PlaylistMembersQuery): Promise<PlaylistMembersResult> {
    const input = PlaylistMembersQuerySchema.parse(query);
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.playlistMembers, input);
    return PlaylistMembersResultSchema.parse(response);
  },
  async addFilesystemDestination(): Promise<DestinationDto | null> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.chooseFilesystemDestination, {});
    if (response?.status === 'CANCELLED') return null;
    if (response?.status === 'ADDED') {
      return DestinationDtoSchema.parse(response.destination);
    }
    throw new Error('The destination picker returned an invalid result.');
  },
  async addGoogleDriveDestination(accountId: string): Promise<DestinationDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.addGoogleDriveDestination, {
      accountId,
    });
    return DestinationDtoSchema.parse(response);
  },
  async listDestinations(): Promise<DestinationDto[]> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.destinationsList, {});
    return DestinationsListResultSchema.parse(response).destinations;
  },
  async disableDestination(destinationId: string): Promise<void> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.disableDestination, {
      destinationId,
    });
    if (response?.disabled !== true) throw new Error('The local destination was not disabled.');
  },
  async getChannelBackupSettings(channelId: string): Promise<ChannelBackupSettingsDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.channelBackupSettings, {
      channelId,
    });
    return ChannelBackupSettingsDtoSchema.parse(response);
  },
  async updateChannelBackupSettings(
    inputValue: ChannelBackupSettingsPatch,
  ): Promise<ChannelBackupSettingsDto> {
    const input = ChannelBackupSettingsPatchSchema.parse(inputValue);
    const response = await ipcRenderer.invoke(
      DESKTOP_IPC_CHANNELS.updateChannelBackupSettings,
      input,
    );
    return ChannelBackupSettingsDtoSchema.parse(response);
  },
  async startBackup(channelId: string): Promise<BackupStartResult> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.startBackup, { channelId });
    return BackupStartResultSchema.parse(response);
  },
  async listBackupRuns(): Promise<BackupRunDto[]> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.backupRuns, {});
    return BackupRunsListResultSchema.parse(response).runs;
  },
  async controlBackupRun(runId: string, action: RunControlAction): Promise<void> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.controlBackupRun, {
      runId,
      action,
    });
    if (response?.accepted !== true) throw new Error('The backup run control was not accepted.');
  },
  async getQueueSnapshot(queryValue: QueueQuery): Promise<QueueSnapshot> {
    const query = QueueQuerySchema.parse(queryValue);
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.queueSnapshot, query);
    return QueueSnapshotSchema.parse(response);
  },
  async controlJob(jobId: string, action: JobControlAction): Promise<QueueJobDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.controlJob, { jobId, action });
    return QueueJobDtoSchema.parse(response);
  },
  async getMediaBackupDetails(mediaItemId: string): Promise<MediaBackupDetails> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.mediaBackupDetails, {
      mediaItemId,
    });
    return MediaBackupDetailsSchema.parse(response);
  },
  async openVerifiedCopyFolder(mediaCopyId: string): Promise<OpenVerifiedCopyFolderResult> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.openVerifiedCopyFolder, {
      mediaCopyId,
    });
    return OpenVerifiedCopyFolderResultSchema.parse(response);
  },
  async openGoogleDriveObject(input: {
    mediaCopyId?: string;
    destinationId?: string;
  }): Promise<OpenGoogleDriveObjectResult> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.openGoogleDriveObject, {
      mediaCopyId: input.mediaCopyId ?? null,
      destinationId: input.destinationId ?? null,
    });
    return OpenGoogleDriveObjectResultSchema.parse(response);
  },
  async getDashboardSummary(): Promise<DashboardSummary> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.dashboardSummary, {});
    return DashboardSummarySchema.parse(response);
  },
  async getToolDiagnostics(): Promise<ToolDiagnostics> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.toolDiagnostics, {});
    return ToolDiagnosticsSchema.parse(response);
  },
  async createRecoverySession(): Promise<RecoverySessionDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.recoveryCreate, {});
    return RecoverySessionDtoSchema.parse(response);
  },
  async getLatestRecoverySession(): Promise<RecoverySessionDto | null> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.recoveryLatest, {});
    return RecoverySessionDtoSchema.nullable().parse(response);
  },
  async getRecoverySession(sessionId: string): Promise<RecoverySessionDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.recoveryGet, { sessionId });
    return RecoverySessionDtoSchema.parse(response);
  },
  async addRecoveryLocalSource(sessionId: string): Promise<RecoverySessionDto | null> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.chooseRecoveryLocalSource, {
      sessionId,
    });
    if (response?.status === 'CANCELLED') return null;
    if (response?.status === 'ADDED') return RecoverySessionDtoSchema.parse(response.session);
    throw new Error('The recovery source picker returned an invalid result.');
  },
  async addRecoveryDriveSource(sessionId: string, accountId: string): Promise<RecoverySessionDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.addRecoveryDriveSource, {
      sessionId,
      accountId,
    });
    return RecoverySessionDtoSchema.parse(response);
  },
  async setRecoveryDriveRootSelected(input: {
    sessionId: string;
    sourceId: string;
    providerRootId: string;
    selected: boolean;
  }): Promise<RecoverySessionDto> {
    const response = await ipcRenderer.invoke(
      DESKTOP_IPC_CHANNELS.setRecoveryDriveRootSelected,
      input,
    );
    return RecoverySessionDtoSchema.parse(response);
  },
  async startRecoveryScan(sessionId: string): Promise<RecoverySessionDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.startRecoveryScan, {
      sessionId,
    });
    return RecoverySessionDtoSchema.parse(response);
  },
  async startRecoveryImport(sessionId: string): Promise<RecoverySessionDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.startRecoveryImport, {
      sessionId,
    });
    return RecoverySessionDtoSchema.parse(response);
  },
  async cancelRecovery(sessionId: string): Promise<RecoverySessionDto> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.cancelRecovery, { sessionId });
    return RecoverySessionDtoSchema.parse(response);
  },
});

contextBridge.exposeInMainWorld('ytbm', api);
