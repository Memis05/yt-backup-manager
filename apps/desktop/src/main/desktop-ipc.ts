import type { IpcMain } from 'electron';

import type {
  CatalogQuery,
  ChannelBackupSettingsPatch,
  GoogleOAuthCapability,
  JobControlAction,
  PlaylistMembersQuery,
  PlaylistQuery,
  QueueQuery,
  RunControlAction,
} from '@ytbm/core';
import {
  DESKTOP_IPC_CHANNELS,
  parseDesktopIpcInput,
  parseDesktopIpcOutput,
  type DesktopIpcChannel,
  type WorkerRpcClient,
} from '@ytbm/ipc';

import { googleDriveObjectUrl, isAllowedGoogleOAuthUrl } from './external-navigation';

const BACKUP_START_RPC_TIMEOUT_MS = 5 * 60_000;

export interface IpcHandlerRegistrar {
  handle(channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>): void;
  removeHandler(channel: string): void;
}

export type OpenExternalUrl = (url: string) => Promise<void>;
export type ChooseFilesystemDestination = () => Promise<string | null>;
export type AuthorizeIpcEvent = (event: unknown) => boolean;

export function registerDesktopIpcHandlers(
  ipcMain: IpcHandlerRegistrar | IpcMain,
  worker: WorkerRpcClient,
  openExternal: OpenExternalUrl,
  chooseFilesystemDestination: ChooseFilesystemDestination,
  openLogFolder: () => Promise<void>,
  openKnownFolder: (path: string) => Promise<void>,
  authorizeIpcEvent: AuthorizeIpcEvent,
): () => void {
  const handle = (
    channel: DesktopIpcChannel,
    handler: (input: unknown) => Promise<unknown>,
  ): void => {
    ipcMain.handle(channel, async (event, input) => {
      if (!authorizeIpcEvent(event)) throw new Error('Desktop IPC sender is not authorized');
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
      input as { accountId: string | null; capability: GoogleOAuthCapability },
    );
    if (result.status === 'UNAVAILABLE') return result;
    if (!isAllowedGoogleOAuthUrl(result.authorizationUrl)) {
      throw new Error('Google OAuth authorization URL was rejected');
    }
    await openExternal(result.authorizationUrl);
    return {
      status: 'STARTED',
      flowId: result.flowId,
      capability: result.capability,
      expiresAt: result.expiresAt,
    };
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
  handle(DESKTOP_IPC_CHANNELS.chooseFilesystemDestination, async () => {
    const rootPath = await chooseFilesystemDestination();
    return rootPath === null
      ? ({ status: 'CANCELLED' } as const)
      : ({
          status: 'ADDED',
          destination: await worker.request('destinations.addFilesystem', { rootPath }),
        } as const);
  });
  handle(DESKTOP_IPC_CHANNELS.addGoogleDriveDestination, async (input) =>
    worker.request('destinations.addGoogleDrive', input as { accountId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.destinationsList, async () =>
    worker.request('destinations.list', {}),
  );
  handle(DESKTOP_IPC_CHANNELS.disableDestination, async (input) =>
    worker.request('destinations.disable', input as { destinationId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.channelBackupSettings, async (input) =>
    worker.request('backup.channelSettings', input as { channelId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.updateChannelBackupSettings, async (input) =>
    worker.request('backup.updateChannelSettings', input as ChannelBackupSettingsPatch),
  );
  handle(DESKTOP_IPC_CHANNELS.startBackup, async (input) =>
    worker.request('backup.start', input as { channelId: string }, {
      timeoutMs: BACKUP_START_RPC_TIMEOUT_MS,
    }),
  );
  handle(DESKTOP_IPC_CHANNELS.backupRuns, async () => worker.request('backup.runs', {}));
  handle(DESKTOP_IPC_CHANNELS.controlBackupRun, async (input) =>
    worker.request('backup.controlRun', input as { runId: string; action: RunControlAction }),
  );
  handle(DESKTOP_IPC_CHANNELS.queueSnapshot, async (input) =>
    worker.request('jobs.snapshot', input as QueueQuery),
  );
  handle(DESKTOP_IPC_CHANNELS.controlJob, async (input) =>
    worker.request('jobs.control', input as { jobId: string; action: JobControlAction }),
  );
  handle(DESKTOP_IPC_CHANNELS.mediaBackupDetails, async (input) =>
    worker.request('media.backupDetails', input as { mediaItemId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.openVerifiedCopyFolder, async (input) => {
    const result = await worker.request(
      'media.resolveVerifiedFolder',
      input as { mediaCopyId: string },
    );
    if (result.status !== 'AVAILABLE') return result;
    try {
      await openKnownFolder(result.folderPath);
      return { status: 'OPENED' } as const;
    } catch {
      return {
        status: 'UNAVAILABLE',
        safeMessage: 'The verified backup folder could not be opened.',
      } as const;
    }
  });
  handle(DESKTOP_IPC_CHANNELS.openGoogleDriveObject, async (input) => {
    const result = await worker.request(
      'storage.resolveGoogleDriveObject',
      input as { mediaCopyId: string | null; destinationId: string | null },
    );
    if (result.status !== 'AVAILABLE') return result;
    try {
      await openExternal(googleDriveObjectUrl(result.providerId));
      return { status: 'OPENED' } as const;
    } catch {
      return {
        status: 'UNAVAILABLE',
        safeMessage: 'The Google Drive object could not be opened.',
      } as const;
    }
  });
  handle(DESKTOP_IPC_CHANNELS.dashboardSummary, async () =>
    worker.request('dashboard.summary', {}),
  );
  handle(DESKTOP_IPC_CHANNELS.toolDiagnostics, async () => worker.request('tools.diagnostics', {}));
  handle(DESKTOP_IPC_CHANNELS.recoveryCreate, async () => worker.request('recovery.create', {}));
  handle(DESKTOP_IPC_CHANNELS.recoveryLatest, async () => worker.request('recovery.latest', {}));
  handle(DESKTOP_IPC_CHANNELS.recoveryGet, async (input) =>
    worker.request('recovery.get', input as { sessionId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.chooseRecoveryLocalSource, async (input) => {
    const { sessionId } = input as { sessionId: string };
    const rootPath = await chooseFilesystemDestination();
    return rootPath === null
      ? ({ status: 'CANCELLED' } as const)
      : ({
          status: 'ADDED',
          session: await worker.request('recovery.addLocalSource', { sessionId, rootPath }),
        } as const);
  });
  handle(DESKTOP_IPC_CHANNELS.addRecoveryDriveSource, async (input) =>
    worker.request('recovery.addDriveSource', input as { sessionId: string; accountId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.setRecoveryDriveRootSelected, async (input) =>
    worker.request(
      'recovery.setDriveRootSelected',
      input as {
        sessionId: string;
        sourceId: string;
        providerRootId: string;
        selected: boolean;
      },
    ),
  );
  handle(DESKTOP_IPC_CHANNELS.startRecoveryScan, async (input) =>
    worker.request('recovery.scan', input as { sessionId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.startRecoveryImport, async (input) =>
    worker.request('recovery.import', input as { sessionId: string }),
  );
  handle(DESKTOP_IPC_CHANNELS.cancelRecovery, async (input) =>
    worker.request('recovery.cancel', input as { sessionId: string }),
  );

  return () => {
    for (const channel of Object.values(DESKTOP_IPC_CHANNELS)) ipcMain.removeHandler(channel);
  };
}
