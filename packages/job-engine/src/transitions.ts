import { JobStatusSchema, type JobStatus } from '@ytbm/core';

const ALLOWED_TRANSITIONS: Readonly<Record<JobStatus, ReadonlySet<JobStatus>>> = {
  PENDING: new Set(['READY', 'PAUSED', 'BLOCKED', 'CANCELLED']),
  READY: new Set(['RUNNING', 'PAUSED', 'CANCELLED']),
  RUNNING: new Set([
    'COMPLETED',
    'RETRY_WAIT',
    'FAILED',
    'BLOCKED',
    'PAUSE_REQUESTED',
    'CANCEL_REQUESTED',
    'INTERRUPTED',
  ]),
  PAUSE_REQUESTED: new Set(['PAUSED', 'CANCEL_REQUESTED', 'FAILED', 'INTERRUPTED']),
  PAUSED: new Set(['READY', 'CANCELLED']),
  RETRY_WAIT: new Set(['READY', 'CANCELLED']),
  CANCEL_REQUESTED: new Set(['CANCELLED', 'FAILED', 'INTERRUPTED']),
  CANCELLED: new Set(),
  COMPLETED: new Set(),
  FAILED: new Set(),
  INTERRUPTED: new Set(['READY', 'BLOCKED', 'FAILED', 'CANCELLED']),
  BLOCKED: new Set(['READY', 'CANCELLED']),
};

export function canTransitionJob(fromInput: unknown, toInput: unknown): boolean {
  const from = JobStatusSchema.parse(fromInput);
  const to = JobStatusSchema.parse(toInput);
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function assertJobTransition(fromInput: unknown, toInput: unknown): void {
  const from = JobStatusSchema.parse(fromInput);
  const to = JobStatusSchema.parse(toInput);
  if (!ALLOWED_TRANSITIONS[from].has(to)) {
    throw new Error(`Invalid job transition: ${from} -> ${to}`);
  }
}
