import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DESKTOP_IPC_CHANNELS, WorkerRpcClient, createUserScopedEndpoints } from '@ytbm/ipc';
import { MemoryLogSink, RpcAuthTokenStore, type EncryptionAdapter } from '@ytbm/security';
import { afterEach, describe, expect, it } from 'vitest';

import { loadRuntimeConfig } from '../src/config/runtime';
import { registerDesktopIpcHandlers, type IpcHandlerRegistrar } from '../src/main/desktop-ipc';
import { WorkerRuntime } from '../src/worker-bootstrap/runtime';

const directories: string[] = [];
const runtimes: WorkerRuntime[] = [];

const testEncryption: EncryptionAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext) => Buffer.from(plaintext, 'utf8'),
  decryptString: (ciphertext) => Buffer.from(ciphertext).toString('utf8'),
};

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('desktop-to-worker foundation flow', () => {
  it('connects, initializes worker-owned SQLite, and persists safe settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-foundation-flow-'));
    directories.push(directory);
    const config = loadRuntimeConfig({
      userData: join(directory, 'user-data'),
      localData: join(directory, 'local-data'),
    });
    const runtime = new WorkerRuntime({
      config: { ...config, environment: 'test' },
      version: '0.1.0-test',
      mode: 'DIRECT',
      encryption: testEncryption,
      logSink: new MemoryLogSink(),
    });
    runtimes.push(runtime);
    await expect(runtime.start()).resolves.toBe(true);

    const endpoints = createUserScopedEndpoints(config.paths.runtime);
    const token = await new RpcAuthTokenStore(config.paths.rpcToken).loadOrCreate();
    const client = new WorkerRpcClient(endpoints.rpc, token);
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
    const registrar: IpcHandlerRegistrar = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => void handlers.delete(channel),
    };
    const unregister = registerDesktopIpcHandlers(registrar, client);
    const foundationHandler = handlers.get(DESKTOP_IPC_CHANNELS.foundationStatus);
    const settingsHandler = handlers.get(DESKTOP_IPC_CHANNELS.updateSettings);
    expect(foundationHandler).toBeDefined();
    expect(settingsHandler).toBeDefined();

    await expect(foundationHandler!(null, {})).resolves.toMatchObject({
      worker: { status: 'READY' },
      database: {
        schemaVersion: 3,
        foreignKeysEnabled: true,
        journalMode: 'wal',
      },
    });
    await expect(settingsHandler!(null, { startMinimized: true })).resolves.toMatchObject({
      startMinimized: true,
    });
    await expect(foundationHandler!(null, {})).resolves.toMatchObject({
      settings: { startMinimized: true },
    });

    unregister();
    client.close();
  });
});
