import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  DESKTOP_IPC_CHANNELS,
  RpcProtocolError,
  parseDesktopIpcInput,
  parseDesktopIpcOutput,
  parseWorkerRpcRequest,
} from '../src';

describe('validated IPC contracts', () => {
  it('rejects malformed worker RPC parameters', () => {
    expect(() =>
      parseWorkerRpcRequest({
        id: randomUUID(),
        authToken: randomBytes(32).toString('hex'),
        method: 'settings.update',
        params: { concurrentDownloads: 99 },
      }),
    ).toThrow(RpcProtocolError);
  });

  it('does not allow the renderer to invoke arbitrary methods', () => {
    expect(() => parseDesktopIpcInput('ytbm:execute-sql', { sql: 'select 1' })).toThrow(
      RpcProtocolError,
    );
    expect(() => parseDesktopIpcInput('ytbm:run-shell', { command: 'whoami' })).toThrow(
      RpcProtocolError,
    );
  });

  it('validates every renderer settings update', () => {
    expect(
      parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.updateSettings, { startMinimized: true }),
    ).toEqual({ startMinimized: true });
    expect(() =>
      parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.updateSettings, { arbitrary: true }),
    ).toThrow(RpcProtocolError);
  });

  it('allows opening only the fixed application log folder', () => {
    expect(parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.openLogFolder, {})).toEqual({});
    expect(() =>
      parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.openLogFolder, { path: 'C:\\' }),
    ).toThrow(RpcProtocolError);
  });

  it('allows only a result-only folder chooser contract', () => {
    expect(parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.chooseFilesystemDestination, {})).toEqual({});
    expect(() =>
      parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.chooseFilesystemDestination, {
        defaultPath: 'C:\\arbitrary-renderer-path',
      }),
    ).toThrow(RpcProtocolError);
    expect(
      parseDesktopIpcOutput(DESKTOP_IPC_CHANNELS.chooseFilesystemDestination, {
        status: 'ADDED',
        destination: {
          id: '123e4567-e89b-42d3-a456-426614174000',
          destinationType: 'FILESYSTEM',
          rootPath: 'D:\\YouTube Backup',
          enabled: true,
          availabilityStatus: 'AVAILABLE',
          volumeGuid: null,
          volumeSerial: null,
          filesystemType: null,
          lastKnownMountPath: null,
          availableBytes: null,
          totalBytes: null,
          lastProbeAt: null,
          safeMessage: null,
        },
      }),
    ).toMatchObject({
      status: 'ADDED',
      destination: { rootPath: 'D:\\YouTube Backup' },
    });
    expect(
      parseDesktopIpcOutput(DESKTOP_IPC_CHANNELS.chooseFilesystemDestination, {
        status: 'CANCELLED',
      }),
    ).toEqual({ status: 'CANCELLED' });
  });

  it('limits queue queries to the approved paginated views', () => {
    expect(
      parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.queueSnapshot, {
        section: 'WAITING_DOWNLOADS',
        page: 1,
        pageSize: 50,
      }),
    ).toEqual({ section: 'WAITING_DOWNLOADS', page: 1, pageSize: 50 });
    expect(() =>
      parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.queueSnapshot, {
        section: 'CUSTOM_SQL',
        page: 1,
        pageSize: 50,
      }),
    ).toThrow(RpcProtocolError);
    expect(() =>
      parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.queueSnapshot, {
        section: 'ALL',
        page: 1,
        pageSize: 1_000,
      }),
    ).toThrow(RpcProtocolError);
  });

  it('returns stale-copy folder failures as safe renderer states', () => {
    expect(
      parseDesktopIpcOutput(DESKTOP_IPC_CHANNELS.openVerifiedCopyFolder, {
        status: 'MISSING',
        safeMessage: 'This backup file is missing. Start Backup now to recreate it.',
      }),
    ).toEqual({
      status: 'MISSING',
      safeMessage: 'This backup file is missing. Start Backup now to recreate it.',
    });
    expect(() =>
      parseDesktopIpcOutput(DESKTOP_IPC_CHANNELS.openVerifiedCopyFolder, {
        status: 'MISSING',
        folderPath: 'C:\\secret',
      }),
    ).toThrow();
  });

  it('rejects OAuth credentials in renderer inputs and account DTOs', () => {
    expect(() =>
      parseDesktopIpcInput(DESKTOP_IPC_CHANNELS.beginGoogleOAuth, {
        accountId: null,
        clientSecret: 'must-never-enter-renderer-contracts',
      }),
    ).toThrow(RpcProtocolError);
    expect(() =>
      parseDesktopIpcOutput(DESKTOP_IPC_CHANNELS.accountsList, {
        accounts: [
          {
            id: randomUUID(),
            provider: 'GOOGLE',
            providerAccountId: 'subject',
            email: 'owner@example.test',
            displayName: null,
            avatarUrl: null,
            connectionState: 'CONNECTED',
            capabilities: { youtubeReadonly: true, grantedScopes: [] },
            connectedAt: 1,
            lastAuthAt: 1,
            lastErrorCode: null,
            accessToken: 'must-never-leave-worker',
          },
        ],
      }),
    ).toThrow();
  });
});
