import {
  JobControlActionSchema,
  QueueCompletedMediaDtoSchema,
  QueueJobDtoSchema,
  QueueQuerySchema,
  QueueSnapshotSchema,
  RunControlActionSchema,
  type JobControlAction,
  type JobStatus,
  type JobType,
  type QueueCompletedMediaDto,
  type QueueJobDto,
  type QueueQuery,
  type QueueSnapshot,
  type RunControlAction,
} from '@ytbm/core';
import {
  assertJobTransition,
  type DurableJobRecord,
  type DurableJobRepository,
  type JobFailure,
  type PersistedJobProgress,
} from '@ytbm/job-engine';

import type { WorkerDatabase } from '../database';

interface JobRow {
  id: string;
  backup_run_id: string | null;
  operation_type: string | null;
  channel_id: string | null;
  media_item_id: string | null;
  media_title: string | null;
  destination_id: string | null;
  destination_path: string | null;
  destination_type: 'FILESYSTEM' | 'GOOGLE_DRIVE' | null;
  job_type: string;
  status: string;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  progress_ratio: number | null;
  bytes_processed: number;
  bytes_total: number | null;
  speed_bytes_per_sec: number | null;
  eta_seconds: number | null;
  payload_json: string;
  next_retry_at: number | null;
  error_code: string | null;
  error_message_safe: string | null;
  created_at: number;
  updated_at: number;
}

interface CompletedMediaRow {
  media_item_id: string;
  media_title: string;
  destination_paths: string;
  verified_copy_count: number;
  bytes: number | null;
  verified_at: number;
}

function parsePayload(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function durableRecord(row: JobRow): DurableJobRecord {
  return {
    id: row.id,
    backupRunId: row.backup_run_id,
    channelId: row.channel_id,
    mediaItemId: row.media_item_id,
    destinationId: row.destination_id,
    jobType: row.job_type as JobType,
    status: row.status as JobStatus,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    payload: parsePayload(row.payload_json),
  };
}

function queueDto(row: JobRow): QueueJobDto {
  return QueueJobDtoSchema.parse({
    id: row.id,
    backupRunId: row.backup_run_id,
    operationType: row.operation_type,
    channelId: row.channel_id,
    mediaItemId: row.media_item_id,
    mediaTitle: row.media_title,
    destinationId: row.destination_id,
    destinationPath: row.destination_path,
    destinationType: row.destination_type,
    jobType: row.job_type,
    status: row.status,
    priority: row.priority,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    progressRatio: row.progress_ratio,
    bytesProcessed: row.bytes_processed,
    bytesTotal: row.bytes_total,
    speedBytesPerSec: row.speed_bytes_per_sec,
    etaSeconds: row.eta_seconds,
    errorCode: row.error_code,
    safeMessage: row.error_message_safe,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

const SELECT_JOB = `select j.*, br.trigger_type as operation_type, m.title as media_title,
  case when d.destination_type = 'GOOGLE_DRIVE'
    then 'Google Drive' || case when a.email is null then '' else ' - ' || a.email end
    else d.root_path end as destination_path,
  d.destination_type
  from jobs j
  left join backup_runs br on br.id = j.backup_run_id
  left join media_items m on m.id = j.media_item_id
  left join destinations d on d.id = j.destination_id
  left join accounts a on a.id = d.account_id`;

export class DurableJobSqlRepository implements DurableJobRepository {
  public constructor(private readonly database: WorkerDatabase) {}

  public recoverExpiredLeases(now: number): number {
    return this.database.sqlite
      .prepare(
        `update jobs set status = 'INTERRUPTED', lock_owner = null, lease_until = null,
          last_heartbeat_at = null, updated_at = ?
         where status in ('RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED')`,
      )
      .run(now).changes;
  }

  public getExecutionJob(jobId: string): DurableJobRecord {
    return durableRecord(this.getJobRow(jobId));
  }

  public requeueInterrupted(now: number): number {
    return this.database.sqlite
      .prepare(`update jobs set status = 'READY', updated_at = ? where status = 'INTERRUPTED'`)
      .run(now).changes;
  }

  public promoteDependencies(now: number): void {
    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `update jobs set status = 'READY', next_retry_at = null, updated_at = ?
           where status = 'RETRY_WAIT' and next_retry_at <= ?`,
        )
        .run(now, now);
      this.database.sqlite
        .prepare(
          `update jobs set status = 'BLOCKED', error_code = 'INTERNAL_ERROR',
            error_message_safe = 'A required backup operation failed.', updated_at = ?
           where status = 'PENDING' and exists (
             select 1 from job_dependencies jd join jobs dependency on dependency.id = jd.depends_on_job_id
             where jd.job_id = jobs.id and (
               dependency.status in ('FAILED', 'CANCELLED')
               or (dependency.status = 'BLOCKED' and dependency.error_code = 'INTERNAL_ERROR')
             )
           )`,
        )
        .run(now);
      this.database.sqlite
        .prepare(
          `update jobs set status = 'READY', updated_at = ?
           where status = 'PENDING'
             and not exists (
               select 1 from job_dependencies jd join jobs dependency on dependency.id = jd.depends_on_job_id
               where jd.job_id = jobs.id and dependency.status <> 'COMPLETED'
             )`,
        )
        .run(now);
    });
    transaction();
  }

  public claimNext(
    jobTypes: readonly JobType[],
    workerId: string,
    now: number,
    leaseUntil: number,
  ): DurableJobRecord | null {
    if (jobTypes.length === 0) return null;
    const placeholders = jobTypes.map(() => '?').join(', ');
    const transaction = this.database.sqlite.transaction(() => {
      const row = this.database.sqlite
        .prepare(
          `${SELECT_JOB}
           where j.status = 'READY' and j.job_type in (${placeholders})
             and not exists (
               select 1 from job_dependencies jd join jobs dependency on dependency.id = jd.depends_on_job_id
               where jd.job_id = j.id and dependency.status <> 'COMPLETED'
             )
           order by j.priority desc, j.created_at asc limit 1`,
        )
        .get(...jobTypes) as JobRow | undefined;
      if (row === undefined) return null;
      assertJobTransition('READY', 'RUNNING');
      const claimed = this.database.sqlite
        .prepare(
          `update jobs set status = 'RUNNING', lock_owner = ?, lease_until = ?,
            last_heartbeat_at = ?, attempt_count = attempt_count + 1,
            started_at = coalesce(started_at, ?), updated_at = ?
           where id = ? and status = 'READY'`,
        )
        .run(workerId, leaseUntil, now, now, now, row.id);
      if (claimed.changes !== 1) return null;
      this.database.sqlite
        .prepare(
          `insert into job_attempts (
            id, job_id, attempt_number, worker_instance_id, started_at, created_at
          ) values (?, ?, ?, ?, ?, ?)`,
        )
        .run(crypto.randomUUID(), row.id, row.attempt_count + 1, workerId, now, now);
      return { ...row, status: 'RUNNING', attempt_count: row.attempt_count + 1 };
    });
    const claimed = transaction() as JobRow | null;
    return claimed === null ? null : durableRecord(claimed);
  }

  public renewLease(jobId: string, workerId: string, now: number, leaseUntil: number): boolean {
    return (
      this.database.sqlite
        .prepare(
          `update jobs set last_heartbeat_at = ?, lease_until = ?, updated_at = ?
           where id = ? and status in ('RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED')
             and lock_owner = ?`,
        )
        .run(now, leaseUntil, now, jobId, workerId).changes === 1
    );
  }

  public persistProgress(
    jobId: string,
    workerId: string,
    progress: PersistedJobProgress,
    now: number,
  ): void {
    this.database.sqlite
      .prepare(
        `update jobs set bytes_processed = ?, bytes_total = ?, progress_ratio = ?,
          speed_bytes_per_sec = ?, eta_seconds = ?, updated_at = ?
         where id = ? and lock_owner = ? and status in ('RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED')`,
      )
      .run(
        progress.bytesProcessed,
        progress.bytesTotal,
        progress.progressRatio,
        progress.speedBytesPerSec,
        progress.etaSeconds,
        now,
        jobId,
        workerId,
      );
  }

  public requestedState(jobId: string, workerId: string): JobStatus | null {
    const row = this.database.sqlite
      .prepare('select status from jobs where id = ? and lock_owner = ?')
      .get(jobId, workerId) as { status: JobStatus } | undefined;
    return row?.status ?? null;
  }

  public removePartialOnCancel(jobId: string): boolean {
    const row = this.database.sqlite
      .prepare('select payload_json from jobs where id = ?')
      .get(jobId) as { payload_json: string } | undefined;
    const payload = row === undefined ? null : parsePayload(row.payload_json);
    return (
      payload !== null &&
      typeof payload === 'object' &&
      'removePartialOnCancel' in payload &&
      payload.removePartialOnCancel === true
    );
  }

  public complete(jobId: string, workerId: string, result: unknown, now: number): void {
    assertJobTransition(this.requiredOwnedStatus(jobId, workerId), 'COMPLETED');
    this.database.sqlite
      .prepare(
        `update jobs set status = 'COMPLETED', result_json = ?, progress_ratio = 1,
          lock_owner = null, lease_until = null, last_heartbeat_at = null,
          error_code = null, error_message_safe = null, completed_at = ?, updated_at = ?
         where id = ? and lock_owner = ? and status = 'RUNNING'`,
      )
      .run(JSON.stringify(result ?? null), now, now, jobId, workerId);
    this.finishAttempt(jobId, workerId, 'COMPLETED', null, null, now);
  }

  public settleStopped(
    jobId: string,
    workerId: string,
    status: 'PAUSED' | 'CANCELLED' | 'INTERRUPTED',
    now: number,
  ): void {
    const current = this.requiredOwnedStatus(jobId, workerId);
    assertJobTransition(current, status);
    this.database.sqlite
      .prepare(
        `update jobs set status = ?, lock_owner = null, lease_until = null,
          last_heartbeat_at = null, completed_at = ?, updated_at = ?
         where id = ? and lock_owner = ?`,
      )
      .run(status, status === 'CANCELLED' ? now : null, now, jobId, workerId);
    this.finishAttempt(jobId, workerId, status, null, null, now);
  }

  public fail(jobId: string, workerId: string, failure: JobFailure, now: number): void {
    const current = this.requiredOwnedStatus(jobId, workerId);
    assertJobTransition(current, failure.status);
    this.database.sqlite
      .prepare(
        `update jobs set status = ?, next_retry_at = ?,
          error_code = ?, error_message_safe = ?, lock_owner = null, lease_until = null,
          last_heartbeat_at = null, completed_at = ?, updated_at = ?
         where id = ? and lock_owner = ?`,
      )
      .run(
        failure.status,
        failure.retryAt,
        failure.code,
        failure.safeMessage,
        failure.status === 'FAILED' ? now : null,
        now,
        jobId,
        workerId,
      );
    this.finishAttempt(jobId, workerId, failure.status, failure.code, failure.safeMessage, now);
  }

  public hasExecutionWork(): boolean {
    const row = this.database.sqlite
      .prepare(
        `select 1 as found from jobs
         where status in ('PENDING', 'READY', 'RUNNING', 'RETRY_WAIT', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED')
            or (job_type = 'CLEANUP_STAGING' and status <> 'COMPLETED')
         limit 1`,
      )
      .get() as { found: number } | undefined;
    return row !== undefined;
  }

  public snapshot(input: QueueQuery = { section: 'ALL', page: 1, pageSize: 100 }): QueueSnapshot {
    const query = QueueQuerySchema.parse(input);
    const offset = (query.page - 1) * query.pageSize;
    const counts = this.database.sqlite
      .prepare(
        `select
          count(*) as total_jobs,
          sum(case when status in ('RUNNING','PAUSE_REQUESTED','CANCEL_REQUESTED') then 1 else 0 end) as active,
          sum(case when status in ('PENDING','READY') then 1 else 0 end) as pending,
          sum(case when job_type = 'DOWNLOAD_MEDIA' and status in ('PENDING','READY') then 1 else 0 end) as waiting_downloads,
          sum(case when status = 'PAUSED' then 1 else 0 end) as paused,
          sum(case when status = 'RETRY_WAIT' then 1 else 0 end) as retry_waiting,
          sum(case when status = 'BLOCKED' then 1 else 0 end) as blocked,
          sum(case when status = 'FAILED' then 1 else 0 end) as failed
         from jobs where job_type <> 'CHANNEL_SYNC'`,
      )
      .get() as Record<string, number | null>;
    const completedMediaCount = (
      this.database.sqlite
        .prepare(
          `select count(distinct mc.media_item_id) as count from media_copies mc
           join destinations d on d.id = mc.destination_id
           where mc.status = 'VERIFIED' and mc.verified_at is not null`,
        )
        .get() as { count: number }
    ).count;

    let jobs: QueueJobDto[] = [];
    let completedMedia: QueueCompletedMediaDto[] = [];
    let totalItems: number;
    if (query.section === 'COMPLETED') {
      totalItems = completedMediaCount;
      const rows = this.database.sqlite
        .prepare(
          `select m.id as media_item_id, m.title as media_title,
            group_concat(case when d.destination_type = 'GOOGLE_DRIVE'
              then 'Google Drive' || case when a.email is null then '' else ' - ' || a.email end
              else d.root_path end, char(31)) as destination_paths,
            count(*) as verified_copy_count, max(mc.bytes) as bytes,
            max(mc.verified_at) as verified_at
           from media_copies mc
           join media_items m on m.id = mc.media_item_id
           join destinations d on d.id = mc.destination_id
           left join accounts a on a.id = d.account_id
           where mc.status = 'VERIFIED' and mc.verified_at is not null
           group by m.id, m.title
           order by verified_at desc, m.title collate nocase
           limit ? offset ?`,
        )
        .all(query.pageSize, offset) as CompletedMediaRow[];
      completedMedia = rows.map((row) =>
        QueueCompletedMediaDtoSchema.parse({
          mediaItemId: row.media_item_id,
          mediaTitle: row.media_title,
          destinationPaths: row.destination_paths.split('\u001f'),
          verifiedCopyCount: row.verified_copy_count,
          bytes: row.bytes,
          verifiedAt: row.verified_at,
        }),
      );
    } else {
      const sectionWhere = {
        ACTIVE: "j.status in ('RUNNING','PAUSE_REQUESTED','CANCEL_REQUESTED')",
        WAITING_DOWNLOADS: "j.job_type = 'DOWNLOAD_MEDIA' and j.status in ('PENDING','READY')",
        RETRYING: "j.status = 'RETRY_WAIT'",
        PAUSED: "j.status = 'PAUSED'",
        ATTENTION: "j.status in ('BLOCKED','FAILED')",
        ALL: "j.job_type <> 'CHANNEL_SYNC'",
      } as const;
      const where = sectionWhere[query.section];
      totalItems = (
        this.database.sqlite
          .prepare(`select count(*) as count from jobs j where ${where}`)
          .get() as {
          count: number;
        }
      ).count;
      const rows = this.database.sqlite
        .prepare(
          `${SELECT_JOB}
           where ${where}
           order by
             case j.status
               when 'RUNNING' then 0 when 'PAUSE_REQUESTED' then 1 when 'CANCEL_REQUESTED' then 2
               when 'READY' then 3 when 'PENDING' then 4 when 'RETRY_WAIT' then 5
               when 'BLOCKED' then 6 when 'PAUSED' then 7 when 'FAILED' then 8 else 9 end,
             j.priority desc, j.updated_at desc limit ? offset ?`,
        )
        .all(query.pageSize, offset) as JobRow[];
      jobs = rows.map(queueDto);
    }

    return QueueSnapshotSchema.parse({
      jobs,
      completedMedia,
      section: query.section,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalJobCount: Number(counts.total_jobs ?? 0),
      activeCount: Number(counts.active ?? 0),
      pendingCount: Number(counts.pending ?? 0),
      waitingDownloadCount: Number(counts.waiting_downloads ?? 0),
      pausedCount: Number(counts.paused ?? 0),
      retryWaitingCount: Number(counts.retry_waiting ?? 0),
      blockedCount: Number(counts.blocked ?? 0),
      failedCount: Number(counts.failed ?? 0),
      completedMediaCount,
    });
  }

  public controlJob(jobId: string, actionInput: JobControlAction, now: number): QueueJobDto {
    const action = JobControlActionSchema.parse(actionInput);
    const row = this.getJobRow(jobId);
    if (action === 'MOVE_TOP' || action === 'PRIORITY_UP' || action === 'PRIORITY_DOWN') {
      const priority =
        action === 'MOVE_TOP'
          ? (
              this.database.sqlite
                .prepare('select coalesce(max(priority), 0) + 100 as value from jobs')
                .get() as { value: number }
            ).value
          : row.priority + (action === 'PRIORITY_UP' ? 10 : -10);
      this.database.sqlite
        .prepare('update jobs set priority = ?, updated_at = ? where id = ?')
        .run(priority, now, jobId);
      return queueDto(this.getJobRow(jobId));
    }
    if (action === 'PAUSE') {
      if (row.status === 'RUNNING') this.transition(row, 'PAUSE_REQUESTED', now);
      else if (row.status === 'PENDING' || row.status === 'READY')
        this.transition(row, 'PAUSED', now);
    } else if (action === 'RESUME' && row.status === 'PAUSED') {
      this.transition(row, 'READY', now);
    } else if (action.startsWith('CANCEL_')) {
      const payload = parsePayload(row.payload_json);
      const updatedPayload = {
        ...(payload !== null && typeof payload === 'object' ? payload : {}),
        removePartialOnCancel: action === 'CANCEL_REMOVE_PARTIAL',
      };
      this.database.sqlite
        .prepare('update jobs set payload_json = ?, updated_at = ? where id = ?')
        .run(JSON.stringify(updatedPayload), now, jobId);
      if (row.status === 'RUNNING' || row.status === 'PAUSE_REQUESTED') {
        this.transition(this.getJobRow(jobId), 'CANCEL_REQUESTED', now);
      } else if (['PENDING', 'READY', 'PAUSED', 'RETRY_WAIT', 'BLOCKED'].includes(row.status)) {
        this.transition(this.getJobRow(jobId), 'CANCELLED', now);
      }
    }
    return queueDto(this.getJobRow(jobId));
  }

  public controlRun(runId: string, actionInput: RunControlAction, now: number): void {
    const action = RunControlActionSchema.parse(actionInput);
    const rows = this.database.sqlite
      .prepare(`${SELECT_JOB} where j.backup_run_id = ?`)
      .all(runId) as JobRow[];
    const mappedAction: JobControlAction =
      action === 'PAUSE' ? 'PAUSE' : action === 'RESUME' ? 'RESUME' : 'CANCEL_KEEP_PARTIAL';
    for (const row of rows) this.controlJob(row.id, mappedAction, now);
  }

  public unblockDestination(destinationId: string, now: number): number {
    return this.database.sqlite
      .prepare(
        `update jobs set status = 'READY', error_code = null, error_message_safe = null, updated_at = ?
         where destination_id = ? and status = 'BLOCKED'
           and error_code in ('DESTINATION_DISCONNECTED','AUTH_REVOKED','NETWORK_UNAVAILABLE')`,
      )
      .run(now, destinationId).changes;
  }

  private getJobRow(jobId: string): JobRow {
    const row = this.database.sqlite.prepare(`${SELECT_JOB} where j.id = ?`).get(jobId) as
      JobRow | undefined;
    if (row === undefined) throw new Error('Backup job was not found');
    return row;
  }

  private transition(row: JobRow, next: JobStatus, now: number): void {
    assertJobTransition(row.status as JobStatus, next);
    this.database.sqlite
      .prepare(
        `update jobs set status = ?, completed_at = ?, updated_at = ? where id = ? and status = ?`,
      )
      .run(next, next === 'CANCELLED' ? now : null, now, row.id, row.status);
  }

  private requiredOwnedStatus(jobId: string, workerId: string): JobStatus {
    const row = this.database.sqlite
      .prepare('select status from jobs where id = ? and lock_owner = ?')
      .get(jobId, workerId) as { status: JobStatus } | undefined;
    if (row === undefined) throw new Error('Job lease ownership was lost');
    return row.status;
  }

  private finishAttempt(
    jobId: string,
    workerId: string,
    status: string,
    errorCode: string | null,
    safeMessage: string | null,
    now: number,
  ): void {
    this.database.sqlite
      .prepare(
        `update job_attempts set finished_at = ?, result_status = ?, error_code = ?,
          error_message_safe = ? where id = (
            select id from job_attempts where job_id = ? and worker_instance_id = ?
            and finished_at is null order by started_at desc limit 1
          )`,
      )
      .run(now, status, errorCode, safeMessage, jobId, workerId);
  }
}
