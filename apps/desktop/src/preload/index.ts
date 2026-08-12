import { contextBridge, ipcRenderer } from 'electron';

import {
  AccountDtoSchema,
  AccountsListResultSchema,
  AppSettingsSchema,
  CatalogQuerySchema,
  ChannelDtoSchema,
  ChannelsListResultSchema,
  FoundationStatusSchema,
  LibraryQueryResultSchema,
  OAuthBeginResultSchema,
  OAuthFlowDtoSchema,
  PlaylistMembersQuerySchema,
  PlaylistMembersResultSchema,
  PlaylistQueryResultSchema,
  PlaylistQuerySchema,
  RendererSettingsPatchSchema,
  SourceSyncJobDtoSchema,
  type AccountDto,
  type AppSettings,
  type CatalogQuery,
  type ChannelDto,
  type FoundationStatus,
  type LibraryQueryResult,
  type OAuthBeginResult,
  type OAuthFlowDto,
  type PlaylistMembersQuery,
  type PlaylistMembersResult,
  type PlaylistQuery,
  type PlaylistQueryResult,
  type SourceSyncJobDto,
} from '@ytbm/core';
import { DESKTOP_IPC_CHANNELS } from '@ytbm/ipc/renderer';

export interface YouTubeBackupManagerApi {
  getFoundationStatus(): Promise<FoundationStatus>;
  updateStartMinimized(startMinimized: boolean): Promise<AppSettings>;
  openLogFolder(): Promise<void>;
  listAccounts(): Promise<AccountDto[]>;
  beginGoogleOAuth(accountId?: string | null): Promise<OAuthBeginResult>;
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
  async openLogFolder(): Promise<void> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.openLogFolder, {});
    if (response?.opened !== true)
      throw new Error('The application log folder could not be opened.');
  },
  async listAccounts(): Promise<AccountDto[]> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.accountsList, {});
    return AccountsListResultSchema.parse(response).accounts;
  },
  async beginGoogleOAuth(accountId: string | null = null): Promise<OAuthBeginResult> {
    const response = await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.beginGoogleOAuth, {
      accountId,
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
});

contextBridge.exposeInMainWorld('ytbm', api);
