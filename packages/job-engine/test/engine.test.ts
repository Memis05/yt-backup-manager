import { BackupOperationError, type JobStatus, type JobType } from '@ytbm/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DurableJobEngine,
  type DurableJobRecord,
  type DurableJobRepository,
  type JobFailure,
  type PersistedJobProgress,
} from '../src';

const engines: DurableJobEngine[] = [];

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()));
});

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

class MemoryJobRepository implements DurableJobRepository {
  public readonly job: DurableJobRecord = {
    id: 'job-1',
    backupRunId: 'run-1',
    channelId: 'channel-1',
    mediaItemId: 'media-1',
    destinationId: null,
    jobType: 'DOWNLOAD_MEDIA',
    status: 'READY',
    attemptCount: 0,
    maxAttempts: 3,
    payload: {},
  };
  public leaseUntil: number | null = null;
  public lockOwner: string | null = null;
  public retryAt: number | null = null;
  public removePartial = false;
  public progress: PersistedJobProgress | null = null;

  public recoverExpiredLeases(): number {
    if (
      this.job.status === 'RUNNING' ||
      this.job.status === 'PAUSE_REQUESTED' ||
      this.job.status === 'CANCEL_REQUESTED'
    ) {
      this.job.status = 'INTERRUPTED';
      this.lockOwner = null;
      this.leaseUntil = null;
      return 1;
    }
    return 0;
  }

  public requeueInterrupted(): number {
    if (this.job.status !== 'INTERRUPTED') return 0;
    this.job.status = 'READY';
    return 1;
  }

  public promoteDependencies(now: number): void {
    if (this.job.status === 'RETRY_WAIT' && this.retryAt !== null && this.retryAt <= now) {
      this.job.status = 'READY';
      this.retryAt = null;
    }
  }

  public claimNext(
    jobTypes: readonly JobType[],
    workerId: string,
    _now: number,
    leaseUntil: number,
  ): DurableJobRecord | null {
    if (this.job.status !== 'READY' || !jobTypes.includes(this.job.jobType)) return null;
    this.job.status = 'RUNNING';
    this.job.attemptCount += 1;
    this.lockOwner = workerId;
    this.leaseUntil = leaseUntil;
    return { ...this.job };
  }

  public renewLease(jobId: string, workerId: string, _now: number, leaseUntil: number): boolean {
    if (jobId !== this.job.id || workerId !== this.lockOwner) return false;
    this.leaseUntil = leaseUntil;
    return true;
  }

  public persistProgress(_jobId: string, _workerId: string, progress: PersistedJobProgress): void {
    this.progress = progress;
  }

  public requestedState(jobId: string, workerId: string): JobStatus | null {
    return jobId === this.job.id && workerId === this.lockOwner ? this.job.status : null;
  }

  public removePartialOnCancel(): boolean {
    return this.removePartial;
  }

  public complete(): void {
    this.job.status = 'COMPLETED';
    this.lockOwner = null;
    this.leaseUntil = null;
  }

  public settleStopped(
    _jobId: string,
    _workerId: string,
    status: 'PAUSED' | 'CANCELLED' | 'INTERRUPTED',
  ): void {
    this.job.status = status;
    this.lockOwner = null;
    this.leaseUntil = null;
  }

  public fail(_jobId: string, _workerId: string, failure: JobFailure): void {
    this.job.status = failure.status;
    this.retryAt = failure.retryAt;
    this.lockOwner = null;
    this.leaseUntil = null;
  }

  public hasExecutionWork(): boolean {
    return [
      'PENDING',
      'READY',
      'RUNNING',
      'RETRY_WAIT',
      'PAUSE_REQUESTED',
      'CANCEL_REQUESTED',
    ].includes(this.job.status);
  }

  public requestCancel(removePartial: boolean): void {
    this.removePartial = removePartial;
    this.job.status = 'CANCEL_REQUESTED';
  }
}

function createEngine(
  repository: MemoryJobRepository,
  execute: (signal: AbortSignal) => Promise<unknown>,
  cleanupCancelled = vi.fn(async () => undefined),
): { engine: DurableJobEngine; cleanupCancelled: typeof cleanupCancelled } {
  const engine = new DurableJobEngine({
    workerId: 'worker-1',
    repository,
    handlers: new Map([
      [
        'DOWNLOAD_MEDIA',
        {
          pool: 'download',
          execute: (context) => execute(context.signal),
          cleanupCancelled,
        },
      ],
    ]),
    concurrency: { download: 1 },
    pollIntervalMs: 2,
    heartbeatIntervalMs: 5,
    leaseDurationMs: 20,
    random: () => 0.5,
  });
  engines.push(engine);
  return { engine, cleanupCancelled };
}

describe('DurableJobEngine execution', () => {
  it('retries a transient acquisition failure and then completes', async () => {
    const repository = new MemoryJobRepository();
    let executions = 0;
    const { engine } = createEngine(repository, async () => {
      executions += 1;
      if (executions === 1) {
        throw new BackupOperationError('NETWORK_TIMEOUT', 'Transient fixture failure.', {
          disposition: 'RETRY',
          retryAfterMs: 1,
        });
      }
      return { downloaded: true };
    });

    engine.start();
    await eventually(() => expect(repository.job.status).toBe('COMPLETED'));

    expect(executions).toBe(2);
    expect(repository.job.attemptCount).toBe(2);
  });

  it.each([
    { removePartial: false, cleanupCalls: 0 },
    { removePartial: true, cleanupCalls: 1 },
  ])(
    'cancels active work with removePartial=$removePartial',
    async ({ removePartial, cleanupCalls }) => {
      const repository = new MemoryJobRepository();
      const { engine, cleanupCancelled } = createEngine(
        repository,
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
      );

      engine.start();
      await eventually(() => expect(repository.job.status).toBe('RUNNING'));
      expect(engine.isIdle()).toBe(false);
      repository.requestCancel(removePartial);
      engine.wake();
      await eventually(() => expect(repository.job.status).toBe('CANCELLED'));

      expect(cleanupCancelled).toHaveBeenCalledTimes(cleanupCalls);
    },
  );

  it('marks active work interrupted on shutdown and completes it after restart', async () => {
    const repository = new MemoryJobRepository();
    const first = createEngine(
      repository,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    ).engine;
    first.start();
    await eventually(() => expect(repository.job.status).toBe('RUNNING'));

    await first.stop();
    expect(repository.job.status).toBe('INTERRUPTED');

    const second = createEngine(repository, async () => ({ resumed: true })).engine;
    second.start();
    await eventually(() => expect(repository.job.status).toBe('COMPLETED'));
    expect(second.isIdle()).toBe(true);
  });
});
