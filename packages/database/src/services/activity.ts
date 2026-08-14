import {
  ActivityAttentionPageSchema,
  ActivityAttentionQuerySchema,
  ActivityEntityResolutionSchema,
  ActivityLogPageSchema,
  ActivityLogQuerySchema,
  ActivityOperationDetailsQuerySchema,
  ActivityOperationDetailsSchema,
  ActivityRunDetailsQuerySchema,
  ActivityRunDetailsSchema,
  ActivityOperationsPageSchema,
  ActivityOperationsQuerySchema,
  BackupRunDtoSchema,
  BackupRunHistoryPageSchema,
  BackupRunHistoryQuerySchema,
  type ActivityAttentionIssueDto,
  type ActivityAttentionPage,
  type ActivityAttentionQuery,
  type ActivityDestinationBranch,
  type ActivityEntityResolution,
  type ActivityLogCategory,
  type ActivityLogPage,
  type ActivityLogQuery,
  type ActivityOperationDetails,
  type ActivityOperationDetailsQuery,
  type ActivityOperationDto,
  type ActivityOperationStatus,
  type ActivityOperationsPage,
  type ActivityOperationsQuery,
  type ActivityTechnicalJobDto,
  type ActivityRunDetails,
  type ActivityRunDetailsQuery,
  type ActivityUserPhase,
  type BackupRunDto,
  type BackupRunHistoryPage,
  type BackupRunHistoryQuery,
  type JobControlAction,
  type JobStatus,
  type JobType,
  type RunControlAction,
} from '@ytbm/core';

import type { WorkerDatabase } from '../database';

interface OperationKeyRow {
  run_id: string;
  media_item_id: string | null;
  updated_at: number;
}

interface ActivityJobRow {
  id: string;
  backup_run_id: string;
  trigger_type: ActivityOperationDto['triggerType'];
  run_status: BackupRunDto['status'];
  channel_id: string;
  channel_title: string;
  media_item_id: string | null;
  media_title: string | null;
  destination_id: string | null;
  destination_type: ActivityDestinationBranch['destinationType'] | null;
  destination_label: string | null;
  job_type: JobType;
  status: JobStatus;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  progress_ratio: number | null;
  bytes_processed: number;
  bytes_total: number | null;
  speed_bytes_per_sec: number | null;
  eta_seconds: number | null;
  next_retry_at: number | null;
  error_code: ActivityTechnicalJobDto['errorCode'];
  error_message_safe: string | null;
  created_at: number;
  updated_at: number;
}

interface BackupRunRow {
  id: string;
  channel_id: string;
  channel_title: string;
  trigger_type: BackupRunDto['triggerType'];
  status: BackupRunDto['status'];
  effective_config_json: string;
  discovered_count: number;
  downloaded_count: number;
  local_copy_count: number;
  drive_upload_count: number;
  metadata_update_count: number;
  failed_count: number;
  bytes_downloaded: number;
  bytes_transferred: number;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
}

const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  'PENDING',
  'READY',
  'RUNNING',
  'PAUSE_REQUESTED',
  'PAUSED',
  'RETRY_WAIT',
  'CANCEL_REQUESTED',
  'INTERRUPTED',
  'BLOCKED',
];

const JOB_SELECT = `select j.id, j.backup_run_id, br.trigger_type, br.status as run_status,
  j.channel_id, c.title as channel_title, j.media_item_id, m.title as media_title,
  j.destination_id, d.destination_type,
  case when d.destination_type = 'GOOGLE_DRIVE'
    then 'Google Drive' || case when a.email is null then '' else ' - ' || a.email end
    else 'Local' end as destination_label,
  j.job_type, j.status, j.priority, j.attempt_count, j.max_attempts, j.progress_ratio,
  j.bytes_processed, j.bytes_total, j.speed_bytes_per_sec, j.eta_seconds, j.next_retry_at,
  j.error_code, j.error_message_safe, j.created_at, j.updated_at
  from jobs j
  join backup_runs br on br.id = j.backup_run_id
  join channels c on c.id = j.channel_id
  left join media_items m on m.id = j.media_item_id
  left join destinations d on d.id = j.destination_id
  left join accounts a on a.id = d.account_id`;

function operationId(runId: string, mediaItemId: string | null): string {
  return `operation:${runId}:${mediaItemId ?? 'run'}`;
}

function parseOperationId(value: string): { runId: string; mediaItemId: string | null } {
  const match = /^operation:([0-9a-f-]{36}):(run|[0-9a-f-]{36})$/i.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error('Activity operation was not found');
  }
  return { runId: match[1], mediaItemId: match[2] === 'run' ? null : match[2] };
}

function backupRunDto(row: BackupRunRow): BackupRunDto {
  const config = JSON.parse(row.effective_config_json) as {
    qualityProfile: unknown;
    destinationIds: unknown;
  };
  return BackupRunDtoSchema.parse({
    id: row.id,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    triggerType: row.trigger_type,
    status: row.status,
    effectiveQualityProfile: config.qualityProfile,
    destinationIds: config.destinationIds,
    discoveredCount: row.discovered_count,
    downloadedCount: row.downloaded_count,
    localCopyCount: row.local_copy_count,
    driveUploadCount: row.drive_upload_count,
    metadataUpdateCount: row.metadata_update_count,
    failedCount: row.failed_count,
    bytesDownloaded: row.bytes_downloaded,
    bytesTransferred: row.bytes_transferred,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  });
}

function aggregateStatus(rows: readonly ActivityJobRow[]): ActivityOperationStatus {
  const statuses = new Set(rows.map((row) => row.status));
  if (statuses.has('CANCEL_REQUESTED')) return 'CANCEL_REQUESTED';
  if (statuses.has('PAUSE_REQUESTED')) return 'PAUSE_REQUESTED';
  if (statuses.has('RUNNING')) return 'RUNNING';
  if (statuses.has('RETRY_WAIT')) return 'RETRY_WAIT';
  if (statuses.has('PAUSED')) return 'PAUSED';
  if (statuses.has('READY') || statuses.has('PENDING')) return 'QUEUED';
  if (statuses.has('INTERRUPTED')) return 'INTERRUPTED';
  if (statuses.has('BLOCKED')) return 'BLOCKED';
  if (statuses.has('FAILED')) {
    return statuses.has('COMPLETED') ? 'COMPLETED_WITH_ISSUES' : 'FAILED';
  }
  if (statuses.has('CANCELLED') && !statuses.has('COMPLETED')) return 'CANCELLED';
  return 'COMPLETED';
}

function jobPhase(row: ActivityJobRow): ActivityUserPhase {
  if (row.trigger_type === 'REPAIR') return 'REPAIRING_BACKUP';
  const phases: Readonly<Partial<Record<JobType, ActivityUserPhase>>> = {
    FORMAT_PROBE: 'PREPARING',
    DOWNLOAD_MEDIA: 'DOWNLOADING',
    DOWNLOAD_THUMBNAIL: 'DOWNLOADING',
    POST_PROCESS_MEDIA: 'PROCESSING_MEDIA',
    HASH_STAGING_MEDIA: 'CHECKING_DOWNLOAD',
    VERIFY_STAGING_MEDIA: 'CHECKING_DOWNLOAD',
    WRITE_STAGING_METADATA: 'PREPARING',
    COPY_TO_FILESYSTEM: 'COPYING_LOCAL',
    VERIFY_FILESYSTEM_COPY: 'VERIFYING_LOCAL',
    WRITE_DESTINATION_METADATA: 'FINALIZING',
    UPDATE_MANIFEST: 'FINALIZING',
    ENSURE_GOOGLE_DRIVE_ROOT: 'PREPARING',
    ENSURE_GOOGLE_DRIVE_FOLDER: 'PREPARING',
    UPLOAD_TO_GOOGLE_DRIVE: 'UPLOADING_DRIVE',
    VERIFY_GOOGLE_DRIVE_COPY: 'VERIFYING_DRIVE',
    DOWNLOAD_FROM_GOOGLE_DRIVE: 'DOWNLOADING_DRIVE',
    RECONCILE_GOOGLE_DRIVE_OBJECT: 'VERIFYING_DRIVE',
    UPDATE_GOOGLE_DRIVE_METADATA: 'FINALIZING',
    UPDATE_GOOGLE_DRIVE_THUMBNAIL: 'FINALIZING',
    UPDATE_GOOGLE_DRIVE_MANIFEST: 'FINALIZING',
    CLEANUP_STAGING: 'FINALIZING',
    VERIFY_EXISTING_COPY: 'VERIFYING_BACKUP',
  };
  return phases[row.job_type] ?? 'WAITING';
}

function currentRow(rows: readonly ActivityJobRow[]): ActivityJobRow {
  const rank: Readonly<Record<JobStatus, number>> = {
    RUNNING: 0,
    PAUSE_REQUESTED: 1,
    CANCEL_REQUESTED: 2,
    RETRY_WAIT: 3,
    READY: 4,
    PENDING: 5,
    PAUSED: 6,
    INTERRUPTED: 7,
    BLOCKED: 8,
    FAILED: 9,
    COMPLETED: 10,
    CANCELLED: 11,
  };
  return [...rows].sort((left, right) => rank[left.status] - rank[right.status])[0]!;
}

function availableOperationActions(rows: readonly ActivityJobRow[]): RunControlAction[] {
  const statuses = new Set(rows.map((row) => row.status));
  const actions: RunControlAction[] = [];
  if (['PENDING', 'READY', 'RUNNING'].some((status) => statuses.has(status as JobStatus))) {
    actions.push('PAUSE');
  }
  if (statuses.has('PAUSED')) actions.push('RESUME');
  if (
    ['PENDING', 'READY', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED', 'RETRY_WAIT', 'BLOCKED'].some(
      (status) => statuses.has(status as JobStatus),
    )
  ) {
    actions.push('CANCEL_KEEP_PARTIAL');
  }
  return actions;
}

function destinationBranches(rows: readonly ActivityJobRow[]): ActivityDestinationBranch[] {
  const groups = new Map<string, ActivityJobRow[]>();
  for (const row of rows) {
    if (row.destination_id === null || row.destination_type === null) continue;
    const group = groups.get(row.destination_id) ?? [];
    group.push(row);
    groups.set(row.destination_id, group);
  }
  return [...groups.entries()].map(([destinationId, jobs]) => {
    const failed = jobs.find((job) => job.status === 'FAILED' || job.status === 'BLOCKED');
    return {
      destinationId,
      destinationType: jobs[0]!.destination_type!,
      label: jobs[0]!.destination_label ?? 'Backup destination',
      status: aggregateStatus(jobs),
      completedSteps: jobs.filter((job) => job.status === 'COMPLETED').length,
      totalSteps: jobs.length,
      safeMessage: failed?.error_message_safe ?? null,
    };
  });
}

function activityOperation(rows: readonly ActivityJobRow[]): ActivityOperationDto {
  if (rows.length === 0) throw new Error('Activity operation was not found');
  const current = currentRow(rows);
  const explicitProgress = rows.filter((row) => row.progress_ratio !== null);
  const completed = rows.filter((row) => row.status === 'COMPLETED').length;
  const progressRatio =
    explicitProgress.length > 0
      ? explicitProgress.reduce((total, row) => total + row.progress_ratio!, 0) /
        explicitProgress.length
      : completed / rows.length;
  const failures = rows.filter((row) => row.status === 'FAILED' || row.status === 'BLOCKED');
  const bytesTotalValues = rows
    .map((row) => row.bytes_total)
    .filter((value): value is number => value !== null);
  return {
    id: operationId(current.backup_run_id, current.media_item_id),
    runId: current.backup_run_id,
    mediaItemId: current.media_item_id,
    channelId: current.channel_id,
    channelTitle: current.channel_title,
    title: current.media_title ?? `${current.channel_title} backup`,
    triggerType: current.trigger_type,
    status: aggregateStatus(rows),
    phase: jobPhase(current),
    progressRatio: Math.max(0, Math.min(1, progressRatio)),
    completedSteps: completed,
    totalSteps: rows.length,
    bytesProcessed: rows.reduce((total, row) => total + row.bytes_processed, 0),
    bytesTotal:
      bytesTotalValues.length === 0
        ? null
        : bytesTotalValues.reduce((total, value) => total + value, 0),
    speedBytesPerSec: current.speed_bytes_per_sec,
    etaSeconds: current.eta_seconds,
    nextRetryAt:
      rows.map((row) => row.next_retry_at).find((value): value is number => value !== null) ?? null,
    safeMessage: failures[0]?.error_message_safe ?? null,
    issueCount: failures.length,
    destinationBranches: destinationBranches(rows),
    availableActions: availableOperationActions(rows),
    sourceJobIds: rows.map((row) => row.id),
    createdAt: Math.min(...rows.map((row) => row.created_at)),
    updatedAt: Math.max(...rows.map((row) => row.updated_at)),
  };
}

function technicalActions(row: ActivityJobRow): JobControlAction[] {
  const actions: JobControlAction[] = [];
  if (['PENDING', 'READY', 'RUNNING'].includes(row.status)) actions.push('PAUSE');
  if (row.status === 'PAUSED') actions.push('RESUME');
  if (
    ['PENDING', 'READY', 'RUNNING', 'PAUSE_REQUESTED', 'PAUSED', 'RETRY_WAIT', 'BLOCKED'].includes(
      row.status,
    )
  ) {
    actions.push('CANCEL_KEEP_PARTIAL');
    if (row.job_type === 'DOWNLOAD_MEDIA' || row.job_type === 'DOWNLOAD_FROM_GOOGLE_DRIVE') {
      actions.push('CANCEL_REMOVE_PARTIAL');
    }
  }
  if (['PENDING', 'READY', 'PAUSED', 'RETRY_WAIT'].includes(row.status)) {
    actions.push('MOVE_TOP', 'PRIORITY_UP', 'PRIORITY_DOWN');
  }
  return actions;
}

function logCategory(eventType: string): Exclude<ActivityLogCategory, 'ALL'> {
  if (eventType.startsWith('INTEGRITY_') || eventType.endsWith('_VERIFIED')) return 'INTEGRITY';
  if (eventType.startsWith('REPAIR_')) return 'REPAIRS';
  if (eventType.startsWith('SCHEDULE_') || eventType === 'STARTUP_TRIGGERED') return 'SCHEDULES';
  if (eventType.startsWith('DESTINATION_') || eventType === 'AUTH_REQUIRED') return 'DESTINATIONS';
  if (
    eventType.includes('MEDIA_') ||
    eventType.includes('PLAYLIST_') ||
    eventType === 'TITLE_CHANGED' ||
    eventType === 'THUMBNAIL_CHANGED'
  ) {
    return 'ARCHIVE_CHANGES';
  }
  return 'BACKUPS';
}

function eventTitle(eventType: string): string {
  const titles: Readonly<Record<string, string>> = {
    BACKUP_STARTED: 'Backup started',
    BACKUP_COMPLETED: 'Backup completed',
    BACKUP_FAILED: 'Backup failed',
    MEDIA_DISCOVERED: 'Media added to the archive',
    MEDIA_REMOVED_FROM_SOURCE: 'Media removed from YouTube',
    TITLE_CHANGED: 'Title changed',
    THUMBNAIL_CHANGED: 'Thumbnail changed',
    PLAYLIST_REMOVED_FROM_SOURCE: 'Playlist removed from YouTube',
    PLAYLIST_MEMBERSHIP_CHANGED: 'Playlist membership changed',
    DESTINATION_DISCONNECTED: 'Destination disconnected',
    DESTINATION_RECONNECTED: 'Destination reconnected',
    AUTH_REQUIRED: 'Authorization required',
    INTEGRITY_STARTED: 'Integrity check started',
    INTEGRITY_COMPLETED: 'Integrity check completed',
    INTEGRITY_MISSING: 'Backup copy missing',
    INTEGRITY_CORRUPT: 'Backup copy corrupt',
    INTEGRITY_PROBLEM: 'Integrity problem found',
    REPAIR_STARTED: 'Repair started',
    REPAIR_COMPLETED: 'Repair completed',
    REPAIR_FAILED: 'Repair failed',
    SCHEDULE_CREATED: 'Schedule created',
    SCHEDULE_UPDATED: 'Schedule updated',
    SCHEDULE_DISABLED: 'Schedule disabled',
    SCHEDULE_TRIGGERED: 'Scheduled backup started',
    LOCAL_COPY_VERIFIED: 'Local copy verified',
    GOOGLE_DRIVE_COPY_VERIFIED: 'Google Drive copy verified',
  };
  return titles[eventType] ?? 'Archive activity';
}

export class ActivitySqlRepository {
  public constructor(private readonly database: WorkerDatabase) {}

  public listOperations(input: ActivityOperationsQuery): ActivityOperationsPage {
    const query = ActivityOperationsQuerySchema.parse(input);
    const placeholders = ACTIVE_JOB_STATUSES.map(() => '?').join(', ');
    const offset = (query.page - 1) * query.pageSize;
    const base = `from jobs j where j.backup_run_id is not null and j.job_type <> 'CHANNEL_SYNC'
      and exists (
        select 1 from jobs active
        where active.backup_run_id = j.backup_run_id
          and active.media_item_id is j.media_item_id
          and active.status in (${placeholders})
      )`;
    const totalItems = (
      this.database.sqlite
        .prepare(
          `select count(*) as count from (
            select j.backup_run_id, j.media_item_id ${base}
            group by j.backup_run_id, j.media_item_id
          )`,
        )
        .get(...ACTIVE_JOB_STATUSES) as { count: number }
    ).count;
    const keys = this.database.sqlite
      .prepare(
        `select j.backup_run_id as run_id, j.media_item_id,
          max(j.updated_at) as updated_at ${base}
         group by j.backup_run_id, j.media_item_id
         order by updated_at desc limit ? offset ?`,
      )
      .all(...ACTIVE_JOB_STATUSES, query.pageSize, offset) as OperationKeyRow[];
    const operations = keys.map((key) => activityOperation(this.operationRows(key)));
    const counts = this.database.sqlite
      .prepare(
        `select
          count(distinct case when status in ('RUNNING','PAUSE_REQUESTED','CANCEL_REQUESTED')
            then backup_run_id || ':' || coalesce(media_item_id, 'run') end) as active,
          count(distinct case when status = 'PAUSED'
            then backup_run_id || ':' || coalesce(media_item_id, 'run') end) as paused,
          count(distinct case when status = 'RETRY_WAIT'
            then backup_run_id || ':' || coalesce(media_item_id, 'run') end) as retrying,
          count(distinct case when status in ('FAILED','BLOCKED')
            then backup_run_id || ':' || coalesce(media_item_id, 'run') end) as attention
         from jobs where backup_run_id is not null and job_type <> 'CHANNEL_SYNC'`,
      )
      .get() as { active: number; paused: number; retrying: number; attention: number };
    return ActivityOperationsPageSchema.parse({
      operations,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      activeCount: counts.active,
      pausedCount: counts.paused,
      retryingCount: counts.retrying,
      attentionCount: counts.attention,
    });
  }

  public operationDetails(input: ActivityOperationDetailsQuery): ActivityOperationDetails {
    const query = ActivityOperationDetailsQuerySchema.parse(input);
    const key = parseOperationId(query.operationId);
    const rows = this.operationRows({
      run_id: key.runId,
      media_item_id: key.mediaItemId,
      updated_at: 0,
    });
    const offset = (query.page - 1) * query.pageSize;
    const selected = rows.slice(offset, offset + query.pageSize);
    const dependencyStatement = this.database.sqlite.prepare(
      'select depends_on_job_id from job_dependencies where job_id = ?',
    );
    const technicalJobs: ActivityTechnicalJobDto[] = selected.map((row) => ({
      id: row.id,
      jobType: row.job_type,
      status: row.status,
      destinationId: row.destination_id,
      destinationLabel: row.destination_label,
      priority: row.priority,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      progressRatio: row.progress_ratio,
      bytesProcessed: row.bytes_processed,
      bytesTotal: row.bytes_total,
      errorCode: row.error_code,
      safeMessage: row.error_message_safe,
      nextRetryAt: row.next_retry_at,
      dependsOnJobIds: (
        dependencyStatement.all(row.id) as Array<{ depends_on_job_id: string }>
      ).map((dependency) => dependency.depends_on_job_id),
      availableActions: technicalActions(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return ActivityOperationDetailsSchema.parse({
      operation: activityOperation(rows),
      run: this.getRun(key.runId),
      technicalJobs,
      page: query.page,
      pageSize: query.pageSize,
      totalJobs: rows.length,
    });
  }

  public operationJobIds(operationIdValue: string, action: RunControlAction): string[] {
    const key = parseOperationId(operationIdValue);
    const statuses: Readonly<Record<RunControlAction, readonly JobStatus[]>> = {
      PAUSE: ['PENDING', 'READY', 'RUNNING'],
      RESUME: ['PAUSED'],
      CANCEL_KEEP_PARTIAL: [
        'PENDING',
        'READY',
        'RUNNING',
        'PAUSE_REQUESTED',
        'PAUSED',
        'RETRY_WAIT',
        'BLOCKED',
      ],
    };
    const allowed = new Set(statuses[action]);
    return this.operationRows({ run_id: key.runId, media_item_id: key.mediaItemId, updated_at: 0 })
      .filter((row) => allowed.has(row.status))
      .map((row) => row.id);
  }

  public listRunHistory(input: BackupRunHistoryQuery): BackupRunHistoryPage {
    const query = BackupRunHistoryQuerySchema.parse(input);
    const where: string[] = ["br.trigger_type in ('MANUAL','CUSTOM_MANUAL','SCHEDULED','STARTUP')"];
    const parameters: Array<string | number> = [];
    if (query.status !== null) {
      where.push('br.status = ?');
      parameters.push(query.status);
    }
    if (query.triggerType !== null) {
      where.push('br.trigger_type = ?');
      parameters.push(query.triggerType);
    }
    if (query.channelId !== null) {
      where.push('br.channel_id = ?');
      parameters.push(query.channelId);
    }
    if (query.destinationId !== null) {
      where.push(
        'exists (select 1 from jobs destination_job where destination_job.backup_run_id = br.id and destination_job.destination_id = ?)',
      );
      parameters.push(query.destinationId);
    }
    if (query.from !== null) {
      where.push('br.created_at >= ?');
      parameters.push(query.from);
    }
    if (query.to !== null) {
      where.push('br.created_at <= ?');
      parameters.push(query.to);
    }
    const clause = where.join(' and ');
    const totalItems = (
      this.database.sqlite
        .prepare(`select count(*) as count from backup_runs br where ${clause}`)
        .get(...parameters) as { count: number }
    ).count;
    const rows = this.database.sqlite
      .prepare(
        `select br.*, c.title as channel_title from backup_runs br
         join channels c on c.id = br.channel_id where ${clause}
         order by br.created_at desc limit ? offset ?`,
      )
      .all(...parameters, query.pageSize, (query.page - 1) * query.pageSize) as BackupRunRow[];
    return BackupRunHistoryPageSchema.parse({
      runs: rows.map(backupRunDto),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
    });
  }

  public runDetails(input: ActivityRunDetailsQuery): ActivityRunDetails {
    const query = ActivityRunDetailsQuerySchema.parse(input);
    const rows = this.database.sqlite
      .prepare(`${JOB_SELECT} where j.backup_run_id = ? order by j.created_at asc limit ? offset ?`)
      .all(query.runId, query.pageSize, (query.page - 1) * query.pageSize) as ActivityJobRow[];
    const totalJobs = (
      this.database.sqlite
        .prepare('select count(*) as count from jobs where backup_run_id = ?')
        .get(query.runId) as { count: number }
    ).count;
    const dependencyStatement = this.database.sqlite.prepare(
      'select depends_on_job_id from job_dependencies where job_id = ?',
    );
    return ActivityRunDetailsSchema.parse({
      run: this.getRun(query.runId),
      technicalJobs: rows.map((row) => ({
        id: row.id,
        jobType: row.job_type,
        status: row.status,
        destinationId: row.destination_id,
        destinationLabel: row.destination_label,
        priority: row.priority,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        progressRatio: row.progress_ratio,
        bytesProcessed: row.bytes_processed,
        bytesTotal: row.bytes_total,
        errorCode: row.error_code,
        safeMessage: row.error_message_safe,
        nextRetryAt: row.next_retry_at,
        dependsOnJobIds: (
          dependencyStatement.all(row.id) as Array<{ depends_on_job_id: string }>
        ).map((dependency) => dependency.depends_on_job_id),
        availableActions: technicalActions(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalJobs,
    });
  }

  public listLog(input: ActivityLogQuery): ActivityLogPage {
    const query = ActivityLogQuerySchema.parse(input);
    const where: string[] = [];
    const parameters: Array<string | number> = [];
    const categoryClauses: Readonly<Record<Exclude<ActivityLogCategory, 'ALL'>, string>> = {
      BACKUPS: "al.event_type like 'BACKUP_%'",
      ARCHIVE_CHANGES:
        "(al.event_type like 'MEDIA_%' or al.event_type like 'PLAYLIST_%' or al.event_type in ('TITLE_CHANGED','THUMBNAIL_CHANGED'))",
      DESTINATIONS: "(al.event_type like 'DESTINATION_%' or al.event_type = 'AUTH_REQUIRED')",
      INTEGRITY: "(al.event_type like 'INTEGRITY_%' or al.event_type like '%_VERIFIED')",
      REPAIRS: "al.event_type like 'REPAIR_%'",
      SCHEDULES: "(al.event_type like 'SCHEDULE_%' or al.event_type = 'STARTUP_TRIGGERED')",
    };
    if (query.category !== 'ALL') where.push(categoryClauses[query.category]);
    for (const [column, value] of [
      ['al.channel_id', query.channelId],
      ['al.media_item_id', query.mediaItemId],
      ['al.destination_id', query.destinationId],
    ] as const) {
      if (value !== null) {
        where.push(`${column} = ?`);
        parameters.push(value);
      }
    }
    if (query.from !== null) {
      where.push('al.created_at >= ?');
      parameters.push(query.from);
    }
    if (query.to !== null) {
      where.push('al.created_at <= ?');
      parameters.push(query.to);
    }
    const clause = where.length === 0 ? '1 = 1' : where.join(' and ');
    const totalItems = (
      this.database.sqlite
        .prepare(`select count(*) as count from activity_log al where ${clause}`)
        .get(...parameters) as { count: number }
    ).count;
    const rows = this.database.sqlite
      .prepare(
        `select al.*, c.title as channel_title, m.title as media_title,
          case when d.destination_type = 'GOOGLE_DRIVE'
            then 'Google Drive' || case when a.email is null then '' else ' - ' || a.email end
            else 'Local' end as destination_label
         from activity_log al
         left join channels c on c.id = al.channel_id
         left join media_items m on m.id = al.media_item_id
         left join destinations d on d.id = al.destination_id
         left join accounts a on a.id = d.account_id
         where ${clause} order by al.created_at desc limit ? offset ?`,
      )
      .all(...parameters, query.pageSize, (query.page - 1) * query.pageSize) as Array<
      Record<string, unknown>
    >;
    return ActivityLogPageSchema.parse({
      events: rows.map((row) => ({
        id: row.id,
        category: logCategory(String(row.event_type)),
        severity: ['INFO', 'WARNING', 'ERROR'].includes(String(row.severity))
          ? row.severity
          : 'INFO',
        title: eventTitle(String(row.event_type)),
        summary: row.summary,
        accountId: row.account_id,
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        mediaItemId: row.media_item_id,
        mediaTitle: row.media_title,
        destinationId: row.destination_id,
        destinationLabel: row.destination_label,
        runId: row.backup_run_id,
        createdAt: row.created_at,
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
    });
  }

  public listAttention(input: ActivityAttentionQuery): ActivityAttentionPage {
    const query = ActivityAttentionQuerySchema.parse(input);
    const issues: ActivityAttentionIssueDto[] = [];
    const operationRows = this.database.sqlite
      .prepare(
        `select j.backup_run_id as run_id, j.media_item_id, c.title as channel_title,
          m.title as media_title, count(*) as issue_count, max(j.updated_at) as updated_at,
          max(j.error_message_safe) as safe_message
         from jobs j join channels c on c.id = j.channel_id
         left join media_items m on m.id = j.media_item_id
         where j.backup_run_id is not null and j.status in ('FAILED','BLOCKED')
           and not exists (
             select 1 from destinations auth_destination
             left join accounts auth_account on auth_account.id = auth_destination.account_id
             where auth_destination.id = j.destination_id
               and (
                 auth_destination.availability_status = 'AUTH_REQUIRED'
                 or auth_account.connection_state in ('REAUTH_REQUIRED','DISCONNECTED','ERROR')
               )
           )
         group by j.backup_run_id, j.media_item_id
         order by updated_at desc`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of operationRows) {
      const id = operationId(String(row.run_id), (row.media_item_id as string | null) ?? null);
      issues.push({
        id: `attention:${id}`,
        kind: 'OPERATION',
        title: String(row.media_title ?? `${String(row.channel_title)} backup`),
        summary: String(row.safe_message ?? 'A backup step needs attention.'),
        count: Number(row.issue_count),
        createdAt: Number(row.updated_at),
        resolutionLabel: 'Review operation',
        resolutionRoute: { area: 'activity', view: 'active', entityId: id },
      });
    }
    const accountAuthorization = this.database.sqlite
      .prepare(
        `select a.id, a.email, a.display_name,
          max(max(a.updated_at, coalesce(d.updated_at, 0))) as updated_at,
          count(distinct case when j.status in ('FAILED','BLOCKED')
            then j.backup_run_id || ':' || coalesce(j.media_item_id, 'run') end) as operation_count
         from accounts a
         left join destinations d on d.account_id = a.id and d.enabled = 1
         left join jobs j on j.destination_id = d.id
         where a.connection_state in ('REAUTH_REQUIRED','DISCONNECTED','ERROR')
           or exists (
             select 1 from destinations auth_destination
             where auth_destination.account_id = a.id and auth_destination.enabled = 1
               and auth_destination.availability_status = 'AUTH_REQUIRED'
           )
         group by a.id, a.email, a.display_name`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of accountAuthorization) {
      issues.push({
        id: `attention:account:${String(row.id)}`,
        kind: 'AUTHORIZATION',
        title: String(row.email ?? row.display_name ?? 'Google account'),
        summary: 'This Google account must be reconnected before its archive work can continue.',
        count: Math.max(1, Number(row.operation_count)),
        createdAt: Number(row.updated_at),
        resolutionLabel: 'Manage accounts',
        resolutionRoute: { area: 'settings', category: 'accounts' },
      });
    }
    const unownedAuthorization = this.database.sqlite
      .prepare(
        `select d.id, d.updated_at,
          count(distinct case when j.status in ('FAILED','BLOCKED')
            then j.backup_run_id || ':' || coalesce(j.media_item_id, 'run') end) as operation_count
         from destinations d left join jobs j on j.destination_id = d.id
         where d.enabled = 1 and d.account_id is null
           and d.availability_status = 'AUTH_REQUIRED'
         group by d.id, d.updated_at`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of unownedAuthorization) {
      issues.push({
        id: `attention:destination-auth:${String(row.id)}`,
        kind: 'AUTHORIZATION',
        title: 'Google Drive',
        summary: 'Google Drive authorization is required before archive work can continue.',
        count: Math.max(1, Number(row.operation_count)),
        createdAt: Number(row.updated_at),
        resolutionLabel: 'Manage accounts',
        resolutionRoute: { area: 'settings', category: 'accounts' },
      });
    }
    const destinations = this.database.sqlite
      .prepare(
        `select d.id, d.destination_type, d.root_path, d.availability_status, d.updated_at,
          a.email from destinations d left join accounts a on a.id = d.account_id
         where d.enabled = 1
           and d.availability_status not in ('AVAILABLE','AUTH_REQUIRED')`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of destinations) {
      const label =
        row.destination_type === 'GOOGLE_DRIVE'
          ? `Google Drive${row.email === null ? '' : ` - ${String(row.email)}`}`
          : String(row.root_path ?? 'Local destination');
      issues.push({
        id: `attention:destination:${String(row.id)}`,
        kind: 'DESTINATION',
        title: label,
        summary: 'This destination is not currently available.',
        count: 1,
        createdAt: Number(row.updated_at),
        resolutionLabel: 'Review storage',
        resolutionRoute: { area: 'storage', destinationId: String(row.id) },
      });
    }
    const integrity = this.database.sqlite
      .prepare(
        `select mc.id, mc.status, mc.updated_at, m.title from media_copies mc
         join media_items m on m.id = mc.media_item_id where mc.status in ('MISSING','CORRUPT')`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of integrity) {
      issues.push({
        id: `attention:copy:${String(row.id)}`,
        kind: 'INTEGRITY',
        title: String(row.title),
        summary:
          row.status === 'CORRUPT' ? 'A backup copy is corrupt.' : 'A backup copy is missing.',
        count: 1,
        createdAt: Number(row.updated_at),
        resolutionLabel: 'Review integrity',
        resolutionRoute: { area: 'integrity', copyId: String(row.id) },
      });
    }
    const schedules = this.database.sqlite
      .prepare(
        `select id, last_error_safe, updated_at from schedules
         where task_status in ('ERROR','UNAVAILABLE')`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of schedules) {
      issues.push({
        id: `attention:schedule:${String(row.id)}`,
        kind: 'SCHEDULE',
        title: 'Automatic backup schedule',
        summary: String(row.last_error_safe ?? 'The Windows schedule needs attention.'),
        count: 1,
        createdAt: Number(row.updated_at),
        resolutionLabel: 'Review scheduling',
        resolutionRoute: { area: 'settings', category: 'scheduling' },
      });
    }
    issues.sort((left, right) => right.createdAt - left.createdAt);
    const offset = (query.page - 1) * query.pageSize;
    return ActivityAttentionPageSchema.parse({
      issues: issues.slice(offset, offset + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      totalItems: issues.length,
    });
  }

  public resolveEntity(entityId: string): ActivityEntityResolution {
    const job = this.database.sqlite
      .prepare('select backup_run_id, media_item_id, status from jobs where id = ?')
      .get(entityId) as
      { backup_run_id: string | null; media_item_id: string | null; status: JobStatus } | undefined;
    if (job?.backup_run_id !== null && job?.backup_run_id !== undefined) {
      const view =
        job.status === 'FAILED' || job.status === 'BLOCKED'
          ? 'attention'
          : job.status === 'COMPLETED' || job.status === 'CANCELLED'
            ? 'history'
            : 'active';
      return ActivityEntityResolutionSchema.parse({
        found: true,
        view,
        entityId:
          view === 'history'
            ? job.backup_run_id
            : operationId(job.backup_run_id, job.media_item_id),
      });
    }
    const run = this.database.sqlite
      .prepare('select id from backup_runs where id = ?')
      .get(entityId) as { id: string } | undefined;
    return ActivityEntityResolutionSchema.parse(
      run === undefined
        ? { found: false, view: null, entityId: null }
        : { found: true, view: 'history', entityId: run.id },
    );
  }

  private operationRows(key: OperationKeyRow): ActivityJobRow[] {
    const mediaClause =
      key.media_item_id === null ? 'j.media_item_id is null' : 'j.media_item_id = ?';
    const parameters = key.media_item_id === null ? [key.run_id] : [key.run_id, key.media_item_id];
    return this.database.sqlite
      .prepare(
        `${JOB_SELECT} where j.backup_run_id = ? and ${mediaClause}
         order by j.created_at asc`,
      )
      .all(...parameters) as ActivityJobRow[];
  }

  private getRun(runId: string): BackupRunDto {
    const row = this.database.sqlite
      .prepare(
        `select br.*, c.title as channel_title from backup_runs br
         join channels c on c.id = br.channel_id where br.id = ?`,
      )
      .get(runId) as BackupRunRow | undefined;
    if (row === undefined) throw new Error('Backup run was not found');
    return backupRunDto(row);
  }
}
