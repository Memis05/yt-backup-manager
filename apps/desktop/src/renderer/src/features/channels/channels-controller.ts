import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AccountDto,
  BackupRunDto,
  ChannelBackupSettingsDto,
  ChannelDto,
  ChannelQualityChangePreview,
  DestinationDto,
  FoundationStatus,
  IntegrityOverview,
  QueueSnapshot,
  QualityProfile,
  ScheduleDto,
  ScheduleUpsert,
  SourceSyncJobDto,
} from '@ytbm/core';

import {
  useBackupController,
  useSourceSyncController,
  type FeatureController,
} from '../controllers';

const START_RECONCILIATION_ATTEMPTS = 3;
const START_RECONCILIATION_DELAY_MS = 750;

type ChannelsApi = Pick<
  Window['ytbm'],
  | 'applyChannelQualityChange'
  | 'getChannelBackupSettings'
  | 'getFoundationStatus'
  | 'getIntegrityOverview'
  | 'getQueueSnapshot'
  | 'getSyncStatus'
  | 'listAccounts'
  | 'listBackupRuns'
  | 'listChannels'
  | 'listDestinations'
  | 'listSchedules'
  | 'previewChannelQualityChange'
  | 'removeSchedule'
  | 'setChannelEnabled'
  | 'startBackup'
  | 'startChannelSync'
  | 'updateChannelBackupSettings'
  | 'upsertSchedule'
>;

export interface ChannelsSnapshot {
  foundation: FoundationStatus;
  accounts: AccountDto[];
  channels: ChannelDto[];
  destinations: DestinationDto[];
  settings: ChannelBackupSettingsDto[];
  runs: BackupRunDto[];
  queue: QueueSnapshot;
  integrity: IntegrityOverview;
  schedules: ScheduleDto[];
}

export interface ChannelsController {
  snapshot: ChannelsSnapshot | null;
  loading: boolean;
  requestError: string | null;
  actionError: string | null;
  pendingAction: string | null;
  startLockedChannelId: string | null;
  syncJob: SourceSyncJobDto | null;
  qualityPreview: ChannelQualityChangePreview | null;
  refresh(): Promise<void>;
  clearActionError(): void;
  setEnabled(channelId: string, enabled: boolean): Promise<boolean>;
  updateDestinations(channelId: string, destinationIds: string[]): Promise<boolean>;
  previewQuality(
    channelId: string,
    qualityProfileOverride: QualityProfile | null,
  ): Promise<ChannelQualityChangePreview | null>;
  applyQuality(channelId: string, qualityProfileOverride: QualityProfile | null): Promise<boolean>;
  startSync(channelId: string): Promise<boolean>;
  startBackup(channelId: string): Promise<void>;
  saveSchedule(input: ScheduleUpsert): Promise<boolean>;
  removeSchedule(scheduleId: string): Promise<boolean>;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function isAmbiguousStartFailure(error: unknown): boolean {
  const message = safeMessage(error).toLowerCase();
  return (
    message.includes('request timed out') ||
    message.includes('connection timed out') ||
    message.includes('connection is unavailable') ||
    message.includes('connection closed')
  );
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

export async function loadChannelsSnapshot(
  api: ChannelsApi = window.ytbm,
): Promise<ChannelsSnapshot> {
  const [foundation, accounts, channels, destinations, runs, queue, integrity, schedules] =
    await Promise.all([
      api.getFoundationStatus(),
      api.listAccounts(),
      api.listChannels(),
      api.listDestinations(),
      api.listBackupRuns(),
      api.getQueueSnapshot({ section: 'ALL', page: 1, pageSize: 100 }),
      api.getIntegrityOverview(),
      api.listSchedules(),
    ]);
  const settings = await Promise.all(
    channels.map((channel) => api.getChannelBackupSettings(channel.id)),
  );
  return {
    foundation,
    accounts,
    channels,
    destinations,
    settings,
    runs,
    queue,
    integrity,
    schedules,
  };
}

async function findPersistedRun(
  api: ChannelsApi,
  channelId: string,
  previousRunIds: ReadonlySet<string>,
  attemptStartedAt: number,
): Promise<string | null> {
  for (let attempt = 0; attempt < START_RECONCILIATION_ATTEMPTS; attempt += 1) {
    const [runs, queue] = await Promise.all([
      api.listBackupRuns(),
      api.getQueueSnapshot({ section: 'ALL', page: 1, pageSize: 100 }),
    ]);
    const run = runs.find(
      (item) =>
        item.channelId === channelId &&
        !previousRunIds.has(item.id) &&
        item.createdAt >= attemptStartedAt - 1_000,
    );
    if (run) return run.id;
    const job = queue.jobs.find(
      (item) =>
        item.channelId === channelId &&
        item.backupRunId !== null &&
        !previousRunIds.has(item.backupRunId) &&
        item.createdAt >= attemptStartedAt - 1_000,
    );
    if (job?.backupRunId) return job.backupRunId;
    if (attempt + 1 < START_RECONCILIATION_ATTEMPTS) {
      await wait(START_RECONCILIATION_DELAY_MS);
    }
  }
  return null;
}

export function useChannelsController({
  api = window.ytbm,
  enabled = true,
  onBackupAccepted,
}: {
  api?: ChannelsApi;
  enabled?: boolean;
  onBackupAccepted(runId: string): void;
}): ChannelsController {
  const [snapshot, setSnapshot] = useState<ChannelsSnapshot | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [startLockedChannelId, setStartLockedChannelId] = useState<string | null>(null);
  const [syncJob, setSyncJob] = useState<SourceSyncJobDto | null>(null);
  const [qualityPreview, setQualityPreview] = useState<ChannelQualityChangePreview | null>(null);
  const snapshotRef = useRef<ChannelsSnapshot | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const controllerRef = useRef<FeatureController | null>(null);

  const controller = useBackupController<ChannelsSnapshot>({
    enabled,
    queryKey: 'channels',
    request: () => loadChannelsSnapshot(api),
    onSuccess: (next) => {
      snapshotRef.current = next;
      setSnapshot(next);
      setRequestError(null);
    },
    onError: (error) => setRequestError(safeMessage(error)),
  });
  useEffect(() => {
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
    };
  }, [controller]);

  useSourceSyncController({
    enabled:
      enabled && syncJob !== null && ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(syncJob.status),
    queryKey: syncJob?.id ?? 'none',
    request: () => api.getSyncStatus(syncJob!.id),
    onSuccess: (next) => {
      setSyncJob(next);
      if (next.status === 'FAILED') {
        setActionError(next.safeMessage ?? 'The YouTube source refresh failed.');
      }
      if (['COMPLETED', 'FAILED'].includes(next.status)) void controllerRef.current?.refresh();
    },
    onError: (error) => setActionError(safeMessage(error)),
  });

  const mutate = useCallback(async (key: string, action: () => Promise<void>): Promise<boolean> => {
    if (pendingActionRef.current !== null) return false;
    pendingActionRef.current = key;
    setPendingAction(key);
    setActionError(null);
    try {
      await action();
      await controllerRef.current?.refresh();
      return true;
    } catch (error) {
      setActionError(safeMessage(error));
      return false;
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }, []);

  const setEnabled = useCallback(
    (channelId: string, nextEnabled: boolean) =>
      mutate(`enabled:${channelId}`, async () => {
        await api.setChannelEnabled(channelId, nextEnabled);
      }),
    [api, mutate],
  );

  const updateDestinations = useCallback(
    (channelId: string, destinationIds: string[]) =>
      mutate(`destinations:${channelId}`, async () => {
        const current = snapshotRef.current?.settings.find((item) => item.channelId === channelId);
        if (!current) throw new Error('Channel backup settings are not available.');
        await api.updateChannelBackupSettings({
          channelId,
          destinationIds,
          qualityProfileOverride: current.qualityProfileOverride,
        });
      }),
    [api, mutate],
  );

  const previewQuality = useCallback(
    async (channelId: string, qualityProfileOverride: QualityProfile | null) => {
      if (pendingActionRef.current !== null) return null;
      pendingActionRef.current = `quality-preview:${channelId}`;
      setPendingAction(`quality-preview:${channelId}`);
      setActionError(null);
      try {
        const preview = await api.previewChannelQualityChange({
          channelId,
          qualityProfileOverride,
        });
        setQualityPreview(preview);
        return preview;
      } catch (error) {
        setActionError(safeMessage(error));
        return null;
      } finally {
        pendingActionRef.current = null;
        setPendingAction(null);
      }
    },
    [api],
  );

  const applyQuality = useCallback(
    (channelId: string, qualityProfileOverride: QualityProfile | null) =>
      mutate(`quality-apply:${channelId}`, async () => {
        await api.applyChannelQualityChange({
          channelId,
          qualityProfileOverride,
          policy: 'NEW_MEDIA_ONLY',
        });
        setQualityPreview(null);
      }),
    [api, mutate],
  );

  const startSync = useCallback(
    (channelId: string) =>
      mutate(`sync:${channelId}`, async () => {
        setSyncJob(await api.startChannelSync(channelId));
      }),
    [api, mutate],
  );

  const startBackup = useCallback(
    async (channelId: string): Promise<void> => {
      if (pendingActionRef.current !== null || startLockedChannelId === channelId) return;
      const previousRunIds = new Set(snapshotRef.current?.runs.map((run) => run.id) ?? []);
      const attemptStartedAt = Date.now();
      pendingActionRef.current = `backup:${channelId}`;
      setPendingAction(`backup:${channelId}`);
      setActionError(null);
      try {
        const result = await api.startBackup(channelId);
        onBackupAccepted(result.run.id);
      } catch (error) {
        try {
          const persistedRunId = await findPersistedRun(
            api,
            channelId,
            previousRunIds,
            attemptStartedAt,
          );
          if (persistedRunId) {
            onBackupAccepted(persistedRunId);
          } else {
            if (isAmbiguousStartFailure(error)) setStartLockedChannelId(channelId);
            setActionError(
              isAmbiguousStartFailure(error)
                ? `${safeMessage(error)} No new persisted backup is visible yet. Starting again is disabled until Activity confirms the result.`
                : `${safeMessage(error)} No new persisted backup appeared after the app checked Activity.`,
            );
          }
        } catch (reconciliationError) {
          setStartLockedChannelId(channelId);
          setActionError(
            `${safeMessage(error)} The app could not confirm persisted state: ${safeMessage(reconciliationError)}`,
          );
        }
      } finally {
        pendingActionRef.current = null;
        setPendingAction(null);
        await controllerRef.current?.refresh();
      }
    },
    [api, onBackupAccepted, startLockedChannelId],
  );

  const saveSchedule = useCallback(
    (input: ScheduleUpsert) =>
      mutate(`schedule:${input.channelId ?? 'global'}`, async () => {
        await api.upsertSchedule(input);
      }),
    [api, mutate],
  );
  const removeSchedule = useCallback(
    (scheduleId: string) =>
      mutate(`schedule-remove:${scheduleId}`, async () => {
        await api.removeSchedule(scheduleId);
      }),
    [api, mutate],
  );

  return {
    snapshot,
    loading: snapshot === null && requestError === null,
    requestError,
    actionError,
    pendingAction,
    startLockedChannelId,
    syncJob,
    qualityPreview,
    refresh: controller.refresh,
    clearActionError: () => setActionError(null),
    setEnabled,
    updateDestinations,
    previewQuality,
    applyQuality,
    startSync,
    startBackup,
    saveSchedule,
    removeSchedule,
  };
}
