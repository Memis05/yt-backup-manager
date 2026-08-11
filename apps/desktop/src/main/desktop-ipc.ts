import type { IpcMain } from 'electron';

import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcInput,
  parseDesktopIpcOutput,
  type WorkerRpcClient,
} from '@ytbm/ipc';

export interface IpcHandlerRegistrar {
  handle(channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>): void;
  removeHandler(channel: string): void;
}

export function registerDesktopIpcHandlers(
  ipcMain: IpcHandlerRegistrar | IpcMain,
  worker: WorkerRpcClient,
): () => void {
  ipcMain.handle(DESKTOP_IPC_CHANNELS.foundationStatus, async (_event, input) => {
    parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.foundationStatus, input);
    const [health, application, database, settings] = await Promise.all([
      worker.request('worker.health', {}),
      worker.request('app.info', {}),
      worker.request('database.health', {}),
      worker.request('settings.get', {}),
    ]);
    return parseDesktopIpcOutput(DESKTOP_IPC_CHANNELS.foundationStatus, {
      worker: health,
      application,
      database,
      settings,
    });
  });

  ipcMain.handle(DESKTOP_IPC_CHANNELS.updateSettings, async (_event, input) => {
    const patch = parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.updateSettings, input);
    const settings = await worker.request('settings.update', patch as { startMinimized: boolean });
    return parseDesktopIpcOutput(DESKTOP_IPC_CHANNELS.updateSettings, settings);
  });

  return () => {
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.foundationStatus);
    ipcMain.removeHandler(DESKTOP_IPC_CHANNELS.updateSettings);
  };
}
