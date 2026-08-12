import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  SettingsService,
  type ApplicationInfo,
  type WorkerHealth,
  type WorkerMode,
} from '@ytbm/core';
import {
  DatabaseHealthService,
  DrizzleGoogleAccountRepository,
  DrizzleSettingsRepository,
  SourceCatalogService,
  SourceSyncCoordinator,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '@ytbm/database/worker';
import { WorkerRpcServer, createUserScopedEndpoints, type WorkerRpcHandlers } from '@ytbm/ipc';
import { NamedPipeWorkerSingleton, WorkerAlreadyRunningError } from '@ytbm/job-engine';
import {
  EncryptedFileCredentialStore,
  JsonLinesFileSink,
  RpcAuthTokenStore,
  StructuredLogger,
  type EncryptionAdapter,
  type LogSink,
} from '@ytbm/security';
import {
  GoogleAccountService,
  YouTubeApiClient,
  YouTubeSourceProvider,
} from '@ytbm/source-youtube';

import type { RuntimeConfig } from '../config/runtime';

export interface WorkerRuntimeOptions {
  config: RuntimeConfig;
  version: string;
  mode: WorkerMode;
  encryption: EncryptionAdapter;
  logSink?: LogSink;
  now?: () => number;
  onShutdownRequested?: () => void;
}

export class WorkerRuntime {
  private readonly instanceId = randomUUID();
  private readonly startedAt: number;
  private readonly now: () => number;
  private readonly logger: StructuredLogger;
  private readonly singleton: NamedPipeWorkerSingleton;
  private rpcServer: WorkerRpcServer | null = null;
  private database: WorkerDatabase | null = null;
  private googleAccounts: GoogleAccountService | null = null;
  private sourceSync: SourceSyncCoordinator | null = null;

  public constructor(private readonly options: WorkerRuntimeOptions) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    mkdirSync(options.config.paths.runtime, { recursive: true, mode: 0o700 });
    mkdirSync(options.config.paths.logs, { recursive: true, mode: 0o700 });
    const sink =
      options.logSink ?? new JsonLinesFileSink(join(options.config.paths.logs, 'worker.jsonl'));
    this.logger = new StructuredLogger('worker', sink, { workerInstanceId: this.instanceId });
    const endpoints = createUserScopedEndpoints(options.config.paths.runtime);
    this.singleton = new NamedPipeWorkerSingleton(endpoints.singleton);
  }

  public async start(): Promise<boolean> {
    try {
      await this.singleton.acquire();
    } catch (error) {
      if (error instanceof WorkerAlreadyRunningError) return false;
      throw error;
    }

    try {
      this.database = openWorkerDatabase({
        databasePath: this.options.config.paths.database,
        ownership: acquireWorkerDatabaseOwnership(),
      });
      const settings = new SettingsService(new DrizzleSettingsRepository(this.database), this.now);
      const databaseHealth = new DatabaseHealthService(this.database);
      const credentials = new EncryptedFileCredentialStore(
        this.options.config.paths.credentials,
        this.options.encryption,
      );
      this.logger.info('Secure credential store initialized', {
        encryptionAvailable: this.options.encryption.isEncryptionAvailable(),
      });
      const accountRepository = new DrizzleGoogleAccountRepository(this.database);
      const catalog = new SourceCatalogService(this.database, this.now);
      const youtubeProviderReference: { current: YouTubeSourceProvider | null } = {
        current: null,
      };
      this.googleAccounts = new GoogleAccountService(
        {
          clientId: this.options.config.googleOAuthClientId,
          clientSecret: this.options.config.googleOAuthClientSecret,
          onDiagnostic: (diagnostic) => {
            this.logger.error('Google OAuth callback failed', { ...diagnostic });
          },
        },
        accountRepository,
        credentials,
        fetch,
        this.now,
        async (account) => {
          const discovered = await youtubeProviderReference.current?.listChannels(account.id);
          if (discovered === undefined) return;
          await catalog.discoverChannels(account.id, discovered);
        },
      );
      const youtubeApi = new YouTubeApiClient(this.googleAccounts);
      const youtubeProvider = new YouTubeSourceProvider(youtubeApi);
      youtubeProviderReference.current = youtubeProvider;
      this.sourceSync = new SourceSyncCoordinator(
        this.instanceId,
        catalog,
        youtubeProvider,
        this.now,
        async (accountId) => {
          await accountRepository.setAccountConnectionState(
            accountId,
            'REAUTH_REQUIRED',
            'AUTH_REVOKED',
            this.now(),
          );
        },
      );

      const endpoints = createUserScopedEndpoints(this.options.config.paths.runtime);
      const authToken = await new RpcAuthTokenStore(
        this.options.config.paths.rpcToken,
      ).loadOrCreate();
      const handlers: WorkerRpcHandlers = {
        'worker.health': () => this.workerHealth(),
        'worker.scheduledWake': ({ requestedAt }) => {
          this.logger.info('Scheduled worker wake received', { requestedAt });
          return { accepted: true };
        },
        'worker.shutdownIfIdle': () => {
          if (
            this.options.onShutdownRequested === undefined ||
            this.sourceSync?.isIdle() === false ||
            this.googleAccounts?.isIdle() === false
          ) {
            return { accepted: false };
          }
          this.logger.info('Idle worker shutdown requested');
          setTimeout(this.options.onShutdownRequested, 50);
          return { accepted: true };
        },
        'app.info': () => this.applicationInfo(),
        'database.health': () => databaseHealth.getHealth(),
        'settings.get': () => settings.get(),
        'settings.update': (patch) => settings.update(patch),
        'accounts.oauthBegin': ({ accountId }) => this.googleAccounts!.beginConnection(accountId),
        'accounts.oauthConfigure': ({ clientId, clientSecret }) => ({
          configured: this.googleAccounts!.configureClientCredentials(clientId, clientSecret),
        }),
        'accounts.oauthStatus': ({ flowId }) => this.googleAccounts!.getFlowStatus(flowId),
        'accounts.list': async () => ({ accounts: await this.googleAccounts!.listAccounts() }),
        'accounts.disconnect': ({ accountId }) => this.googleAccounts!.disconnect(accountId),
        'channels.discover': async ({ accountId }) => {
          const discovered = await youtubeProvider.listChannels(accountId);
          return { channels: await catalog.discoverChannels(accountId, discovered) };
        },
        'channels.list': async ({ accountId, selectedOnly }) => ({
          channels: await catalog.listChannels({ accountId, selectedOnly }),
        }),
        'channels.setEnabled': ({ channelId, enabled }) =>
          catalog.setChannelEnabled(channelId, enabled),
        'sync.start': ({ channelId }) => this.sourceSync!.start(channelId),
        'sync.status': ({ syncId }) => this.sourceSync!.status(syncId),
        'library.query': (query) => catalog.queryLibrary(query),
        'playlists.query': (query) => catalog.queryPlaylists(query),
        'playlists.members': (query) => catalog.queryPlaylistMembers(query),
      };
      this.rpcServer = new WorkerRpcServer(endpoints.rpc, authToken, handlers);
      await this.rpcServer.start();
      this.sourceSync.resumePending();
      this.logger.info('Worker ready', { mode: this.options.mode });
      return true;
    } catch (error) {
      this.database?.close();
      this.database = null;
      await this.singleton.release();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    await this.rpcServer?.stop();
    this.rpcServer = null;
    await this.sourceSync?.stop();
    this.sourceSync = null;
    await this.googleAccounts?.stop();
    this.googleAccounts = null;
    this.database?.close();
    this.database = null;
    await this.singleton.release();
    this.logger.info('Worker stopped');
  }

  private workerHealth(): WorkerHealth {
    return {
      status: 'READY',
      instanceId: this.instanceId,
      mode: this.options.mode,
      startedAt: new Date(this.startedAt).toISOString(),
      uptimeMs: Math.max(0, this.now() - this.startedAt),
    };
  }

  private applicationInfo(): ApplicationInfo {
    return {
      name: 'YouTube Backup Manager',
      version: this.options.version,
      environment: this.options.config.environment,
      platform: process.platform,
      arch: process.arch,
    };
  }
}
