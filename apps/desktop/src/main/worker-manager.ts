import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';

import { type App } from 'electron';

import {
  RpcProtocolError,
  WORKER_RPC_PROTOCOL_VERSION,
  WorkerRpcClient,
  createUserScopedEndpoints,
} from '@ytbm/ipc';
import { RpcAuthTokenStore, type StructuredLogger } from '@ytbm/security';

import type { RuntimeConfig } from '../config/runtime';

function endpointIsActive(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(endpoint);
    let settled = false;
    const finish = (active: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(active);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function waitForWorkerEndpointRelease(
  endpoint: string,
  timeoutMs = 5 * 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await endpointIsActive(endpoint))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The outdated backup worker did not release its process lock in time.');
}

type WorkerControlClient = Pick<WorkerRpcClient, 'request'>;

export async function readWorkerRpcProtocolVersion(client: WorkerControlClient): Promise<number> {
  try {
    return (await client.request('worker.protocol', {})).version;
  } catch (error) {
    if (error instanceof RpcProtocolError && error.code === 'METHOD_NOT_FOUND') return 0;
    throw error;
  }
}

export async function requestWorkerShutdownForReplacement(
  client: WorkerControlClient,
): Promise<'IMMEDIATE' | 'WHEN_IDLE'> {
  const shutdown = await client.request('worker.shutdownIfIdle', {});
  if (shutdown.accepted) return 'IMMEDIATE';
  await client.request('worker.shutdownWhenIdle', {});
  return 'WHEN_IDLE';
}

export class DesktopWorkerManager {
  private client: WorkerRpcClient | null = null;
  private spawnedProcess: ChildProcess | null = null;
  private currentProtocolPromise: Promise<void> = Promise.resolve();

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

    let protocolVersion = await readWorkerRpcProtocolVersion(client);
    if (protocolVersion > WORKER_RPC_PROTOCOL_VERSION) {
      throw new Error(
        'The running backup worker is newer than this desktop application. Start the matching application version.',
      );
    }
    if (protocolVersion < WORKER_RPC_PROTOCOL_VERSION) {
      if (!connectedToExistingWorker) {
        throw new Error('The bundled backup worker uses an incompatible RPC protocol.');
      }
      const shutdownMode = await requestWorkerShutdownForReplacement(client);
      if (shutdownMode === 'IMMEDIATE') {
        this.logger.info('Replacing an idle outdated worker');
        await this.restartWorker(client, endpoints.singleton);
        connectedToExistingWorker = false;
        protocolVersion = await readWorkerRpcProtocolVersion(client);
        this.logger.info('Replaced outdated worker with the current RPC protocol', {
          protocolVersion,
        });
      } else {
        this.logger.info('Draining an outdated worker in the background', { shutdownMode });
        this.currentProtocolPromise = this.replaceOutdatedWorker(client, endpoints.singleton);
        void this.currentProtocolPromise.catch((error: unknown) => {
          this.logger.error('Background worker replacement failed', {
            exceptionType: error instanceof Error ? error.name : typeof error,
          });
        });
        this.client = client;
        return client;
      }
    }

    if (connectedToExistingWorker && this.config.environment === 'development') {
      const shutdown = await client.request('worker.shutdownIfIdle', {});
      if (shutdown.accepted) {
        await this.restartWorker(client, endpoints.singleton);
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
      await this.restartWorker(client, endpoints.singleton);
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

  public waitForCurrentProtocol(): Promise<void> {
    return this.currentProtocolPromise;
  }

  public terminateSpawnedWorkerForTest(): void {
    if (this.config.environment !== 'test') return;
    if (this.spawnedProcess?.exitCode === null) this.spawnedProcess.kill();
    this.spawnedProcess = null;
  }

  private configureGoogleOAuth(client: WorkerRpcClient): Promise<{ configured: boolean }> {
    return client.request('accounts.oauthConfigure', {
      clientId: this.config.googleOAuthClientId,
      clientSecret: this.config.googleOAuthClientSecret,
    });
  }

  private async replaceOutdatedWorker(
    client: WorkerRpcClient,
    singletonEndpoint: string,
  ): Promise<void> {
    await this.restartWorker(client, singletonEndpoint);
    await this.configureGoogleOAuth(client);
    this.logger.info('Replaced drained worker with the current RPC protocol', {
      protocolVersion: WORKER_RPC_PROTOCOL_VERSION,
    });
  }

  private async restartWorker(client: WorkerRpcClient, singletonEndpoint: string): Promise<void> {
    await waitForWorkerEndpointRelease(singletonEndpoint);
    client.close();
    this.spawnWorker();
    await client.waitUntilConnected(10_000);
    const protocolVersion = await readWorkerRpcProtocolVersion(client);
    if (protocolVersion !== WORKER_RPC_PROTOCOL_VERSION) {
      throw new Error('The replacement backup worker uses an incompatible RPC protocol.');
    }
  }

  private spawnWorker(): void {
    const gpuArgs =
      this.config.environment === 'test'
        ? ['--disable-gpu', '--disable-software-rasterizer', '--in-process-gpu']
        : ['--disable-gpu'];
    const args = this.app.isPackaged
      ? [...gpuArgs, '--worker', '--spawned-by-desktop']
      : [process.argv[1] ?? this.app.getAppPath(), ...gpuArgs, '--worker', '--spawned-by-desktop'];
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
