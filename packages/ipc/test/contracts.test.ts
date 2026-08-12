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
