import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DrizzleGoogleAccountRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
} from '@ytbm/database/worker';
import { DESKTOP_IPC_CHANNELS, WorkerRpcClient, createUserScopedEndpoints } from '@ytbm/ipc';
import {
  MemoryLogSink,
  RpcAuthTokenStore,
  StructuredLogger,
  type EncryptionAdapter,
} from '@ytbm/security';
import { afterEach, describe, expect, it } from 'vitest';

import { loadRuntimeConfig } from '../src/config/runtime';
import { registerDesktopIpcHandlers, type IpcHandlerRegistrar } from '../src/main/desktop-ipc';
import { DesktopWorkerManager } from '../src/main/worker-manager';
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
    const channelId = crypto.randomUUID();
    const now = Date.now();
    const seedDatabase = openWorkerDatabase({
      databasePath: config.paths.database,
      ownership: acquireWorkerDatabaseOwnership(),
    });
    seedDatabase.sqlite
      .prepare(
        `insert into channels (
          id, source_provider, provider_channel_id, title, backup_enabled, source_status,
          first_seen_at, last_seen_at, last_sync_at, created_at, updated_at
        ) values (?, 'YOUTUBE', 'UCdesktopflow', 'Desktop Flow Channel', 1, 'AVAILABLE',
          ?, ?, ?, ?, ?)`,
      )
      .run(channelId, now, now, now, now, now);
    const account = await new DrizzleGoogleAccountRepository(seedDatabase).upsertConnectedAccount({
      providerAccountId: 'desktop-flow-subject',
      email: 'desktop-flow@example.test',
      displayName: 'Desktop Flow',
      avatarUrl: null,
      credentialRef: 'google-oauth:desktop-flow-youtube',
      grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
      capability: 'YOUTUBE',
      connectedAt: now,
    });
    seedDatabase.close();
    const runtime = new WorkerRuntime({
      config: { ...config, environment: 'test' },
      version: '0.1.0-test',
      mode: 'DIRECT',
      encryption: testEncryption,
      logSink: new MemoryLogSink(),
      ytDlpExecutable: join(directory, 'yt-dlp.exe'),
      ffmpegExecutable: join(directory, 'ffmpeg.exe'),
    });
    runtimes.push(runtime);
    await expect(runtime.start()).resolves.toBe(true);

    const workerManager = new DesktopWorkerManager(
      {} as never,
      {
        ...config,
        googleOAuthClientId: 'desktop-client.apps.googleusercontent.com',
        googleOAuthClientSecret: 'desktop-client-secret',
      },
      new StructuredLogger('desktop-test', new MemoryLogSink()),
    );
    const configuredClient = await workerManager.connect();
    await expect(
      configuredClient.request('accounts.oauthBegin', {
        accountId: null,
        capability: 'YOUTUBE',
      }),
    ).resolves.toMatchObject({ status: 'STARTED' });
    workerManager.disconnect();

    const endpoints = createUserScopedEndpoints(config.paths.runtime);
    const token = await new RpcAuthTokenStore(config.paths.rpcToken).loadOrCreate();
    const client = new WorkerRpcClient(endpoints.rpc, token);
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
    const registrar: IpcHandlerRegistrar = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => void handlers.delete(channel),
    };
    let logFolderOpened = false;
    let destinationPickerOpened = false;
    let openedExternalUrl: string | null = null;
    let ipcAuthorized = true;
    const unregister = registerDesktopIpcHandlers(
      registrar,
      client,
      async (url) => {
        openedExternalUrl = url;
      },
      async () => {
        destinationPickerOpened = true;
        return join(directory, 'chosen-backup');
      },
      async () => {
        logFolderOpened = true;
      },
      async () => undefined,
      () => ipcAuthorized,
    );
    const foundationHandler = handlers.get(DESKTOP_IPC_CHANNELS.foundationStatus);
    const settingsHandler = handlers.get(DESKTOP_IPC_CHANNELS.updateSettings);
    const openLogsHandler = handlers.get(DESKTOP_IPC_CHANNELS.openLogFolder);
    const oauthBeginHandler = handlers.get(DESKTOP_IPC_CHANNELS.beginGoogleOAuth);
    const chooseDestinationHandler = handlers.get(DESKTOP_IPC_CHANNELS.chooseFilesystemDestination);
    const updateBackupSettingsHandler = handlers.get(
      DESKTOP_IPC_CHANNELS.updateChannelBackupSettings,
    );
    const startBackupHandler = handlers.get(DESKTOP_IPC_CHANNELS.startBackup);
    const queueHandler = handlers.get(DESKTOP_IPC_CHANNELS.queueSnapshot);
    expect(foundationHandler).toBeDefined();
    expect(settingsHandler).toBeDefined();
    expect(openLogsHandler).toBeDefined();
    expect(oauthBeginHandler).toBeDefined();
    expect(chooseDestinationHandler).toBeDefined();
    expect(updateBackupSettingsHandler).toBeDefined();
    expect(startBackupHandler).toBeDefined();
    expect(queueHandler).toBeDefined();

    await expect(foundationHandler!(null, {})).resolves.toMatchObject({
      worker: { status: 'READY' },
      database: {
        schemaVersion: 8,
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
    await expect(openLogsHandler!(null, {})).resolves.toEqual({ opened: true });
    expect(logFolderOpened).toBe(true);
    await expect(
      oauthBeginHandler!(null, {
        accountId: account.id,
        capability: 'GOOGLE_DRIVE',
      }),
    ).resolves.toMatchObject({
      status: 'STARTED',
      capability: 'GOOGLE_DRIVE',
    });
    expect(openedExternalUrl).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    const chooseResult = (await chooseDestinationHandler!(null, {})) as {
      status: 'ADDED';
      destination: { id: string; availabilityStatus: string };
    };
    expect(chooseResult.status).toBe('ADDED');
    expect(destinationPickerOpened).toBe(true);
    const destination = chooseResult.destination;
    expect(destination.availabilityStatus).toBe('AVAILABLE');
    await expect(
      updateBackupSettingsHandler!(null, {
        channelId,
        qualityProfileOverride: null,
        destinationIds: [destination.id],
      }),
    ).resolves.toMatchObject({ channelId, destinationIds: [destination.id] });
    await expect(startBackupHandler!(null, { channelId })).resolves.toMatchObject({
      run: { channelId, destinationIds: [destination.id], status: 'RUNNING' },
      plannedJobs: 1,
    });
    await expect(
      queueHandler!(null, { section: 'ALL', page: 1, pageSize: 50 }),
    ).resolves.toMatchObject({
      section: 'ALL',
      page: 1,
      pageSize: 50,
      totalItems: 1,
      totalJobCount: 1,
      jobs: [{ jobType: 'UPDATE_MANIFEST' }],
    });
    ipcAuthorized = false;
    await expect(foundationHandler!(null, {})).rejects.toThrow(/not authorized/);

    unregister();
    client.close();
  });
});
