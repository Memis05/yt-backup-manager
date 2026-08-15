import {
  DEFAULT_APP_SETTINGS,
  type AccountDto,
  type BackupRunDto,
  type ChannelBackupSettingsDto,
  type ChannelDto,
  type DashboardSummary,
  type DestinationDto,
  type FoundationStatus,
  type IntegrityOverview,
  type QueueJobDto,
  type QueueSnapshot,
  type ScheduleDto,
  type ToolDiagnostics,
} from '@ytbm/core';
import { vi, type Mock } from 'vitest';

import type { HomeSnapshot } from '../../src/renderer/src/features/home/home-model';

export const FIXTURE_IDS = {
  account: '00000000-0000-4000-8000-000000000001',
  channel: '00000000-0000-4000-8000-000000000002',
  secondChannel: '00000000-0000-4000-8000-000000000003',
  destination: '00000000-0000-4000-8000-000000000004',
  run: '00000000-0000-4000-8000-000000000005',
  job: '00000000-0000-4000-8000-000000000006',
  schedule: '00000000-0000-4000-8000-000000000007',
} as const;

const NOW = 1_787_097_600_000;

export const foundationFixture: FoundationStatus = {
  worker: {
    status: 'READY',
    instanceId: '00000000-0000-4000-8000-000000000008',
    mode: 'DESKTOP_SPAWNED',
    startedAt: '2026-08-13T08:00:00.000Z',
    uptimeMs: 60_000,
  },
  application: {
    name: 'YouTube Backup Manager',
    version: '0.1.0-test',
    environment: 'test',
    platform: 'win32',
    arch: 'x64',
  },
  database: {
    status: 'READY',
    schemaVersion: 1,
    foreignKeysEnabled: true,
    journalMode: 'wal',
  },
  settings: {
    ...DEFAULT_APP_SETTINGS,
    notifications: { ...DEFAULT_APP_SETTINGS.notifications },
    periodicIntegrity: {
      ...DEFAULT_APP_SETTINGS.periodicIntegrity,
      scope: { kind: 'ALL' },
    },
  },
};

export const connectedAccountFixture: AccountDto = {
  id: FIXTURE_IDS.account,
  provider: 'GOOGLE',
  providerAccountId: 'provider-account-1',
  email: 'owner@example.test',
  displayName: 'Archive Owner',
  avatarUrl: null,
  connectionState: 'CONNECTED',
  capabilities: {
    youtubeReadonly: true,
    driveFile: true,
    driveConnectionState: 'CONNECTED',
    grantedScopes: ['youtube.readonly', 'drive.file'],
  },
  connectedAt: NOW - 86_400_000,
  lastAuthAt: NOW - 86_400_000,
  lastErrorCode: null,
};

export const channelFixture: ChannelDto = {
  id: FIXTURE_IDS.channel,
  providerChannelId: 'UC_TEST_PRIMARY',
  title: 'Studio North',
  handle: '@studionorth',
  thumbnailUrl: null,
  backupEnabled: true,
  sourceStatus: 'AVAILABLE',
  publishedAt: NOW - 86_400_000,
  lastSyncAt: NOW - 3_600_000,
  accessibleAccountIds: [FIXTURE_IDS.account],
  videosCount: 8,
  shortsCount: 3,
  liveCount: 1,
  syncStatus: null,
};

export const destinationFixture: DestinationDto = {
  id: FIXTURE_IDS.destination,
  destinationType: 'FILESYSTEM',
  rootPath: 'D:\\Archive',
  volumeGuid: null,
  volumeSerial: 'TEST-VOLUME',
  filesystemType: 'NTFS',
  lastKnownMountPath: 'D:\\',
  enabled: true,
  availabilityStatus: 'AVAILABLE',
  availableBytes: 500 * 1024 * 1024 * 1024,
  totalBytes: 1024 * 1024 * 1024 * 1024,
  lastProbeAt: NOW,
  safeMessage: null,
};

export const channelSettingsFixture: ChannelBackupSettingsDto = {
  channelId: FIXTURE_IDS.channel,
  qualityProfileOverride: null,
  effectiveQualityProfile: 'MAX_1080P',
  destinationIds: [FIXTURE_IDS.destination],
};

export const dashboardFixture: DashboardSummary = {
  selectedChannelCount: 1,
  mediaCount: 12,
  intendedCopyCount: 12,
  verifiedCopyCount: 12,
  pendingCopyCount: 0,
  failedCopyCount: 0,
  verifiedBytes: 24 * 1024 * 1024 * 1024,
  localVerifiedCount: 12,
  driveVerifiedCount: 0,
  lastBackupAt: NOW - 60_000,
};

export const completedRunFixture: BackupRunDto = {
  id: FIXTURE_IDS.run,
  channelId: FIXTURE_IDS.channel,
  channelTitle: channelFixture.title,
  triggerType: 'MANUAL',
  status: 'COMPLETED',
  effectiveQualityProfile: 'MAX_1080P',
  destinationIds: [FIXTURE_IDS.destination],
  discoveredCount: 12,
  downloadedCount: 12,
  localCopyCount: 12,
  driveUploadCount: 0,
  metadataUpdateCount: 12,
  failedCount: 0,
  bytesDownloaded: dashboardFixture.verifiedBytes,
  bytesTransferred: dashboardFixture.verifiedBytes,
  startedAt: NOW - 120_000,
  completedAt: NOW - 60_000,
  createdAt: NOW - 120_000,
};

export const emptyIntegrityFixture: IntegrityOverview = {
  health: {
    complete: 12,
    partial: 0,
    pending: 0,
    missing: 0,
    corrupt: 0,
    unavailable: 0,
    authRequired: 0,
  },
  channels: [],
  media: [],
  issues: [],
  history: [],
};

export function queueFixture(
  jobs: QueueJobDto[] = [],
  overrides: Partial<QueueSnapshot> = {},
): QueueSnapshot {
  return {
    jobs,
    completedMedia: [],
    section: 'ALL',
    page: 1,
    pageSize: 100,
    totalItems: jobs.length,
    totalJobCount: jobs.length,
    activeCount: jobs.filter((job) => job.status === 'RUNNING').length,
    pendingCount: jobs.filter((job) => ['PENDING', 'READY'].includes(job.status)).length,
    waitingDownloadCount: 0,
    pausedCount: jobs.filter((job) => job.status === 'PAUSED').length,
    retryWaitingCount: jobs.filter((job) => job.status === 'RETRY_WAIT').length,
    blockedCount: jobs.filter((job) => job.status === 'BLOCKED').length,
    failedCount: jobs.filter((job) => job.status === 'FAILED').length,
    completedMediaCount: 0,
    ...overrides,
  };
}

export function jobFixture(overrides: Partial<QueueJobDto> = {}): QueueJobDto {
  return {
    id: FIXTURE_IDS.job,
    backupRunId: FIXTURE_IDS.run,
    operationType: 'MANUAL',
    channelId: FIXTURE_IDS.channel,
    mediaItemId: '00000000-0000-4000-8000-000000000009',
    mediaTitle: 'A quiet test upload',
    destinationId: FIXTURE_IDS.destination,
    destinationPath: 'D:\\Archive',
    destinationType: 'FILESYSTEM',
    jobType: 'COPY_TO_FILESYSTEM',
    status: 'RUNNING',
    priority: 100,
    attemptCount: 0,
    maxAttempts: 3,
    progressRatio: 0.5,
    bytesProcessed: 1024,
    bytesTotal: 2048,
    speedBytesPerSec: 512,
    etaSeconds: 2,
    errorCode: null,
    safeMessage: null,
    nextRetryAt: null,
    createdAt: NOW - 10_000,
    updatedAt: NOW,
    ...overrides,
  };
}

export function scheduleFixture(overrides: Partial<ScheduleDto> = {}): ScheduleDto {
  return {
    id: FIXTURE_IDS.schedule,
    channelId: FIXTURE_IDS.channel,
    channelTitle: channelFixture.title,
    enabled: true,
    frequency: 'DAILY',
    localTime: '03:00',
    weekday: null,
    everyHours: null,
    catchUp: true,
    backupOnStartup: false,
    timezone: 'Europe/Sarajevo',
    taskStatus: 'SYNCED',
    lastErrorSafe: null,
    lastTriggeredAt: NOW - 86_400_000,
    nextExpectedAt: NOW + 86_400_000,
    createdAt: NOW - 604_800_000,
    updatedAt: NOW,
    ...overrides,
  };
}

export function healthyHomeSnapshot(overrides: Partial<HomeSnapshot> = {}): HomeSnapshot {
  return {
    foundation: foundationFixture,
    dashboard: dashboardFixture,
    accounts: [connectedAccountFixture],
    channels: [channelFixture],
    destinations: [destinationFixture],
    channelSettings: [channelSettingsFixture],
    queue: queueFixture(),
    attentionQueue: queueFixture([], { section: 'ATTENTION' }),
    integrity: emptyIntegrityFixture,
    runs: [completedRunFixture],
    schedules: [],
    latestRecovery: null,
    ...overrides,
  };
}

export function emptyHomeSnapshot(overrides: Partial<HomeSnapshot> = {}): HomeSnapshot {
  return healthyHomeSnapshot({
    dashboard: {
      selectedChannelCount: 0,
      mediaCount: 0,
      intendedCopyCount: 0,
      verifiedCopyCount: 0,
      pendingCopyCount: 0,
      failedCopyCount: 0,
      verifiedBytes: 0,
      localVerifiedCount: 0,
      driveVerifiedCount: 0,
      lastBackupAt: null,
    },
    accounts: [],
    channels: [],
    destinations: [],
    channelSettings: [],
    integrity: {
      ...emptyIntegrityFixture,
      health: { ...emptyIntegrityFixture.health, complete: 0 },
    },
    runs: [],
    ...overrides,
  });
}

type HomeApiMethod =
  | 'controlBackupRun'
  | 'controlJob'
  | 'getChannelBackupSettings'
  | 'getDashboardSummary'
  | 'getFoundationStatus'
  | 'getIntegrityOverview'
  | 'getLatestRecoverySession'
  | 'getQueueSnapshot'
  | 'listAccounts'
  | 'listBackupRuns'
  | 'listChannels'
  | 'listDestinations'
  | 'listSchedules'
  | 'startBackup';

export type HomeApiMock = Pick<Window['ytbm'], HomeApiMethod> & {
  [Method in HomeApiMethod]: Mock<Window['ytbm'][Method]>;
};

export interface InstalledHomeApi extends HomeApiMock {
  getToolDiagnostics: Mock<() => Promise<ToolDiagnostics>>;
  onInternalRoute: Mock<Window['ytbm']['onInternalRoute']>;
}

export function installHomeApi(
  snapshot: HomeSnapshot,
  overrides: Partial<HomeApiMock> = {},
): InstalledHomeApi {
  const allQueue = snapshot.queue;
  const attentionQueue = snapshot.attentionQueue;
  const api: InstalledHomeApi = {
    getFoundationStatus: vi.fn(async () => snapshot.foundation),
    listAccounts: vi.fn(async () => snapshot.accounts),
    listChannels: vi.fn(async () => snapshot.channels),
    listDestinations: vi.fn(async () => snapshot.destinations),
    listBackupRuns: vi.fn(async () => snapshot.runs),
    getQueueSnapshot: vi.fn(async (query) =>
      query.section === 'ATTENTION' ? attentionQueue : allQueue,
    ),
    getIntegrityOverview: vi.fn(async () => snapshot.integrity),
    listSchedules: vi.fn(async () => snapshot.schedules),
    getLatestRecoverySession: vi.fn(async () => snapshot.latestRecovery),
    getDashboardSummary: vi.fn(async () => snapshot.dashboard),
    getChannelBackupSettings: vi.fn(async (channelId) => {
      const settings = snapshot.channelSettings.find((item) => item.channelId === channelId);
      if (settings === undefined) throw new Error('Missing test channel settings.');
      return settings;
    }),
    startBackup: vi.fn(async () => ({
      run: { ...completedRunFixture, status: 'PENDING', completedAt: null },
      plannedJobs: 1,
      skippedVerifiedMedia: 0,
    })),
    controlBackupRun: vi.fn(async () => undefined),
    controlJob: vi.fn(async () => jobFixture()),
    getToolDiagnostics: vi.fn(async () => ({
      ytDlp: { available: true, version: 'test' },
      ffmpeg: { available: true, version: 'test' },
      googleDrive: {
        configuredDestinations: 0,
        availableDestinations: 0,
        activeUploads: 0,
        lastSafeErrorCode: null,
      },
    })),
    onInternalRoute: vi.fn(() => () => undefined),
    ...overrides,
  };

  Object.defineProperty(window, 'ytbm', {
    configurable: true,
    value: api as unknown as Window['ytbm'],
  });
  return api;
}
