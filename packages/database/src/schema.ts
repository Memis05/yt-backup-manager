import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamps = () => ({
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id'),
    email: text('email'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    credentialRef: text('credential_ref').notNull(),
    driveCredentialRef: text('drive_credential_ref'),
    capabilitiesJson: text('capabilities_json').notNull().default('{}'),
    connectionState: text('connection_state').notNull().default('CONNECTED'),
    connectedAt: integer('connected_at').notNull(),
    lastAuthAt: integer('last_auth_at'),
    lastErrorCode: text('last_error_code'),
    lastErrorAt: integer('last_error_at'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('accounts_provider_account_uidx')
      .on(table.provider, table.providerAccountId)
      .where(sql`${table.providerAccountId} is not null`),
    index('accounts_email_idx').on(table.email),
  ],
);

export const channels = sqliteTable(
  'channels',
  {
    id: text('id').primaryKey(),
    sourceProvider: text('source_provider').notNull(),
    providerChannelId: text('provider_channel_id').notNull(),
    title: text('title').notNull(),
    handle: text('handle'),
    thumbnailUrl: text('thumbnail_url'),
    backupEnabled: integer('backup_enabled', { mode: 'boolean' }).notNull().default(false),
    sourceStatus: text('source_status').notNull().default('AVAILABLE'),
    publishedAt: integer('published_at'),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at'),
    lastSyncAt: integer('last_sync_at'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('channels_provider_channel_uidx').on(table.sourceProvider, table.providerChannelId),
  ],
);

export const accountChannels = sqliteTable(
  'account_channels',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    relationshipMetadataJson: text('relationship_metadata_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.channelId] }),
    index('account_channels_channel_idx').on(table.channelId),
  ],
);

export const mediaItems = sqliteTable(
  'media_items',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id),
    sourceProvider: text('source_provider').notNull(),
    providerMediaId: text('provider_media_id').notNull(),
    mediaType: text('media_type').notNull(),
    title: text('title').notNull(),
    originalTitle: text('original_title').notNull(),
    sourceUrl: text('source_url').notNull(),
    visibility: text('visibility'),
    sourceStatus: text('source_status').notNull().default('AVAILABLE'),
    publishedAt: integer('published_at'),
    durationSeconds: integer('duration_seconds'),
    thumbnailUrl: text('thumbnail_url'),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at'),
    removedAt: integer('removed_at'),
    metadataVersion: integer('metadata_version').notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('media_items_provider_media_uidx').on(table.sourceProvider, table.providerMediaId),
    index('media_items_channel_published_idx').on(table.channelId, table.publishedAt),
    index('media_items_channel_type_idx').on(table.channelId, table.mediaType),
    index('media_items_source_status_idx').on(table.sourceStatus),
    index('media_items_last_seen_idx').on(table.lastSeenAt),
  ],
);

export const playlists = sqliteTable(
  'playlists',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id),
    sourceProvider: text('source_provider').notNull(),
    providerPlaylistId: text('provider_playlist_id').notNull(),
    title: text('title').notNull(),
    sourceStatus: text('source_status').notNull().default('AVAILABLE'),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at'),
    removedAt: integer('removed_at'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('playlists_provider_playlist_uidx').on(
      table.sourceProvider,
      table.providerPlaylistId,
    ),
    index('playlists_channel_idx').on(table.channelId),
    index('playlists_source_status_idx').on(table.sourceStatus),
  ],
);

export const playlistItems = sqliteTable(
  'playlist_items',
  {
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id, { onDelete: 'cascade' }),
    position: integer('position'),
    lastSeenAt: integer('last_seen_at'),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.playlistId, table.mediaItemId] })],
);

export const destinations = sqliteTable(
  'destinations',
  {
    id: text('id').primaryKey(),
    destinationType: text('destination_type').notNull(),
    accountId: text('account_id').references(() => accounts.id),
    rootPath: text('root_path'),
    providerRootId: text('provider_root_id'),
    volumeGuid: text('volume_guid'),
    volumeSerial: text('volume_serial'),
    filesystemType: text('filesystem_type'),
    lastKnownMountPath: text('last_known_mount_path'),
    credentialRef: text('credential_ref'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    availabilityStatus: text('availability_status').notNull().default('UNKNOWN'),
    lastProbeAt: integer('last_probe_at'),
    lastErrorCode: text('last_error_code'),
    lastErrorAt: integer('last_error_at'),
    ...timestamps(),
  },
  (table) => [
    index('destinations_type_idx').on(table.destinationType),
    index('destinations_account_idx').on(table.accountId),
    index('destinations_volume_guid_idx').on(table.volumeGuid),
    index('destinations_volume_serial_idx').on(table.volumeSerial),
  ],
);

export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey(),
  scheduleType: text('schedule_type').notNull(),
  configJson: text('config_json').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  windowsTaskId: text('windows_task_id'),
  lastTriggeredAt: integer('last_triggered_at'),
  nextExpectedAt: integer('next_expected_at'),
  ...timestamps(),
});

export const globalBackupSettings = sqliteTable(
  'global_backup_settings',
  {
    id: integer('id').primaryKey(),
    defaultQualityProfile: text('default_quality_profile').notNull(),
    defaultScheduleId: text('default_schedule_id').references(() => schedules.id),
    defaultConcurrentDownloads: integer('default_concurrent_downloads').notNull(),
    defaultConcurrentLocalCopies: integer('default_concurrent_local_copies').notNull(),
    defaultConcurrentDriveUploads: integer('default_concurrent_drive_uploads').notNull(),
    downloadBandwidthLimit: integer('download_bandwidth_limit'),
    uploadBandwidthLimit: integer('upload_bandwidth_limit'),
    ...timestamps(),
  },
  (table) => [check('global_backup_settings_singleton_check', sql`${table.id} = 1`)],
);

export const defaultDestinations = sqliteTable('default_destinations', {
  destinationId: text('destination_id')
    .primaryKey()
    .references(() => destinations.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
});

export const channelSettings = sqliteTable('channel_settings', {
  channelId: text('channel_id')
    .primaryKey()
    .references(() => channels.id, { onDelete: 'cascade' }),
  qualityProfileOverride: text('quality_profile_override'),
  scheduleIdOverride: text('schedule_id_override').references(() => schedules.id),
  ...timestamps(),
});

export const channelDestinations = sqliteTable(
  'channel_destinations',
  {
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.channelId, table.destinationId] })],
);

export const backupRuns = sqliteTable(
  'backup_runs',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id').references(() => channels.id),
    triggerType: text('trigger_type').notNull(),
    status: text('status').notNull(),
    effectiveConfigJson: text('effective_config_json').notNull(),
    discoveredCount: integer('discovered_count').notNull().default(0),
    downloadedCount: integer('downloaded_count').notNull().default(0),
    localCopyCount: integer('local_copy_count').notNull().default(0),
    driveUploadCount: integer('drive_upload_count').notNull().default(0),
    metadataUpdateCount: integer('metadata_update_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    bytesDownloaded: integer('bytes_downloaded').notNull().default(0),
    bytesTransferred: integer('bytes_transferred').notNull().default(0),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    ...timestamps(),
  },
  (table) => [
    index('backup_runs_channel_created_idx').on(table.channelId, table.createdAt),
    index('backup_runs_status_idx').on(table.status),
  ],
);

export const mediaMetadataHistory = sqliteTable(
  'media_metadata_history',
  {
    id: text('id').primaryKey(),
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id),
    changeType: text('change_type').notNull(),
    oldValueJson: text('old_value_json'),
    newValueJson: text('new_value_json').notNull(),
    capturedAt: integer('captured_at').notNull(),
    backupRunId: text('backup_run_id').references(() => backupRuns.id),
  },
  (table) => [
    index('media_metadata_history_item_captured_idx').on(table.mediaItemId, table.capturedAt),
  ],
);

export const mediaCopies = sqliteTable(
  'media_copies',
  {
    id: text('id').primaryKey(),
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id),
    relativePath: text('relative_path'),
    providerFileId: text('provider_file_id'),
    container: text('container'),
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    width: integer('width'),
    height: integer('height'),
    fps: real('fps'),
    bytes: integer('bytes'),
    sha256: text('sha256'),
    qualityProfile: text('quality_profile'),
    contentGeneration: text('content_generation'),
    verificationStrength: text('verification_strength'),
    providerMetadataJson: text('provider_metadata_json'),
    status: text('status').notNull().default('PENDING'),
    verifiedAt: integer('verified_at'),
    lastCheckedAt: integer('last_checked_at'),
    missingSince: integer('missing_since'),
    corruptSince: integer('corrupt_since'),
    lastErrorCode: text('last_error_code'),
    lastErrorAt: integer('last_error_at'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('media_copies_media_destination_uidx').on(table.mediaItemId, table.destinationId),
    index('media_copies_destination_status_idx').on(table.destinationId, table.status),
    index('media_copies_media_status_idx').on(table.mediaItemId, table.status),
    index('media_copies_status_idx').on(table.status),
    index('media_copies_provider_file_idx').on(table.providerFileId),
  ],
);

export const mediaArtifacts = sqliteTable(
  'media_artifacts',
  {
    id: text('id').primaryKey(),
    mediaItemId: text('media_item_id')
      .notNull()
      .references(() => mediaItems.id),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id),
    artifactType: text('artifact_type').notNull(),
    relativePath: text('relative_path'),
    providerFileId: text('provider_file_id'),
    bytes: integer('bytes'),
    sha256: text('sha256'),
    contentGeneration: text('content_generation'),
    status: text('status').notNull(),
    verifiedAt: integer('verified_at'),
    lastCheckedAt: integer('last_checked_at'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('media_artifacts_item_destination_type_uidx').on(
      table.mediaItemId,
      table.destinationId,
      table.artifactType,
    ),
  ],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    backupRunId: text('backup_run_id').references(() => backupRuns.id),
    channelId: text('channel_id').references(() => channels.id),
    mediaItemId: text('media_item_id').references(() => mediaItems.id),
    destinationId: text('destination_id').references(() => destinations.id),
    jobType: text('job_type').notNull(),
    status: text('status').notNull(),
    priority: integer('priority').notNull().default(0),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextRetryAt: integer('next_retry_at'),
    progressRatio: real('progress_ratio'),
    bytesProcessed: integer('bytes_processed').notNull().default(0),
    bytesTotal: integer('bytes_total'),
    speedBytesPerSec: integer('speed_bytes_per_sec'),
    etaSeconds: integer('eta_seconds'),
    payloadJson: text('payload_json').notNull().default('{}'),
    resultJson: text('result_json'),
    idempotencyKey: text('idempotency_key').notNull(),
    lockOwner: text('lock_owner'),
    leaseUntil: integer('lease_until'),
    lastHeartbeatAt: integer('last_heartbeat_at'),
    errorCode: text('error_code'),
    errorMessageSafe: text('error_message_safe'),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('jobs_idempotency_uidx').on(table.idempotencyKey),
    index('jobs_queue_idx').on(table.status, table.nextRetryAt, table.priority, table.createdAt),
    index('jobs_run_status_idx').on(table.backupRunId, table.status),
    index('jobs_media_status_idx').on(table.mediaItemId, table.status),
    index('jobs_destination_status_idx').on(table.destinationId, table.status),
    index('jobs_lease_idx').on(table.leaseUntil),
  ],
);

export const jobDependencies = sqliteTable(
  'job_dependencies',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    dependsOnJobId: text('depends_on_job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.dependsOnJobId] }),
    index('job_dependencies_depends_on_idx').on(table.dependsOnJobId),
    check('job_dependencies_not_self_check', sql`${table.jobId} <> ${table.dependsOnJobId}`),
  ],
);

export const jobAttempts = sqliteTable('job_attempts', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  workerInstanceId: text('worker_instance_id'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  resultStatus: text('result_status'),
  errorCode: text('error_code'),
  errorMessageSafe: text('error_message_safe'),
  createdAt: integer('created_at').notNull(),
});

export const stagingArtifacts = sqliteTable('staging_artifacts', {
  id: text('id').primaryKey(),
  mediaItemId: text('media_item_id')
    .notNull()
    .references(() => mediaItems.id),
  jobId: text('job_id').references(() => jobs.id),
  artifactType: text('artifact_type').notNull(),
  path: text('path').notNull(),
  bytes: integer('bytes'),
  sha256: text('sha256'),
  state: text('state').notNull(),
  generation: text('generation'),
  ...timestamps(),
});

export const providerObjects = sqliteTable(
  'provider_objects',
  {
    id: text('id').primaryKey(),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    logicalKey: text('logical_key').notNull(),
    objectType: text('object_type').notNull(),
    providerObjectId: text('provider_object_id').notNull(),
    parentProviderObjectId: text('parent_provider_object_id'),
    currentName: text('current_name').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('provider_objects_destination_key_uidx').on(table.destinationId, table.logicalKey),
    index('provider_objects_provider_id_idx').on(table.providerObjectId),
  ],
);

export const driveUploadSessions = sqliteTable(
  'drive_upload_sessions',
  {
    jobId: text('job_id')
      .primaryKey()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    mediaCopyId: text('media_copy_id')
      .notNull()
      .references(() => mediaCopies.id, { onDelete: 'cascade' }),
    parentProviderObjectId: text('parent_provider_object_id').notNull(),
    sessionUri: text('session_uri').notNull(),
    providerFileId: text('provider_file_id'),
    bytesAcknowledged: integer('bytes_acknowledged').notNull().default(0),
    expectedBytes: integer('expected_bytes').notNull(),
    expectedSha256: text('expected_sha256').notNull(),
    sourceReferenceJson: text('source_reference_json').notNull(),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('drive_upload_sessions_destination_idx').on(table.destinationId),
    index('drive_upload_sessions_copy_idx').on(table.mediaCopyId),
  ],
);

export const recoverySessions = sqliteTable(
  'recovery_sessions',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    progressPhase: text('progress_phase'),
    progressProcessed: integer('progress_processed').notNull().default(0),
    progressTotal: integer('progress_total'),
    errorMessageSafe: text('error_message_safe'),
    cancelRequested: integer('cancel_requested', { mode: 'boolean' }).notNull().default(false),
    completedAt: integer('completed_at'),
    ...timestamps(),
  },
  (table) => [index('recovery_sessions_status_updated_idx').on(table.status, table.updatedAt)],
);

export const recoverySources = sqliteTable(
  'recovery_sources',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(),
    status: text('status').notNull(),
    label: text('label').notNull(),
    rootPath: text('root_path'),
    accountId: text('account_id').references(() => accounts.id),
    volumeGuid: text('volume_guid'),
    volumeSerial: text('volume_serial'),
    filesystemType: text('filesystem_type'),
    lastKnownMountPath: text('last_known_mount_path'),
    discoveredRootCount: integer('discovered_root_count').notNull().default(0),
    errorMessageSafe: text('error_message_safe'),
    ...timestamps(),
  },
  (table) => [
    index('recovery_sources_session_idx').on(table.sessionId, table.createdAt),
    index('recovery_sources_account_idx').on(table.accountId),
  ],
);

export const recoveryDriveRootSelections = sqliteTable(
  'recovery_drive_root_selections',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => recoverySources.id, { onDelete: 'cascade' }),
    providerRootId: text('provider_root_id').notNull(),
    selected: integer('selected', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.sourceId, table.providerRootId] }),
    index('recovery_drive_root_selections_source_idx').on(table.sessionId, table.sourceId),
  ],
);

export const recoveryChannels = sqliteTable(
  'recovery_channels',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => recoverySources.id, { onDelete: 'cascade' }),
    sourceProvider: text('source_provider').notNull(),
    providerChannelId: text('provider_channel_id').notNull(),
    title: text('title').notNull(),
    sourceStatus: text('source_status').notNull(),
    publishedAt: integer('published_at'),
    lastSeenAt: integer('last_seen_at'),
    metadataUpdatedAt: integer('metadata_updated_at').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('recovery_channels_session_source_provider_uidx').on(
      table.sessionId,
      table.sourceId,
      table.sourceProvider,
      table.providerChannelId,
    ),
    index('recovery_channels_identity_idx').on(
      table.sessionId,
      table.sourceProvider,
      table.providerChannelId,
    ),
  ],
);

export const recoveryMedia = sqliteTable(
  'recovery_media',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => recoverySources.id, { onDelete: 'cascade' }),
    sourceProvider: text('source_provider').notNull(),
    providerChannelId: text('provider_channel_id').notNull(),
    providerMediaId: text('provider_media_id').notNull(),
    mediaType: text('media_type').notNull(),
    title: text('title').notNull(),
    originalTitle: text('original_title').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceStatus: text('source_status').notNull(),
    publishedAt: integer('published_at'),
    durationSeconds: integer('duration_seconds'),
    thumbnailUrl: text('thumbnail_url'),
    metadataUpdatedAt: integer('metadata_updated_at').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('recovery_media_session_source_provider_uidx').on(
      table.sessionId,
      table.sourceId,
      table.sourceProvider,
      table.providerMediaId,
    ),
    index('recovery_media_identity_idx').on(
      table.sessionId,
      table.sourceProvider,
      table.providerMediaId,
    ),
  ],
);

export const recoveryPlaylists = sqliteTable(
  'recovery_playlists',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => recoverySources.id, { onDelete: 'cascade' }),
    sourceProvider: text('source_provider').notNull(),
    providerChannelId: text('provider_channel_id').notNull(),
    providerPlaylistId: text('provider_playlist_id').notNull(),
    title: text('title').notNull(),
    sourceStatus: text('source_status').notNull(),
    metadataUpdatedAt: integer('metadata_updated_at').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('recovery_playlists_session_source_provider_uidx').on(
      table.sessionId,
      table.sourceId,
      table.sourceProvider,
      table.providerPlaylistId,
    ),
    index('recovery_playlists_identity_idx').on(
      table.sessionId,
      table.sourceProvider,
      table.providerPlaylistId,
    ),
  ],
);

export const recoveryPlaylistItems = sqliteTable(
  'recovery_playlist_items',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => recoverySources.id, { onDelete: 'cascade' }),
    providerPlaylistId: text('provider_playlist_id').notNull(),
    providerMediaId: text('provider_media_id').notNull(),
    position: integer('position'),
    metadataUpdatedAt: integer('metadata_updated_at').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionId, table.sourceId, table.providerPlaylistId, table.providerMediaId],
    }),
    index('recovery_playlist_items_playlist_idx').on(table.sessionId, table.providerPlaylistId),
  ],
);

export const recoveryCopies = sqliteTable(
  'recovery_copies',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => recoverySources.id, { onDelete: 'cascade' }),
    providerRootId: text('provider_root_id'),
    sourceProvider: text('source_provider').notNull(),
    providerMediaId: text('provider_media_id').notNull(),
    destinationType: text('destination_type').notNull(),
    relativePath: text('relative_path'),
    providerFileId: text('provider_file_id'),
    container: text('container'),
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    width: integer('width'),
    height: integer('height'),
    fps: real('fps'),
    bytes: integer('bytes'),
    sha256: text('sha256'),
    qualityProfile: text('quality_profile'),
    contentGeneration: text('content_generation'),
    verificationStrength: text('verification_strength'),
    status: text('status').notNull(),
    verifiedAt: integer('verified_at'),
    metadataUpdatedAt: integer('metadata_updated_at').notNull(),
    providerMetadataJson: text('provider_metadata_json').notNull().default('{}'),
    ...timestamps(),
  },
  (table) => [
    index('recovery_copies_identity_idx').on(
      table.sessionId,
      table.sourceProvider,
      table.providerMediaId,
    ),
    index('recovery_copies_destination_idx').on(
      table.sessionId,
      table.destinationType,
      table.sourceId,
      table.providerRootId,
    ),
  ],
);

export const recoveryArtifacts = sqliteTable(
  'recovery_artifacts',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => recoverySources.id, { onDelete: 'cascade' }),
    providerRootId: text('provider_root_id'),
    providerMediaId: text('provider_media_id').notNull(),
    artifactType: text('artifact_type').notNull(),
    relativePath: text('relative_path'),
    providerFileId: text('provider_file_id'),
    bytes: integer('bytes'),
    sha256: text('sha256'),
    status: text('status').notNull(),
    metadataUpdatedAt: integer('metadata_updated_at').notNull(),
    ...timestamps(),
  },
  (table) => [index('recovery_artifacts_media_idx').on(table.sessionId, table.providerMediaId)],
);

export const recoveryWarnings = sqliteTable(
  'recovery_warnings',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').references(() => recoverySources.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    entityKey: text('entity_key'),
    messageSafe: text('message_safe').notNull(),
    detailsJson: text('details_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('recovery_warnings_session_code_idx').on(table.sessionId, table.code, table.createdAt),
  ],
);

export const recoveryDriveObjects = sqliteTable(
  'recovery_drive_objects',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => recoverySessions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => recoverySources.id, { onDelete: 'cascade' }),
    providerObjectId: text('provider_object_id').notNull(),
    parentProviderObjectId: text('parent_provider_object_id'),
    currentName: text('current_name').notNull(),
    mimeType: text('mime_type').notNull(),
    bytes: integer('bytes'),
    modifiedAt: integer('modified_at'),
    logicalKey: text('logical_key'),
    objectType: text('object_type'),
    appPropertiesJson: text('app_properties_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('recovery_drive_objects_session_source_provider_uidx').on(
      table.sessionId,
      table.sourceId,
      table.providerObjectId,
    ),
    index('recovery_drive_objects_parent_idx').on(
      table.sessionId,
      table.sourceId,
      table.parentProviderObjectId,
    ),
    index('recovery_drive_objects_logical_key_idx').on(
      table.sessionId,
      table.sourceId,
      table.logicalKey,
    ),
  ],
);

export const integrityChecks = sqliteTable(
  'integrity_checks',
  {
    id: text('id').primaryKey(),
    mediaCopyId: text('media_copy_id').references(() => mediaCopies.id),
    mediaArtifactId: text('media_artifact_id').references(() => mediaArtifacts.id),
    destinationId: text('destination_id')
      .notNull()
      .references(() => destinations.id),
    expectedSha256: text('expected_sha256'),
    actualSha256: text('actual_sha256'),
    expectedBytes: integer('expected_bytes'),
    actualBytes: integer('actual_bytes'),
    result: text('result').notNull(),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at'),
    errorCode: text('error_code'),
    errorMessageSafe: text('error_message_safe'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('integrity_checks_destination_created_idx').on(table.destinationId, table.createdAt),
    index('integrity_checks_copy_created_idx').on(table.mediaCopyId, table.createdAt),
    check(
      'integrity_checks_one_target_check',
      sql`(${table.mediaCopyId} is not null) <> (${table.mediaArtifactId} is not null)`,
    ),
  ],
);

export const activityLog = sqliteTable(
  'activity_log',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').notNull(),
    severity: text('severity').notNull().default('INFO'),
    accountId: text('account_id').references(() => accounts.id),
    channelId: text('channel_id').references(() => channels.id),
    mediaItemId: text('media_item_id').references(() => mediaItems.id),
    playlistId: text('playlist_id').references(() => playlists.id),
    destinationId: text('destination_id').references(() => destinations.id),
    backupRunId: text('backup_run_id').references(() => backupRuns.id),
    jobId: text('job_id').references(() => jobs.id),
    summary: text('summary').notNull(),
    detailsJson: text('details_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('activity_log_created_idx').on(table.createdAt),
    index('activity_log_channel_created_idx').on(table.channelId, table.createdAt),
    index('activity_log_media_created_idx').on(table.mediaItemId, table.createdAt),
    index('activity_log_severity_created_idx').on(table.severity, table.createdAt),
  ],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
