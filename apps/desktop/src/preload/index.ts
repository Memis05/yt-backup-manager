import { contextBridge, ipcRenderer } from 'electron';

import {
  AppSettingsSchema,
  FoundationStatusSchema,
  RendererSettingsPatchSchema,
  type AppSettings,
  type FoundationStatus,
} from '@ytbm/core';
import { DESKTOP_IPC_CHANNELS } from '@ytbm/ipc/renderer';

export interface YouTubeBackupManagerApi {
  getFoundationStatus(): Promise<FoundationStatus>;
  updateStartMinimized(startMinimized: boolean): Promise<AppSettings>;
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
});

contextBridge.exposeInMainWorld('ytbm', api);
