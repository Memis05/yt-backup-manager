import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  ScheduleTriggerResultSchema,
  ScheduleUpsertSchema,
  type AppSettings,
  type BackupRunTrigger,
  type IntegrityStartResult,
  type ScheduleDto,
  type ScheduleTriggerResult,
  type ScheduleUpsert,
} from '@ytbm/core';
const execFileAsync = promisify(execFile);

export const WINDOWS_TASK_NAMESPACE = '\\YouTubeBackupManager-';
export const PERIODIC_INTEGRITY_TASK_ID = '31b2781b-1568-4ac5-bf35-05d1cd664a38';
const SCHEDULE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type WindowsScheduleFrequency = 'DAILY' | 'WEEKLY' | 'EVERY_N_HOURS';
export type ScheduledTaskOperationKind = 'BACKUP' | 'INTEGRITY';

export interface WindowsScheduledTaskDefinition {
  operationKind: ScheduledTaskOperationKind;
  scheduleId: string;
  executablePath: string;
  frequency: WindowsScheduleFrequency;
  localTime: string;
  weekday: number | null;
  everyHours: number | null;
  catchUp: boolean;
  enabled: boolean;
}

export interface WindowsScheduledTaskRecord {
  operationKind: ScheduledTaskOperationKind;
  scheduleId: string;
  taskName: string;
}

export interface WindowsTaskSchedulerAdapter {
  readonly available: boolean;
  listOwnedTasks(): Promise<WindowsScheduledTaskRecord[]>;
  upsertTask(definition: WindowsScheduledTaskDefinition): Promise<void>;
  removeTask(scheduleId: string, operationKind?: ScheduledTaskOperationKind): Promise<void>;
}

export function windowsTaskName(scheduleId: string): string {
  assertScheduleId(scheduleId);
  return `${WINDOWS_TASK_NAMESPACE}Schedule-${scheduleId.toLowerCase()}`;
}

export function windowsIntegrityTaskName(scheduleId: string): string {
  assertScheduleId(scheduleId);
  return `${WINDOWS_TASK_NAMESPACE}Integrity-${scheduleId.toLowerCase()}`;
}

export function scheduledWorkerArguments(scheduleId: string): string {
  assertScheduleId(scheduleId);
  return `--worker --scheduled ${scheduleId.toLowerCase()}`;
}

export function scheduledIntegrityWorkerArguments(scheduleId: string): string {
  assertScheduleId(scheduleId);
  return `--worker --scheduled-integrity ${scheduleId.toLowerCase()}`;
}

export function validateScheduledExecutable(path: string): string {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.exe' || /[\0\r\n"]/.test(path)) {
    throw new Error('The scheduled worker executable must be a controlled absolute .exe path.');
  }
  const resolved = resolve(path);
  if (basename(resolved).toLowerCase() === 'electron.exe') {
    throw new Error('Development Electron cannot be registered as the production scheduled task.');
  }
  return resolved;
}

function assertScheduleId(scheduleId: string): void {
  if (!SCHEDULE_ID.test(scheduleId)) throw new Error('The schedule ID is invalid.');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function triggerXml(definition: WindowsScheduledTaskDefinition): string {
  const match = LOCAL_TIME.exec(definition.localTime);
  if (match === null) throw new Error('The schedule local time is invalid.');
  const boundary = `2000-01-01T${definition.localTime}:00`;
  if (definition.frequency === 'DAILY') {
    return `<CalendarTrigger><StartBoundary>${boundary}</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
  }
  if (definition.frequency === 'WEEKLY') {
    if (definition.weekday === null || definition.weekday < 0 || definition.weekday > 6) {
      throw new Error('A weekly schedule requires a valid weekday.');
    }
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      definition.weekday
    ]!;
    return `<CalendarTrigger><StartBoundary>${boundary}</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><${day}/></DaysOfWeek></ScheduleByWeek></CalendarTrigger>`;
  }
  if (
    definition.everyHours === null ||
    !Number.isInteger(definition.everyHours) ||
    definition.everyHours < 1 ||
    definition.everyHours > 168
  ) {
    throw new Error('An interval schedule requires between 1 and 168 hours.');
  }
  return `<TimeTrigger><StartBoundary>${boundary}</StartBoundary><Enabled>true</Enabled><Repetition><Interval>PT${definition.everyHours}H</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>`;
}

export function windowsTaskXml(definition: WindowsScheduledTaskDefinition): string {
  assertScheduleId(definition.scheduleId);
  const executable = validateScheduledExecutable(definition.executablePath);
  const enabled = definition.enabled ? 'true' : 'false';
  const argumentsValue =
    definition.operationKind === 'INTEGRITY'
      ? scheduledIntegrityWorkerArguments(definition.scheduleId)
      : scheduledWorkerArguments(definition.scheduleId);
  const description =
    definition.operationKind === 'INTEGRITY'
      ? `YouTube Backup Manager periodic integrity schedule ${definition.scheduleId}`
      : `YouTube Backup Manager automatic backup schedule ${definition.scheduleId}`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>${description}</Description></RegistrationInfo>
  <Triggers>${triggerXml(definition)}</Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>${definition.catchUp ? 'true' : 'false'}</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>${enabled}</Enabled><Hidden>false</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>7</Priority></Settings>
  <Actions Context="Author"><Exec><Command>${escapeXml(executable)}</Command><Arguments>${argumentsValue}</Arguments><WorkingDirectory>${escapeXml(dirname(executable))}</WorkingDirectory></Exec></Actions>
</Task>`;
}

function firstCsvField(line: string): string | null {
  if (!line.startsWith('"')) return line.split(',', 1)[0]?.trim() ?? null;
  let value = '';
  for (let index = 1; index < line.length; index += 1) {
    const character = line[index]!;
    if (character !== '"') {
      value += character;
      continue;
    }
    if (line[index + 1] === '"') {
      value += '"';
      index += 1;
      continue;
    }
    return value;
  }
  return null;
}

export class WindowsTaskScheduler implements WindowsTaskSchedulerAdapter {
  public readonly available = process.platform === 'win32';

  public async listOwnedTasks(): Promise<WindowsScheduledTaskRecord[]> {
    this.assertAvailable();
    const result = await execFileAsync('schtasks.exe', ['/Query', '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    const backupPrefix = `${WINDOWS_TASK_NAMESPACE}Schedule-`.toLowerCase();
    const integrityPrefix = `${WINDOWS_TASK_NAMESPACE}Integrity-`.toLowerCase();
    const records: WindowsScheduledTaskRecord[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const taskName = firstCsvField(line);
      if (taskName === null) continue;
      const lower = taskName.toLowerCase();
      const operationKind = lower.startsWith(backupPrefix)
        ? 'BACKUP'
        : lower.startsWith(integrityPrefix)
          ? 'INTEGRITY'
          : null;
      if (operationKind === null) continue;
      const prefix = operationKind === 'BACKUP' ? backupPrefix : integrityPrefix;
      const scheduleId = taskName.slice(prefix.length);
      if (SCHEDULE_ID.test(scheduleId)) records.push({ operationKind, scheduleId, taskName });
    }
    return records;
  }

  public async upsertTask(definition: WindowsScheduledTaskDefinition): Promise<void> {
    this.assertAvailable();
    const taskName =
      definition.operationKind === 'INTEGRITY'
        ? windowsIntegrityTaskName(definition.scheduleId)
        : windowsTaskName(definition.scheduleId);
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-task-'));
    const xmlPath = join(directory, 'task.xml');
    try {
      await writeFile(xmlPath, `\ufeff${windowsTaskXml(definition)}`, 'utf16le');
      await execFileAsync('schtasks.exe', ['/Create', '/TN', taskName, '/XML', xmlPath, '/F'], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  public async removeTask(
    scheduleId: string,
    operationKind: ScheduledTaskOperationKind = 'BACKUP',
  ): Promise<void> {
    this.assertAvailable();
    const taskName =
      operationKind === 'INTEGRITY'
        ? windowsIntegrityTaskName(scheduleId)
        : windowsTaskName(scheduleId);
    try {
      await execFileAsync('schtasks.exe', ['/Delete', '/TN', taskName, '/F'], {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      const message =
        error !== null && typeof error === 'object'
          ? `${'message' in error ? String(error.message) : ''} ${'stderr' in error ? String(error.stderr) : ''}`
          : '';
      if (!/cannot find|does not exist/i.test(message)) throw error;
    }
  }

  private assertAvailable(): void {
    if (!this.available) throw new Error('Windows Task Scheduler is unavailable on this platform.');
  }
}

export class UnavailableWindowsTaskScheduler implements WindowsTaskSchedulerAdapter {
  public readonly available = false;

  public async listOwnedTasks(): Promise<WindowsScheduledTaskRecord[]> {
    return [];
  }

  public async upsertTask(definition: WindowsScheduledTaskDefinition): Promise<void> {
    void definition;
    throw new Error('Automatic schedules can only be registered by a packaged Windows build.');
  }

  public async removeTask(
    scheduleId: string,
    operationKind: ScheduledTaskOperationKind = 'BACKUP',
  ): Promise<void> {
    void scheduleId;
    void operationKind;
  }
}

export interface SchedulingServiceOptions {
  repository: {
    list(): ScheduleDto[];
    get(scheduleId: string): ScheduleDto;
    upsert(input: ScheduleUpsert, timezone: string): ScheduleDto;
    remove(scheduleId: string): void;
    setTaskState(
      scheduleId: string,
      state: 'SYNCED' | 'ERROR' | 'UNAVAILABLE',
      input: {
        windowsTaskId: string | null;
        nextExpectedAt: number | null;
        safeError: string | null;
        timezone: string;
      },
    ): void;
    beginTrigger(
      scheduleId: string,
      logicalTriggerAt: number,
      requestedAt: number,
      source: 'WINDOWS' | 'CATCH_UP' | 'STARTUP',
    ): { id: string; scheduleId: string; logicalTriggerAt: number; duplicate: boolean };
    finishTrigger(
      triggerId: string,
      scheduleId: string,
      status: 'STARTED' | 'SUPPRESSED' | 'FAILED',
      runIds: string[],
      safeMessage: string | null,
    ): void;
    setNextExpected(scheduleId: string, nextExpectedAt: number | null): void;
    targetChannelIds(schedule: ScheduleDto): string[];
    activeBackupRun(channelId: string): string | null;
  };
  adapter: WindowsTaskSchedulerAdapter;
  executablePath: string | null;
  now?: () => number;
  timezone?: () => string;
  startBackup(
    channelId: string,
    trigger: Extract<BackupRunTrigger, 'MANUAL' | 'CUSTOM_MANUAL' | 'SCHEDULED' | 'STARTUP'>,
  ): Promise<{ run: { id: string } }>;
}

function localDateAt(timestamp: number, localTime: string): Date {
  const [hourText, minuteText] = localTime.split(':');
  const value = new Date(timestamp);
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    Number(hourText),
    Number(minuteText),
    0,
    0,
  );
}

export function logicalTriggerTime(schedule: ScheduleDto, requestedAt: number): number {
  if (schedule.frequency === 'EVERY_N_HOURS') {
    const interval = schedule.everyHours! * 60 * 60_000;
    const [hourText, minuteText] = schedule.localTime.split(':');
    let anchor = new Date(2000, 0, 1, Number(hourText), Number(minuteText), 0, 0).getTime();
    while (anchor > requestedAt) anchor -= interval;
    return anchor + Math.floor((requestedAt - anchor) / interval) * interval;
  }
  const candidate = localDateAt(requestedAt, schedule.localTime);
  if (schedule.frequency === 'WEEKLY') {
    candidate.setDate(candidate.getDate() - ((candidate.getDay() - schedule.weekday! + 7) % 7));
  }
  if (candidate.getTime() > requestedAt) {
    candidate.setDate(candidate.getDate() - (schedule.frequency === 'WEEKLY' ? 7 : 1));
  }
  return candidate.getTime();
}

export function nextExpectedTime(schedule: ScheduleDto, after: number): number {
  const logical = logicalTriggerTime(schedule, after);
  if (schedule.frequency === 'EVERY_N_HOURS') {
    return logical + schedule.everyHours! * 60 * 60_000;
  }
  const next = new Date(logical);
  next.setDate(next.getDate() + (schedule.frequency === 'WEEKLY' ? 7 : 1));
  return next.getTime();
}

export class SchedulingService {
  private readonly now: () => number;
  private readonly timezone: () => string;
  private reconciling: Promise<void> | null = null;

  public constructor(private readonly options: SchedulingServiceOptions) {
    this.now = options.now ?? Date.now;
    this.timezone =
      options.timezone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC');
  }

  public list(): ScheduleDto[] {
    return this.options.repository.list();
  }

  public async upsert(inputValue: ScheduleUpsert): Promise<ScheduleDto> {
    const input = ScheduleUpsertSchema.parse(inputValue);
    const saved = this.options.repository.upsert(input, this.timezone());
    await this.reconcile();
    return this.options.repository.get(saved.id);
  }

  public async remove(scheduleId: string): Promise<void> {
    this.options.repository.get(scheduleId);
    await this.options.adapter.removeTask(scheduleId);
    this.options.repository.remove(scheduleId);
  }

  public async reconcile(): Promise<void> {
    if (this.reconciling !== null) return this.reconciling;
    this.reconciling = this.reconcileOnce().finally(() => {
      this.reconciling = null;
    });
    return this.reconciling;
  }

  public async trigger(
    scheduleId: string,
    requestedAtInput: number,
    source: 'WINDOWS' | 'CATCH_UP' | 'STARTUP' = 'WINDOWS',
  ): Promise<ScheduleTriggerResult> {
    const schedule = this.options.repository.get(scheduleId);
    const requestedAt = Math.max(0, Math.trunc(requestedAtInput));
    const logicalTriggerAt =
      source === 'STARTUP'
        ? Math.floor(requestedAt / 60_000) * 60_000
        : logicalTriggerTime(schedule, requestedAt);
    const trigger = this.options.repository.beginTrigger(
      scheduleId,
      logicalTriggerAt,
      requestedAt,
      source,
    );
    if (trigger.duplicate) {
      if (source !== 'STARTUP') {
        this.options.repository.setNextExpected(
          scheduleId,
          schedule.enabled ? nextExpectedTime(schedule, requestedAt) : null,
        );
      }
      return ScheduleTriggerResultSchema.parse({
        accepted: false,
        deduplicated: true,
        logicalTriggerAt,
        runIds: [],
        safeMessage: 'This logical schedule occurrence was already handled.',
      });
    }
    if (!schedule.enabled || (source === 'STARTUP' && !schedule.backupOnStartup)) {
      this.options.repository.finishTrigger(
        trigger.id,
        scheduleId,
        'SUPPRESSED',
        [],
        'The schedule is disabled for this trigger.',
      );
      if (source !== 'STARTUP') this.options.repository.setNextExpected(scheduleId, null);
      return ScheduleTriggerResultSchema.parse({
        accepted: false,
        deduplicated: false,
        logicalTriggerAt,
        runIds: [],
        safeMessage: 'The schedule is disabled for this trigger.',
      });
    }

    const runIds: string[] = [];
    let activeSuppressed = 0;
    try {
      for (const channelId of this.options.repository.targetChannelIds(schedule)) {
        const activeRun = this.options.repository.activeBackupRun(channelId);
        if (activeRun !== null) {
          activeSuppressed += 1;
          continue;
        }
        const started = await this.options.startBackup(
          channelId,
          source === 'STARTUP' ? 'STARTUP' : 'SCHEDULED',
        );
        runIds.push(started.run.id);
      }
      const accepted = runIds.length > 0;
      const message = accepted
        ? activeSuppressed > 0
          ? 'Scheduled backup started; channels with active work were deduplicated.'
          : 'Scheduled backup started.'
        : activeSuppressed > 0
          ? 'Equivalent backup work is already active.'
          : 'No enabled channel currently inherits this schedule.';
      this.options.repository.finishTrigger(
        trigger.id,
        scheduleId,
        accepted ? 'STARTED' : 'SUPPRESSED',
        runIds,
        message,
      );
      if (source !== 'STARTUP') {
        this.options.repository.setNextExpected(
          scheduleId,
          nextExpectedTime(schedule, requestedAt),
        );
      }
      return ScheduleTriggerResultSchema.parse({
        accepted,
        deduplicated: !accepted && activeSuppressed > 0,
        logicalTriggerAt,
        runIds,
        safeMessage: message,
      });
    } catch {
      const message = 'The scheduled backup could not be planned.';
      this.options.repository.finishTrigger(trigger.id, scheduleId, 'FAILED', runIds, message);
      if (source !== 'STARTUP') {
        this.options.repository.setNextExpected(
          scheduleId,
          nextExpectedTime(schedule, requestedAt),
        );
      }
      throw new Error(message);
    }
  }

  public async triggerStartup(requestedAt = this.now()): Promise<ScheduleTriggerResult[]> {
    const results: ScheduleTriggerResult[] = [];
    for (const schedule of this.options.repository.list()) {
      if (schedule.enabled && schedule.backupOnStartup) {
        try {
          results.push(await this.trigger(schedule.id, requestedAt, 'STARTUP'));
        } catch {
          // A failed schedule occurrence is persisted and must not prevent other scopes.
        }
      }
    }
    return results;
  }

  public async catchUpDue(requestedAt = this.now()): Promise<ScheduleTriggerResult[]> {
    const results: ScheduleTriggerResult[] = [];
    for (const schedule of this.options.repository.list()) {
      if (
        schedule.enabled &&
        schedule.catchUp &&
        schedule.nextExpectedAt !== null &&
        schedule.nextExpectedAt <= requestedAt
      ) {
        try {
          results.push(await this.trigger(schedule.id, requestedAt, 'CATCH_UP'));
        } catch {
          // A failed catch-up is persisted and must not prevent task reconciliation.
        }
      }
    }
    return results;
  }

  public isIdle(): boolean {
    return this.reconciling === null;
  }

  private async reconcileOnce(): Promise<void> {
    const now = this.now();
    const timezone = this.timezone();
    await this.catchUpDue(now);
    const schedules = this.options.repository.list();
    if (!this.options.adapter.available || this.options.executablePath === null) {
      for (const schedule of schedules) {
        this.options.repository.setTaskState(schedule.id, 'UNAVAILABLE', {
          windowsTaskId: null,
          nextExpectedAt: schedule.enabled ? nextExpectedTime(schedule, now) : null,
          safeError: schedule.enabled
            ? 'Task Scheduler registration requires a packaged Windows build.'
            : null,
          timezone,
        });
      }
      return;
    }
    const existing = await this.options.adapter.listOwnedTasks();
    const desiredIds = new Set(schedules.map((schedule) => schedule.id));
    for (const task of existing) {
      if (task.operationKind === 'BACKUP' && !desiredIds.has(task.scheduleId)) {
        await this.options.adapter.removeTask(task.scheduleId);
      }
    }
    for (const schedule of schedules) {
      const nextExpectedAt = schedule.enabled ? nextExpectedTime(schedule, now) : null;
      try {
        if (!schedule.enabled) {
          await this.options.adapter.removeTask(schedule.id);
          this.options.repository.setTaskState(schedule.id, 'SYNCED', {
            windowsTaskId: null,
            nextExpectedAt,
            safeError: null,
            timezone,
          });
          continue;
        }
        await this.options.adapter.upsertTask({
          operationKind: 'BACKUP',
          scheduleId: schedule.id,
          executablePath: this.options.executablePath,
          frequency: schedule.frequency,
          localTime: schedule.localTime,
          weekday: schedule.weekday,
          everyHours: schedule.everyHours,
          catchUp: schedule.catchUp,
          enabled: true,
        });
        this.options.repository.setTaskState(schedule.id, 'SYNCED', {
          windowsTaskId: windowsTaskName(schedule.id),
          nextExpectedAt,
          safeError: null,
          timezone,
        });
      } catch {
        this.options.repository.setTaskState(schedule.id, 'ERROR', {
          windowsTaskId: null,
          nextExpectedAt,
          safeError: 'Windows Task Scheduler could not reconcile this app-owned task.',
          timezone,
        });
      }
    }
  }
}

export interface PeriodicIntegritySchedulingOptions {
  adapter: WindowsTaskSchedulerAdapter;
  executablePath: string | null;
  settings(): Promise<AppSettings>;
  lastIntegrityStartedAt(): number | null;
  startIntegrity(
    scope: AppSettings['periodicIntegrity']['scope'],
    driveMode: AppSettings['periodicIntegrity']['driveMode'],
  ): IntegrityStartResult;
  now?: () => number;
}

function integrityIntervalDays(settings: AppSettings['periodicIntegrity']): number {
  if (settings.frequency === 'WEEKLY') return 7;
  return settings.customIntervalDays;
}

function localCalendarDay(timestamp: number): number {
  const value = new Date(timestamp);
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;
}

function periodicIntegrityDue(
  settings: AppSettings['periodicIntegrity'],
  lastStartedAt: number,
  requestedAt: number,
): boolean {
  if (settings.frequency === 'MONTHLY') {
    const last = new Date(lastStartedAt);
    const requested = new Date(requestedAt);
    return (
      requested.getFullYear() * 12 + requested.getMonth() >
      last.getFullYear() * 12 + last.getMonth()
    );
  }
  return (
    localCalendarDay(requestedAt) - localCalendarDay(lastStartedAt) >=
    integrityIntervalDays(settings)
  );
}

export class PeriodicIntegritySchedulingService {
  private readonly now: () => number;
  private reconciling: Promise<void> | null = null;

  public constructor(private readonly options: PeriodicIntegritySchedulingOptions) {
    this.now = options.now ?? Date.now;
  }

  public async reconcile(): Promise<void> {
    if (this.reconciling !== null) return this.reconciling;
    this.reconciling = this.reconcileOnce().finally(() => {
      this.reconciling = null;
    });
    return this.reconciling;
  }

  public async trigger(requestedAt = this.now()): Promise<IntegrityStartResult | null> {
    const settings = await this.options.settings();
    if (!settings.periodicIntegrity.enabled) return null;
    const lastStartedAt = this.options.lastIntegrityStartedAt();
    if (
      lastStartedAt !== null &&
      !periodicIntegrityDue(settings.periodicIntegrity, lastStartedAt, requestedAt)
    ) {
      return null;
    }
    return this.options.startIntegrity(
      settings.periodicIntegrity.scope,
      settings.periodicIntegrity.driveMode,
    );
  }

  public isIdle(): boolean {
    return this.reconciling === null;
  }

  private async reconcileOnce(): Promise<void> {
    const settings = await this.options.settings();
    if (
      !settings.periodicIntegrity.enabled ||
      !this.options.adapter.available ||
      this.options.executablePath === null
    ) {
      if (this.options.adapter.available) {
        await this.options.adapter.removeTask(PERIODIC_INTEGRITY_TASK_ID, 'INTEGRITY');
      }
      return;
    }
    await this.options.adapter.upsertTask({
      operationKind: 'INTEGRITY',
      scheduleId: PERIODIC_INTEGRITY_TASK_ID,
      executablePath: this.options.executablePath,
      frequency: 'DAILY',
      localTime: settings.periodicIntegrity.localTime,
      weekday: null,
      everyHours: null,
      catchUp: true,
      enabled: true,
    });
  }
}
