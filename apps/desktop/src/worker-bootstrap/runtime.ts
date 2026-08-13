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
  SchedulingRepository,
  SourceCatalogService,
  SourceSyncCoordinator,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '@ytbm/database/worker';
import { WorkerRpcServer, createUserScopedEndpoints, type WorkerRpcHandlers } from '@ytbm/ipc';
import { NamedPipeWorkerSingleton, WorkerAlreadyRunningError } from '@ytbm/job-engine';
import { RecoveryService } from '@ytbm/recovery';
import {
  PeriodicIntegritySchedulingService,
  PERIODIC_INTEGRITY_TASK_ID,
  SchedulingService,
  UnavailableWindowsTaskScheduler,
  type WindowsTaskSchedulerAdapter,
} from '@ytbm/scheduler-windows';
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
import { GoogleDriveStorageProvider } from '@ytbm/storage-google-drive';

import type { RuntimeConfig } from '../config/runtime';
import { LocalBackupRuntime } from './backup-runtime';

export interface WorkerRuntimeOptions {
  config: RuntimeConfig;
  version: string;
  mode: WorkerMode;
  encryption: EncryptionAdapter;
  logSink?: LogSink;
  now?: () => number;
  onShutdownRequested?: () => void;
  ytDlpExecutable: string;
  ffmpegExecutable: string;
  schedulerAdapter?: WindowsTaskSchedulerAdapter;
  scheduledExecutablePath?: string | null;
  scheduledScheduleId?: string | null;
  scheduledIntegrityId?: string | null;
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
  private localBackup: LocalBackupRuntime | null = null;
  private recovery: RecoveryService | null = null;
  private scheduling: SchedulingService | null = null;
  private periodicIntegrityScheduling: PeriodicIntegritySchedulingService | null = null;
  private scheduledIdleTimer: NodeJS.Timeout | null = null;
  private shutdownWhenIdle = false;

  public constructor(private readonly options: WorkerRuntimeOptions) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    mkdirSync(options.config.paths.runtime, { recursive: true, mode: 0o700 });
    mkdirSync(options.config.paths.logs, { recursive: true, mode: 0o700 });
    mkdirSync(options.config.paths.staging, { recursive: true, mode: 0o700 });
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
      const googleDriveStorage = new GoogleDriveStorageProvider({
        getAccessToken: (accountId, forceRefresh) =>
          this.googleAccounts!.getAccessToken(accountId, forceRefresh, 'GOOGLE_DRIVE'),
        markDriveAuthorizationInvalid: (accountId) =>
          this.googleAccounts!.markDriveAuthorizationInvalid(accountId),
      });
      this.localBackup = new LocalBackupRuntime({
        workerId: this.instanceId,
        database: this.database,
        stagingRoot: this.options.config.paths.staging,
        ytDlpExecutable: this.options.ytDlpExecutable,
        ffmpegExecutable: this.options.ffmpegExecutable,
        logger: this.logger,
        settings: () => settings.get(),
        now: this.now,
        googleDriveStorage,
      });
      this.recovery = new RecoveryService({
        database: this.database,
        googleDriveStorage,
        now: this.now,
      });
      const schedulerAdapter =
        this.options.schedulerAdapter ?? new UnavailableWindowsTaskScheduler();
      this.scheduling = new SchedulingService({
        repository: new SchedulingRepository(this.database, this.now),
        adapter: schedulerAdapter,
        executablePath: this.options.scheduledExecutablePath ?? null,
        now: this.now,
        startBackup: (channelId, trigger) => this.localBackup!.startBackup(channelId, trigger),
      });
      this.periodicIntegrityScheduling = new PeriodicIntegritySchedulingService({
        adapter: schedulerAdapter,
        executablePath: this.options.scheduledExecutablePath ?? null,
        settings: () => settings.get(),
        lastIntegrityStartedAt: () => this.localBackup!.lastIntegrityStartedAt(),
        startIntegrity: (scope, driveMode) => this.localBackup!.startIntegrity(scope, driveMode),
        now: this.now,
      });

      const endpoints = createUserScopedEndpoints(this.options.config.paths.runtime);
      const authToken = await new RpcAuthTokenStore(
        this.options.config.paths.rpcToken,
      ).loadOrCreate();
      const handlers: WorkerRpcHandlers = {
        'worker.health': () => this.workerHealth(),
        'worker.scheduledWake': ({ scheduleId, requestedAt }) => {
          this.logger.info('Scheduled worker wake received', { scheduleId, requestedAt });
          return this.scheduling!.trigger(scheduleId, Date.parse(requestedAt));
        },
        'worker.scheduledIntegrityWake': ({ scheduleId, requestedAt }) => {
          if (scheduleId !== PERIODIC_INTEGRITY_TASK_ID) {
            throw new Error('The scheduled integrity maintenance ID is invalid.');
          }
          this.logger.info('Scheduled integrity wake received', { scheduleId, requestedAt });
          return this.periodicIntegrityScheduling!.trigger(Date.parse(requestedAt));
        },
        'worker.shutdownIfIdle': () => {
          if (
            this.options.onShutdownRequested === undefined ||
            this.sourceSync?.isIdle() === false ||
            this.googleAccounts?.isIdle() === false ||
            this.recovery?.isIdle() === false ||
            this.scheduling?.isIdle() === false ||
            this.periodicIntegrityScheduling?.isIdle() === false ||
            this.localBackup?.requestShutdownIfIdle() !== true
          ) {
            return { accepted: false };
          }
          this.logger.info('Idle worker shutdown requested');
          setTimeout(this.options.onShutdownRequested, 50);
          return { accepted: true };
        },
        'worker.shutdownWhenIdle': () => {
          this.shutdownWhenIdle = true;
          this.localBackup!.prepareShutdownWhenIdle();
          this.startIdleShutdownMonitor();
          return { accepted: true } as const;
        },
        'app.info': () => this.applicationInfo(),
        'database.health': () => databaseHealth.getHealth(),
        'settings.get': () => settings.get(),
        'settings.update': async (patch) => {
          const updated = await settings.update(patch);
          await this.periodicIntegrityScheduling!.reconcile();
          return updated;
        },
        'schedules.list': () => ({ schedules: this.scheduling!.list() }),
        'schedules.upsert': (input) => this.scheduling!.upsert(input),
        'schedules.remove': async ({ scheduleId }) => {
          await this.scheduling!.remove(scheduleId);
          return { removed: true } as const;
        },
        'schedules.triggerStartup': async ({ requestedAt }) => ({
          results: await this.scheduling!.triggerStartup(Date.parse(requestedAt)),
        }),
        'accounts.oauthBegin': ({ accountId, capability }) =>
          this.googleAccounts!.beginConnection(accountId, capability),
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
        'destinations.addFilesystem': ({ rootPath }) => this.localBackup!.addDestination(rootPath),
        'destinations.addGoogleDrive': ({ accountId }) =>
          this.localBackup!.addGoogleDriveDestination(accountId),
        'destinations.list': async () => ({
          destinations: await this.localBackup!.listDestinations(),
        }),
        'destinations.disable': ({ destinationId }) => {
          this.localBackup!.disableDestination(destinationId);
          return { disabled: true };
        },
        'backup.channelSettings': ({ channelId }) =>
          this.localBackup!.getChannelSettings(channelId),
        'backup.updateChannelSettings': (input) => this.localBackup!.setChannelSettings(input),
        'backup.start': ({ channelId }) => this.localBackup!.startBackup(channelId),
        'backup.runs': async () => ({ runs: this.localBackup!.listRuns() }),
        'backup.controlRun': ({ runId, action }) => {
          this.localBackup!.controlRun(runId, action);
          return { accepted: true };
        },
        'jobs.snapshot': (query) => this.localBackup!.queueSnapshot(query),
        'jobs.control': ({ jobId, action }) => this.localBackup!.controlJob(jobId, action),
        'media.backupDetails': ({ mediaItemId }) =>
          this.localBackup!.reconciledMediaDetails(mediaItemId),
        'media.resolveVerifiedFolder': ({ mediaCopyId }) =>
          this.localBackup!.resolveVerifiedCopyFolder(mediaCopyId),
        'storage.resolveGoogleDriveObject': ({ mediaCopyId, destinationId }) =>
          this.localBackup!.resolveGoogleDriveObject(mediaCopyId, destinationId),
        'dashboard.summary': () => this.localBackup!.dashboardSummary(),
        'integrity.start': ({ scope, driveMode }) =>
          this.localBackup!.startIntegrity(scope, driveMode),
        'integrity.overview': () => this.localBackup!.integrityOverview(),
        'repair.start': ({ copyId, allowYoutubeFallback }) =>
          this.localBackup!.startRepair(copyId, allowYoutubeFallback),
        'notifications.pending': async () => ({
          notifications: await this.localBackup!.pendingNotifications(),
        }),
        'notifications.ack': ({ notificationIds }) => ({
          acknowledged: this.localBackup!.acknowledgeNotifications(notificationIds),
        }),
        'tools.diagnostics': () => this.localBackup!.diagnostics(),
        'recovery.create': () => this.recovery!.createSession(),
        'recovery.latest': () => this.recovery!.latestSession(),
        'recovery.get': ({ sessionId }) => this.recovery!.getSession(sessionId),
        'recovery.addLocalSource': ({ sessionId, rootPath }) =>
          this.recovery!.addLocalSource(sessionId, rootPath),
        'recovery.addDriveSource': ({ sessionId, accountId }) =>
          this.recovery!.addDriveSource(sessionId, accountId),
        'recovery.setDriveRootSelected': ({ sessionId, sourceId, providerRootId, selected }) =>
          this.recovery!.setDriveRootSelected(sessionId, sourceId, providerRootId, selected),
        'recovery.scan': ({ sessionId }) => this.recovery!.startScan(sessionId),
        'recovery.import': ({ sessionId }) => this.recovery!.startImport(sessionId),
        'recovery.cancel': ({ sessionId }) => this.recovery!.cancel(sessionId),
      };
      this.rpcServer = new WorkerRpcServer(endpoints.rpc, authToken, handlers);
      await this.rpcServer.start();
      this.sourceSync.resumePending();
      this.localBackup.start();
      await this.scheduling.reconcile();
      await this.periodicIntegrityScheduling.reconcile();
      if (
        this.options.scheduledScheduleId !== null &&
        this.options.scheduledScheduleId !== undefined
      ) {
        await this.scheduling.trigger(this.options.scheduledScheduleId, this.now()).catch(() => {
          this.logger.warn('Scheduled occurrence could not be planned', {
            scheduleId: this.options.scheduledScheduleId,
          });
        });
        this.startIdleShutdownMonitor();
      }
      if (
        this.options.scheduledIntegrityId !== null &&
        this.options.scheduledIntegrityId !== undefined
      ) {
        await this.periodicIntegrityScheduling.trigger(this.now()).catch(() => {
          this.logger.warn('Scheduled integrity occurrence could not be planned', {
            scheduleId: this.options.scheduledIntegrityId,
          });
        });
        this.startIdleShutdownMonitor();
      }
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
    if (this.scheduledIdleTimer !== null) clearInterval(this.scheduledIdleTimer);
    this.scheduledIdleTimer = null;
    await this.rpcServer?.stop();
    this.rpcServer = null;
    await this.sourceSync?.stop();
    this.sourceSync = null;
    await this.recovery?.stop();
    this.recovery = null;
    this.scheduling = null;
    this.periodicIntegrityScheduling = null;
    await this.googleAccounts?.stop();
    await this.localBackup?.stop();
    this.localBackup = null;
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

  private startIdleShutdownMonitor(): void {
    if (
      (this.options.mode !== 'SCHEDULED' && !this.shutdownWhenIdle) ||
      this.options.onShutdownRequested === undefined ||
      this.scheduledIdleTimer !== null
    ) {
      return;
    }
    const startedAt = this.now();
    this.scheduledIdleTimer = setInterval(() => {
      if (this.now() - startedAt < 1_000) return;
      if (
        this.sourceSync?.isIdle() !== true ||
        this.googleAccounts?.isIdle() !== true ||
        this.recovery?.isIdle() !== true ||
        this.scheduling?.isIdle() !== true ||
        this.periodicIntegrityScheduling?.isIdle() !== true ||
        this.localBackup?.isIdle() !== true
      ) {
        return;
      }
      if (this.scheduledIdleTimer !== null) clearInterval(this.scheduledIdleTimer);
      this.scheduledIdleTimer = null;
      this.options.onShutdownRequested?.();
    }, 500);
    this.scheduledIdleTimer.unref();
  }
}
