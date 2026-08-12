import { spawn, type ChildProcess } from 'node:child_process';

import { type App } from 'electron';

import { WorkerRpcClient, createUserScopedEndpoints } from '@ytbm/ipc';
import { RpcAuthTokenStore, type StructuredLogger } from '@ytbm/security';

import type { RuntimeConfig } from '../config/runtime';

export class DesktopWorkerManager {
  private client: WorkerRpcClient | null = null;
  private spawnedProcess: ChildProcess | null = null;

  public constructor(
    private readonly app: App,
    private readonly config: RuntimeConfig,
    private readonly logger: StructuredLogger,
  ) {}

  public async connect(): Promise<WorkerRpcClient> {
    if (this.client !== null) return this.client;

    const endpoints = createUserScopedEndpoints(this.config.paths.runtime);
    const authToken = await new RpcAuthTokenStore(this.config.paths.rpcToken).loadOrCreate();
    const client = new WorkerRpcClient(endpoints.rpc, authToken);
    let connectedToExistingWorker = false;

    try {
      await client.waitUntilConnected(400);
      connectedToExistingWorker = true;
      this.logger.info('Connected to existing worker');
    } catch {
      this.spawnWorker();
      await client.waitUntilConnected(10_000);
      this.logger.info('Connected to spawned worker');
    }

    if (connectedToExistingWorker && this.config.environment === 'development') {
      const shutdown = await client.request('worker.shutdownIfIdle', {});
      if (shutdown.accepted) {
        await this.waitForWorkerShutdown(client);
        client.close();
        this.spawnWorker();
        await client.waitUntilConnected(10_000);
        connectedToExistingWorker = false;
        this.logger.info('Replaced idle development worker to load the current application code');
      } else {
        this.logger.info('Kept active development worker running');
      }
    }

    try {
      await this.configureGoogleOAuth(client);
    } catch (error) {
      if (!connectedToExistingWorker) throw error;

      const shutdown = await client.request('worker.shutdownIfIdle', {});
      if (!shutdown.accepted) {
        throw new Error(
          'The running backup worker must finish its active synchronization before OAuth configuration can be refreshed.',
          { cause: error },
        );
      }
      await this.waitForWorkerShutdown(client);
      client.close();
      this.spawnWorker();
      await client.waitUntilConnected(10_000);
      await this.configureGoogleOAuth(client);
      this.logger.info('Replaced an outdated idle worker to refresh OAuth configuration');
    }

    this.client = client;
    return client;
  }

  public disconnect(): void {
    this.client?.close();
    this.client = null;
  }

  public getSpawnedProcessId(): number | null {
    return this.spawnedProcess?.pid ?? null;
  }

  private configureGoogleOAuth(client: WorkerRpcClient): Promise<{ configured: boolean }> {
    return client.request('accounts.oauthConfigure', {
      clientId: this.config.googleOAuthClientId,
      clientSecret: this.config.googleOAuthClientSecret,
    });
  }

  private async waitForWorkerShutdown(client: WorkerRpcClient): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        await client.request('worker.health', {});
      } catch {
        return;
      }
    }
    throw new Error('The outdated backup worker did not shut down in time.');
  }

  private spawnWorker(): void {
    const args = this.app.isPackaged
      ? ['--disable-gpu', '--worker', '--spawned-by-desktop']
      : [
          process.argv[1] ?? this.app.getAppPath(),
          '--disable-gpu',
          '--worker',
          '--spawned-by-desktop',
        ];
    this.spawnedProcess = spawn(process.execPath, args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        YTBM_ENVIRONMENT: this.config.environment,
        YTBM_USER_DATA_PATH: this.config.paths.userData,
        YTBM_LOCAL_DATA_PATH: this.config.paths.localData,
        YTBM_DATABASE_PATH: this.config.paths.database,
        YTBM_GOOGLE_OAUTH_CLIENT_ID: this.config.googleOAuthClientId ?? '',
        YTBM_GOOGLE_OAUTH_CLIENT_SECRET: this.config.googleOAuthClientSecret ?? '',
      },
    });
    this.spawnedProcess.unref();
  }
}
