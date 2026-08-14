import { useCallback, useEffect, useRef, useState } from 'react';

import type { QueueJobDto } from '@ytbm/core';

import { usePollingController, type FeatureController } from '../controllers/controller-core';
import { observedDurableCompletion, type HomeSnapshot } from './home-model';

export const HOME_POLL_INTERVAL_MS = 2_000;
const START_RECONCILIATION_ATTEMPTS = 3;
const START_RECONCILIATION_DELAY_MS = 750;

type HomeApi = Pick<
  Window['ytbm'],
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
  | 'startBackup'
>;

export interface HomeControllerState {
  snapshot: HomeSnapshot | null;
  loading: boolean;
  requestError: string | null;
  operationPending: boolean;
  startError: string | null;
  retryStartAllowed: boolean;
  startRetryLocked: boolean;
  reconcilingStart: boolean;
}

export interface HomeController extends HomeControllerState, FeatureController {
  startBackup(channelId: string): Promise<void>;
  controlOperation(job: QueueJobDto, action: 'PAUSE' | 'RESUME'): Promise<void>;
  clearStartError(): void;
}

export interface HomeControllerOptions {
  enabled?: boolean;
  api?: HomeApi;
  onBackupAccepted(runId: string): void;
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

/**
 * Loads a Home snapshot in two stages. Run history is read before the coverage
 * summary because listing runs reconciles durable run status in the worker.
 */
export async function loadHomeSnapshot(api: HomeApi = window.ytbm): Promise<HomeSnapshot> {
  const [
    foundation,
    accounts,
    channels,
    destinations,
    runs,
    queue,
    attentionQueue,
    integrity,
    schedules,
    latestRecovery,
  ] = await Promise.all([
    api.getFoundationStatus(),
    api.listAccounts(),
    api.listChannels(),
    api.listDestinations(),
    api.listBackupRuns(),
    api.getQueueSnapshot({ section: 'ALL', page: 1, pageSize: 100 }),
    api.getQueueSnapshot({ section: 'ATTENTION', page: 1, pageSize: 100 }),
    api.getIntegrityOverview(),
    api.listSchedules(),
    api.getLatestRecoverySession().catch(() => null),
  ]);
  const selectedChannelIds = channels
    .filter((channel) => channel.backupEnabled)
    .map((channel) => channel.id);
  const [dashboard, channelSettings] = await Promise.all([
    api.getDashboardSummary(),
    Promise.all(selectedChannelIds.map((channelId) => api.getChannelBackupSettings(channelId))),
  ]);

  return {
    foundation,
    dashboard,
    accounts,
    channels,
    destinations,
    channelSettings,
    queue,
    attentionQueue,
    integrity,
    runs,
    schedules,
    latestRecovery,
  };
}

async function findPersistedStartedRun(
  api: HomeApi,
  channelId: string,
  previousRunIds: ReadonlySet<string>,
  attemptStartedAt: number,
  shouldContinue: () => boolean = () => true,
): Promise<string | null> {
  for (let attempt = 0; attempt < START_RECONCILIATION_ATTEMPTS; attempt += 1) {
    if (!shouldContinue()) return null;
    const [runs, queue] = await Promise.all([
      api.listBackupRuns(),
      api.getQueueSnapshot({ section: 'ALL', page: 1, pageSize: 100 }),
    ]);
    const matchingRun = runs.find(
      (run) =>
        run.channelId === channelId &&
        !previousRunIds.has(run.id) &&
        run.createdAt >= attemptStartedAt - 1_000,
    );
    if (matchingRun !== undefined) return matchingRun.id;

    const matchingJob = queue.jobs.find(
      (job) =>
        job.channelId === channelId &&
        job.backupRunId !== null &&
        !previousRunIds.has(job.backupRunId) &&
        job.createdAt >= attemptStartedAt - 1_000,
    );
    if (matchingJob?.backupRunId !== null && matchingJob?.backupRunId !== undefined) {
      return matchingJob.backupRunId;
    }
    if (attempt + 1 < START_RECONCILIATION_ATTEMPTS) {
      await wait(START_RECONCILIATION_DELAY_MS);
    }
  }
  return null;
}

export function useHomeController({
  api = window.ytbm,
  enabled = true,
  onBackupAccepted,
}: HomeControllerOptions): HomeController {
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [operationPending, setOperationPending] = useState(false);
  const [reconcilingStart, setReconcilingStart] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [retryStartAllowed, setRetryStartAllowed] = useState(false);
  const [startRetryLocked, setStartRetryLocked] = useState(false);
  const snapshotRef = useRef<HomeSnapshot | null>(null);
  const operationPendingRef = useRef(false);
  const mountedRef = useRef(true);
  const startAttemptRef = useRef(0);
  const controllerRef = useRef<FeatureController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startAttemptRef.current += 1;
    };
  }, []);

  const controller = usePollingController<HomeSnapshot>({
    enabled,
    ownerKey: 'home',
    intervalMs: HOME_POLL_INTERVAL_MS,
    immediate: true,
    request: () => loadHomeSnapshot(api),
    onSuccess: (nextSnapshot) => {
      const completionObserved = observedDurableCompletion(snapshotRef.current, nextSnapshot);
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setRequestError(null);
      if (completionObserved) {
        // The first read observes the durable transition; the coalesced follow-up
        // obtains coverage and integrity after every completion-side write settles.
        void controllerRef.current?.refresh();
      }
    },
    onError: (error) => setRequestError(safeMessage(error)),
  });
  useEffect(() => {
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
    };
  }, [controller]);

  const refresh = useCallback(() => controller.refresh(), [controller]);

  const startBackup = useCallback(
    async (channelId: string): Promise<void> => {
      if (operationPendingRef.current || startRetryLocked) return;
      operationPendingRef.current = true;
      const attemptId = startAttemptRef.current + 1;
      startAttemptRef.current = attemptId;
      const attemptIsCurrent = (): boolean =>
        mountedRef.current && startAttemptRef.current === attemptId;
      const attemptStartedAt = Date.now();
      const previousRunIds = new Set(snapshotRef.current?.runs.map((run) => run.id) ?? []);
      setOperationPending(true);
      setStartError(null);
      setRetryStartAllowed(false);
      try {
        const result = await api.startBackup(channelId);
        if (!attemptIsCurrent()) return;
        // The returned run is already durable and authoritative. Refresh persisted
        // state before leaving Home when possible, but never reinterpret an accepted
        // start as a failure just because this best-effort follow-up read failed.
        await Promise.allSettled([
          api.listBackupRuns(),
          api.getQueueSnapshot({ section: 'ALL', page: 1, pageSize: 100 }),
        ]);
        if (attemptIsCurrent()) onBackupAccepted(result.run.id);
      } catch (error) {
        if (!attemptIsCurrent()) return;
        setReconcilingStart(true);
        try {
          const persistedRunId = await findPersistedStartedRun(
            api,
            channelId,
            previousRunIds,
            attemptStartedAt,
            attemptIsCurrent,
          );
          if (!attemptIsCurrent()) return;
          if (persistedRunId !== null) {
            if (attemptIsCurrent()) onBackupAccepted(persistedRunId);
            return;
          }
          const ambiguousFailure = isAmbiguousStartFailure(error);
          if (attemptIsCurrent()) {
            setStartError(
              ambiguousFailure
                ? `${safeMessage(error)} No new persisted backup is visible yet. The original request may still be finishing, so starting again is disabled. Check Activity before taking another action.`
                : `${safeMessage(error)} No new persisted backup appeared after the app checked Activity.`,
            );
            setRetryStartAllowed(!ambiguousFailure);
            setStartRetryLocked(ambiguousFailure);
          }
        } catch (reconciliationError) {
          if (attemptIsCurrent()) {
            setStartError(
              `${safeMessage(error)} The app could not confirm whether a backup was persisted: ${safeMessage(reconciliationError)}`,
            );
            setRetryStartAllowed(false);
            setStartRetryLocked(true);
          }
        } finally {
          if (attemptIsCurrent()) setReconcilingStart(false);
        }
      } finally {
        operationPendingRef.current = false;
        if (attemptIsCurrent()) setOperationPending(false);
      }
    },
    [api, onBackupAccepted, startRetryLocked],
  );

  const controlOperation = useCallback(
    async (job: QueueJobDto, action: 'PAUSE' | 'RESUME'): Promise<void> => {
      if (operationPendingRef.current || requestError !== null) return;
      operationPendingRef.current = true;
      setOperationPending(true);
      setStartError(null);
      try {
        if (job.backupRunId === null) await api.controlJob(job.id, action);
        else await api.controlBackupRun(job.backupRunId, action);
        await controller.refresh();
      } catch (error) {
        setStartError(safeMessage(error));
      } finally {
        operationPendingRef.current = false;
        setOperationPending(false);
      }
    },
    [api, controller, requestError],
  );

  const clearStartError = useCallback(() => {
    if (startRetryLocked) return;
    setStartError(null);
    setRetryStartAllowed(false);
  }, [startRetryLocked]);

  return {
    snapshot,
    loading: snapshot === null && requestError === null,
    requestError,
    operationPending,
    startError,
    retryStartAllowed,
    startRetryLocked,
    reconcilingStart,
    refresh,
    startBackup,
    controlOperation,
    clearStartError,
  };
}
