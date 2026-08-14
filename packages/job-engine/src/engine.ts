import {
  BackupOperationError,
  type BackupErrorCode,
  type JobStatus,
  type JobType,
} from '@ytbm/core';

export interface DurableJobRecord {
  id: string;
  backupRunId: string | null;
  channelId: string | null;
  mediaItemId: string | null;
  destinationId: string | null;
  jobType: JobType;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  payload: unknown;
}

export interface PersistedJobProgress {
  bytesProcessed: number;
  bytesTotal: number | null;
  progressRatio: number | null;
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
}

export interface JobFailure {
  code: BackupErrorCode;
  safeMessage: string;
  retryAt: number | null;
  status: 'RETRY_WAIT' | 'BLOCKED' | 'FAILED';
}

export interface DurableJobRepository {
  recoverExpiredLeases(now: number): number;
  requeueInterrupted(now: number): number;
  promoteDependencies(now: number): void;
  claimNext(
    jobTypes: readonly JobType[],
    workerId: string,
    now: number,
    leaseUntil: number,
  ): DurableJobRecord | null;
  renewLease(jobId: string, workerId: string, now: number, leaseUntil: number): boolean;
  persistProgress(
    jobId: string,
    workerId: string,
    progress: PersistedJobProgress,
    now: number,
  ): void;
  requestedState(jobId: string, workerId: string): JobStatus | null;
  removePartialOnCancel(jobId: string): boolean;
  complete(jobId: string, workerId: string, result: unknown, now: number): void;
  settleStopped(
    jobId: string,
    workerId: string,
    status: 'PAUSED' | 'CANCELLED' | 'INTERRUPTED',
    now: number,
  ): void;
  fail(jobId: string, workerId: string, failure: JobFailure, now: number): void;
  hasExecutionWork(): boolean;
}

export interface JobExecutionContext {
  job: DurableJobRecord;
  signal: AbortSignal;
  progress(progress: PersistedJobProgress): void;
}

export interface DurableJobHandler {
  pool: string;
  execute(context: JobExecutionContext): Promise<unknown>;
  cleanupCancelled?(context: JobExecutionContext): Promise<void>;
}

export interface DurableJobEngineOptions {
  workerId: string;
  repository: DurableJobRepository;
  handlers: ReadonlyMap<JobType, DurableJobHandler>;
  concurrency: Readonly<Record<string, number>>;
  now?: () => number;
  random?: () => number;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  progressPersistIntervalMs?: number;
  onJobSettled?(): void;
}

interface ActiveExecution {
  job: DurableJobRecord;
  controller: AbortController;
  promise: Promise<void>;
  lastPersistedAt: number;
  pendingProgress: PersistedJobProgress | null;
}

const RETRY_DELAYS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;

function internalFailure(): BackupOperationError {
  return new BackupOperationError(
    'INTERNAL_ERROR',
    'The backup operation stopped because of an internal error.',
    { disposition: 'RETRY' },
  );
}

export class DurableJobEngine {
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly pollIntervalMs: number;
  private readonly progressPersistIntervalMs: number;
  private readonly active = new Map<string, ActiveExecution>();
  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private draining = false;

  public constructor(private readonly options: DurableJobEngineOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.progressPersistIntervalMs = options.progressPersistIntervalMs ?? 1_000;
  }

  public start(): void {
    if (this.pollTimer !== null) return;
    this.stopping = false;
    this.draining = false;
    const now = this.now();
    this.options.repository.recoverExpiredLeases(now);
    this.options.repository.requeueInterrupted(now);
    this.tick();
    this.pollTimer = setInterval(() => this.tick(), this.pollIntervalMs);
    this.pollTimer.unref();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  public wake(): void {
    this.tick();
  }

  public isIdle(): boolean {
    return this.active.size === 0 && (this.draining || !this.options.repository.hasExecutionWork());
  }

  public prepareShutdownWhenIdle(): void {
    this.draining = true;
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
    for (const active of this.active.values())
      active.controller.abort(new Error('Worker stopping'));
    await Promise.allSettled([...this.active.values()].map((active) => active.promise));
  }

  private tick(): void {
    if (this.stopping) return;
    const now = this.now();
    this.options.repository.promoteDependencies(now);
    const poolCounts = new Map<string, number>();
    for (const active of this.active.values()) {
      const pool = this.options.handlers.get(active.job.jobType)?.pool;
      if (pool !== undefined) poolCounts.set(pool, (poolCounts.get(pool) ?? 0) + 1);
      const requested = this.options.repository.requestedState(
        active.job.id,
        this.options.workerId,
      );
      if (requested === 'PAUSE_REQUESTED' || requested === 'CANCEL_REQUESTED') {
        active.controller.abort(new Error(requested));
      }
    }

    if (this.draining) return;

    for (const [pool, limit] of Object.entries(this.options.concurrency)) {
      let running = poolCounts.get(pool) ?? 0;
      const jobTypes = [...this.options.handlers.entries()]
        .filter(([, handler]) => handler.pool === pool)
        .map(([jobType]) => jobType);
      while (running < limit) {
        const job = this.options.repository.claimNext(
          jobTypes,
          this.options.workerId,
          now,
          now + this.leaseDurationMs,
        );
        if (job === null) break;
        this.execute(job);
        running += 1;
      }
    }
  }

  private execute(job: DurableJobRecord): void {
    const controller = new AbortController();
    const active: ActiveExecution = {
      job,
      controller,
      promise: Promise.resolve(),
      lastPersistedAt: 0,
      pendingProgress: null,
    };
    const handler = this.options.handlers.get(job.jobType);
    if (handler === undefined) {
      this.options.repository.fail(
        job.id,
        this.options.workerId,
        {
          code: 'INTERNAL_ERROR',
          safeMessage: `No executor is registered for ${job.jobType}.`,
          retryAt: null,
          status: 'FAILED',
        },
        this.now(),
      );
      return;
    }
    active.promise = handler
      .execute({
        job,
        signal: controller.signal,
        progress: (progress) => this.recordProgress(active, progress),
      })
      .then((result) => {
        this.flushProgress(active);
        this.options.repository.complete(job.id, this.options.workerId, result, this.now());
      })
      .catch((error: unknown) => this.settleError(active, handler, error))
      .finally(() => {
        this.active.delete(job.id);
        this.options.onJobSettled?.();
        this.tick();
      });
    this.active.set(job.id, active);
  }

  private async settleError(
    active: ActiveExecution,
    handler: DurableJobHandler,
    error: unknown,
  ): Promise<void> {
    const requested = this.options.repository.requestedState(active.job.id, this.options.workerId);
    if (requested === 'PAUSE_REQUESTED') {
      this.options.repository.settleStopped(
        active.job.id,
        this.options.workerId,
        'PAUSED',
        this.now(),
      );
      return;
    }
    if (requested === 'CANCEL_REQUESTED') {
      if (this.options.repository.removePartialOnCancel(active.job.id)) {
        await handler.cleanupCancelled?.({
          job: active.job,
          signal: active.controller.signal,
          progress: () => undefined,
        });
      }
      this.options.repository.settleStopped(
        active.job.id,
        this.options.workerId,
        'CANCELLED',
        this.now(),
      );
      return;
    }
    if (this.stopping) {
      this.options.repository.settleStopped(
        active.job.id,
        this.options.workerId,
        'INTERRUPTED',
        this.now(),
      );
      return;
    }
    const operationError = error instanceof BackupOperationError ? error : internalFailure();
    if (operationError.disposition === 'BLOCK') {
      this.options.repository.fail(
        active.job.id,
        this.options.workerId,
        {
          code: operationError.code,
          safeMessage: operationError.message,
          retryAt: null,
          status: 'BLOCKED',
        },
        this.now(),
      );
      return;
    }
    const attempt = active.job.attemptCount;
    if (operationError.disposition === 'RETRY' && attempt < active.job.maxAttempts) {
      const base =
        operationError.retryAfterMs ??
        RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)]!;
      const jitter = 0.9 + this.random() * 0.2;
      const now = this.now();
      this.options.repository.fail(
        active.job.id,
        this.options.workerId,
        {
          code: operationError.code,
          safeMessage: operationError.message,
          retryAt: now + Math.round(base * jitter),
          status: 'RETRY_WAIT',
        },
        now,
      );
      return;
    }
    this.options.repository.fail(
      active.job.id,
      this.options.workerId,
      {
        code: operationError.code,
        safeMessage: operationError.message,
        retryAt: null,
        status: 'FAILED',
      },
      this.now(),
    );
  }

  private recordProgress(active: ActiveExecution, progress: PersistedJobProgress): void {
    active.pendingProgress = progress;
    if (this.now() - active.lastPersistedAt >= this.progressPersistIntervalMs) {
      this.flushProgress(active);
    }
  }

  private flushProgress(active: ActiveExecution): void {
    if (active.pendingProgress === null) return;
    const now = this.now();
    this.options.repository.persistProgress(
      active.job.id,
      this.options.workerId,
      active.pendingProgress,
      now,
    );
    active.pendingProgress = null;
    active.lastPersistedAt = now;
  }

  private heartbeat(): void {
    const now = this.now();
    for (const active of this.active.values()) {
      const renewed = this.options.repository.renewLease(
        active.job.id,
        this.options.workerId,
        now,
        now + this.leaseDurationMs,
      );
      if (!renewed) active.controller.abort(new Error('Job lease was lost'));
      else this.flushProgress(active);
    }
  }
}
