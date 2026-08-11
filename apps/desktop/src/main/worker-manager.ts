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

    try {
      await client.waitUntilConnected(400);
      this.logger.info('Connected to existing worker');
    } catch {
      this.spawnWorker();
      await client.waitUntilConnected(10_000);
      this.logger.info('Connected to spawned worker');
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

  private spawnWorker(): void {
    const args = this.app.isPackaged
      ? ['--worker', '--spawned-by-desktop']
      : [process.argv[1] ?? this.app.getAppPath(), '--worker', '--spawned-by-desktop'];
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
      },
    });
    this.spawnedProcess.unref();
  }
}
