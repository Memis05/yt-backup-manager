import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  DESKTOP_IPC_CHANNELS,
  RpcProtocolError,
  parseDesktopIpcInput,
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
});
