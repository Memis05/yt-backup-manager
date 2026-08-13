import { randomUUID } from 'node:crypto';

import {
  ScheduleDtoSchema,
  ScheduleUpsertSchema,
  type ScheduleDto,
  type ScheduleUpsert,
} from '@ytbm/core';

import type { WorkerDatabase } from '../database';

interface ScheduleRow {
  id: string;
  channel_id: string | null;
  channel_title: string | null;
  schedule_type: string;
  config_json: string;
  enabled: number;
  catch_up: number;
  backup_on_startup: number;
  timezone: string;
  windows_task_id: string | null;
  task_status: string;
  last_error_safe: string | null;
  last_triggered_at: number | null;
  next_expected_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ScheduleConfig {
  localTime: string;
  weekday: number | null;
  everyHours: number | null;
}

function scheduleDto(row: ScheduleRow): ScheduleDto {
  const config = JSON.parse(row.config_json) as ScheduleConfig;
  return ScheduleDtoSchema.parse({
    id: row.id,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    enabled: row.enabled === 1,
    frequency: row.schedule_type,
    localTime: config.localTime,
    weekday: config.weekday,
    everyHours: config.everyHours,
    catchUp: row.catch_up === 1,
    backupOnStartup: row.backup_on_startup === 1,
    timezone: row.timezone,
    taskStatus: row.task_status,
    lastErrorSafe: row.last_error_safe,
    lastTriggeredAt: row.last_triggered_at,
    nextExpectedAt: row.next_expected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export interface ScheduleTriggerRecord {
  id: string;
  scheduleId: string;
  logicalTriggerAt: number;
  duplicate: boolean;
}

export class SchedulingRepository {
  public constructor(
    public readonly database: WorkerDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  public list(): ScheduleDto[] {
    const rows = this.database.sqlite
      .prepare(
        `select s.*, c.title as channel_title from schedules s
         left join channels c on c.id = s.channel_id
         where s.operation_kind = 'BACKUP'
         order by s.channel_id is not null, coalesce(c.title, ''), s.created_at`,
      )
      .all() as ScheduleRow[];
    return rows.map(scheduleDto);
  }

  public get(scheduleId: string): ScheduleDto {
    const row = this.database.sqlite
      .prepare(
        `select s.*, c.title as channel_title from schedules s
         left join channels c on c.id = s.channel_id
         where s.id = ? and s.operation_kind = 'BACKUP'`,
      )
      .get(scheduleId) as ScheduleRow | undefined;
    if (row === undefined) throw new Error('The schedule was not found.');
    return scheduleDto(row);
  }

  public upsert(inputValue: ScheduleUpsert, timezone: string): ScheduleDto {
    const input = ScheduleUpsertSchema.parse(inputValue);
    const changedAt = this.now();
    if (input.channelId !== null) {
      const channel = this.database.sqlite
        .prepare('select 1 as found from channels where id = ? and backup_enabled = 1')
        .get(input.channelId) as { found: number } | undefined;
      if (channel === undefined) throw new Error('The scheduled channel is not enabled.');
    }
    const existingForScope = this.database.sqlite
      .prepare(
        `select id from schedules where operation_kind = 'BACKUP'
         and ((channel_id is null and ? is null) or channel_id = ?) limit 1`,
      )
      .get(input.channelId, input.channelId) as { id: string } | undefined;
    const id = input.id ?? existingForScope?.id ?? randomUUID();
    if (input.id !== null) this.get(input.id);
    if (existingForScope !== undefined && existingForScope.id !== id) {
      throw new Error('Only one effective schedule is allowed for this scope.');
    }
    const config: ScheduleConfig = {
      localTime: input.localTime,
      weekday: input.frequency === 'WEEKLY' ? input.weekday : null,
      everyHours: input.frequency === 'EVERY_N_HOURS' ? input.everyHours : null,
    };
    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `insert into schedules (
            id, operation_kind, channel_id, schedule_type, config_json, enabled, catch_up,
            backup_on_startup, timezone, task_status, created_at, updated_at
          ) values (?, 'BACKUP', ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
          on conflict(id) do update set
            channel_id = excluded.channel_id,
            schedule_type = excluded.schedule_type,
            config_json = excluded.config_json,
            enabled = excluded.enabled,
            catch_up = excluded.catch_up,
            backup_on_startup = excluded.backup_on_startup,
            timezone = excluded.timezone,
            task_status = 'PENDING',
            last_error_safe = null,
            updated_at = excluded.updated_at`,
        )
        .run(
          id,
          input.channelId,
          input.frequency,
          JSON.stringify(config),
          input.enabled ? 1 : 0,
          input.catchUp ? 1 : 0,
          input.backupOnStartup ? 1 : 0,
          timezone,
          changedAt,
          changedAt,
        );
      if (input.channelId === null) {
        this.database.sqlite
          .prepare(
            `insert into global_backup_settings (
              id, default_quality_profile, default_schedule_id, default_concurrent_downloads,
              default_concurrent_local_copies, default_concurrent_drive_uploads, created_at, updated_at
            ) values (1, 'MAX_1080P', ?, 2, 2, 2, ?, ?)
            on conflict(id) do update set default_schedule_id = excluded.default_schedule_id,
              updated_at = excluded.updated_at`,
          )
          .run(id, changedAt, changedAt);
      } else {
        this.database.sqlite
          .prepare(
            `insert into channel_settings (
              channel_id, quality_profile_override, schedule_id_override, created_at, updated_at
            ) values (?, null, ?, ?, ?)
            on conflict(channel_id) do update set
              schedule_id_override = excluded.schedule_id_override,
              updated_at = excluded.updated_at`,
          )
          .run(input.channelId, id, changedAt, changedAt);
      }
      this.recordActivity(
        input.id === null ? 'SCHEDULE_CREATED' : 'SCHEDULE_UPDATED',
        input.channelId,
        input.enabled ? 'Automatic backup schedule saved.' : 'Automatic backup schedule disabled.',
      );
    });
    transaction();
    return this.get(id);
  }

  public remove(scheduleId: string): void {
    const schedule = this.get(scheduleId);
    const changedAt = this.now();
    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          'update global_backup_settings set default_schedule_id = null where default_schedule_id = ?',
        )
        .run(scheduleId);
      this.database.sqlite
        .prepare(
          'update channel_settings set schedule_id_override = null where schedule_id_override = ?',
        )
        .run(scheduleId);
      this.database.sqlite.prepare('delete from schedules where id = ?').run(scheduleId);
      this.recordActivity(
        'SCHEDULE_DISABLED',
        schedule.channelId,
        'Automatic backup schedule removed.',
      );
    });
    transaction();
    void changedAt;
  }

  public setTaskState(
    scheduleId: string,
    state: 'SYNCED' | 'ERROR' | 'UNAVAILABLE',
    input: {
      windowsTaskId: string | null;
      nextExpectedAt: number | null;
      safeError: string | null;
      timezone: string;
    },
  ): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `update schedules set windows_task_id = ?, task_status = ?, last_error_safe = ?,
          last_reconciled_at = ?, next_expected_at = ?, timezone = ?, updated_at = ? where id = ?`,
      )
      .run(
        input.windowsTaskId,
        state,
        input.safeError,
        changedAt,
        input.nextExpectedAt,
        input.timezone,
        changedAt,
        scheduleId,
      );
    if (state === 'ERROR') {
      this.database.sqlite
        .prepare(
          `insert into notification_events (
            id, category, dedup_key, title, body, route_json, created_at
          ) values (?, 'SCHEDULE_ERROR', ?, 'Automatic schedule error',
            'Windows Task Scheduler could not reconcile an automatic backup task.', ?, ?)
          on conflict(dedup_key) do nothing`,
        )
        .run(
          randomUUID(),
          `schedule:${scheduleId}:error`,
          JSON.stringify({ section: 'settings', entityId: scheduleId }),
          changedAt,
        );
    } else if (state === 'SYNCED') {
      this.database.sqlite
        .prepare('delete from notification_events where dedup_key = ?')
        .run(`schedule:${scheduleId}:error`);
    }
  }

  public beginTrigger(
    scheduleId: string,
    logicalTriggerAt: number,
    requestedAt: number,
    source: 'WINDOWS' | 'CATCH_UP' | 'STARTUP',
  ): ScheduleTriggerRecord {
    const id = randomUUID();
    const inserted = this.database.sqlite
      .prepare(
        `insert into schedule_triggers (
          id, schedule_id, logical_trigger_at, requested_at, trigger_source, status,
          run_ids_json, created_at, updated_at
        ) values (?, ?, ?, ?, ?, 'PLANNING', '[]', ?, ?)
        on conflict(schedule_id, logical_trigger_at) do nothing`,
      )
      .run(id, scheduleId, logicalTriggerAt, requestedAt, source, requestedAt, requestedAt);
    if (inserted.changes === 0) {
      const existing = this.database.sqlite
        .prepare(
          'select id from schedule_triggers where schedule_id = ? and logical_trigger_at = ?',
        )
        .get(scheduleId, logicalTriggerAt) as { id: string };
      return { id: existing.id, scheduleId, logicalTriggerAt, duplicate: true };
    }
    return { id, scheduleId, logicalTriggerAt, duplicate: false };
  }

  public finishTrigger(
    triggerId: string,
    scheduleId: string,
    status: 'STARTED' | 'SUPPRESSED' | 'FAILED',
    runIds: string[],
    safeMessage: string | null,
  ): void {
    const changedAt = this.now();
    const trigger = this.database.sqlite
      .prepare('select trigger_source from schedule_triggers where id = ? and schedule_id = ?')
      .get(triggerId, scheduleId) as { trigger_source: string } | undefined;
    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `update schedule_triggers set status = ?, run_ids_json = ?, safe_message = ?, updated_at = ?
           where id = ?`,
        )
        .run(status, JSON.stringify(runIds), safeMessage, changedAt, triggerId);
      this.database.sqlite
        .prepare('update schedules set last_triggered_at = ?, updated_at = ? where id = ?')
        .run(changedAt, changedAt, scheduleId);
      this.recordActivity(
        status === 'STARTED'
          ? trigger?.trigger_source === 'CATCH_UP'
            ? 'SCHEDULE_CATCH_UP'
            : trigger?.trigger_source === 'STARTUP'
              ? 'SCHEDULE_STARTUP_TRIGGERED'
              : 'SCHEDULE_TRIGGERED'
          : 'SCHEDULE_MISSED',
        null,
        safeMessage ??
          (status === 'STARTED' ? 'Scheduled backup started.' : 'Scheduled backup suppressed.'),
      );
      if (status === 'FAILED') {
        this.database.sqlite
          .prepare(
            `insert into notification_events (
              id, category, dedup_key, title, body, route_json, created_at
            ) values (?, 'SCHEDULE_ERROR', ?, 'Automatic backup could not start',
              'An automatic backup occurrence could not be planned. Review its schedule and destinations.', ?, ?)
            on conflict(dedup_key) do nothing`,
          )
          .run(
            randomUUID(),
            `schedule:${scheduleId}:trigger-failed`,
            JSON.stringify({ section: 'settings', entityId: scheduleId }),
            changedAt,
          );
      } else if (status === 'STARTED') {
        this.database.sqlite
          .prepare('delete from notification_events where dedup_key = ?')
          .run(`schedule:${scheduleId}:trigger-failed`);
      }
    });
    transaction();
  }

  public setNextExpected(scheduleId: string, nextExpectedAt: number | null): void {
    this.database.sqlite
      .prepare('update schedules set next_expected_at = ?, updated_at = ? where id = ?')
      .run(nextExpectedAt, this.now(), scheduleId);
  }

  public targetChannelIds(schedule: ScheduleDto): string[] {
    if (schedule.channelId !== null) return [schedule.channelId];
    return (
      this.database.sqlite
        .prepare(
          `select c.id from channels c
           left join channel_settings cs on cs.channel_id = c.id
           where c.backup_enabled = 1 and cs.schedule_id_override is null
           order by c.id`,
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
  }

  public activeBackupRun(channelId: string): string | null {
    const row = this.database.sqlite
      .prepare(
        `select id from backup_runs where channel_id = ?
         and trigger_type in ('MANUAL','CUSTOM_MANUAL','SCHEDULED','STARTUP','REPAIR')
         and status in ('PENDING','RUNNING','PAUSED','INTERRUPTED')
         order by created_at desc limit 1`,
      )
      .get(channelId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private recordActivity(eventType: string, channelId: string | null, summary: string): void {
    this.database.sqlite
      .prepare(
        `insert into activity_log (
          id, event_type, severity, channel_id, summary, details_json, created_at
        ) values (?, ?, 'INFO', ?, ?, '{}', ?)`,
      )
      .run(randomUUID(), eventType, channelId, summary, this.now());
  }
}
