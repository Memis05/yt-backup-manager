import { StrictMode, type ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import type {
  AccountDto,
  BackupRunDto,
  ChannelBackupSettingsDto,
  ChannelDto,
  DestinationDto,
  QueueJobDto,
  QueueSection,
  QueueSnapshot,
} from '@ytbm/core';
import { DEFAULT_APP_SETTINGS } from '@ytbm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HOME_POLL_INTERVAL_MS,
  useHomeController,
} from '../../src/renderer/src/features/home/home-controller';
import type { HomeSnapshot } from '../../src/renderer/src/features/home/home-model';
import { usePollingController } from '../../src/renderer/src/features/controllers/controller-core';

const NOW = 1_787_156_400_000;
const INSTANCE_ID = '10000000-0000-4000-8000-000000000001';
const ACCOUNT_ID = '10000000-0000-4000-8000-000000000002';
const CHANNEL_ID = '10000000-0000-4000-8000-000000000003';
const DESTINATION_ID = '10000000-0000-4000-8000-000000000004';
const RUN_ID = '10000000-0000-4000-8000-000000000005';
const NEW_RUN_ID = '10000000-0000-4000-8000-000000000006';
const JOB_ID = '10000000-0000-4000-8000-000000000007';
const MEDIA_ID = '10000000-0000-4000-8000-000000000008';

type HomeApi = NonNullable<Parameters<typeof useHomeController>[0]['api']>;

const account: AccountDto = {
  id: ACCOUNT_ID,
  provider: 'GOOGLE',
  providerAccountId: 'provider-account',
  email: 'owner@example.test',
  displayName: 'Archive owner',
  avatarUrl: null,
  connectionState: 'CONNECTED',
  capabilities: {
    youtubeReadonly: true,
    driveFile: true,
    driveConnectionState: 'CONNECTED',
    grantedScopes: [],
  },
  connectedAt: NOW - 20_000,
  lastAuthAt: NOW - 20_000,
  lastErrorCode: null,
};

const channel: ChannelDto = {
  id: CHANNEL_ID,
  providerChannelId: 'UC-controller-test',
  title: 'Test channel',
  handle: '@controller-test',
  thumbnailUrl: null,
  backupEnabled: true,
  sourceStatus: 'ACTIVE',
  publishedAt: NOW - 100_000,
  lastSyncAt: NOW - 10_000,
  accessibleAccountIds: [ACCOUNT_ID],
  videosCount: 1,
  shortsCount: 0,
  liveCount: 0,
  syncStatus: 'COMPLETED',
};

const destination: DestinationDto = {
  id: DESTINATION_ID,
  destinationType: 'FILESYSTEM',
  rootPath: 'D:\\YouTube Backup',
  volumeGuid: null,
  volumeSerial: null,
  filesystemType: 'NTFS',
  lastKnownMountPath: 'D:\\',
  enabled: true,
  availabilityStatus: 'AVAILABLE',
  availableBytes: 100_000_000,
  totalBytes: 200_000_000,
  lastProbeAt: NOW - 1_000,
  safeMessage: null,
};

const channelSettings: ChannelBackupSettingsDto = {
  channelId: CHANNEL_ID,
  qualityProfileOverride: null,
  effectiveQualityProfile: 'MAX_1080P',
  destinationIds: [DESTINATION_ID],
};

function makeRun(overrides: Partial<BackupRunDto> = {}): BackupRunDto {
  return {
    id: RUN_ID,
    channelId: CHANNEL_ID,
    channelTitle: channel.title,
    triggerType: 'BACKUP',
    status: 'COMPLETED',
    effectiveQualityProfile: 'MAX_1080P',
    destinationIds: [DESTINATION_ID],
    discoveredCount: 1,
    downloadedCount: 1,
    localCopyCount: 1,
    driveUploadCount: 0,
    metadataUpdateCount: 1,
    failedCount: 0,
    bytesDownloaded: 1_024,
    bytesTransferred: 1_024,
    startedAt: NOW - 5_000,
    completedAt: NOW - 1_000,
    createdAt: NOW - 6_000,
    ...overrides,
  };
}

function makeJob(overrides: Partial<QueueJobDto> = {}): QueueJobDto {
  return {
    id: JOB_ID,
    backupRunId: RUN_ID,
    operationType: 'BACKUP',
    channelId: CHANNEL_ID,
    mediaItemId: MEDIA_ID,
    mediaTitle: 'Test video',
    destinationId: DESTINATION_ID,
    destinationPath: 'D:\\YouTube Backup\\Test video.mp4',
    destinationType: 'FILESYSTEM',
    jobType: 'COPY_TO_FILESYSTEM',
    status: 'RUNNING',
    priority: 100,
    attemptCount: 0,
    maxAttempts: 3,
    progressRatio: 0.5,
    bytesProcessed: 512,
    bytesTotal: 1_024,
    speedBytesPerSec: 128,
    etaSeconds: 4,
    errorCode: null,
    safeMessage: null,
    nextRetryAt: null,
    createdAt: NOW - 2_000,
    updatedAt: NOW - 500,
    ...overrides,
  };
}

function makeQueue(section: QueueSection, jobs: QueueJobDto[] = []): QueueSnapshot {
  return {
    jobs,
    completedMedia: [],
    section,
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
  };
}

function makeSnapshot(overrides: Partial<HomeSnapshot> = {}): HomeSnapshot {
  return {
    foundation: {
      worker: {
        status: 'READY',
        instanceId: INSTANCE_ID,
        mode: 'DESKTOP_SPAWNED',
        startedAt: new Date(NOW - 60_000).toISOString(),
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
      settings: DEFAULT_APP_SETTINGS,
    },
    dashboard: {
      selectedChannelCount: 1,
      mediaCount: 1,
      intendedCopyCount: 1,
      verifiedCopyCount: 1,
      pendingCopyCount: 0,
      failedCopyCount: 0,
      verifiedBytes: 1_024,
      localVerifiedCount: 1,
      driveVerifiedCount: 0,
      lastBackupAt: NOW - 1_000,
    },
    accounts: [account],
    channels: [channel],
    destinations: [destination],
    channelSettings: [channelSettings],
    queue: makeQueue('ALL'),
    attentionQueue: makeQueue('ATTENTION'),
    integrity: {
      health: {
        complete: 1,
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
    },
    runs: [makeRun()],
    schedules: [],
    latestRecovery: null,
    ...overrides,
  };
}

interface HomeApiMock {
  api: HomeApi;
  getFoundationStatus: ReturnType<typeof vi.fn>;
  getDashboardSummary: ReturnType<typeof vi.fn>;
  getIntegrityOverview: ReturnType<typeof vi.fn>;
  getLatestRecoverySession: ReturnType<typeof vi.fn>;
  getQueueSnapshot: ReturnType<typeof vi.fn>;
  listAccounts: ReturnType<typeof vi.fn>;
  listBackupRuns: ReturnType<typeof vi.fn>;
  listChannels: ReturnType<typeof vi.fn>;
  listDestinations: ReturnType<typeof vi.fn>;
  listSchedules: ReturnType<typeof vi.fn>;
  getChannelBackupSettings: ReturnType<typeof vi.fn>;
  startBackup: ReturnType<typeof vi.fn>;
  controlBackupRun: ReturnType<typeof vi.fn>;
  controlJob: ReturnType<typeof vi.fn>;
}

function createApi(getSnapshot: () => HomeSnapshot): HomeApiMock {
  const getFoundationStatus = vi.fn(async () => getSnapshot().foundation);
  const getDashboardSummary = vi.fn(async () => getSnapshot().dashboard);
  const getIntegrityOverview = vi.fn(async () => getSnapshot().integrity);
  const getLatestRecoverySession = vi.fn(async () => getSnapshot().latestRecovery);
  const getQueueSnapshot = vi.fn(async ({ section }: { section: QueueSection }) =>
    section === 'ATTENTION' ? getSnapshot().attentionQueue : getSnapshot().queue,
  );
  const listAccounts = vi.fn(async () => getSnapshot().accounts);
  const listBackupRuns = vi.fn(async () => getSnapshot().runs);
  const listChannels = vi.fn(async () => getSnapshot().channels);
  const listDestinations = vi.fn(async () => getSnapshot().destinations);
  const listSchedules = vi.fn(async () => getSnapshot().schedules);
  const getChannelBackupSettings = vi.fn(async (channelId: string) => {
    const settings = getSnapshot().channelSettings.find(
      (candidate) => candidate.channelId === channelId,
    );
    if (settings === undefined) throw new Error('Missing channel settings fixture.');
    return settings;
  });
  const acceptedRun = makeRun({
    id: NEW_RUN_ID,
    status: 'PENDING',
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
  });
  const startBackup = vi.fn(async () => ({
    run: acceptedRun,
    plannedJobs: 1,
    skippedVerifiedMedia: 0,
  }));
  const controlBackupRun = vi.fn(async () => undefined);
  const controlJob = vi.fn(async (jobId: string, action: 'PAUSE' | 'RESUME') =>
    makeJob({ id: jobId, status: action === 'PAUSE' ? 'PAUSED' : 'RUNNING' }),
  );

  const api = {
    controlBackupRun,
    controlJob,
    getChannelBackupSettings,
    getDashboardSummary,
    getFoundationStatus,
    getIntegrityOverview,
    getLatestRecoverySession,
    getQueueSnapshot,
    listAccounts,
    listBackupRuns,
    listChannels,
    listDestinations,
    listSchedules,
    startBackup,
  } as HomeApi;

  return {
    api,
    getFoundationStatus,
    getDashboardSummary,
    getIntegrityOverview,
    getLatestRecoverySession,
    getQueueSnapshot,
    listAccounts,
    listBackupRuns,
    listChannels,
    listDestinations,
    listSchedules,
    getChannelBackupSettings,
    startBackup,
    controlBackupRun,
    controlJob,
  };
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
}

async function advanceTimers(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function StrictHarness({ children }: { children: ReactNode }): ReactNode {
  return <StrictMode>{children}</StrictMode>;
}

describe('Home controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('loads every Home source immediately and publishes one composed snapshot', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const accepted = vi.fn();
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: accepted }),
    );

    expect(mounted.result.current.loading).toBe(true);
    await flushAsyncWork();

    expect(mounted.result.current.loading).toBe(false);
    expect(mounted.result.current.snapshot).toMatchObject({
      dashboard: snapshot.dashboard,
      runs: snapshot.runs,
      queue: snapshot.queue,
    });
    expect(mock.getFoundationStatus).toHaveBeenCalledOnce();
    expect(mock.getDashboardSummary).toHaveBeenCalledOnce();
    expect(mock.listAccounts).toHaveBeenCalledOnce();
    expect(mock.listChannels).toHaveBeenCalledOnce();
    expect(mock.listDestinations).toHaveBeenCalledOnce();
    expect(mock.listBackupRuns).toHaveBeenCalledOnce();
    expect(mock.getIntegrityOverview).toHaveBeenCalledOnce();
    expect(mock.listSchedules).toHaveBeenCalledOnce();
    expect(mock.getLatestRecoverySession).toHaveBeenCalledOnce();
    expect(mock.getChannelBackupSettings).toHaveBeenCalledWith(CHANNEL_ID);
    expect(mock.getQueueSnapshot).toHaveBeenCalledTimes(2);

    mounted.unmount();
  });

  it('stops on route exit and performs a fresh immediate load on reentry', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const accepted = vi.fn();
    const mounted = renderHook(
      ({ enabled }) => useHomeController({ api: mock.api, enabled, onBackupAccepted: accepted }),
      { initialProps: { enabled: true } },
    );

    await flushAsyncWork();
    expect(mock.getFoundationStatus).toHaveBeenCalledOnce();

    mounted.rerender({ enabled: false });
    await advanceTimers(HOME_POLL_INTERVAL_MS * 3);
    expect(mock.getFoundationStatus).toHaveBeenCalledOnce();

    mounted.rerender({ enabled: true });
    await flushAsyncWork();
    expect(mock.getFoundationStatus).toHaveBeenCalledTimes(2);

    mounted.unmount();
  });

  it('does not duplicate the immediate Home request under React Strict Mode', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const mounted = renderHook(
      () => useHomeController({ api: mock.api, onBackupAccepted: vi.fn() }),
      { wrapper: StrictHarness },
    );

    await flushAsyncWork();
    expect(mock.getFoundationStatus).toHaveBeenCalledOnce();
    expect(mock.getQueueSnapshot).toHaveBeenCalledTimes(2);

    mounted.unmount();
  });

  it('keeps one live Home owner and promotes a waiting mount after owner exit', async () => {
    const snapshot = makeSnapshot();
    const firstMock = createApi(() => snapshot);
    const secondMock = createApi(() => snapshot);
    const first = renderHook(() =>
      useHomeController({ api: firstMock.api, onBackupAccepted: vi.fn() }),
    );
    const second = renderHook(() =>
      useHomeController({ api: secondMock.api, onBackupAccepted: vi.fn() }),
    );

    await flushAsyncWork();
    expect(firstMock.getFoundationStatus).toHaveBeenCalledOnce();
    expect(secondMock.getFoundationStatus).not.toHaveBeenCalled();

    first.unmount();
    await flushAsyncWork();
    expect(secondMock.getFoundationStatus).toHaveBeenCalledOnce();

    second.unmount();
  });

  it('coalesces an active-to-terminal observation into one follow-up snapshot refresh', async () => {
    let snapshot = makeSnapshot({
      runs: [makeRun({ status: 'RUNNING', completedAt: null })],
      queue: makeQueue('ALL', [makeJob()]),
    });
    const mock = createApi(() => snapshot);
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: vi.fn() }),
    );
    await flushAsyncWork();

    snapshot = makeSnapshot({
      runs: [makeRun({ status: 'COMPLETED', completedAt: NOW })],
      dashboard: {
        ...snapshot.dashboard,
        verifiedCopyCount: 1,
        pendingCopyCount: 0,
        lastBackupAt: NOW,
      },
    });
    await advanceTimers(HOME_POLL_INTERVAL_MS);

    expect(mock.getFoundationStatus).toHaveBeenCalledTimes(3);
    expect(mounted.result.current.snapshot?.runs[0]?.status).toBe('COMPLETED');

    mounted.unmount();
  });

  it('preserves the last good snapshot on request failure and clears the error after retry', async () => {
    let snapshot = makeSnapshot();
    let failRequest = false;
    const mock = createApi(() => snapshot);
    mock.getFoundationStatus.mockImplementation(async () => {
      if (failRequest) throw new Error('Worker unavailable');
      return snapshot.foundation;
    });
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: vi.fn() }),
    );
    await flushAsyncWork();
    const lastGoodSnapshot = mounted.result.current.snapshot;

    failRequest = true;
    await advanceTimers(HOME_POLL_INTERVAL_MS);
    expect(mounted.result.current.requestError).toBe('Worker unavailable');
    expect(mounted.result.current.snapshot).toBe(lastGoodSnapshot);

    snapshot = makeSnapshot({
      dashboard: { ...snapshot.dashboard, mediaCount: 2 },
    });
    failRequest = false;
    await act(async () => mounted.result.current.refresh());
    expect(mounted.result.current.requestError).toBeNull();
    expect(mounted.result.current.snapshot?.dashboard.mediaCount).toBe(2);

    mounted.unmount();
  });

  it('surfaces a schedule query rejection instead of publishing an incomplete snapshot', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    mock.listSchedules.mockRejectedValueOnce(new Error('Schedule catalog unavailable'));
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: vi.fn() }),
    );

    await flushAsyncWork();

    expect(mounted.result.current.snapshot).toBeNull();
    expect(mounted.result.current.loading).toBe(false);
    expect(mounted.result.current.requestError).toBe('Schedule catalog unavailable');

    mounted.unmount();
  });

  it('reads persisted state before publishing an accepted backup start', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const accepted = vi.fn();
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: accepted }),
    );
    await flushAsyncWork();

    let releasePersistedRead!: (runs: BackupRunDto[]) => void;
    mock.listBackupRuns.mockImplementationOnce(
      () =>
        new Promise<BackupRunDto[]>((resolve) => {
          releasePersistedRead = resolve;
        }),
    );
    let startPromise!: Promise<void>;
    act(() => {
      startPromise = mounted.result.current.startBackup(CHANNEL_ID);
    });
    await flushAsyncWork();

    expect(mock.startBackup).toHaveBeenCalledWith(CHANNEL_ID);
    expect(accepted).not.toHaveBeenCalled();

    await act(async () => {
      releasePersistedRead([
        makeRun({ id: NEW_RUN_ID, status: 'PENDING', completedAt: null, createdAt: NOW }),
      ]);
      await startPromise;
    });
    expect(accepted).toHaveBeenCalledOnce();
    expect(accepted).toHaveBeenCalledWith(NEW_RUN_ID);

    mounted.unmount();
  });

  it('keeps an accepted run authoritative when its follow-up persisted read fails', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const accepted = vi.fn();
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: accepted }),
    );
    await flushAsyncWork();

    mock.listBackupRuns.mockRejectedValueOnce(new Error('Run history temporarily unavailable'));
    await act(async () => mounted.result.current.startBackup(CHANNEL_ID));

    expect(mock.startBackup).toHaveBeenCalledWith(CHANNEL_ID);
    expect(accepted).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(mounted.result.current.startError).toBeNull();
    expect(mounted.result.current.startRetryLocked).toBe(false);

    mounted.unmount();
  });

  it('ignores a stale accepted start after Home unmounts', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const accepted = vi.fn();
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: accepted }),
    );
    await flushAsyncWork();

    let releaseStart!: (result: Awaited<ReturnType<HomeApi['startBackup']>>) => void;
    mock.startBackup.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseStart = resolve;
        }),
    );
    let startPromise!: Promise<void>;
    act(() => {
      startPromise = mounted.result.current.startBackup(CHANNEL_ID);
    });
    await flushAsyncWork();
    mounted.unmount();

    releaseStart({
      run: makeRun({
        id: NEW_RUN_ID,
        status: 'PENDING',
        startedAt: null,
        completedAt: null,
        createdAt: NOW,
      }),
      plannedJobs: 1,
      skippedVerifiedMedia: 0,
    });
    await startPromise;

    expect(accepted).not.toHaveBeenCalled();
  });

  it('accepts a start failure when reconciliation finds a new persisted run', async () => {
    let snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const accepted = vi.fn();
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: accepted }),
    );
    await flushAsyncWork();

    mock.startBackup.mockRejectedValueOnce(new Error('Worker RPC request timed out'));
    snapshot = makeSnapshot({
      runs: [
        makeRun({ id: NEW_RUN_ID, status: 'RUNNING', completedAt: null, createdAt: NOW }),
        ...snapshot.runs,
      ],
    });
    await act(async () => mounted.result.current.startBackup(CHANNEL_ID));

    expect(accepted).toHaveBeenCalledWith(NEW_RUN_ID);
    expect(mounted.result.current.startError).toBeNull();
    expect(mounted.result.current.retryStartAllowed).toBe(false);

    mounted.unmount();
  });

  it('allows retry for a definitive start rejection only after no persisted run is found', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: vi.fn() }),
    );
    await flushAsyncWork();
    mock.startBackup.mockRejectedValueOnce(new Error('Backup preflight rejected'));

    let startPromise!: Promise<void>;
    act(() => {
      startPromise = mounted.result.current.startBackup(CHANNEL_ID);
    });
    await flushAsyncWork();
    await advanceTimers(750);
    await advanceTimers(750);
    await act(async () => startPromise);

    expect(mock.listBackupRuns).toHaveBeenCalledTimes(4);
    expect(mounted.result.current.startError).toContain(
      'No new persisted backup appeared after the app checked Activity.',
    );
    expect(mounted.result.current.retryStartAllowed).toBe(true);
    expect(mounted.result.current.reconcilingStart).toBe(false);

    mounted.unmount();
  });

  it('keeps retry disabled when a timed-out start remains ambiguous after reconciliation', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: vi.fn() }),
    );
    await flushAsyncWork();
    mock.startBackup.mockRejectedValueOnce(new Error('Worker RPC request timed out'));

    let startPromise!: Promise<void>;
    act(() => {
      startPromise = mounted.result.current.startBackup(CHANNEL_ID);
    });
    await flushAsyncWork();
    await advanceTimers(750);
    await advanceTimers(750);
    await act(async () => startPromise);

    expect(mounted.result.current.startError).toContain(
      'The original request may still be finishing, so starting again is disabled.',
    );
    expect(mounted.result.current.retryStartAllowed).toBe(false);

    act(() => mounted.result.current.clearStartError());
    expect(mounted.result.current.startError).toContain(
      'The original request may still be finishing, so starting again is disabled.',
    );
    await act(async () => mounted.result.current.startBackup(CHANNEL_ID));

    expect(mock.startBackup).toHaveBeenCalledOnce();
    expect(mounted.result.current.retryStartAllowed).toBe(false);

    mounted.unmount();
  });

  it('disables retry when persisted-state reconciliation itself fails', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: vi.fn() }),
    );
    await flushAsyncWork();
    mock.startBackup.mockRejectedValueOnce(new Error('Worker RPC request timed out'));
    mock.listBackupRuns.mockRejectedValueOnce(new Error('Run history unavailable'));

    await act(async () => mounted.result.current.startBackup(CHANNEL_ID));

    expect(mounted.result.current.startError).toContain(
      'The app could not confirm whether a backup was persisted',
    );
    expect(mounted.result.current.startError).toContain('Run history unavailable');
    expect(mounted.result.current.retryStartAllowed).toBe(false);

    mounted.unmount();
  });

  it('routes controls to the durable run or standalone job owner and refreshes afterward', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: vi.fn() }),
    );
    await flushAsyncWork();
    const initialLoads = mock.getFoundationStatus.mock.calls.length;

    await act(async () => mounted.result.current.controlOperation(makeJob(), 'PAUSE'));
    expect(mock.controlBackupRun).toHaveBeenCalledWith(RUN_ID, 'PAUSE');
    expect(mock.controlJob).not.toHaveBeenCalled();
    expect(mock.getFoundationStatus).toHaveBeenCalledTimes(initialLoads + 1);

    const standaloneJob = makeJob({
      backupRunId: null,
      operationType: 'VERIFY',
      status: 'PAUSED',
    });
    await act(async () => mounted.result.current.controlOperation(standaloneJob, 'RESUME'));
    expect(mock.controlJob).toHaveBeenCalledWith(JOB_ID, 'RESUME');
    expect(mock.controlBackupRun).toHaveBeenCalledOnce();
    expect(mock.getFoundationStatus).toHaveBeenCalledTimes(initialLoads + 2);

    mounted.unmount();
  });

  it('surfaces a control failure without issuing a speculative refresh', async () => {
    const snapshot = makeSnapshot();
    const mock = createApi(() => snapshot);
    const mounted = renderHook(() =>
      useHomeController({ api: mock.api, onBackupAccepted: vi.fn() }),
    );
    await flushAsyncWork();
    const initialLoads = mock.getFoundationStatus.mock.calls.length;
    mock.controlBackupRun.mockRejectedValueOnce(new Error('Pause was not accepted'));

    await act(async () => mounted.result.current.controlOperation(makeJob(), 'PAUSE'));

    expect(mounted.result.current.startError).toBe('Pause was not accepted');
    expect(mock.getFoundationStatus).toHaveBeenCalledTimes(initialLoads);
    expect(mounted.result.current.operationPending).toBe(false);

    mounted.unmount();
  });
});

describe('controller-core Strict Mode ownership', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('rechecks ownership before the discarded immediate-effect microtask can request', async () => {
    const request = vi.fn(async () => 1);
    const mounted = renderHook(
      () =>
        usePollingController({
          ownerKey: 'strict-mode-immediate-regression',
          intervalMs: 1_000,
          immediate: true,
          request,
          onSuccess: vi.fn(),
        }),
      { wrapper: StrictHarness },
    );

    await flushAsyncWork();
    expect(request).toHaveBeenCalledOnce();

    mounted.unmount();
  });
});
