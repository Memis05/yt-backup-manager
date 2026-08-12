import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { redactString, redactValue } from './redaction';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  workerInstanceId?: string;
  jobId?: string;
  backupRunId?: string;
  mediaId?: string;
  [key: string]: unknown;
}

export interface StructuredLogRecord {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  workerInstanceId?: string;
  jobId?: string;
  backupRunId?: string;
  mediaId?: string;
  context?: unknown;
}

export interface LogSink {
  write(record: StructuredLogRecord): void;
}

export class JsonLinesFileSink implements LogSink {
  public constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  }

  public write(record: StructuredLogRecord): void {
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

export class MemoryLogSink implements LogSink {
  public readonly records: StructuredLogRecord[] = [];

  public write(record: StructuredLogRecord): void {
    this.records.push(record);
  }
}

export class StructuredLogger {
  public constructor(
    private readonly component: string,
    private readonly sink: LogSink,
    private readonly baseContext: LogContext = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  public child(component: string, context: LogContext = {}): StructuredLogger {
    return new StructuredLogger(
      `${this.component}.${component}`,
      this.sink,
      { ...this.baseContext, ...context },
      this.now,
    );
  }

  public debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  public error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    const combined = { ...this.baseContext, ...context };
    const { workerInstanceId, jobId, backupRunId, mediaId, ...details } = combined;
    const record: StructuredLogRecord = {
      timestamp: this.now().toISOString(),
      level,
      component: this.component,
      message: redactString(message),
    };

    if (typeof workerInstanceId === 'string') record.workerInstanceId = workerInstanceId;
    if (typeof jobId === 'string') record.jobId = jobId;
    if (typeof backupRunId === 'string') record.backupRunId = backupRunId;
    if (typeof mediaId === 'string') record.mediaId = mediaId;
    if (Object.keys(details).length > 0) record.context = redactValue(details);

    this.sink.write(record);
  }
}
