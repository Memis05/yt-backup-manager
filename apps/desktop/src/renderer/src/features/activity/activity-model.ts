import type {
  ActivityAttentionIssueDto,
  ActivityLogCategory,
  ActivityOperationStatus,
  ActivityUserPhase,
  BackupRunStatus,
  BackupRunTrigger,
  JobControlAction,
  JobStatus,
  JobType,
  RunControlAction,
} from '@ytbm/core';

export const ACTIVITY_PHASE_LABELS: Readonly<Record<ActivityUserPhase, string>> = {
  PREPARING: 'Preparing files',
  DOWNLOADING: 'Downloading from YouTube',
  PROCESSING_MEDIA: 'Processing media',
  CHECKING_DOWNLOAD: 'Checking downloaded media',
  COPYING_LOCAL: 'Copying to local storage',
  VERIFYING_LOCAL: 'Verifying local copy',
  UPLOADING_DRIVE: 'Uploading to Google Drive',
  VERIFYING_DRIVE: 'Verifying Google Drive copy',
  DOWNLOADING_DRIVE: 'Downloading from Google Drive',
  VERIFYING_BACKUP: 'Checking backup integrity',
  REPAIRING_BACKUP: 'Repairing backup copy',
  FINALIZING: 'Finalizing archive records',
  WAITING: 'Waiting for a required step',
};

export const OPERATION_STATUS_LABELS: Readonly<Record<ActivityOperationStatus, string>> = {
  QUEUED: 'Queued',
  RUNNING: 'In progress',
  PAUSE_REQUESTED: 'Pausing',
  PAUSED: 'Paused',
  RETRY_WAIT: 'Retry scheduled',
  BLOCKED: 'Needs attention',
  CANCEL_REQUESTED: 'Cancelling',
  COMPLETED: 'Completed',
  COMPLETED_WITH_ISSUES: 'Completed with issues',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  INTERRUPTED: 'Resuming after interruption',
};

export const RUN_STATUS_LABELS: Readonly<Record<BackupRunStatus, string>> = {
  PENDING: 'Queued',
  RUNNING: 'In progress',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  COMPLETED_WITH_ERRORS: 'Completed with issues',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  INTERRUPTED: 'Interrupted',
};

export const TRIGGER_LABELS: Readonly<Record<BackupRunTrigger, string>> = {
  MANUAL: 'Manual backup',
  CUSTOM_MANUAL: 'Custom backup',
  SCHEDULED: 'Scheduled backup',
  STARTUP: 'Startup backup',
  RECOVERY: 'Recovery',
  REPAIR: 'Repair',
  VERIFY: 'Integrity check',
};

export const JOB_TYPE_LABELS: Readonly<Record<JobType, string>> = {
  CHANNEL_SYNC: 'Sync channel catalog',
  FORMAT_PROBE: 'Choose media format',
  DOWNLOAD_MEDIA: 'Download media',
  DOWNLOAD_THUMBNAIL: 'Download thumbnail',
  POST_PROCESS_MEDIA: 'Process media',
  HASH_STAGING_MEDIA: 'Calculate download checksum',
  VERIFY_STAGING_MEDIA: 'Verify downloaded media',
  WRITE_STAGING_METADATA: 'Write archive metadata',
  COPY_TO_FILESYSTEM: 'Copy to local destination',
  VERIFY_FILESYSTEM_COPY: 'Verify local copy',
  WRITE_DESTINATION_METADATA: 'Write destination metadata',
  UPDATE_MANIFEST: 'Update local manifest',
  ENSURE_GOOGLE_DRIVE_ROOT: 'Prepare Google Drive archive',
  ENSURE_GOOGLE_DRIVE_FOLDER: 'Prepare Google Drive folder',
  UPLOAD_TO_GOOGLE_DRIVE: 'Upload to Google Drive',
  VERIFY_GOOGLE_DRIVE_COPY: 'Verify Google Drive copy',
  DOWNLOAD_FROM_GOOGLE_DRIVE: 'Download from Google Drive',
  RECONCILE_GOOGLE_DRIVE_OBJECT: 'Check Google Drive object',
  UPDATE_GOOGLE_DRIVE_METADATA: 'Update Google Drive metadata',
  UPDATE_GOOGLE_DRIVE_THUMBNAIL: 'Update Google Drive thumbnail',
  UPDATE_GOOGLE_DRIVE_MANIFEST: 'Update Google Drive manifest',
  CLEANUP_STAGING: 'Clean up temporary files',
  VERIFY_EXISTING_COPY: 'Verify existing copy',
};

export const JOB_STATUS_LABELS: Readonly<Record<JobStatus, string>> = {
  PENDING: 'Waiting for a required step',
  READY: 'Ready',
  RUNNING: 'In progress',
  PAUSE_REQUESTED: 'Pausing',
  PAUSED: 'Paused',
  RETRY_WAIT: 'Retry scheduled',
  CANCEL_REQUESTED: 'Cancelling',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  INTERRUPTED: 'Interrupted',
  BLOCKED: 'Blocked by another step',
};

export const OPERATION_ACTION_LABELS: Readonly<Record<RunControlAction, string>> = {
  PAUSE: 'Pause',
  RESUME: 'Resume',
  CANCEL_KEEP_PARTIAL: 'Cancel and keep partial files',
};

export const JOB_ACTION_LABELS: Readonly<Record<JobControlAction, string>> = {
  PAUSE: 'Pause step',
  RESUME: 'Resume step',
  CANCEL_KEEP_PARTIAL: 'Cancel and keep partial files',
  CANCEL_REMOVE_PARTIAL: 'Cancel and remove partial files',
  MOVE_TOP: 'Move to top',
  PRIORITY_UP: 'Increase priority',
  PRIORITY_DOWN: 'Decrease priority',
};

export const LOG_FILTER_LABELS: Readonly<Record<ActivityLogCategory, string>> = {
  ALL: 'All activity',
  BACKUPS: 'Backups',
  ARCHIVE_CHANGES: 'Archive changes',
  DESTINATIONS: 'Destinations',
  INTEGRITY: 'Integrity',
  REPAIRS: 'Repairs',
  SCHEDULES: 'Schedules',
};

export function operationTone(
  status: ActivityOperationStatus | BackupRunStatus | JobStatus,
): 'healthy' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'COMPLETED') return 'healthy';
  if (status === 'RUNNING') return 'info';
  if (
    status === 'FAILED' ||
    status === 'BLOCKED' ||
    status === 'COMPLETED_WITH_ERRORS' ||
    status === 'COMPLETED_WITH_ISSUES'
  ) {
    return 'danger';
  }
  if (status === 'PAUSED' || status === 'RETRY_WAIT' || status === 'INTERRUPTED') {
    return 'warning';
  }
  return 'neutral';
}

export function attentionGroupLabel(kind: ActivityAttentionIssueDto['kind']): string {
  const labels: Readonly<Record<ActivityAttentionIssueDto['kind'], string>> = {
    OPERATION: 'Backup operations',
    DESTINATION: 'Storage connections',
    AUTHORIZATION: 'Account authorization',
    INTEGRITY: 'Backup integrity',
    SCHEDULE: 'Automatic backups',
  };
  return labels[kind];
}
