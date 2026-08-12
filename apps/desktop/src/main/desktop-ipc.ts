import type { IpcMain } from 'electron';

import type { CatalogQuery, PlaylistMembersQuery, PlaylistQuery } from '@ytbm/core';
import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcInput,
  parseDesktopIpcOutput,
  type DesktopIpcChannel,
  type WorkerRpcClient,
} from '@ytbm/ipc';

import { isAllowedGoogleOAuthUrl } from './external-navigation';

export interface IpcHandlerRegistrar {
  handle(channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>): void;
  removeHandler(channel: string): void;
}

export type OpenExternalUrl = (url: string) => Promise<void>;

export function registerDesktopIpcHandlers(
  ipcMain: IpcHandlerRegistrar | IpcMain,
  worker: WorkerRpcClient,
  openExternal: OpenExternalUrl,
  openLogFolder: () => Promise<void>,
): () => void {
  const handle = (
    channel: DesktopIpcChannel,
    handler: (input: unknown) => Promise<unknown>,
  ): void => {
    ipcMain.handle(channel, async (_event, input) => {
      const parsed = parseDesktopIpcInput(channel, input);
      return parseDesktopIpcOutput(channel, await handler(parsed));
    });
  };

  handle(DESKTOP_IPC_CHANNELS.foundationStatus, async () => {
    const [health, application, database, settings] = await Promise.all([
      worker.request('worker.health', {}),
      worker.request('app.info', {}),
      worker.request('database.health', {}),
      worker.request('settings.get', {}),
    ]);
    return { worker: health, application, database, settings };
  });

  handle(DESKTOP_IPC_CHANNELS.updateSettings, async (input) =>
    worker.request('settings.update', input as { startMinimized: boolean }),
  );

  handle(DESKTOP_IPC_CHANNELS.openLogFolder, async () => {
    await openLogFolder();
    return { opened: true } as const;
  });

  handle(DESKTOP_IPC_CHANNELS.beginGoogleOAuth, async (input) => {
    const result = await worker.request(
      'accounts.oauthBegin',
      input as { accountId: string | null },
    );
    if (result.status === 'UNAVAILABLE') return result;
    if (!isAllowedGoogleOAuthUrl(result.authorizationUrl)) {
      throw new Error('Google OAuth authorization URL was rejected');
    }
    await openExternal(result.authorizationUrl);
    return { status: 'STARTED', flowId: result.flowId, expiresAt: result.expiresAt };
  });

  handle(DESKTOP_IPC_CHANNELS.oauthStatus, async (input) =>
    worker.request('accounts.oauthStatus', input as { flowId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.accountsList, async () => worker.request('accounts.list', {}));
  handle(DESKTOP_IPC_CHANNELS.disconnectAccount, async (input) =>
    worker.request('accounts.disconnect', input as { accountId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.discoverChannels, async (input) =>
    worker.request('channels.discover', input as { accountId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.channelsList, async (input) =>
    worker.request('channels.list', input as { accountId: string | null; selectedOnly: boolean }),
  );
  handle(DESKTOP_IPC_CHANNELS.setChannelEnabled, async (input) =>
    worker.request('channels.setEnabled', input as { channelId: string; enabled: boolean }),
  );
  handle(DESKTOP_IPC_CHANNELS.startSync, async (input) =>
    worker.request('sync.start', input as { channelId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.syncStatus, async (input) =>
    worker.request('sync.status', input as { syncId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.libraryQuery, async (input) =>
    worker.request('library.query', input as CatalogQuery),
  );
  handle(DESKTOP_IPC_CHANNELS.playlistsQuery, async (input) =>
    worker.request('playlists.query', input as PlaylistQuery),
  );
  handle(DESKTOP_IPC_CHANNELS.playlistMembers, async (input) =>
    worker.request('playlists.members', input as PlaylistMembersQuery),
  );

  return () => {
    for (const channel of Object.values(DESKTOP_IPC_CHANNELS)) ipcMain.removeHandler(channel);
  };
}
