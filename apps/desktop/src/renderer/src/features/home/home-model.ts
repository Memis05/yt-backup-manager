import type {
  AccountDto,
  BackupRunDto,
  ChannelBackupSettingsDto,
  ChannelDto,
  DashboardSummary,
  DestinationDto,
  FoundationStatus,
  IntegrityOverview,
  JobType,
  QueueJobDto,
  QueueSnapshot,
  RecoverySessionDto,
  ScheduleDto,
} from '@ytbm/core';

import type { AppRoute } from '../../app/routes';

export interface HomeSnapshot {
  foundation: FoundationStatus;
  dashboard: DashboardSummary;
  accounts: AccountDto[];
  channels: ChannelDto[];
  destinations: DestinationDto[];
  channelSettings: ChannelBackupSettingsDto[];
  queue: QueueSnapshot;
  attentionQueue: QueueSnapshot;
  integrity: IntegrityOverview;
  runs: BackupRunDto[];
  schedules: ScheduleDto[];
  latestRecovery: RecoverySessionDto | null;
}

export type HomeSetupState =
  | { kind: 'empty' }
  | {
      kind: 'partial';
      title: string;
      description: string;
      route: AppRoute;
    }
  | { kind: 'configured' };

export interface HomeAttentionItem {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  route: AppRoute;
  count: number;
  kind: 'authorization' | 'configuration' | 'destination' | 'integrity' | 'operation' | 'schedule';
}

export interface HomeActiveOperation {
  job: QueueJobDto;
  title: string;
  phase: string;
  stateLabel: string;
  destinationLabel: string | null;
  canPause: boolean;
  canResume: boolean;
}

export interface HomeHealthConclusion {
  title: string;
  description: string;
  tone: 'healthy' | 'warning' | 'danger' | 'info' | 'neutral';
}

export interface HomeChannelSummary {
  channelId: string;
  title: string;
  destinationSummary: string;
  lastBackupAt: number | null;
}

export interface HomePresentationModel {
  setup: HomeSetupState;
  activeOperation: HomeActiveOperation | null;
  attention: HomeAttentionItem[];
  health: HomeHealthConclusion;
  eligibleChannels: ChannelDto[];
  channelSummaries: HomeChannelSummary[];
  recentRuns: BackupRunDto[];
}

const ACTIVE_JOB_PRIORITY: Readonly<Record<QueueJobDto['status'], number>> = {
  RUNNING: 0,
  PAUSE_REQUESTED: 1,
  CANCEL_REQUESTED: 2,
  PAUSED: 3,
  RETRY_WAIT: 4,
  READY: 5,
  PENDING: 6,
  INTERRUPTED: 7,
  BLOCKED: 8,
  FAILED: 9,
  CANCELLED: 10,
  COMPLETED: 11,
};

const ACTIVE_JOB_STATES = new Set<QueueJobDto['status']>([
  'RUNNING',
  'PAUSE_REQUESTED',
  'CANCEL_REQUESTED',
  'PAUSED',
  'RETRY_WAIT',
  'READY',
  'PENDING',
  'INTERRUPTED',
  'BLOCKED',
]);

const TERMINAL_RUN_STATES = new Set<BackupRunDto['status']>([
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
]);

const DESTINATION_ERROR_CODES = new Set<QueueJobDto['errorCode']>([
  'DESTINATION_DISCONNECTED',
  'DESTINATION_READ_ONLY',
  'DESTINATION_FULL',
  'DESTINATION_PERMISSION_DENIED',
]);

const AUTH_ERROR_CODES = new Set<QueueJobDto['errorCode']>([
  'AUTH_EXPIRED',
  'AUTH_REFRESH_FAILED',
  'AUTH_REVOKED',
]);

const INTEGRITY_ISSUE_PAGE_LIMIT = 100;

export function formatHomeBytes(bytes: number | null): string {
  if (bytes === null) return 'Size unavailable';
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1_024;
  let unit: (typeof units)[number] = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index]!;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function formatHomeDate(value: number | null): string {
  if (value === null) return 'No completed backup yet';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

export function formatHomeRelativeTime(value: number | null, now = Date.now()): string {
  if (value === null) return 'No completed backup yet';
  const elapsed = Math.max(0, now - value);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatHomeDate(value);
}

export function destinationDisplayName(destination: DestinationDto): string {
  if (destination.destinationType === 'FILESYSTEM') return destination.rootPath;
  return destination.accountEmail ?? destination.accountDisplayName ?? destination.rootName;
}

export function homeJobPhase(jobType: JobType): string {
  const labels: Record<JobType, string> = {
    CHANNEL_SYNC: 'Refreshing channel',
    FORMAT_PROBE: 'Checking media quality',
    DOWNLOAD_MEDIA: 'Downloading',
    DOWNLOAD_THUMBNAIL: 'Saving thumbnail',
    POST_PROCESS_MEDIA: 'Processing media',
    HASH_STAGING_MEDIA: 'Checking downloaded file',
    VERIFY_STAGING_MEDIA: 'Verifying downloaded file',
    WRITE_STAGING_METADATA: 'Saving backup details',
    COPY_TO_FILESYSTEM: 'Copying to local backup',
    VERIFY_FILESYSTEM_COPY: 'Verifying local backup',
    WRITE_DESTINATION_METADATA: 'Saving destination details',
    UPDATE_MANIFEST: 'Updating backup index',
    ENSURE_GOOGLE_DRIVE_ROOT: 'Preparing Google Drive',
    ENSURE_GOOGLE_DRIVE_FOLDER: 'Preparing Google Drive',
    UPLOAD_TO_GOOGLE_DRIVE: 'Uploading to Google Drive',
    VERIFY_GOOGLE_DRIVE_COPY: 'Verifying Google Drive backup',
    DOWNLOAD_FROM_GOOGLE_DRIVE: 'Downloading from Google Drive',
    RECONCILE_GOOGLE_DRIVE_OBJECT: 'Checking Google Drive copy',
    UPDATE_GOOGLE_DRIVE_METADATA: 'Updating Google Drive details',
    UPDATE_GOOGLE_DRIVE_THUMBNAIL: 'Updating Google Drive thumbnail',
    UPDATE_GOOGLE_DRIVE_MANIFEST: 'Updating Google Drive index',
    CLEANUP_STAGING: 'Finishing backup',
    VERIFY_EXISTING_COPY: 'Verifying backup',
  };
  return labels[jobType];
}

export function homeRunOutcome(run: BackupRunDto): string {
  const outcomes: Record<BackupRunDto['status'], string> = {
    PENDING: 'Backup queued',
    RUNNING: 'Backup in progress',
    PAUSED: 'Backup paused',
    COMPLETED: 'Backup completed',
    COMPLETED_WITH_ERRORS: 'Backup completed with issues',
    FAILED: 'Backup failed',
    CANCELLED: 'Backup cancelled',
    INTERRUPTED: 'Backup interrupted',
  };
  return outcomes[run.status];
}

function operationStateLabel(status: QueueJobDto['status']): string {
  const labels: Record<QueueJobDto['status'], string> = {
    PENDING: 'Queued',
    READY: 'Ready to start',
    RUNNING: 'In progress',
    PAUSE_REQUESTED: 'Pausing',
    PAUSED: 'Paused',
    RETRY_WAIT: 'Trying again soon',
    CANCEL_REQUESTED: 'Cancelling',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed',
    FAILED: 'Needs attention',
    INTERRUPTED: 'Recovering',
    BLOCKED: 'Waiting for attention',
  };
  return labels[status];
}

function setupState(snapshot: HomeSnapshot): HomeSetupState {
  const enabledDestinations = snapshot.destinations.filter((destination) => destination.enabled);
  const enabledDestinationIds = new Set(enabledDestinations.map((destination) => destination.id));
  const selectedChannels = snapshot.channels.filter((channel) => channel.backupEnabled);
  const noProgress =
    snapshot.dashboard.mediaCount === 0 &&
    snapshot.accounts.length === 0 &&
    snapshot.channels.length === 0 &&
    snapshot.destinations.length === 0 &&
    snapshot.channelSettings.length === 0 &&
    snapshot.schedules.length === 0;
  const hasPersistedSourceSetup =
    snapshot.accounts.some((account) => account.capabilities.youtubeReadonly) ||
    snapshot.dashboard.mediaCount > 0 ||
    snapshot.runs.length > 0;
  const hasArchiveHistory = snapshot.dashboard.mediaCount > 0 || snapshot.runs.length > 0;
  const hasConnectedYoutubeAccount = snapshot.accounts.some(
    (account) => account.connectionState === 'CONNECTED' && account.capabilities.youtubeReadonly,
  );

  if (noProgress) return { kind: 'empty' };
  if (!hasPersistedSourceSetup) {
    return {
      kind: 'partial',
      title: 'Continue setting up your backup',
      description: 'Connect or sign in to Google to choose the YouTube channels you manage.',
      route: { area: 'settings', category: 'accounts' },
    };
  }
  if (!hasArchiveHistory && !hasConnectedYoutubeAccount) {
    return {
      kind: 'partial',
      title: 'Sign in to continue setup',
      description: 'Reconnect Google before choosing the YouTube channels you manage.',
      route: { area: 'settings', category: 'accounts' },
    };
  }
  if (selectedChannels.length === 0) {
    return {
      kind: 'partial',
      title: 'Choose channels to protect',
      description: 'Your Google account is connected, but no managed channel is selected.',
      route: { area: 'channels' },
    };
  }
  if (enabledDestinations.length === 0) {
    return {
      kind: 'partial',
      title: 'Add a backup destination',
      description: 'Choose a local folder or Google Drive before starting your first backup.',
      route: { area: 'storage' },
    };
  }
  const settingsByChannel = new Map(
    snapshot.channelSettings.map((settings) => [settings.channelId, settings]),
  );
  const allSelectedChannelsConfigured = selectedChannels.every(
    (channel) =>
      settingsByChannel
        .get(channel.id)
        ?.destinationIds.some((destinationId) => enabledDestinationIds.has(destinationId)) ?? false,
  );
  if (!allSelectedChannelsConfigured) {
    return {
      kind: 'partial',
      title: 'Choose where backups are stored',
      description: 'Assign an available destination to a selected channel before starting.',
      route: { area: 'channels', panel: 'backup' },
    };
  }
  if (snapshot.dashboard.mediaCount === 0 && snapshot.runs.length === 0) {
    return {
      kind: 'partial',
      title: 'Your first backup is ready to start',
      description: 'Review the selected channel and its saved backup destination.',
      route: { area: 'channels', panel: 'backup' },
    };
  }
  return { kind: 'configured' };
}

function configurationAttention(
  snapshot: HomeSnapshot,
  setup: HomeSetupState,
): HomeAttentionItem[] {
  if (setup.kind !== 'configured') return [];
  const selectedChannels = snapshot.channels.filter((channel) => channel.backupEnabled);
  if (selectedChannels.length === 0) {
    return [
      {
        id: 'configuration:channels',
        title: 'Backup channels',
        description: 'Choose a channel to protect',
        actionLabel: 'Choose channels',
        route: { area: 'channels' },
        count: 1,
        kind: 'configuration',
      },
    ];
  }

  const enabledDestinationIds = new Set(
    snapshot.destinations.filter((destination) => destination.enabled).map(({ id }) => id),
  );
  const settingsByChannel = new Map(
    snapshot.channelSettings.map((settings) => [settings.channelId, settings]),
  );
  const unconfiguredChannels = selectedChannels.filter(
    (channel) =>
      !settingsByChannel
        .get(channel.id)
        ?.destinationIds.some((destinationId) => enabledDestinationIds.has(destinationId)),
  );
  if (unconfiguredChannels.length === 0) return [];

  return [
    {
      id: 'configuration:destinations',
      title: `${unconfiguredChannels.length} selected ${unconfiguredChannels.length === 1 ? 'channel' : 'channels'}`,
      description:
        unconfiguredChannels.length === 1
          ? 'No enabled backup destination is selected'
          : 'No enabled backup destination is selected for each channel',
      actionLabel: 'Choose destinations',
      route: { area: 'channels', panel: 'backup' },
      count: unconfiguredChannels.length,
      kind: 'configuration',
    },
  ];
}

function eligibleChannels(snapshot: HomeSnapshot): ChannelDto[] {
  const settingsByChannel = new Map(
    snapshot.channelSettings.map((settings) => [settings.channelId, settings]),
  );
  const enabledDestinationIds = new Set(
    snapshot.destinations.filter((destination) => destination.enabled).map(({ id }) => id),
  );
  const connectedAccountIds = new Set(
    snapshot.accounts
      .filter(
        (account) =>
          account.connectionState === 'CONNECTED' && account.capabilities.youtubeReadonly,
      )
      .map((account) => account.id),
  );
  return snapshot.channels.filter((channel) => {
    if (
      !channel.backupEnabled ||
      !channel.accessibleAccountIds.some((accountId) => connectedAccountIds.has(accountId))
    ) {
      return false;
    }
    const settings = settingsByChannel.get(channel.id);
    return settings?.destinationIds.some((id) => enabledDestinationIds.has(id)) ?? false;
  });
}

function activeOperation(snapshot: HomeSnapshot): HomeActiveOperation | null {
  const job = snapshot.queue.jobs
    .filter((item) => ACTIVE_JOB_STATES.has(item.status))
    .sort(
      (left, right) =>
        ACTIVE_JOB_PRIORITY[left.status] - ACTIVE_JOB_PRIORITY[right.status] ||
        right.updatedAt - left.updatedAt,
    )[0];
  if (job === undefined) return null;

  const run = snapshot.runs.find((candidate) => candidate.id === job.backupRunId);
  const channelTitle =
    run?.channelTitle ??
    snapshot.channels.find((channel) => channel.id === job.channelId)?.title ??
    null;
  const objectTitle = job.mediaTitle ?? channelTitle ?? 'your archive';
  const title =
    job.operationType === 'VERIFY'
      ? `Verifying ${objectTitle}`
      : job.operationType === 'REPAIR'
        ? `Repairing ${objectTitle}`
        : channelTitle === null
          ? `Working on ${objectTitle}`
          : `Backing up ${channelTitle}`;

  return {
    job,
    title,
    phase: homeJobPhase(job.jobType),
    stateLabel: operationStateLabel(job.status),
    destinationLabel: job.destinationPath,
    canPause: ['RUNNING', 'READY', 'PENDING'].includes(job.status),
    canResume: job.status === 'PAUSED',
  };
}

function authorizationAttention(snapshot: HomeSnapshot): HomeAttentionItem[] {
  const items: HomeAttentionItem[] = [];
  const accountIds = new Set<string>();
  const connectedYoutubeAccountIds = new Set(
    snapshot.accounts
      .filter(
        (account) =>
          account.connectionState === 'CONNECTED' && account.capabilities.youtubeReadonly,
      )
      .map((account) => account.id),
  );
  const youtubeAuthorizationMissing = snapshot.channels
    .filter((channel) => channel.backupEnabled)
    .some(
      (channel) =>
        channel.accessibleAccountIds.length === 0 ||
        !channel.accessibleAccountIds.some((accountId) =>
          connectedYoutubeAccountIds.has(accountId),
        ),
    );
  if (youtubeAuthorizationMissing) {
    items.push({
      id: 'account:youtube',
      title: 'YouTube connection',
      description: 'Sign in again',
      actionLabel: 'Sign in again',
      route: { area: 'settings', category: 'accounts' },
      count: 1,
      kind: 'authorization',
    });
  }

  const enabledDriveAccountIds = new Set(
    snapshot.destinations.flatMap((destination) =>
      destination.enabled && destination.destinationType === 'GOOGLE_DRIVE'
        ? [destination.accountId]
        : [],
    ),
  );
  for (const account of snapshot.accounts) {
    const driveNeedsAuth =
      enabledDriveAccountIds.has(account.id) &&
      (account.connectionState !== 'CONNECTED' ||
        account.capabilities.driveConnectionState !== 'CONNECTED');
    if (!driveNeedsAuth) continue;
    accountIds.add(account.id);
    const accountName = account.displayName ?? account.email;
    items.push({
      id: `account:${account.id}`,
      title: accountName ?? 'Google Drive',
      description: 'Google Drive: Sign in again',
      actionLabel: 'Sign in again',
      route: { area: 'settings', category: 'accounts' },
      count: 1,
      kind: 'authorization',
    });
  }

  for (const destination of snapshot.destinations) {
    if (
      !destination.enabled ||
      destination.availabilityStatus !== 'AUTH_REQUIRED' ||
      (destination.destinationType === 'GOOGLE_DRIVE' && accountIds.has(destination.accountId))
    ) {
      continue;
    }
    items.push({
      id: `destination-auth:${destination.id}`,
      title: destinationDisplayName(destination),
      description: 'Sign in again',
      actionLabel: 'Sign in again',
      route: { area: 'settings', category: 'accounts' },
      count: 1,
      kind: 'authorization',
    });
  }
  return items;
}

function destinationAttention(snapshot: HomeSnapshot): HomeAttentionItem[] {
  const descriptions: Partial<Record<DestinationDto['availabilityStatus'], string>> = {
    READ_ONLY: 'Read-only destination',
    FULL: 'Not enough space',
    ERROR: 'Destination needs attention',
  };
  return snapshot.destinations.flatMap((destination) => {
    if (!destination.enabled) return [];
    const description =
      destination.availabilityStatus === 'DISCONNECTED'
        ? destination.destinationType === 'FILESYSTEM'
          ? 'Filesystem unavailable'
          : 'Google Drive unavailable'
        : descriptions[destination.availabilityStatus];
    if (description === undefined) return [];
    return [
      {
        id: `destination:${destination.id}`,
        title: destinationDisplayName(destination),
        description,
        actionLabel: 'Review storage',
        route: { area: 'storage', entityId: destination.id },
        count: 1,
        kind: 'destination' as const,
      },
    ];
  });
}

function integrityAttention(snapshot: HomeSnapshot): HomeAttentionItem[] {
  const failedCopies = snapshot.dashboard.failedCopyCount;
  const affectedMedia = snapshot.integrity.health.missing + snapshot.integrity.health.corrupt;
  if (failedCopies === 0 && affectedMedia === 0) return [];
  const details = [
    failedCopies > 0 ? `${failedCopies} failed ${failedCopies === 1 ? 'copy' : 'copies'}` : null,
    affectedMedia > 0
      ? `${affectedMedia} ${affectedMedia === 1 ? 'media item has' : 'media items have'} missing or corrupt copies`
      : null,
  ].filter((detail): detail is string => detail !== null);
  return [
    {
      id: 'integrity:copies',
      title: 'Backup integrity',
      description: `${details.join('; ')}. Review required`,
      actionLabel: 'Review integrity',
      route: { area: 'integrity', view: 'issues' },
      count: 1,
      kind: 'integrity',
    },
  ];
}

function integrityAvailabilityAttention(
  snapshot: HomeSnapshot,
  destinationProblemIds: ReadonlySet<string>,
  authorizationDestinationIds: ReadonlySet<string>,
): HomeAttentionItem[] {
  // Integrity issues are capped. Only suppress a generic integrity owner when
  // the bounded response is known to be complete and every matching issue is
  // already represented by its exact destination owner.
  const issueListComplete = snapshot.integrity.issues.length < INTEGRITY_ISSUE_PAGE_LIMIT;
  const unavailableIssues = snapshot.integrity.issues.filter(
    (issue) => issue.health === 'UNAVAILABLE',
  );
  const authorizationIssues = snapshot.integrity.issues.filter(
    (issue) => issue.health === 'AUTH_REQUIRED',
  );
  const unavailableFullyOwned =
    issueListComplete &&
    unavailableIssues.length > 0 &&
    unavailableIssues.every((issue) => destinationProblemIds.has(issue.destinationId));
  const authorizationFullyOwned =
    issueListComplete &&
    authorizationIssues.length > 0 &&
    authorizationIssues.every((issue) => authorizationDestinationIds.has(issue.destinationId));
  const items: HomeAttentionItem[] = [];
  if (snapshot.integrity.health.unavailable > 0 && !unavailableFullyOwned) {
    items.push({
      id: 'integrity:unavailable',
      title: 'Backup destination',
      description: 'Some confirmed copies are temporarily unavailable',
      actionLabel: 'Review storage',
      route: { area: 'storage' },
      count: 1,
      kind: 'destination',
    });
  }
  if (snapshot.integrity.health.authRequired > 0 && !authorizationFullyOwned) {
    items.push({
      id: 'integrity:authorization',
      title: 'Google Drive',
      description: 'Sign in again',
      actionLabel: 'Sign in again',
      route: { area: 'settings', category: 'accounts' },
      count: 1,
      kind: 'authorization',
    });
  }
  return items;
}

function operationAttention(
  snapshot: HomeSnapshot,
  destinationProblemIds: ReadonlySet<string>,
  authorizationDestinationIds: ReadonlySet<string>,
  youtubeAuthorizationChannelIds: ReadonlySet<string>,
): HomeAttentionItem[] {
  const operations = snapshot.attentionQueue.jobs.filter((job) => {
    if (!['BLOCKED', 'FAILED'].includes(job.status)) return false;
    const destinationOwned =
      job.destinationId !== null && destinationProblemIds.has(job.destinationId);
    if (destinationOwned && DESTINATION_ERROR_CODES.has(job.errorCode)) return false;
    const authorizationOwned =
      (job.destinationId !== null && authorizationDestinationIds.has(job.destinationId)) ||
      (job.channelId !== null && youtubeAuthorizationChannelIds.has(job.channelId));
    if (authorizationOwned && AUTH_ERROR_CODES.has(job.errorCode)) return false;
    return true;
  });
  const operationOwners = new Set(operations.map((job) => job.backupRunId ?? `job:${job.id}`));
  const count =
    operationOwners.size > 0
      ? operationOwners.size
      : snapshot.attentionQueue.totalItems > 0 &&
          snapshot.attentionQueue.jobs.length === 0 &&
          destinationProblemIds.size === 0 &&
          authorizationDestinationIds.size === 0 &&
          youtubeAuthorizationChannelIds.size === 0
        ? snapshot.attentionQueue.totalItems
        : 0;
  if (count === 0) return [];
  return [
    {
      id: 'activity:attention',
      title: `${count} backup ${count === 1 ? 'operation' : 'operations'}`,
      description: 'Failed or waiting for attention',
      actionLabel: 'Open Activity',
      route: { area: 'activity', view: 'attention' },
      count,
      kind: 'operation',
    },
  ];
}

function scheduleAttention(snapshot: HomeSnapshot): HomeAttentionItem[] {
  const schedules = snapshot.schedules.filter((schedule) =>
    ['ERROR', 'UNAVAILABLE'].includes(schedule.taskStatus),
  );
  if (schedules.length === 0) return [];
  return [
    {
      id: 'schedule:attention',
      title: schedules.length === 1 ? 'Automatic backup' : 'Automatic backups',
      description: 'Scheduling needs attention',
      actionLabel: 'Review scheduling',
      route: { area: 'settings', category: 'scheduling' },
      count: schedules.length,
      kind: 'schedule',
    },
  ];
}

function attentionItems(snapshot: HomeSnapshot, setup: HomeSetupState): HomeAttentionItem[] {
  const connectedYoutubeAccountIds = new Set(
    snapshot.accounts
      .filter(
        (account) =>
          account.connectionState === 'CONNECTED' && account.capabilities.youtubeReadonly,
      )
      .map((account) => account.id),
  );
  const connectedDriveAccountIds = new Set(
    snapshot.accounts
      .filter(
        (account) =>
          account.connectionState === 'CONNECTED' &&
          account.capabilities.driveConnectionState === 'CONNECTED',
      )
      .map((account) => account.id),
  );
  const destinationProblemIds = new Set(
    snapshot.destinations
      .filter(
        (destination) =>
          destination.enabled &&
          ['DISCONNECTED', 'READ_ONLY', 'FULL', 'ERROR'].includes(destination.availabilityStatus),
      )
      .map((destination) => destination.id),
  );
  const authorizationDestinationIds = new Set(
    snapshot.destinations
      .filter(
        (destination) =>
          destination.enabled &&
          (destination.availabilityStatus === 'AUTH_REQUIRED' ||
            (destination.destinationType === 'GOOGLE_DRIVE' &&
              !connectedDriveAccountIds.has(destination.accountId))),
      )
      .map((destination) => destination.id),
  );
  const youtubeAuthorizationChannelIds = new Set(
    snapshot.channels
      .filter(
        (channel) =>
          channel.backupEnabled &&
          !channel.accessibleAccountIds.some((accountId) =>
            connectedYoutubeAccountIds.has(accountId),
          ),
      )
      .map((channel) => channel.id),
  );
  const authorization = authorizationAttention(snapshot);
  const destinations = destinationAttention(snapshot);
  return [
    ...configurationAttention(snapshot, setup),
    ...authorization,
    ...destinations,
    ...integrityAvailabilityAttention(snapshot, destinationProblemIds, authorizationDestinationIds),
    ...integrityAttention(snapshot),
    ...operationAttention(
      snapshot,
      destinationProblemIds,
      authorizationDestinationIds,
      youtubeAuthorizationChannelIds,
    ),
    ...scheduleAttention(snapshot),
  ];
}

function healthConclusion(
  snapshot: HomeSnapshot,
  operation: HomeActiveOperation | null,
  attention: HomeAttentionItem[],
): HomeHealthConclusion {
  if (operation !== null) {
    const title =
      operation.job.status === 'PAUSED'
        ? 'Backup is paused'
        : operation.job.status === 'RETRY_WAIT'
          ? 'Backup is waiting to try again'
          : operation.job.status === 'BLOCKED'
            ? 'Backup is waiting for attention'
            : ['PENDING', 'READY'].includes(operation.job.status)
              ? 'Backup is queued'
              : operation.job.operationType === 'VERIFY'
                ? 'Verification is still in progress'
                : operation.job.operationType === 'REPAIR'
                  ? 'Repair is still in progress'
                  : 'Backup is still in progress';
    return {
      title,
      description: 'Coverage totals will refresh after this work is verified.',
      tone:
        operation.job.status === 'PAUSED' ||
        operation.job.status === 'RETRY_WAIT' ||
        operation.job.status === 'BLOCKED'
          ? 'warning'
          : 'info',
    };
  }

  const latestRun = snapshot.runs.find((run) => TERMINAL_RUN_STATES.has(run.status));
  if (latestRun?.status === 'COMPLETED_WITH_ERRORS') {
    return {
      title: 'Backup completed with issues',
      description:
        latestRun.failedCount > 0
          ? `${latestRun.failedCount} backup ${latestRun.failedCount === 1 ? 'step needs' : 'steps need'} attention before the archive is complete.`
          : 'Review the latest backup outcome before relying on complete archive coverage.',
      tone: 'warning',
    };
  }

  if (attention.length > 0) {
    const onlyItem = attention.length === 1 ? attention[0] : undefined;
    return {
      title:
        onlyItem === undefined
          ? 'Several parts of your backup need attention'
          : onlyItem.kind === 'integrity' || onlyItem.kind === 'operation'
            ? `${onlyItem.title} ${onlyItem.count === 1 ? 'needs' : 'need'} attention`
            : `${onlyItem.title} ${onlyItem.count === 1 ? 'needs' : 'need'} your attention`,
      description: 'Resolve the issues below before relying on complete backup coverage.',
      tone: 'warning',
    };
  }

  if (
    snapshot.dashboard.intendedCopyCount > 0 &&
    snapshot.dashboard.verifiedCopyCount === snapshot.dashboard.intendedCopyCount &&
    snapshot.dashboard.pendingCopyCount === 0 &&
    snapshot.dashboard.failedCopyCount === 0 &&
    snapshot.integrity.health.partial === 0 &&
    snapshot.integrity.health.pending === 0 &&
    snapshot.integrity.health.missing === 0 &&
    snapshot.integrity.health.corrupt === 0 &&
    snapshot.integrity.health.unavailable === 0 &&
    snapshot.integrity.health.authRequired === 0
  ) {
    const lastCompletedRun = snapshot.runs.find(
      (run) => run.status === 'COMPLETED' && run.completedAt !== null,
    );
    return {
      title: 'All intended copies are verified',
      description: `${snapshot.dashboard.verifiedCopyCount} ${snapshot.dashboard.verifiedCopyCount === 1 ? 'copy is' : 'copies are'} verified across ${snapshot.dashboard.selectedChannelCount} ${snapshot.dashboard.selectedChannelCount === 1 ? 'channel' : 'channels'}.${
        lastCompletedRun?.completedAt === null || lastCompletedRun?.completedAt === undefined
          ? ''
          : ` Last backup completed ${formatHomeRelativeTime(lastCompletedRun.completedAt)}.`
      }`,
      tone: 'healthy',
    };
  }

  if (snapshot.dashboard.pendingCopyCount > 0) {
    return {
      title: `${snapshot.dashboard.pendingCopyCount} ${snapshot.dashboard.pendingCopyCount === 1 ? 'copy is' : 'copies are'} not verified yet`,
      description: 'These intended copies do not have verified coverage yet.',
      tone: 'warning',
    };
  }

  if (snapshot.dashboard.verifiedCopyCount > 0) {
    return {
      title: 'Archive status is being refreshed',
      description: 'Confirmed copies remain visible while the app reconciles coverage details.',
      tone: 'info',
    };
  }

  return {
    title: 'Your archive is ready for its next backup',
    description: 'No verified copy coverage is available yet for the selected channels.',
    tone: 'neutral',
  };
}

function channelSummaries(snapshot: HomeSnapshot): HomeChannelSummary[] {
  const destinationById = new Map(
    snapshot.destinations.map((destination) => [destination.id, destination]),
  );
  const settingsByChannel = new Map(
    snapshot.channelSettings.map((settings) => [settings.channelId, settings]),
  );
  return snapshot.channels
    .filter((channel) => channel.backupEnabled)
    .map((channel) => {
      const destinations = (settingsByChannel.get(channel.id)?.destinationIds ?? [])
        .map((id) => destinationById.get(id))
        .filter((destination): destination is DestinationDto => destination !== undefined);
      const lastRun = snapshot.runs.find(
        (run) =>
          run.channelId === channel.id &&
          run.completedAt !== null &&
          ['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(run.status),
      );
      return {
        channelId: channel.id,
        title: channel.title,
        destinationSummary:
          destinations.filter((destination) => destination.enabled).length === 0
            ? 'No enabled backup destination selected'
            : destinations
                .filter((destination) => destination.enabled)
                .map(destinationDisplayName)
                .join(', '),
        lastBackupAt: lastRun?.completedAt ?? null,
      };
    });
}

export function buildHomePresentation(snapshot: HomeSnapshot): HomePresentationModel {
  const setup = setupState(snapshot);
  const operation = activeOperation(snapshot);
  const attention = attentionItems(snapshot, setup);
  return {
    setup,
    activeOperation: operation,
    attention,
    health: healthConclusion(snapshot, operation, attention),
    eligibleChannels: eligibleChannels(snapshot),
    channelSummaries: channelSummaries(snapshot),
    recentRuns: snapshot.runs.filter((run) => TERMINAL_RUN_STATES.has(run.status)).slice(0, 3),
  };
}

export function observedDurableCompletion(
  previous: HomeSnapshot | null,
  next: HomeSnapshot,
): boolean {
  if (previous === null) return false;
  const previousRuns = new Map(previous.runs.map((run) => [run.id, run.status]));
  const runCompleted = next.runs.some(
    (run) =>
      previousRuns.has(run.id) &&
      !TERMINAL_RUN_STATES.has(previousRuns.get(run.id)!) &&
      TERMINAL_RUN_STATES.has(run.status),
  );
  if (runCompleted) return true;

  const nextJobs = new Map(next.queue.jobs.map((job) => [job.id, job.status]));
  return previous.queue.jobs.some((job) => {
    if (!ACTIVE_JOB_STATES.has(job.status)) return false;
    const nextStatus = nextJobs.get(job.id);
    return nextStatus === undefined || !ACTIVE_JOB_STATES.has(nextStatus);
  });
}
