import type {
  AccountDto,
  BackupRunDto,
  ChannelBackupSettingsDto,
  ChannelDto,
  DashboardSummary,
  DestinationDto,
  FilesystemDestinationDto,
  FoundationStatus,
  IntegrityOverview,
  QueueJobDto,
  QueueSnapshot,
  ScheduleDto,
} from '@ytbm/core';

import type { HomeSnapshot } from '../../src/renderer/src/features/home/home-model';

export const HOME_FIXTURE_IDS = {
  account: '00000000-0000-4000-8000-000000000001',
  channel: '00000000-0000-4000-8000-000000000002',
  secondChannel: '00000000-0000-4000-8000-000000000003',
  destination: '00000000-0000-4000-8000-000000000004',
  driveDestination: '00000000-0000-4000-8000-000000000005',
  run: '00000000-0000-4000-8000-000000000006',
  secondRun: '00000000-0000-4000-8000-000000000007',
  job: '00000000-0000-4000-8000-000000000008',
  secondJob: '00000000-0000-4000-8000-000000000009',
  thirdJob: '00000000-0000-4000-8000-000000000010',
  media: '00000000-0000-4000-8000-000000000011',
  schedule: '00000000-0000-4000-8000-000000000012',
} as const;

export const HOME_FIXTURE_NOW = Date.UTC(2026, 7, 13, 12, 0, 0);

export function homeAccount(overrides: Partial<AccountDto> = {}): AccountDto {
  return {
    id: HOME_FIXTURE_IDS.account,
    provider: 'GOOGLE',
    providerAccountId: 'provider-account-1',
    email: 'owner@example.com',
    displayName: 'Archive Owner',
    avatarUrl: null,
    connectionState: 'CONNECTED',
    capabilities: {
      youtubeReadonly: true,
      driveFile: true,
      driveConnectionState: 'CONNECTED',
      grantedScopes: ['youtube.readonly'],
    },
    connectedAt: HOME_FIXTURE_NOW - 86_400_000,
    lastAuthAt: HOME_FIXTURE_NOW - 86_400_000,
    lastErrorCode: null,
    ...overrides,
  };
}

export function homeChannel(overrides: Partial<ChannelDto> = {}): ChannelDto {
  return {
    id: HOME_FIXTURE_IDS.channel,
    providerChannelId: 'youtube-channel-1',
    title: 'Workshop Archive',
    handle: '@workshop',
    thumbnailUrl: null,
    backupEnabled: true,
    sourceStatus: 'AVAILABLE',
    publishedAt: HOME_FIXTURE_NOW - 31_536_000_000,
    lastSyncAt: HOME_FIXTURE_NOW - 3_600_000,
    accessibleAccountIds: [HOME_FIXTURE_IDS.account],
    videosCount: 6,
    shortsCount: 1,
    liveCount: 1,
    syncStatus: 'COMPLETED',
    ...overrides,
  };
}

export function homeDestination(
  overrides: Partial<FilesystemDestinationDto> = {},
): FilesystemDestinationDto {
  return {
    id: HOME_FIXTURE_IDS.destination,
    destinationType: 'FILESYSTEM',
    rootPath: 'E:\\YouTube Archive',
    volumeGuid: null,
    volumeSerial: 'ARCHIVE-001',
    filesystemType: 'NTFS',
    lastKnownMountPath: 'E:\\',
    enabled: true,
    availabilityStatus: 'AVAILABLE',
    availableBytes: 500 * 1_024 ** 3,
    totalBytes: 1_000 * 1_024 ** 3,
    lastProbeAt: HOME_FIXTURE_NOW - 10_000,
    safeMessage: null,
    ...overrides,
  };
}

export function homeChannelSettings(
  overrides: Partial<ChannelBackupSettingsDto> = {},
): ChannelBackupSettingsDto {
  return {
    channelId: HOME_FIXTURE_IDS.channel,
    qualityProfileOverride: null,
    effectiveQualityProfile: 'MAX_1080P',
    destinationIds: [HOME_FIXTURE_IDS.destination],
    ...overrides,
  };
}

export function homeRun(overrides: Partial<BackupRunDto> = {}): BackupRunDto {
  return {
    id: HOME_FIXTURE_IDS.run,
    channelId: HOME_FIXTURE_IDS.channel,
    channelTitle: 'Workshop Archive',
    triggerType: 'MANUAL',
    status: 'COMPLETED',
    effectiveQualityProfile: 'MAX_1080P',
    destinationIds: [HOME_FIXTURE_IDS.destination],
    discoveredCount: 8,
    downloadedCount: 8,
    localCopyCount: 8,
    driveUploadCount: 0,
    metadataUpdateCount: 0,
    failedCount: 0,
    bytesDownloaded: 8 * 1_024 ** 3,
    bytesTransferred: 8 * 1_024 ** 3,
    startedAt: HOME_FIXTURE_NOW - 1_800_000,
    completedAt: HOME_FIXTURE_NOW - 1_200_000,
    createdAt: HOME_FIXTURE_NOW - 1_800_000,
    ...overrides,
  };
}

export function homeJob(overrides: Partial<QueueJobDto> = {}): QueueJobDto {
  return {
    id: HOME_FIXTURE_IDS.job,
    backupRunId: HOME_FIXTURE_IDS.run,
    operationType: 'MANUAL',
    channelId: HOME_FIXTURE_IDS.channel,
    mediaItemId: HOME_FIXTURE_IDS.media,
    mediaTitle: 'The durable backup',
    destinationId: HOME_FIXTURE_IDS.destination,
    destinationPath: 'E:\\YouTube Archive\\the-durable-backup.mp4',
    destinationType: 'FILESYSTEM',
    jobType: 'COPY_TO_FILESYSTEM',
    status: 'RUNNING',
    priority: 100,
    attemptCount: 1,
    maxAttempts: 5,
    progressRatio: 0.42,
    bytesProcessed: 420,
    bytesTotal: 1_000,
    speedBytesPerSec: 100,
    etaSeconds: 6,
    errorCode: null,
    safeMessage: null,
    nextRetryAt: null,
    createdAt: HOME_FIXTURE_NOW - 60_000,
    updatedAt: HOME_FIXTURE_NOW - 1_000,
    ...overrides,
  };
}

export function homeQueue(
  jobs: QueueJobDto[] = [],
  overrides: Partial<QueueSnapshot> = {},
): QueueSnapshot {
  const activeStatuses = new Set<QueueJobDto['status']>([
    'PENDING',
    'READY',
    'RUNNING',
    'PAUSE_REQUESTED',
    'PAUSED',
    'RETRY_WAIT',
    'CANCEL_REQUESTED',
    'INTERRUPTED',
  ]);
  return {
    jobs,
    completedMedia: [],
    section: 'ALL',
    page: 1,
    pageSize: 100,
    totalItems: jobs.length,
    totalJobCount: jobs.length,
    activeCount: jobs.filter((job) => activeStatuses.has(job.status)).length,
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

export function homeDashboard(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
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
    ...overrides,
  };
}

export function homeIntegrity(overrides: Partial<IntegrityOverview> = {}): IntegrityOverview {
  return {
    health: {
      complete: 0,
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
    ...overrides,
  };
}

export function homeSchedule(overrides: Partial<ScheduleDto> = {}): ScheduleDto {
  return {
    id: HOME_FIXTURE_IDS.schedule,
    channelId: HOME_FIXTURE_IDS.channel,
    channelTitle: 'Workshop Archive',
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
    lastTriggeredAt: HOME_FIXTURE_NOW - 86_400_000,
    nextExpectedAt: HOME_FIXTURE_NOW + 86_400_000,
    createdAt: HOME_FIXTURE_NOW - 604_800_000,
    updatedAt: HOME_FIXTURE_NOW - 86_400_000,
    ...overrides,
  };
}

const foundation: FoundationStatus = {
  worker: {
    status: 'READY',
    instanceId: '00000000-0000-4000-8000-000000000099',
    mode: 'DESKTOP_SPAWNED',
    startedAt: '2026-08-13T10:00:00.000Z',
    uptimeMs: 7_200_000,
  },
  application: {
    name: 'YouTube Backup Manager',
    version: '0.1.0',
    environment: 'test',
    platform: 'win32',
    arch: 'x64',
  },
  database: {
    status: 'READY',
    schemaVersion: 7,
    foreignKeysEnabled: true,
    journalMode: 'wal',
  },
  settings: {
    startWithWindows: false,
    startMinimized: false,
    keepRunningInTray: true,
    checkForUpdates: true,
    defaultQualityProfile: 'MAX_1080P',
    concurrentDownloads: 2,
    concurrentLocalCopies: 2,
    concurrentDriveUploads: 2,
    notifications: {
      backupComplete: true,
      backupErrors: true,
      destinationDisconnected: true,
      destinationReconnected: true,
      authenticationRequired: true,
      integrityProblems: true,
      repairResults: true,
      scheduleErrors: true,
    },
    periodicIntegrity: {
      enabled: false,
      frequency: 'WEEKLY',
      customIntervalDays: 30,
      localTime: '03:00',
      scope: { kind: 'ALL' },
      driveMode: 'PROVIDER_METADATA_SIZE',
    },
  },
};

export function emptyHomeSnapshot(overrides: Partial<HomeSnapshot> = {}): HomeSnapshot {
  return {
    foundation,
    dashboard: homeDashboard(),
    accounts: [],
    channels: [],
    destinations: [],
    channelSettings: [],
    queue: homeQueue(),
    attentionQueue: homeQueue([], { section: 'ATTENTION' }),
    integrity: homeIntegrity(),
    runs: [],
    schedules: [],
    latestRecovery: null,
    ...overrides,
  };
}

export function configuredHomeSnapshot(overrides: Partial<HomeSnapshot> = {}): HomeSnapshot {
  return emptyHomeSnapshot({
    dashboard: homeDashboard({
      selectedChannelCount: 1,
      mediaCount: 8,
      intendedCopyCount: 8,
      verifiedCopyCount: 8,
      verifiedBytes: 8 * 1_024 ** 3,
      localVerifiedCount: 8,
      lastBackupAt: HOME_FIXTURE_NOW - 1_200_000,
    }),
    accounts: [homeAccount()],
    channels: [homeChannel()],
    destinations: [homeDestination()],
    channelSettings: [homeChannelSettings()],
    runs: [homeRun()],
    ...overrides,
  });
}

export function enabledDestinations(snapshot: HomeSnapshot): DestinationDto[] {
  return snapshot.destinations.filter((destination) => destination.enabled);
}
