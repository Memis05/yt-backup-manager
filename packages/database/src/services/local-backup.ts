import { randomUUID } from 'node:crypto';
import { join, normalize, relative, resolve } from 'node:path';

import {
  BackupRunDtoSchema,
  BackupRunsListResultSchema,
  BackupStartResultSchema,
  ChannelBackupSettingsDtoSchema,
  DashboardSummarySchema,
  IntegrityCheckDtoSchema,
  IntegrityOverviewSchema,
  IntegrityScopeSchema,
  IntegrityStartResultSchema,
  MediaBackupDetailsSchema,
  NotificationListResultSchema,
  QualityProfileSchema,
  RepairStartResultSchema,
  type BackupHealth,
  type BackupRunDto,
  type BackupRunTrigger,
  type BackupStartResult,
  type ChannelBackupSettingsDto,
  type AppSettings,
  type DashboardSummary,
  type IntegrityOverview,
  type IntegrityScope,
  type IntegrityStartResult,
  type JobType,
  type MediaBackupDetails,
  type NativeNotificationDto,
  type QualityProfile,
  type RepairStartResult,
} from '@ytbm/core';
import type {
  GoogleDriveResumableState,
  StoredFilesystemDestination,
  StoredGoogleDriveDestination,
  VolumeIdentity,
} from '@ytbm/storage-core';

import type { WorkerDatabase } from '../database';

export interface PersistedFilesystemDestination extends StoredFilesystemDestination {
  enabled: boolean;
  availabilityStatus: string;
  lastProbeAt: number | null;
  lastErrorCode: string | null;
}

export interface PersistedGoogleDriveDestination extends StoredGoogleDriveDestination {
  accountEmail: string | null;
  accountDisplayName: string | null;
  enabled: boolean;
  availabilityStatus: string;
  lastProbeAt: number | null;
  lastErrorCode: string | null;
}

export interface ProviderObjectRecord {
  destinationId: string;
  logicalKey: string;
  objectType: string;
  providerObjectId: string;
  parentProviderObjectId: string | null;
  currentName: string;
}

export interface DriveUploadSessionRecord extends GoogleDriveResumableState {
  jobId: string;
  destinationId: string;
  mediaCopyId: string;
  parentProviderObjectId: string;
  expectedBytes: number;
  expectedSha256: string;
  sourceReference: unknown;
}

export interface DestinationPersistenceInput {
  rootPath: string;
  identity: VolumeIdentity | null;
  availabilityStatus: string;
  lastErrorCode: string | null;
}

function volumeRelativeDestination(rootPath: string, mountPath: string): string {
  return normalize(relative(resolve(mountPath), resolve(rootPath))).toLocaleLowerCase('en-US');
}

export interface PlannedJobInput {
  backupRunId: string;
  channelId: string;
  mediaItemId?: string;
  destinationId?: string;
  jobType: JobType;
  status: 'PENDING' | 'READY' | 'BLOCKED';
  priority: number;
  payload: unknown;
  idempotencyKey: string;
  dependencies?: string[];
  errorCode?: string;
  safeMessage?: string;
}

export interface BackupMediaContext {
  id: string;
  providerMediaId: string;
  channelId: string;
  providerChannelId: string;
  channelTitle: string;
  title: string;
  originalTitle: string;
  sourceUrl: string;
  sourceStatus: string;
  mediaType: 'VIDEO' | 'SHORT' | 'LIVE';
  publishedAt: number | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  metadataVersion: number;
  lastSourceSyncAt: number | null;
  playlistIds: string[];
}

export interface MediaCopyContext {
  id: string;
  mediaItemId: string;
  destinationId: string;
  destinationRootPath: string;
  destinationType: 'FILESYSTEM' | 'GOOGLE_DRIVE';
  destinationAccountId: string | null;
  destinationAccountEmail: string | null;
  relativePath: string | null;
  providerFileId: string | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number | null;
  sha256: string | null;
  qualityProfile: QualityProfile | null;
  contentGeneration: string | null;
  verificationStrength: 'LOCAL_SHA256' | 'PROVIDER_METADATA_SIZE' | 'DOWNLOADED_SHA256' | null;
  providerMetadata: unknown;
  status: string;
  verifiedAt: number | null;
  missingSince: number | null;
  corruptSince: number | null;
  updatedAt: number;
}

export interface ChannelManifestData {
  providerChannelId: string;
  channelTitle: string;
  media: Array<{
    providerMediaId: string;
    mediaType: 'VIDEO' | 'SHORT' | 'LIVE';
    relativePath: string;
    bytes: number;
    sha256: string;
  }>;
  playlists: Array<{
    providerPlaylistId: string;
    title: string;
    sourceStatus: string;
    items: Array<{ providerMediaId: string; position: number | null }>;
  }>;
}

interface BackupRunRow {
  id: string;
  channel_id: string;
  channel_title: string;
  trigger_type: BackupRunTrigger;
  status: string;
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

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
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

export class LocalBackupRepository {
  public constructor(
    private readonly database: WorkerDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  public addDestination(input: DestinationPersistenceInput): PersistedFilesystemDestination {
    const candidates = this.database.sqlite
      .prepare(
        `select id, root_path, last_known_mount_path from destinations
         where destination_type = 'FILESYSTEM' and (
          (? is not null and volume_guid = ?) or
          (? is null and ? is not null and volume_serial = ?) or
          (volume_guid is null and volume_serial is null and root_path = ?)
        )`,
      )
      .all(
        input.identity?.volumeGuid ?? null,
        input.identity?.volumeGuid ?? null,
        input.identity?.volumeGuid ?? null,
        input.identity?.volumeSerial ?? null,
        input.identity?.volumeSerial ?? null,
        input.rootPath,
      ) as Array<{ id: string; root_path: string; last_known_mount_path: string | null }>;
    const existing = candidates.find((candidate) => {
      if (
        resolve(candidate.root_path).toLocaleLowerCase('en-US') ===
        resolve(input.rootPath).toLocaleLowerCase('en-US')
      ) {
        return true;
      }
      if (input.identity === null || candidate.last_known_mount_path === null) return false;
      return (
        volumeRelativeDestination(candidate.root_path, candidate.last_known_mount_path) ===
        volumeRelativeDestination(input.rootPath, input.identity.mountPath)
      );
    });
    const id = existing?.id ?? randomUUID();
    const changedAt = this.now();
    if (existing === undefined) {
      this.database.sqlite
        .prepare(
          `insert into destinations (
            id, destination_type, root_path, volume_guid, volume_serial, filesystem_type,
            last_known_mount_path, enabled, availability_status, last_probe_at,
            last_error_code, last_error_at, created_at, updated_at
          ) values (?, 'FILESYSTEM', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.rootPath,
          input.identity?.volumeGuid ?? null,
          input.identity?.volumeSerial ?? null,
          input.identity?.filesystemType ?? null,
          input.identity?.mountPath ?? input.rootPath,
          input.availabilityStatus,
          changedAt,
          input.lastErrorCode,
          input.lastErrorCode === null ? null : changedAt,
          changedAt,
          changedAt,
        );
    } else {
      this.database.sqlite
        .prepare(
          `update destinations set root_path = ?, volume_guid = coalesce(?, volume_guid),
            volume_serial = coalesce(?, volume_serial), filesystem_type = coalesce(?, filesystem_type),
            last_known_mount_path = ?, enabled = 1, availability_status = ?, last_probe_at = ?,
            last_error_code = ?, last_error_at = ?, updated_at = ? where id = ?`,
        )
        .run(
          input.rootPath,
          input.identity?.volumeGuid ?? null,
          input.identity?.volumeSerial ?? null,
          input.identity?.filesystemType ?? null,
          input.identity?.mountPath ?? input.rootPath,
          input.availabilityStatus,
          changedAt,
          input.lastErrorCode,
          input.lastErrorCode === null ? null : changedAt,
          changedAt,
          id,
        );
    }
    return this.getDestination(id);
  }

  public getDestination(id: string): PersistedFilesystemDestination {
    const row = this.database.sqlite
      .prepare(
        `select id, root_path, volume_guid, volume_serial, filesystem_type,
          last_known_mount_path, enabled, availability_status, last_probe_at, last_error_code
         from destinations where id = ? and destination_type = 'FILESYSTEM'`,
      )
      .get(id) as
      | {
          id: string;
          root_path: string;
          volume_guid: string | null;
          volume_serial: string | null;
          filesystem_type: string | null;
          last_known_mount_path: string | null;
          enabled: number;
          availability_status: string;
          last_probe_at: number | null;
          last_error_code: string | null;
        }
      | undefined;
    if (row === undefined) throw new Error('Filesystem destination was not found');
    return {
      id: row.id,
      rootPath: row.root_path,
      volumeGuid: row.volume_guid,
      volumeSerial: row.volume_serial,
      filesystemType: row.filesystem_type,
      lastKnownMountPath: row.last_known_mount_path,
      enabled: row.enabled === 1,
      availabilityStatus: row.availability_status,
      lastProbeAt: row.last_probe_at,
      lastErrorCode: row.last_error_code,
    };
  }

  public listDestinations(enabledOnly = false): PersistedFilesystemDestination[] {
    const rows = this.database.sqlite
      .prepare(
        `select id from destinations where destination_type = 'FILESYSTEM'
         ${enabledOnly ? 'and enabled = 1' : ''} order by created_at`,
      )
      .all() as Array<{ id: string }>;
    return rows.map((row) => this.getDestination(row.id));
  }

  public addGoogleDriveDestination(accountId: string): PersistedGoogleDriveDestination {
    const account = this.database.sqlite
      .prepare(
        `select id from accounts where id = ? and provider = 'GOOGLE'
         and json_extract(capabilities_json, '$.driveFile') = 1
         and json_extract(capabilities_json, '$.driveConnectionState') = 'CONNECTED'`,
      )
      .get(accountId);
    if (account === undefined) {
      throw new Error('Authorize Google Drive for this account before adding a destination');
    }
    const existing = this.database.sqlite
      .prepare(
        `select id from destinations where destination_type = 'GOOGLE_DRIVE' and account_id = ?`,
      )
      .get(accountId) as { id: string } | undefined;
    const changedAt = this.now();
    const id = existing?.id ?? randomUUID();
    if (existing === undefined) {
      this.database.sqlite
        .prepare(
          `insert into destinations (
            id, destination_type, account_id, enabled, availability_status,
            created_at, updated_at
          ) values (?, 'GOOGLE_DRIVE', ?, 1, 'UNKNOWN', ?, ?)`,
        )
        .run(id, accountId, changedAt, changedAt);
    } else {
      this.database.sqlite
        .prepare(
          `update destinations set enabled = 1, availability_status = 'UNKNOWN',
            last_error_code = null, last_error_at = null, updated_at = ? where id = ?`,
        )
        .run(changedAt, id);
    }
    return this.getGoogleDriveDestination(id);
  }

  public getGoogleDriveDestination(id: string): PersistedGoogleDriveDestination {
    const row = this.database.sqlite
      .prepare(
        `select d.id, d.account_id, d.provider_root_id, d.enabled, d.availability_status,
          d.last_probe_at, d.last_error_code, a.email, a.display_name
         from destinations d join accounts a on a.id = d.account_id
         where d.id = ? and d.destination_type = 'GOOGLE_DRIVE'`,
      )
      .get(id) as
      | {
          id: string;
          account_id: string;
          provider_root_id: string | null;
          enabled: number;
          availability_status: string;
          last_probe_at: number | null;
          last_error_code: string | null;
          email: string | null;
          display_name: string | null;
        }
      | undefined;
    if (row === undefined) throw new Error('Google Drive destination was not found');
    return {
      id: row.id,
      accountId: row.account_id,
      accountEmail: row.email,
      accountDisplayName: row.display_name,
      providerRootId: row.provider_root_id,
      enabled: row.enabled === 1,
      availabilityStatus: row.availability_status,
      lastProbeAt: row.last_probe_at,
      lastErrorCode: row.last_error_code,
    };
  }

  public listGoogleDriveDestinations(enabledOnly = false): PersistedGoogleDriveDestination[] {
    const rows = this.database.sqlite
      .prepare(
        `select id from destinations where destination_type = 'GOOGLE_DRIVE'
         ${enabledOnly ? 'and enabled = 1' : ''} order by created_at`,
      )
      .all() as Array<{ id: string }>;
    return rows.map((row) => this.getGoogleDriveDestination(row.id));
  }

  public destinationType(destinationId: string): 'FILESYSTEM' | 'GOOGLE_DRIVE' {
    const row = this.database.sqlite
      .prepare('select destination_type from destinations where id = ?')
      .get(destinationId) as { destination_type: 'FILESYSTEM' | 'GOOGLE_DRIVE' } | undefined;
    if (row === undefined) throw new Error('Backup destination was not found');
    return row.destination_type;
  }

  public updateGoogleDriveDestinationProbe(
    id: string,
    availabilityStatus: string,
    lastErrorCode: string | null,
  ): PersistedGoogleDriveDestination {
    const changedAt = this.now();
    const previous = this.getGoogleDriveDestination(id);
    this.database.sqlite
      .prepare(
        `update destinations set availability_status = ?, last_probe_at = ?,
          last_error_code = ?, last_error_at = ?, updated_at = ?
         where id = ? and destination_type = 'GOOGLE_DRIVE'`,
      )
      .run(
        availabilityStatus,
        changedAt,
        lastErrorCode,
        lastErrorCode === null ? null : changedAt,
        changedAt,
        id,
      );
    if (previous.availabilityStatus !== availabilityStatus) {
      if (availabilityStatus === 'AUTH_REQUIRED') {
        this.enqueueNotification({
          category: 'DRIVE_AUTH_REQUIRED',
          dedupKey: `destination:${id}:auth-required`,
          title: 'Google Drive authorization required',
          body: 'Reconnect Google Drive to resume its backup operations.',
          section: 'storage',
          entityId: id,
        });
      } else if (availabilityStatus === 'AVAILABLE') {
        this.database.sqlite
          .prepare('delete from notification_events where dedup_key = ?')
          .run(`destination:${id}:auth-required`);
        if (previous.availabilityStatus !== 'UNKNOWN') {
          this.enqueueNotification({
            category: 'DESTINATION_RECONNECTED',
            dedupKey: `destination:${id}:reconnected:${changedAt}`,
            title: 'Google Drive reconnected',
            body: 'Blocked Google Drive work can resume.',
            section: 'storage',
            entityId: id,
          });
        }
      }
    }
    return this.getGoogleDriveDestination(id);
  }

  public setGoogleDriveRoot(id: string, providerRootId: string): void {
    const changedAt = this.now();
    const result = this.database.sqlite
      .prepare(
        `update destinations set provider_root_id = ?, availability_status = 'AVAILABLE',
          last_probe_at = ?, last_error_code = null, last_error_at = null, updated_at = ?
         where id = ? and destination_type = 'GOOGLE_DRIVE'`,
      )
      .run(providerRootId, changedAt, changedAt, id);
    if (result.changes !== 1) throw new Error('Google Drive destination was not found');
  }

  public updateDestinationProbe(
    id: string,
    input: DestinationPersistenceInput,
  ): PersistedFilesystemDestination {
    const changedAt = this.now();
    const previous = this.getDestination(id);
    this.database.sqlite
      .prepare(
        `update destinations set root_path = ?, volume_guid = coalesce(?, volume_guid),
          volume_serial = coalesce(?, volume_serial), filesystem_type = coalesce(?, filesystem_type),
          last_known_mount_path = coalesce(?, last_known_mount_path), availability_status = ?,
          last_probe_at = ?, last_error_code = ?, last_error_at = ?, updated_at = ? where id = ?`,
      )
      .run(
        input.rootPath,
        input.identity?.volumeGuid ?? null,
        input.identity?.volumeSerial ?? null,
        input.identity?.filesystemType ?? null,
        input.identity?.mountPath ?? null,
        input.availabilityStatus,
        changedAt,
        input.lastErrorCode,
        input.lastErrorCode === null ? null : changedAt,
        changedAt,
        id,
      );
    if (previous.availabilityStatus !== input.availabilityStatus) {
      if (input.availabilityStatus === 'DISCONNECTED') {
        this.enqueueNotification({
          category: 'DESTINATION_DISCONNECTED',
          dedupKey: `destination:${id}:disconnected`,
          title: 'Backup destination disconnected',
          body: 'Local work for this destination is waiting for the same volume to return.',
          section: 'storage',
          entityId: id,
        });
      } else if (input.availabilityStatus === 'AVAILABLE') {
        this.database.sqlite
          .prepare('delete from notification_events where dedup_key = ?')
          .run(`destination:${id}:disconnected`);
        if (previous.availabilityStatus !== 'UNKNOWN') {
          this.enqueueNotification({
            category: 'DESTINATION_RECONNECTED',
            dedupKey: `destination:${id}:reconnected:${changedAt}`,
            title: 'Backup destination reconnected',
            body: 'Blocked local backup, integrity, and repair work can resume.',
            section: 'storage',
            entityId: id,
          });
        }
      }
    }
    return this.getDestination(id);
  }

  public disableDestination(id: string): void {
    const result = this.database.sqlite
      .prepare('update destinations set enabled = 0, updated_at = ? where id = ?')
      .run(this.now(), id);
    if (result.changes !== 1) throw new Error('Filesystem destination was not found');
  }

  public getChannelSettings(
    channelId: string,
    defaultQualityProfile: QualityProfile,
  ): ChannelBackupSettingsDto {
    const channel = this.database.sqlite
      .prepare(
        `select c.id, cs.quality_profile_override from channels c
         left join channel_settings cs on cs.channel_id = c.id where c.id = ?`,
      )
      .get(channelId) as { id: string; quality_profile_override: string | null } | undefined;
    if (channel === undefined) throw new Error('YouTube channel was not found');
    const override =
      channel.quality_profile_override === null
        ? null
        : QualityProfileSchema.parse(channel.quality_profile_override);
    const destinations = this.database.sqlite
      .prepare(
        `select cd.destination_id from channel_destinations cd
         join destinations d on d.id = cd.destination_id
         where cd.channel_id = ? and cd.enabled = 1 and d.enabled = 1
         order by cd.created_at`,
      )
      .all(channelId) as Array<{ destination_id: string }>;
    return ChannelBackupSettingsDtoSchema.parse({
      channelId,
      qualityProfileOverride: override,
      effectiveQualityProfile: override ?? defaultQualityProfile,
      destinationIds: destinations.map((row) => row.destination_id),
    });
  }

  public setChannelSettings(
    channelId: string,
    qualityProfileOverride: QualityProfile | null,
    destinationIds: string[],
    defaultQualityProfile: QualityProfile,
  ): ChannelBackupSettingsDto {
    const changedAt = this.now();
    const uniqueDestinationIds = [...new Set(destinationIds)];
    const transaction = this.database.sqlite.transaction(() => {
      const channel = this.database.sqlite
        .prepare('select id from channels where id = ?')
        .get(channelId);
      if (channel === undefined) throw new Error('YouTube channel was not found');
      for (const destinationId of uniqueDestinationIds) {
        const destination = this.database.sqlite
          .prepare(
            `select d.id from destinations d
             left join accounts a on a.id = d.account_id
             where d.id = ? and d.enabled = 1 and (
               d.destination_type = 'FILESYSTEM' or
               (d.destination_type = 'GOOGLE_DRIVE' and
                json_extract(a.capabilities_json, '$.driveFile') = 1)
             )`,
          )
          .get(destinationId);
        if (destination === undefined)
          throw new Error('A selected backup destination is unavailable or invalid');
      }
      this.database.sqlite
        .prepare(
          `insert into channel_settings (channel_id, quality_profile_override, created_at, updated_at)
           values (?, ?, ?, ?) on conflict(channel_id) do update set
             quality_profile_override = excluded.quality_profile_override,
             updated_at = excluded.updated_at`,
        )
        .run(channelId, qualityProfileOverride, changedAt, changedAt);
      this.database.sqlite
        .prepare('delete from channel_destinations where channel_id = ?')
        .run(channelId);
      const insert = this.database.sqlite.prepare(
        `insert into channel_destinations (
          channel_id, destination_id, enabled, created_at, updated_at
        ) values (?, ?, 1, ?, ?)`,
      );
      for (const destinationId of uniqueDestinationIds) {
        insert.run(channelId, destinationId, changedAt, changedAt);
      }
    });
    transaction();
    return this.getChannelSettings(channelId, defaultQualityProfile);
  }

  public planBackup(
    channelId: string,
    defaultQualityProfile: QualityProfile,
    stagingRoot: string,
    triggerType: Extract<
      BackupRunTrigger,
      'MANUAL' | 'CUSTOM_MANUAL' | 'SCHEDULED' | 'STARTUP'
    > = 'MANUAL',
  ): BackupStartResult {
    const settings = this.getChannelSettings(channelId, defaultQualityProfile);
    if (settings.destinationIds.length === 0) {
      throw new Error('Select at least one effective backup destination before starting backup');
    }
    const active = this.database.sqlite
      .prepare(
        `select id from backup_runs where channel_id = ?
         and trigger_type in ('MANUAL','CUSTOM_MANUAL','SCHEDULED','STARTUP')
         and status in ('PENDING','RUNNING','PAUSED','INTERRUPTED')
         order by created_at desc limit 1`,
      )
      .get(channelId) as { id: string } | undefined;
    if (active !== undefined) {
      const plannedJobs = (
        this.database.sqlite
          .prepare('select count(*) as count from jobs where backup_run_id = ?')
          .get(active.id) as { count: number }
      ).count;
      return BackupStartResultSchema.parse({
        run: this.getRun(active.id),
        plannedJobs,
        skippedVerifiedMedia: 0,
      });
    }
    const channel = this.database.sqlite
      .prepare(
        `select id, provider_channel_id, title, last_sync_at from channels
         where id = ? and backup_enabled = 1`,
      )
      .get(channelId) as
      | { id: string; provider_channel_id: string; title: string; last_sync_at: number | null }
      | undefined;
    if (channel === undefined) throw new Error('The selected channel is not enabled for backup');
    const runId = randomUUID();
    const plannedAt = this.now();
    const config = {
      qualityProfile: settings.effectiveQualityProfile,
      destinationIds: settings.destinationIds,
      sourceLastSyncAt: channel.last_sync_at,
      qualityGeneration: `q1:${settings.effectiveQualityProfile}`,
    };
    let plannedJobs = 0;
    let skippedVerifiedMedia = 0;

    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `insert into backup_runs (
            id, channel_id, trigger_type, status, effective_config_json, discovered_count,
            started_at, created_at, updated_at
          ) values (?, ?, ?, 'RUNNING', ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          channelId,
          triggerType,
          JSON.stringify(config),
          this.countChannelMedia(channelId),
          plannedAt,
          plannedAt,
          plannedAt,
        );
      this.insertActivity({
        eventType: 'BACKUP_STARTED',
        channelId,
        backupRunId: runId,
        summary: `Backup started for ${channel.title}.`,
        createdAt: plannedAt,
      });

      const mediaRows = this.database.sqlite
        .prepare(
          `select id, provider_media_id, source_status, metadata_version, thumbnail_url
           from media_items where channel_id = ? order by coalesce(published_at, 0), id`,
        )
        .all(channelId) as Array<{
        id: string;
        provider_media_id: string;
        source_status: string;
        metadata_version: number;
        thumbnail_url: string | null;
      }>;
      const manifestDependencies = new Map<string, string[]>();
      const destinationRepairEpochs = new Map<string, number>();
      const destinationTypes = new Map<string, 'FILESYSTEM' | 'GOOGLE_DRIVE'>();
      const driveFolderDependencies = new Map<string, string>();
      const cleanupDependencies = new Map<
        string,
        {
          dependencies: string[];
          repairSuffix: string;
          generation: string;
          stagingDirectory: string;
        }
      >();
      for (const destinationId of settings.destinationIds) {
        const destinationType = this.destinationType(destinationId);
        destinationTypes.set(destinationId, destinationType);
        manifestDependencies.set(destinationId, []);
        destinationRepairEpochs.set(destinationId, 0);
        if (destinationType === 'GOOGLE_DRIVE') {
          const rootId = this.insertJob({
            backupRunId: runId,
            channelId,
            destinationId,
            jobType: 'ENSURE_GOOGLE_DRIVE_ROOT',
            status: 'READY',
            priority: 65,
            payload: {},
            idempotencyKey: `drive-root:${destinationId}:run:${runId}`,
          });
          const folderId = this.insertJob({
            backupRunId: runId,
            channelId,
            destinationId,
            jobType: 'ENSURE_GOOGLE_DRIVE_FOLDER',
            status: 'PENDING',
            priority: 64,
            payload: {},
            idempotencyKey: `drive-folders:${destinationId}:${channelId}:run:${runId}`,
            dependencies: [rootId],
          });
          driveFolderDependencies.set(destinationId, folderId);
          manifestDependencies.get(destinationId)!.push(folderId);
          plannedJobs += 2;
        }
      }

      for (const media of mediaRows) {
        const verifiedCopies = this.verifiedCopies(media.id);
        const verifiedLocalSource =
          verifiedCopies.find((copy) => copy.destinationType === 'FILESYSTEM') ?? null;
        const verifiedDriveSource =
          verifiedCopies.find((copy) => copy.destinationType === 'GOOGLE_DRIVE') ?? null;
        const selectedCopies = new Map(
          settings.destinationIds.map((destinationId) => [
            destinationId,
            this.mediaCopyForDestination(media.id, destinationId),
          ]),
        );
        const selectedVerified = new Map(
          [...selectedCopies.entries()].filter((entry): entry is [string, MediaCopyContext] => {
            return entry[1]?.status === 'VERIFIED';
          }),
        );
        const missingDestinations = settings.destinationIds.filter(
          (destinationId) => !selectedVerified.has(destinationId),
        );
        if (missingDestinations.length === 0) skippedVerifiedMedia += 1;

        const acquisitionRepairEpoch = Math.max(
          0,
          ...missingDestinations.map((destinationId) =>
            this.copyRepairEpoch(selectedCopies.get(destinationId) ?? null),
          ),
        );
        const acquisitionRepairSuffix =
          acquisitionRepairEpoch === 0 ? '' : `:repair:${acquisitionRepairEpoch}`;

        let acquisitionDependency: string | null = null;
        let acquisitionGeneration: string | null = null;
        let acquisitionStagingDirectory: string | null = null;
        if (missingDestinations.length > 0 && verifiedLocalSource === null) {
          if (verifiedDriveSource !== null) {
            const generation = `drive-reuse-${verifiedDriveSource.id}-run-${runId}`;
            const stagingDirectory = join(stagingRoot, 'drive', media.id, generation);
            acquisitionGeneration = generation;
            acquisitionStagingDirectory = stagingDirectory;
            acquisitionDependency = this.insertJob({
              backupRunId: runId,
              channelId,
              mediaItemId: media.id,
              destinationId: verifiedDriveSource.destinationId,
              jobType: 'DOWNLOAD_FROM_GOOGLE_DRIVE',
              status: 'READY',
              priority: 60,
              payload: {
                sourceCopyId: verifiedDriveSource.id,
                generation,
                stagingDirectory,
              },
              idempotencyKey: `drive-download:${verifiedDriveSource.id}:${verifiedDriveSource.sha256 ?? 'unknown'}:run:${runId}`,
            });
            plannedJobs += 1;
          } else {
            if (media.source_status === 'REMOVED' || media.source_status === 'UNAVAILABLE') {
              continue;
            }
            const generation = `q1-${settings.effectiveQualityProfile.toLowerCase()}${
              acquisitionRepairEpoch === 0 ? '' : `-repair-${acquisitionRepairEpoch}`
            }-run-${runId}`;
            const stagingDirectory = join(stagingRoot, 'youtube', media.id, generation);
            acquisitionGeneration = generation;
            acquisitionStagingDirectory = stagingDirectory;
            const formatId = this.insertJob({
              backupRunId: runId,
              channelId,
              mediaItemId: media.id,
              jobType: 'FORMAT_PROBE',
              status: 'READY',
              priority: 100,
              payload: { qualityProfile: settings.effectiveQualityProfile, stagingDirectory },
              idempotencyKey: `format:${media.id}:q1:${settings.effectiveQualityProfile}${acquisitionRepairSuffix}:run:${runId}`,
            });
            const downloadId = this.insertJob({
              backupRunId: runId,
              channelId,
              mediaItemId: media.id,
              jobType: 'DOWNLOAD_MEDIA',
              status: 'PENDING',
              priority: 90,
              payload: { stagingDirectory, generation },
              idempotencyKey: `download:${media.id}:q1:${settings.effectiveQualityProfile}${acquisitionRepairSuffix}:run:${runId}`,
              dependencies: [formatId],
            });
            const postProcessId = this.insertJob({
              backupRunId: runId,
              channelId,
              mediaItemId: media.id,
              jobType: 'POST_PROCESS_MEDIA',
              status: 'PENDING',
              priority: 80,
              payload: { stagingDirectory, generation },
              idempotencyKey: `post-process:${media.id}:q1:${settings.effectiveQualityProfile}${acquisitionRepairSuffix}:run:${runId}`,
              dependencies: [downloadId],
            });
            const hashId = this.insertJob({
              backupRunId: runId,
              channelId,
              mediaItemId: media.id,
              jobType: 'HASH_STAGING_MEDIA',
              status: 'PENDING',
              priority: 70,
              payload: { generation },
              idempotencyKey: `hash:${media.id}:q1:${settings.effectiveQualityProfile}${acquisitionRepairSuffix}:run:${runId}`,
              dependencies: [postProcessId],
            });
            acquisitionDependency = this.insertJob({
              backupRunId: runId,
              channelId,
              mediaItemId: media.id,
              jobType: 'VERIFY_STAGING_MEDIA',
              status: 'PENDING',
              priority: 60,
              payload: { generation },
              idempotencyKey: `verify-staging:${media.id}:q1:${settings.effectiveQualityProfile}${acquisitionRepairSuffix}:run:${runId}`,
              dependencies: [hashId],
            });
            plannedJobs += 5;
          }
        }

        for (const destinationId of settings.destinationIds) {
          let verifyId: string | null = null;
          const existingCopy = selectedVerified.get(destinationId);
          const destinationCopy = selectedCopies.get(destinationId) ?? null;
          const repairEpoch = this.copyRepairEpoch(destinationCopy);
          const repairSuffix = repairEpoch === 0 ? '' : `:repair:${repairEpoch}`;
          destinationRepairEpochs.set(
            destinationId,
            Math.max(destinationRepairEpochs.get(destinationId) ?? 0, repairEpoch),
          );
          const destinationType = destinationTypes.get(destinationId)!;
          if (existingCopy === undefined) {
            const copyId = this.ensureMediaCopy(media.id, destinationId, plannedAt);
            const sourceDependencies =
              acquisitionDependency === null ? [] : [acquisitionDependency];
            if (destinationType === 'FILESYSTEM') {
              const copyJobId = this.insertJob({
                backupRunId: runId,
                channelId,
                mediaItemId: media.id,
                destinationId,
                jobType: 'COPY_TO_FILESYSTEM',
                status: sourceDependencies.length === 0 ? 'READY' : 'PENDING',
                priority: 50,
                payload: {
                  mediaCopyId: copyId,
                  qualityProfile: settings.effectiveQualityProfile,
                  contentGeneration: `q1:${settings.effectiveQualityProfile}`,
                  sourceCopyId: verifiedLocalSource?.id ?? null,
                },
                idempotencyKey: `copy:${media.id}:${destinationId}:q1:${settings.effectiveQualityProfile}${repairSuffix}:run:${runId}`,
                dependencies: sourceDependencies,
              });
              verifyId = this.insertJob({
                backupRunId: runId,
                channelId,
                mediaItemId: media.id,
                destinationId,
                jobType: 'VERIFY_FILESYSTEM_COPY',
                status: 'PENDING',
                priority: 40,
                payload: {
                  mediaCopyId: copyId,
                  qualityProfile: settings.effectiveQualityProfile,
                  contentGeneration: `q1:${settings.effectiveQualityProfile}`,
                },
                idempotencyKey: `verify-copy:${media.id}:${destinationId}:q1:${settings.effectiveQualityProfile}${repairSuffix}:run:${runId}`,
                dependencies: [copyJobId],
              });
            } else {
              const uploadDependencies = [
                driveFolderDependencies.get(destinationId)!,
                ...sourceDependencies,
              ];
              const uploadId = this.insertJob({
                backupRunId: runId,
                channelId,
                mediaItemId: media.id,
                destinationId,
                jobType: 'UPLOAD_TO_GOOGLE_DRIVE',
                status: 'PENDING',
                priority: 50,
                payload: {
                  mediaCopyId: copyId,
                  qualityProfile: settings.effectiveQualityProfile,
                  contentGeneration: `q1:${settings.effectiveQualityProfile}`,
                  sourceCopyId: verifiedLocalSource?.id ?? null,
                },
                idempotencyKey: `drive-upload:${media.id}:${destinationId}:q1:${settings.effectiveQualityProfile}${repairSuffix}:run:${runId}`,
                dependencies: uploadDependencies,
              });
              verifyId = this.insertJob({
                backupRunId: runId,
                channelId,
                mediaItemId: media.id,
                destinationId,
                jobType: 'VERIFY_GOOGLE_DRIVE_COPY',
                status: 'PENDING',
                priority: 40,
                payload: { mediaCopyId: copyId },
                idempotencyKey: `drive-verify:${media.id}:${destinationId}:q1:${settings.effectiveQualityProfile}${repairSuffix}:run:${runId}`,
                dependencies: [uploadId],
              });
            }
            plannedJobs += 2;
          }

          const copy = existingCopy ?? null;
          const metadataGeneration = `metadata:${media.metadata_version}:q1:${settings.effectiveQualityProfile}`;
          const metadataCurrent = this.artifactGenerationCurrent(
            media.id,
            destinationId,
            'METADATA',
            metadataGeneration,
          );
          let metadataId: string | null = null;
          if (!metadataCurrent || verifyId !== null) {
            const metadataDependencies = [
              ...(verifyId === null ? [] : [verifyId]),
              ...(destinationType === 'GOOGLE_DRIVE'
                ? [driveFolderDependencies.get(destinationId)!]
                : []),
            ];
            metadataId = this.insertJob({
              backupRunId: runId,
              channelId,
              mediaItemId: media.id,
              destinationId,
              jobType:
                destinationType === 'GOOGLE_DRIVE'
                  ? 'UPDATE_GOOGLE_DRIVE_METADATA'
                  : 'WRITE_DESTINATION_METADATA',
              status: metadataDependencies.length === 0 ? 'READY' : 'PENDING',
              priority: 30,
              payload: {
                mediaCopyId: copy?.id ?? this.ensureMediaCopy(media.id, destinationId, plannedAt),
                contentGeneration: metadataGeneration,
              },
              idempotencyKey: `metadata:${media.id}:${destinationId}:v${media.metadata_version}:q1:${settings.effectiveQualityProfile}${repairSuffix}:run:${runId}`,
              dependencies: metadataDependencies,
            });
            manifestDependencies.get(destinationId)!.push(metadataId);
            plannedJobs += 1;
          }

          if (media.thumbnail_url !== null) {
            const thumbnailGeneration = `thumbnail:${media.metadata_version}`;
            if (
              verifyId !== null ||
              !this.artifactGenerationCurrent(
                media.id,
                destinationId,
                'THUMBNAIL',
                thumbnailGeneration,
              )
            ) {
              const thumbnailDependencies = [
                ...(verifyId === null ? [] : [verifyId]),
                ...(destinationType === 'GOOGLE_DRIVE'
                  ? [driveFolderDependencies.get(destinationId)!]
                  : []),
              ];
              const thumbnailId = this.insertJob({
                backupRunId: runId,
                channelId,
                mediaItemId: media.id,
                destinationId,
                jobType:
                  destinationType === 'GOOGLE_DRIVE'
                    ? 'UPDATE_GOOGLE_DRIVE_THUMBNAIL'
                    : 'DOWNLOAD_THUMBNAIL',
                status: thumbnailDependencies.length === 0 ? 'READY' : 'PENDING',
                priority: 20,
                payload: { contentGeneration: thumbnailGeneration },
                idempotencyKey: `thumbnail:${media.id}:${destinationId}:v${media.metadata_version}${repairSuffix}:run:${runId}`,
                dependencies: thumbnailDependencies,
              });
              manifestDependencies.get(destinationId)!.push(thumbnailId);
              plannedJobs += 1;
            }
          }
          if (verifyId !== null && metadataId === null) {
            manifestDependencies.get(destinationId)!.push(verifyId);
          }
        }

        if (
          acquisitionDependency !== null &&
          acquisitionGeneration !== null &&
          acquisitionStagingDirectory !== null
        ) {
          cleanupDependencies.set(media.id, {
            dependencies: [],
            repairSuffix: acquisitionRepairSuffix,
            generation: acquisitionGeneration,
            stagingDirectory: acquisitionStagingDirectory,
          });
        }
      }

      const manifestGeneration = channel.last_sync_at ?? plannedAt;
      for (const destinationId of settings.destinationIds) {
        const repairEpoch = destinationRepairEpochs.get(destinationId) ?? 0;
        const repairSuffix = repairEpoch === 0 ? '' : `:repair:${repairEpoch}`;
        const manifestId = this.insertJob({
          backupRunId: runId,
          channelId,
          destinationId,
          jobType:
            destinationTypes.get(destinationId) === 'GOOGLE_DRIVE'
              ? 'UPDATE_GOOGLE_DRIVE_MANIFEST'
              : 'UPDATE_MANIFEST',
          status: 'PENDING',
          priority: 10,
          payload: { generation: manifestGeneration },
          idempotencyKey: `manifest:${channelId}:${destinationId}:${manifestGeneration}${repairSuffix}:run:${runId}`,
          dependencies: [...new Set(manifestDependencies.get(destinationId) ?? [])],
        });
        plannedJobs += 1;
        for (const cleanup of cleanupDependencies.values()) {
          cleanup.dependencies.push(manifestId);
        }
      }
      for (const [mediaItemId, cleanup] of cleanupDependencies) {
        this.insertJob({
          backupRunId: runId,
          channelId,
          mediaItemId,
          jobType: 'CLEANUP_STAGING',
          status: 'PENDING',
          priority: 0,
          payload: {
            generation: cleanup.generation,
            stagingDirectory: cleanup.stagingDirectory,
          },
          idempotencyKey: `cleanup:${mediaItemId}:q1:${settings.effectiveQualityProfile}${cleanup.repairSuffix}:run:${runId}`,
          dependencies: cleanup.dependencies,
        });
        plannedJobs += 1;
      }
    });
    transaction();
    this.reconcileRun(runId);
    return BackupStartResultSchema.parse({
      run: this.getRun(runId),
      plannedJobs,
      skippedVerifiedMedia,
    });
  }

  public planIntegrity(
    scopeInput: IntegrityScope,
    driveMode: 'PROVIDER_METADATA_SIZE' | 'DOWNLOADED_SHA256',
  ): IntegrityStartResult {
    const scope = IntegrityScopeSchema.parse(scopeInput);
    const where =
      scope.kind === 'COPY'
        ? 'mc.id = ?'
        : scope.kind === 'MEDIA'
          ? 'mc.media_item_id = ?'
          : scope.kind === 'CHANNEL'
            ? 'mi.channel_id = ?'
            : scope.kind === 'DESTINATION'
              ? 'mc.destination_id = ?'
              : '1 = 1';
    const parameters = scope.kind === 'ALL' ? [] : [scope.id];
    const copies = this.database.sqlite
      .prepare(
        `select mc.id, mc.media_item_id, mc.destination_id, mc.sha256, mc.bytes,
          mi.channel_id, d.destination_type
         from media_copies mc
         join media_items mi on mi.id = mc.media_item_id
         join destinations d on d.id = mc.destination_id
         where d.enabled = 1 and ${where}
         order by mc.id`,
      )
      .all(...parameters) as Array<{
      id: string;
      media_item_id: string;
      destination_id: string;
      sha256: string | null;
      bytes: number | null;
      channel_id: string;
      destination_type: 'FILESYSTEM' | 'GOOGLE_DRIVE';
    }>;
    const runId = randomUUID();
    const createdAt = this.now();
    const config = {
      qualityProfile: 'MAX_1080P',
      destinationIds: [...new Set(copies.map((copy) => copy.destination_id))],
      integrityScope: scope,
      driveMode,
    };
    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `insert into backup_runs (
            id, channel_id, trigger_type, status, effective_config_json, discovered_count,
            started_at, completed_at, created_at, updated_at
          ) values (?, ?, 'VERIFY', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          copies[0]?.channel_id ?? null,
          copies.length === 0 ? 'COMPLETED' : 'RUNNING',
          JSON.stringify(config),
          copies.length,
          createdAt,
          copies.length === 0 ? createdAt : null,
          createdAt,
          createdAt,
        );
      for (const copy of copies) {
        const checkId = randomUUID();
        const strength = copy.destination_type === 'FILESYSTEM' ? 'LOCAL_SHA256' : driveMode;
        const jobId = this.insertJob({
          backupRunId: runId,
          channelId: copy.channel_id,
          mediaItemId: copy.media_item_id,
          destinationId: copy.destination_id,
          jobType: 'VERIFY_EXISTING_COPY',
          status: 'READY',
          priority: 5,
          payload: {
            integrityCheckId: checkId,
            mediaCopyId: copy.id,
            verificationStrength: strength,
          },
          idempotencyKey: `integrity:${copy.id}:${strength}:run:${runId}`,
        });
        this.database.sqlite
          .prepare(
            `insert into integrity_checks (
              id, backup_run_id, job_id, media_copy_id, destination_id,
              verification_strength, expected_sha256, expected_bytes, result,
              started_at, created_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
          )
          .run(
            checkId,
            runId,
            jobId,
            copy.id,
            copy.destination_id,
            strength,
            copy.sha256,
            copy.bytes,
            createdAt,
            createdAt,
          );
      }
      this.insertActivity({
        eventType: 'INTEGRITY_STARTED',
        backupRunId: runId,
        summary: `Integrity verification started for ${copies.length} backup copies.`,
        createdAt,
      });
    });
    transaction();
    return IntegrityStartResultSchema.parse({ runId, plannedChecks: copies.length });
  }

  public completeIntegrityCheck(input: {
    checkId: string;
    copyId: string;
    result: 'VERIFIED' | 'MISSING' | 'CORRUPT' | 'UNAVAILABLE' | 'ERROR';
    verificationStrength: 'LOCAL_SHA256' | 'PROVIDER_METADATA_SIZE' | 'DOWNLOADED_SHA256';
    actualSha256: string | null;
    actualBytes: number | null;
    errorCode: string | null;
    safeMessage: string | null;
  }): void {
    const completedAt = this.now();
    const copy = this.getMediaCopy(input.copyId);
    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `update integrity_checks set actual_sha256 = ?, actual_bytes = ?, result = ?,
            completed_at = ?, error_code = ?, error_message_safe = ? where id = ? and media_copy_id = ?`,
        )
        .run(
          input.actualSha256,
          input.actualBytes,
          input.result,
          completedAt,
          input.errorCode,
          input.safeMessage,
          input.checkId,
          input.copyId,
        );
      if (input.result === 'VERIFIED') {
        this.database.sqlite
          .prepare('delete from notification_events where dedup_key in (?, ?)')
          .run(`integrity:${input.copyId}:MISSING`, `integrity:${input.copyId}:CORRUPT`);
        this.database.sqlite
          .prepare(
            `update media_copies set status = 'VERIFIED', verification_strength = ?,
              verified_at = ?, last_checked_at = ?, missing_since = null, corrupt_since = null,
              last_error_code = null, last_error_at = null, updated_at = ? where id = ?`,
          )
          .run(input.verificationStrength, completedAt, completedAt, completedAt, input.copyId);
      } else {
        this.database.sqlite
          .prepare(
            `update media_copies set status = ?, last_checked_at = ?,
              missing_since = case when ? = 'MISSING' then coalesce(missing_since, ?) else missing_since end,
              corrupt_since = case when ? = 'CORRUPT' then coalesce(corrupt_since, ?) else corrupt_since end,
              last_error_code = ?, last_error_at = ?, updated_at = ? where id = ?`,
          )
          .run(
            input.result === 'ERROR' ? 'FAILED' : input.result,
            completedAt,
            input.result,
            completedAt,
            input.result,
            completedAt,
            input.errorCode,
            completedAt,
            completedAt,
            input.copyId,
          );
      }
      if (input.result !== 'VERIFIED') {
        this.insertActivity({
          eventType:
            input.result === 'MISSING'
              ? 'INTEGRITY_MISSING'
              : input.result === 'CORRUPT'
                ? 'INTEGRITY_CORRUPT'
                : 'INTEGRITY_PROBLEM',
          mediaItemId: copy.mediaItemId,
          destinationId: copy.destinationId,
          summary: input.safeMessage ?? 'A backup copy did not pass integrity verification.',
          severity: ['MISSING', 'CORRUPT', 'ERROR'].includes(input.result) ? 'WARNING' : 'INFO',
          details: { result: input.result, verificationStrength: input.verificationStrength },
          createdAt: completedAt,
        });
      }
      if (input.result === 'MISSING' || input.result === 'CORRUPT') {
        this.enqueueNotification({
          category: input.result === 'MISSING' ? 'INTEGRITY_MISSING' : 'INTEGRITY_CORRUPT',
          dedupKey: `integrity:${input.copyId}:${input.result}`,
          title: input.result === 'MISSING' ? 'Backup copy missing' : 'Backup copy corrupt',
          body:
            input.result === 'MISSING'
              ? 'A configured backup copy could not be found.'
              : 'A configured backup copy failed integrity verification.',
          section: 'integrity',
          entityId: input.copyId,
        });
      }
    });
    transaction();
  }

  public cancelIntegrityCheck(checkId: string, copyId: string): void {
    const completedAt = this.now();
    const changed = this.database.sqlite
      .prepare(
        `update integrity_checks set result = 'ERROR', completed_at = ?,
          error_code = 'INTERNAL_ERROR', error_message_safe = ?
         where id = ? and media_copy_id = ? and result = 'PENDING'`,
      )
      .run(completedAt, 'Verification was cancelled before completion.', checkId, copyId);
    if (changed.changes === 0) return;
    const copy = this.getMediaCopy(copyId);
    this.insertActivity({
      eventType: 'INTEGRITY_CANCELLED',
      mediaItemId: copy.mediaItemId,
      destinationId: copy.destinationId,
      summary: 'Integrity verification was cancelled before completion.',
      severity: 'INFO',
      createdAt: completedAt,
    });
  }

  public integrityOverview(limit = 100): IntegrityOverview {
    const copyRows = this.database.sqlite
      .prepare(
        `select mc.*, mi.id as intended_media_item_id, cd.destination_id as intended_destination_id,
          d.destination_type, d.availability_status,
          mi.title as media_title, mi.channel_id, mi.source_status, c.title as channel_title
         from media_items mi
         join channels c on c.id = mi.channel_id
         join channel_destinations cd on cd.channel_id = c.id and cd.enabled = 1
         join destinations d on d.id = cd.destination_id and d.enabled = 1
         left join media_copies mc on mc.media_item_id = mi.id and mc.destination_id = d.id
         where c.backup_enabled = 1
         order by coalesce(mc.updated_at, mi.updated_at) desc`,
      )
      .all() as Array<Record<string, unknown>>;
    const mediaGroups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of copyRows) {
      const mediaId = String(row.intended_media_item_id);
      mediaGroups.set(mediaId, [...(mediaGroups.get(mediaId) ?? []), row]);
    }
    const health = {
      complete: 0,
      partial: 0,
      pending: 0,
      missing: 0,
      corrupt: 0,
      unavailable: 0,
      authRequired: 0,
    };
    const summaryKey = {
      COMPLETE: 'complete',
      PARTIAL: 'partial',
      PENDING: 'pending',
      MISSING: 'missing',
      CORRUPT: 'corrupt',
      UNAVAILABLE: 'unavailable',
      AUTH_REQUIRED: 'authRequired',
    } as const;
    const mediaHealth = [...mediaGroups.values()].map((rows) => {
      const statuses = rows.map((row) => (row.id === null ? 'PENDING' : String(row.status)));
      const availability = rows.map((row) => String(row.availability_status));
      const category: BackupHealth = availability.includes('AUTH_REQUIRED')
        ? 'AUTH_REQUIRED'
        : statuses.includes('CORRUPT')
          ? 'CORRUPT'
          : statuses.includes('MISSING')
            ? 'MISSING'
            : statuses.includes('UNAVAILABLE') || availability.includes('DISCONNECTED')
              ? 'UNAVAILABLE'
              : statuses.every((status) => status === 'VERIFIED')
                ? 'COMPLETE'
                : statuses.some((status) => status === 'VERIFIED')
                  ? 'PARTIAL'
                  : 'PENDING';
      health[summaryKey[category]] += 1;
      return {
        mediaItemId: String(rows[0]!.intended_media_item_id),
        mediaTitle: String(rows[0]!.media_title),
        channelId: String(rows[0]!.channel_id),
        channelTitle: String(rows[0]!.channel_title),
        health: category,
        intendedCopyCount: rows.length,
        verifiedCopyCount: statuses.filter((status) => status === 'VERIFIED').length,
      };
    });
    const channelGroups = new Map<
      string,
      { channelId: string; channelTitle: string; health: typeof health }
    >();
    for (const media of mediaHealth) {
      const current = channelGroups.get(media.channelId) ?? {
        channelId: media.channelId,
        channelTitle: media.channelTitle,
        health: {
          complete: 0,
          partial: 0,
          pending: 0,
          missing: 0,
          corrupt: 0,
          unavailable: 0,
          authRequired: 0,
        },
      };
      current.health[summaryKey[media.health]] += 1;
      channelGroups.set(media.channelId, current);
    }
    const channelHealth = [...channelGroups.values()].sort((left, right) =>
      left.channelTitle.localeCompare(right.channelTitle),
    );
    const issues = copyRows
      .filter((row) => {
        return (
          (row.id !== null &&
            ['MISSING', 'CORRUPT', 'UNAVAILABLE', 'FAILED'].includes(String(row.status))) ||
          (row.id !== null &&
            ['DISCONNECTED', 'AUTH_REQUIRED'].includes(String(row.availability_status)))
        );
      })
      .slice(0, limit)
      .map((row) => {
        const copyId = String(row.id);
        const status = String(row.status);
        const availability = String(row.availability_status);
        const healthValue =
          availability === 'AUTH_REQUIRED'
            ? 'AUTH_REQUIRED'
            : status === 'CORRUPT'
              ? 'CORRUPT'
              : status === 'MISSING'
                ? 'MISSING'
                : 'UNAVAILABLE';
        const candidates = this.verifiedCopies(String(row.intended_media_item_id))
          .filter((copy) => copy.id !== copyId)
          .sort((left, right) => {
            if (left.destinationType === right.destinationType)
              return left.id.localeCompare(right.id);
            return left.destinationType === 'FILESYSTEM' ? -1 : 1;
          });
        return {
          copyId,
          mediaItemId: String(row.intended_media_item_id),
          mediaTitle: String(row.media_title),
          channelId: String(row.channel_id),
          channelTitle: String(row.channel_title),
          destinationId: String(row.destination_id),
          destinationType: row.destination_type,
          copyStatus: row.status,
          destinationAvailability: row.availability_status,
          health: healthValue,
          lastCheckedAt: row.last_checked_at,
          safeMessage:
            healthValue === 'AUTH_REQUIRED'
              ? 'Google Drive authorization is required.'
              : healthValue === 'CORRUPT'
                ? 'The stored bytes do not match the expected SHA-256.'
                : healthValue === 'MISSING'
                  ? 'The configured backup copy is missing.'
                  : 'The destination is currently unavailable.',
          repairSources: candidates.map((candidate, index) => ({
            copyId: candidate.id,
            destinationId: candidate.destinationId,
            destinationType: candidate.destinationType,
            verificationStrength: candidate.verificationStrength,
            preferred: index === 0,
          })),
          youtubeFallbackAvailable: row.source_status === 'AVAILABLE',
        };
      });
    const historyRows = this.database.sqlite
      .prepare(
        `select ic.*, mc.media_item_id, mi.title as media_title, d.destination_type
         from integrity_checks ic
         join media_copies mc on mc.id = ic.media_copy_id
         join media_items mi on mi.id = mc.media_item_id
         join destinations d on d.id = ic.destination_id
          order by (ic.completed_at is null), coalesce(ic.completed_at, ic.created_at) desc,
            ic.created_at desc, ic.id limit ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    const history = historyRows.map((row) =>
      IntegrityCheckDtoSchema.parse({
        id: row.id,
        runId: row.backup_run_id,
        jobId: row.job_id,
        mediaCopyId: row.media_copy_id,
        mediaItemId: row.media_item_id,
        mediaTitle: row.media_title,
        destinationId: row.destination_id,
        destinationType: row.destination_type,
        verificationStrength: row.verification_strength,
        expectedSha256: row.expected_sha256,
        actualSha256: row.actual_sha256,
        expectedBytes: row.expected_bytes,
        actualBytes: row.actual_bytes,
        result: row.result,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        safeMessage: row.error_message_safe,
      }),
    );
    return IntegrityOverviewSchema.parse({
      health,
      channels: channelHealth,
      media: mediaHealth.slice(0, limit),
      issues,
      history,
    });
  }

  public planRepair(
    copyId: string,
    allowYoutubeFallback: boolean,
    defaultQualityProfile: QualityProfile,
    stagingRoot: string,
  ): RepairStartResult {
    const target = this.getMediaCopy(copyId);
    const media = this.getMediaContext(target.mediaItemId);
    const createdAt = this.now();
    const runId = randomUUID();
    if (target.status === 'VERIFIED') {
      this.database.sqlite
        .prepare(
          `insert into backup_runs (
            id, channel_id, trigger_type, status, effective_config_json, discovered_count,
            started_at, completed_at, created_at, updated_at
          ) values (?, ?, 'REPAIR', 'COMPLETED', ?, 1, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          media.channelId,
          JSON.stringify({
            qualityProfile: target.qualityProfile ?? defaultQualityProfile,
            destinationIds: [target.destinationId],
            targetCopyId: target.id,
          }),
          createdAt,
          createdAt,
          createdAt,
          createdAt,
        );
      return RepairStartResultSchema.parse({
        runId,
        targetCopyId: copyId,
        source: 'ALREADY_HEALTHY',
        status: 'COMPLETED',
        plannedJobs: 0,
      });
    }
    if (!['MISSING', 'CORRUPT', 'UNAVAILABLE', 'FAILED'].includes(target.status)) {
      throw new Error('This backup copy is not in a repairable unhealthy state.');
    }
    const sources = this.verifiedCopies(target.mediaItemId)
      .filter((copy) => copy.id !== target.id)
      .sort((left, right) => {
        if (left.destinationType === right.destinationType) return left.id.localeCompare(right.id);
        return left.destinationType === 'FILESYSTEM' ? -1 : 1;
      });
    const source = sources[0] ?? null;
    if (
      source === null &&
      (!allowYoutubeFallback || ['REMOVED', 'UNAVAILABLE'].includes(media.sourceStatus))
    ) {
      throw new Error('No trusted archive source is available for this repair.');
    }
    const qualityProfile = source?.qualityProfile ?? target.qualityProfile ?? defaultQualityProfile;
    const generation = `repair-${target.id}-${createdAt}`;
    const stagingDirectory = join(stagingRoot, 'repair', target.mediaItemId, generation);
    const config = {
      qualityProfile,
      destinationIds: [target.destinationId],
      targetCopyId: target.id,
      sourceCopyId: source?.id ?? null,
    };
    let plannedJobs = 0;
    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `insert into backup_runs (
            id, channel_id, trigger_type, status, effective_config_json, discovered_count,
            started_at, created_at, updated_at
          ) values (?, ?, 'REPAIR', 'RUNNING', ?, 1, ?, ?, ?)`,
        )
        .run(runId, media.channelId, JSON.stringify(config), createdAt, createdAt, createdAt);
      let acquisitionDependency: string | null = null;
      let localSourceCopyId: string | null = null;
      if (source?.destinationType === 'FILESYSTEM') {
        localSourceCopyId = source.id;
      } else if (source?.destinationType === 'GOOGLE_DRIVE') {
        acquisitionDependency = this.insertJob({
          backupRunId: runId,
          channelId: media.channelId,
          mediaItemId: media.id,
          destinationId: source.destinationId,
          jobType: 'DOWNLOAD_FROM_GOOGLE_DRIVE',
          status: 'READY',
          priority: 80,
          payload: { sourceCopyId: source.id, generation, stagingDirectory },
          idempotencyKey: `repair-drive-download:${target.id}:${source.id}:${createdAt}`,
        });
        plannedJobs += 1;
      } else {
        const formatId = this.insertJob({
          backupRunId: runId,
          channelId: media.channelId,
          mediaItemId: media.id,
          jobType: 'FORMAT_PROBE',
          status: 'READY',
          priority: 100,
          payload: { qualityProfile, stagingDirectory },
          idempotencyKey: `repair-format:${target.id}:${createdAt}`,
        });
        const downloadId = this.insertJob({
          backupRunId: runId,
          channelId: media.channelId,
          mediaItemId: media.id,
          jobType: 'DOWNLOAD_MEDIA',
          status: 'PENDING',
          priority: 90,
          payload: { stagingDirectory, generation },
          idempotencyKey: `repair-download:${target.id}:${createdAt}`,
          dependencies: [formatId],
        });
        const processId = this.insertJob({
          backupRunId: runId,
          channelId: media.channelId,
          mediaItemId: media.id,
          jobType: 'POST_PROCESS_MEDIA',
          status: 'PENDING',
          priority: 80,
          payload: { stagingDirectory, generation },
          idempotencyKey: `repair-process:${target.id}:${createdAt}`,
          dependencies: [downloadId],
        });
        const hashId = this.insertJob({
          backupRunId: runId,
          channelId: media.channelId,
          mediaItemId: media.id,
          jobType: 'HASH_STAGING_MEDIA',
          status: 'PENDING',
          priority: 70,
          payload: { generation },
          idempotencyKey: `repair-hash:${target.id}:${createdAt}`,
          dependencies: [processId],
        });
        acquisitionDependency = this.insertJob({
          backupRunId: runId,
          channelId: media.channelId,
          mediaItemId: media.id,
          jobType: 'VERIFY_STAGING_MEDIA',
          status: 'PENDING',
          priority: 60,
          payload: { generation },
          idempotencyKey: `repair-staging-verify:${target.id}:${createdAt}`,
          dependencies: [hashId],
        });
        plannedJobs += 5;
      }
      const dependencies = acquisitionDependency === null ? [] : [acquisitionDependency];
      let folderDependency: string | null = null;
      if (target.destinationType === 'GOOGLE_DRIVE') {
        const rootId = this.insertJob({
          backupRunId: runId,
          channelId: media.channelId,
          destinationId: target.destinationId,
          jobType: 'ENSURE_GOOGLE_DRIVE_ROOT',
          status: 'READY',
          priority: 65,
          payload: {},
          idempotencyKey: `repair-drive-root:${target.id}:${createdAt}`,
        });
        folderDependency = this.insertJob({
          backupRunId: runId,
          channelId: media.channelId,
          destinationId: target.destinationId,
          jobType: 'ENSURE_GOOGLE_DRIVE_FOLDER',
          status: 'PENDING',
          priority: 64,
          payload: {},
          idempotencyKey: `repair-drive-folders:${target.id}:${createdAt}`,
          dependencies: [rootId],
        });
        plannedJobs += 2;
      }
      const transferId = this.insertJob({
        backupRunId: runId,
        channelId: media.channelId,
        mediaItemId: media.id,
        destinationId: target.destinationId,
        jobType:
          target.destinationType === 'FILESYSTEM' ? 'COPY_TO_FILESYSTEM' : 'UPLOAD_TO_GOOGLE_DRIVE',
        status: dependencies.length === 0 && folderDependency === null ? 'READY' : 'PENDING',
        priority: 50,
        payload: {
          mediaCopyId: target.id,
          qualityProfile,
          contentGeneration: generation,
          sourceCopyId: localSourceCopyId,
          replaceUnhealthy: true,
          repairOriginalStatus: target.status,
        },
        idempotencyKey: `repair-transfer:${target.id}:${createdAt}`,
        dependencies: [...dependencies, ...(folderDependency === null ? [] : [folderDependency])],
      });
      const verifyId = this.insertJob({
        backupRunId: runId,
        channelId: media.channelId,
        mediaItemId: media.id,
        destinationId: target.destinationId,
        jobType:
          target.destinationType === 'FILESYSTEM'
            ? 'VERIFY_FILESYSTEM_COPY'
            : 'VERIFY_GOOGLE_DRIVE_COPY',
        status: 'PENDING',
        priority: 40,
        payload: {
          mediaCopyId: target.id,
          qualityProfile,
          contentGeneration: generation,
          repairOriginalStatus: target.status,
        },
        idempotencyKey: `repair-verify:${target.id}:${createdAt}`,
        dependencies: [transferId],
      });
      const metadataId = this.insertJob({
        backupRunId: runId,
        channelId: media.channelId,
        mediaItemId: media.id,
        destinationId: target.destinationId,
        jobType:
          target.destinationType === 'FILESYSTEM'
            ? 'WRITE_DESTINATION_METADATA'
            : 'UPDATE_GOOGLE_DRIVE_METADATA',
        status: 'PENDING',
        priority: 20,
        payload: { mediaCopyId: target.id, contentGeneration: generation },
        idempotencyKey: `repair-metadata:${target.id}:${createdAt}`,
        dependencies: [verifyId],
      });
      const manifestId = this.insertJob({
        backupRunId: runId,
        channelId: media.channelId,
        destinationId: target.destinationId,
        jobType:
          target.destinationType === 'FILESYSTEM'
            ? 'UPDATE_MANIFEST'
            : 'UPDATE_GOOGLE_DRIVE_MANIFEST',
        status: 'PENDING',
        priority: 10,
        payload: { generation: createdAt },
        idempotencyKey: `repair-manifest:${target.id}:${createdAt}`,
        dependencies: [metadataId],
      });
      plannedJobs += 4;
      if (acquisitionDependency !== null) {
        this.insertJob({
          backupRunId: runId,
          channelId: media.channelId,
          mediaItemId: media.id,
          jobType: 'CLEANUP_STAGING',
          status: 'PENDING',
          priority: 0,
          payload: { generation, stagingDirectory },
          idempotencyKey: `repair-cleanup:${target.id}:${createdAt}`,
          dependencies: [manifestId],
        });
        plannedJobs += 1;
      }
      this.insertActivity({
        eventType: 'REPAIR_STARTED',
        channelId: media.channelId,
        mediaItemId: media.id,
        destinationId: target.destinationId,
        backupRunId: runId,
        summary: 'Backup copy repair started from the best trusted source.',
        details: { targetCopyId: target.id, sourceCopyId: source?.id ?? null },
        createdAt,
      });
    });
    transaction();
    return RepairStartResultSchema.parse({
      runId,
      targetCopyId: target.id,
      source:
        source?.destinationType === 'FILESYSTEM'
          ? 'LOCAL'
          : source?.destinationType === 'GOOGLE_DRIVE'
            ? 'GOOGLE_DRIVE'
            : 'YOUTUBE',
      status: 'RUNNING',
      plannedJobs,
    });
  }

  public pendingNotifications(settings: AppSettings, limit = 20): NativeNotificationDto[] {
    const rows = this.database.sqlite
      .prepare(
        `select id, category, title, body, route_json, created_at
         from notification_events where delivered_at is null
         order by created_at, id limit ?`,
      )
      .all(Math.min(20, Math.max(1, limit))) as Array<{
      id: string;
      category: string;
      title: string;
      body: string;
      route_json: string;
      created_at: number;
    }>;
    const enabled = (category: string): boolean => {
      if (category === 'BACKUP_COMPLETED') return settings.notifications.backupComplete;
      if (['BACKUP_COMPLETED_WITH_ERRORS', 'BACKUP_FAILED'].includes(category))
        return settings.notifications.backupErrors;
      if (category === 'DESTINATION_DISCONNECTED')
        return settings.notifications.destinationDisconnected;
      if (category === 'DESTINATION_RECONNECTED')
        return settings.notifications.destinationReconnected;
      if (category === 'DRIVE_AUTH_REQUIRED') return settings.notifications.authenticationRequired;
      if (['INTEGRITY_CORRUPT', 'INTEGRITY_MISSING'].includes(category))
        return settings.notifications.integrityProblems;
      if (['REPAIR_COMPLETED', 'REPAIR_FAILED'].includes(category))
        return settings.notifications.repairResults;
      return settings.notifications.scheduleErrors;
    };
    const skipped = rows.filter((row) => !enabled(row.category)).map((row) => row.id);
    if (skipped.length > 0) this.ackNotifications(skipped);
    return NotificationListResultSchema.parse({
      notifications: rows
        .filter((row) => enabled(row.category))
        .map((row) => ({
          id: row.id,
          category: row.category,
          title: row.title,
          body: row.body,
          route: JSON.parse(row.route_json),
          createdAt: row.created_at,
        })),
    }).notifications;
  }

  public ackNotifications(notificationIds: string[]): number {
    const deliveredAt = this.now();
    const update = this.database.sqlite.prepare(
      'update notification_events set delivered_at = ? where id = ? and delivered_at is null',
    );
    let acknowledged = 0;
    const transaction = this.database.sqlite.transaction(() => {
      for (const id of [...new Set(notificationIds)].slice(0, 20)) {
        acknowledged += update.run(deliveredAt, id).changes;
      }
    });
    transaction();
    return acknowledged;
  }

  public getRun(runId: string): BackupRunDto {
    const row = this.database.sqlite
      .prepare(
        `select br.*, c.title as channel_title from backup_runs br
         join channels c on c.id = br.channel_id where br.id = ?`,
      )
      .get(runId) as BackupRunRow | undefined;
    if (row === undefined) throw new Error('Backup run was not found');
    return backupRunDto(row);
  }

  public listRuns(limit = 50): BackupRunDto[] {
    const rows = this.database.sqlite
      .prepare(
        `select br.*, c.title as channel_title from backup_runs br
         join channels c on c.id = br.channel_id
         where br.trigger_type in ('MANUAL','CUSTOM_MANUAL','SCHEDULED','STARTUP')
         order by br.created_at desc limit ?`,
      )
      .all(limit) as BackupRunRow[];
    return BackupRunsListResultSchema.parse({ runs: rows.map(backupRunDto) }).runs;
  }

  public reconcileAllRuns(): void {
    const rows = this.database.sqlite
      .prepare(
        `select id from backup_runs where status in ('PENDING', 'RUNNING', 'PAUSED', 'INTERRUPTED')`,
      )
      .all() as Array<{ id: string }>;
    for (const row of rows) this.reconcileRun(row.id);
  }

  public getMediaContext(mediaItemId: string): BackupMediaContext {
    const row = this.database.sqlite
      .prepare(
        `select m.*, c.provider_channel_id, c.title as channel_title, c.last_sync_at,
          coalesce((select json_group_array(p.provider_playlist_id) from playlist_items pi
            join playlists p on p.id = pi.playlist_id where pi.media_item_id = m.id), '[]') as playlist_ids
         from media_items m join channels c on c.id = m.channel_id where m.id = ?`,
      )
      .get(mediaItemId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error('Media item was not found');
    return {
      id: String(row.id),
      providerMediaId: String(row.provider_media_id),
      channelId: String(row.channel_id),
      providerChannelId: String(row.provider_channel_id),
      channelTitle: String(row.channel_title),
      title: String(row.title),
      originalTitle: String(row.original_title),
      sourceUrl: String(row.source_url),
      sourceStatus: String(row.source_status),
      mediaType: row.media_type as BackupMediaContext['mediaType'],
      publishedAt: row.published_at as number | null,
      durationSeconds: row.duration_seconds as number | null,
      thumbnailUrl: row.thumbnail_url as string | null,
      metadataVersion: Number(row.metadata_version),
      lastSourceSyncAt: row.last_sync_at as number | null,
      playlistIds: parseStringArray(String(row.playlist_ids)),
    };
  }

  public getMediaCopy(copyId: string): MediaCopyContext {
    const row = this.database.sqlite
      .prepare(
        `select mc.*, d.destination_type, d.account_id, d.root_path as destination_root_path,
          a.email as destination_account_email
         from media_copies mc join destinations d on d.id = mc.destination_id
         left join accounts a on a.id = d.account_id where mc.id = ?`,
      )
      .get(copyId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error('Media copy was not found');
    return {
      id: String(row.id),
      mediaItemId: String(row.media_item_id),
      destinationId: String(row.destination_id),
      destinationRootPath:
        row.destination_root_path === null
          ? `Google Drive${row.destination_account_email === null ? '' : ` - ${String(row.destination_account_email)}`}`
          : String(row.destination_root_path),
      destinationType: row.destination_type as MediaCopyContext['destinationType'],
      destinationAccountId: row.account_id as string | null,
      destinationAccountEmail: row.destination_account_email as string | null,
      relativePath: row.relative_path as string | null,
      providerFileId: row.provider_file_id as string | null,
      container: row.container as string | null,
      videoCodec: row.video_codec as string | null,
      audioCodec: row.audio_codec as string | null,
      width: row.width as number | null,
      height: row.height as number | null,
      fps: row.fps as number | null,
      bytes: row.bytes as number | null,
      sha256: row.sha256 as string | null,
      qualityProfile:
        row.quality_profile === null ? null : QualityProfileSchema.parse(row.quality_profile),
      contentGeneration: row.content_generation as string | null,
      verificationStrength: row.verification_strength as MediaCopyContext['verificationStrength'],
      providerMetadata:
        row.provider_metadata_json === null
          ? null
          : (JSON.parse(String(row.provider_metadata_json)) as unknown),
      status: String(row.status),
      verifiedAt: row.verified_at as number | null,
      missingSince: row.missing_since as number | null,
      corruptSince: row.corrupt_since as number | null,
      updatedAt: Number(row.updated_at),
    };
  }

  public listVerifiedMediaCopies(
    input: {
      channelId?: string;
      mediaItemId?: string;
      afterId?: string;
      limit?: number;
    } = {},
  ): MediaCopyContext[] {
    const channelId = input.channelId ?? null;
    const mediaItemId = input.mediaItemId ?? null;
    const afterId = input.afterId ?? null;
    const limit = Math.max(1, Math.min(input.limit ?? 250, 2_000));
    const rows = this.database.sqlite
      .prepare(
        `select mc.id from media_copies mc
         join media_items m on m.id = mc.media_item_id
         where mc.status = 'VERIFIED'
           and (? is null or m.channel_id = ?)
           and (? is null or mc.media_item_id = ?)
           and (? is null or mc.id > ?)
         order by mc.id limit ?`,
      )
      .all(channelId, channelId, mediaItemId, mediaItemId, afterId, afterId, limit) as Array<{
      id: string;
    }>;
    return rows.map((row) => this.getMediaCopy(row.id));
  }

  public getJobResult(jobId: string): unknown {
    const row = this.database.sqlite
      .prepare('select result_json from jobs where id = ?')
      .get(jobId) as { result_json: string | null } | undefined;
    if (row?.result_json === null || row?.result_json === undefined) return null;
    return JSON.parse(row.result_json) as unknown;
  }

  public getDependencyResult(jobId: string, jobType: JobType): unknown {
    const row = this.database.sqlite
      .prepare(
        `select dependency.result_json from job_dependencies jd
         join jobs dependency on dependency.id = jd.depends_on_job_id
         where jd.job_id = ? and dependency.job_type = ? and dependency.status = 'COMPLETED'
         order by dependency.completed_at desc limit 1`,
      )
      .get(jobId, jobType) as { result_json: string | null } | undefined;
    if (row?.result_json === null || row?.result_json === undefined) return null;
    return JSON.parse(row.result_json) as unknown;
  }

  public setStagingArtifact(input: {
    mediaItemId: string;
    jobId: string;
    artifactType: string;
    path: string;
    bytes: number | null;
    sha256: string | null;
    state: string;
    generation: string;
  }): void {
    const changedAt = this.now();
    const existing = this.database.sqlite
      .prepare(
        `select id from staging_artifacts where media_item_id = ? and artifact_type = ? and generation = ?`,
      )
      .get(input.mediaItemId, input.artifactType, input.generation) as { id: string } | undefined;
    if (existing === undefined) {
      this.database.sqlite
        .prepare(
          `insert into staging_artifacts (
            id, media_item_id, job_id, artifact_type, path, bytes, sha256, state,
            generation, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.mediaItemId,
          input.jobId,
          input.artifactType,
          input.path,
          input.bytes,
          input.sha256,
          input.state,
          input.generation,
          changedAt,
          changedAt,
        );
    } else {
      this.database.sqlite
        .prepare(
          `update staging_artifacts set job_id = ?, path = ?, bytes = ?, sha256 = ?,
            state = ?, updated_at = ? where id = ?`,
        )
        .run(
          input.jobId,
          input.path,
          input.bytes,
          input.sha256,
          input.state,
          changedAt,
          existing.id,
        );
    }
  }

  public updateMediaCopyTransferred(
    copyId: string,
    result: {
      relativePath: string;
      container: string;
      videoCodec: string | null;
      audioCodec: string | null;
      width: number | null;
      height: number | null;
      fps: number | null;
      bytes: number;
      sha256: string;
      qualityProfile: QualityProfile;
      contentGeneration: string;
    },
  ): void {
    this.database.sqlite
      .prepare(
        `update media_copies set relative_path = ?, container = ?, video_codec = ?,
          audio_codec = ?, width = ?, height = ?, fps = ?, bytes = ?, sha256 = ?,
          quality_profile = ?, content_generation = ?, status = 'VERIFYING',
          last_error_code = null, last_error_at = null, updated_at = ? where id = ?`,
      )
      .run(
        result.relativePath,
        result.container,
        result.videoCodec,
        result.audioCodec,
        result.width,
        result.height,
        result.fps,
        result.bytes,
        result.sha256,
        result.qualityProfile,
        result.contentGeneration,
        this.now(),
        copyId,
      );
  }

  public updateDriveMediaCopyTransferred(
    copyId: string,
    result: {
      relativePath: string;
      providerFileId: string;
      container: string;
      videoCodec: string | null;
      audioCodec: string | null;
      width: number | null;
      height: number | null;
      fps: number | null;
      bytes: number;
      sha256: string;
      qualityProfile: QualityProfile;
      contentGeneration: string;
      providerMetadata: unknown;
    },
  ): void {
    this.database.sqlite
      .prepare(
        `update media_copies set relative_path = ?, provider_file_id = ?, container = ?,
          video_codec = ?, audio_codec = ?, width = ?, height = ?, fps = ?, bytes = ?,
          sha256 = ?, quality_profile = ?, content_generation = ?, status = 'VERIFYING',
          verification_strength = null, provider_metadata_json = ?, last_error_code = null,
          last_error_at = null, updated_at = ? where id = ?`,
      )
      .run(
        result.relativePath,
        result.providerFileId,
        result.container,
        result.videoCodec,
        result.audioCodec,
        result.width,
        result.height,
        result.fps,
        result.bytes,
        result.sha256,
        result.qualityProfile,
        result.contentGeneration,
        JSON.stringify(result.providerMetadata),
        this.now(),
        copyId,
      );
  }

  public markMediaCopyTransferring(copyId: string): void {
    this.database.sqlite
      .prepare(
        `update media_copies set status = 'TRANSFERRING', last_error_code = null,
          last_error_at = null, updated_at = ? where id = ? and status <> 'VERIFIED'`,
      )
      .run(this.now(), copyId);
  }

  public markMediaCopyVerified(
    copyId: string,
    verificationStrength:
      'LOCAL_SHA256' | 'PROVIDER_METADATA_SIZE' | 'DOWNLOADED_SHA256' = 'LOCAL_SHA256',
  ): boolean {
    const changedAt = this.now();
    return (
      this.database.sqlite
        .prepare(
          `update media_copies set status = 'VERIFIED', verification_strength = ?,
          verified_at = ?, last_checked_at = ?,
          missing_since = null, corrupt_since = null, last_error_code = null,
          last_error_at = null, updated_at = ? where id = ? and status = 'VERIFYING'`,
        )
        .run(verificationStrength, changedAt, changedAt, changedAt, copyId).changes === 1
    );
  }

  public markMediaCopyFailure(
    copyId: string,
    status: 'MISSING' | 'CORRUPT',
    errorCode: string,
  ): boolean {
    const changedAt = this.now();
    const timestampColumn = status === 'MISSING' ? 'missing_since' : 'corrupt_since';
    return (
      this.database.sqlite
        .prepare(
          `update media_copies set status = ?, ${timestampColumn} = coalesce(${timestampColumn}, ?),
          last_checked_at = ?, last_error_code = ?, last_error_at = ?, updated_at = ?
         where id = ? and status <> ?`,
        )
        .run(status, changedAt, changedAt, errorCode, changedAt, changedAt, copyId, status)
        .changes === 1
    );
  }

  public upsertMediaArtifact(input: {
    mediaItemId: string;
    destinationId: string;
    artifactType: 'METADATA' | 'THUMBNAIL';
    relativePath: string;
    bytes: number;
    sha256: string;
    contentGeneration: string;
    providerFileId?: string | null;
  }): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into media_artifacts (
          id, media_item_id, destination_id, artifact_type, relative_path, provider_file_id,
          bytes, sha256,
          content_generation, status, verified_at, last_checked_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?, ?, ?)
        on conflict(media_item_id, destination_id, artifact_type) do update set
          relative_path = excluded.relative_path, provider_file_id = excluded.provider_file_id,
          bytes = excluded.bytes, sha256 = excluded.sha256,
          content_generation = excluded.content_generation, status = 'VERIFIED',
          verified_at = excluded.verified_at, last_checked_at = excluded.last_checked_at,
          updated_at = excluded.updated_at`,
      )
      .run(
        randomUUID(),
        input.mediaItemId,
        input.destinationId,
        input.artifactType,
        input.relativePath,
        input.providerFileId ?? null,
        input.bytes,
        input.sha256,
        input.contentGeneration,
        changedAt,
        changedAt,
        changedAt,
        changedAt,
      );
  }

  public recordDownloadedDriveVerification(copyId: string): void {
    this.database.sqlite
      .prepare(
        `update media_copies set verification_strength = 'DOWNLOADED_SHA256',
          last_checked_at = ?, updated_at = ? where id = ? and status = 'VERIFIED'`,
      )
      .run(this.now(), this.now(), copyId);
  }

  public getMediaArtifactProviderId(
    mediaItemId: string,
    destinationId: string,
    artifactType: 'METADATA' | 'THUMBNAIL',
  ): string | null {
    const row = this.database.sqlite
      .prepare(
        `select provider_file_id from media_artifacts
         where media_item_id = ? and destination_id = ? and artifact_type = ?`,
      )
      .get(mediaItemId, destinationId, artifactType) as
      { provider_file_id: string | null } | undefined;
    return row?.provider_file_id ?? null;
  }

  public getProviderObject(destinationId: string, logicalKey: string): ProviderObjectRecord | null {
    const row = this.database.sqlite
      .prepare(
        `select destination_id, logical_key, object_type, provider_object_id,
          parent_provider_object_id, current_name from provider_objects
         where destination_id = ? and logical_key = ?`,
      )
      .get(destinationId, logicalKey) as
      | {
          destination_id: string;
          logical_key: string;
          object_type: string;
          provider_object_id: string;
          parent_provider_object_id: string | null;
          current_name: string;
        }
      | undefined;
    return row === undefined
      ? null
      : {
          destinationId: row.destination_id,
          logicalKey: row.logical_key,
          objectType: row.object_type,
          providerObjectId: row.provider_object_id,
          parentProviderObjectId: row.parent_provider_object_id,
          currentName: row.current_name,
        };
  }

  public upsertProviderObject(input: ProviderObjectRecord): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into provider_objects (
          id, destination_id, logical_key, object_type, provider_object_id,
          parent_provider_object_id, current_name, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(destination_id, logical_key) do update set
          object_type = excluded.object_type, provider_object_id = excluded.provider_object_id,
          parent_provider_object_id = excluded.parent_provider_object_id,
          current_name = excluded.current_name, updated_at = excluded.updated_at`,
      )
      .run(
        randomUUID(),
        input.destinationId,
        input.logicalKey,
        input.objectType,
        input.providerObjectId,
        input.parentProviderObjectId,
        input.currentName,
        changedAt,
        changedAt,
      );
  }

  public getDriveUploadSession(jobId: string): DriveUploadSessionRecord | null {
    const row = this.database.sqlite
      .prepare('select * from drive_upload_sessions where job_id = ?')
      .get(jobId) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return {
      jobId: String(row.job_id),
      destinationId: String(row.destination_id),
      mediaCopyId: String(row.media_copy_id),
      parentProviderObjectId: String(row.parent_provider_object_id),
      sessionUri: String(row.session_uri),
      providerFileId: row.provider_file_id as string | null,
      bytesAcknowledged: Number(row.bytes_acknowledged),
      expectedBytes: Number(row.expected_bytes),
      expectedSha256: String(row.expected_sha256),
      sourceReference: JSON.parse(String(row.source_reference_json)) as unknown,
    };
  }

  public saveDriveUploadSession(input: DriveUploadSessionRecord): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into drive_upload_sessions (
          job_id, destination_id, media_copy_id, parent_provider_object_id, session_uri,
          provider_file_id, bytes_acknowledged, expected_bytes, expected_sha256,
          source_reference_json, started_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(job_id) do update set
          parent_provider_object_id = excluded.parent_provider_object_id,
          session_uri = excluded.session_uri, provider_file_id = excluded.provider_file_id,
          bytes_acknowledged = excluded.bytes_acknowledged,
          expected_bytes = excluded.expected_bytes, expected_sha256 = excluded.expected_sha256,
          source_reference_json = excluded.source_reference_json, updated_at = excluded.updated_at`,
      )
      .run(
        input.jobId,
        input.destinationId,
        input.mediaCopyId,
        input.parentProviderObjectId,
        input.sessionUri,
        input.providerFileId,
        input.bytesAcknowledged,
        input.expectedBytes,
        input.expectedSha256,
        JSON.stringify(input.sourceReference),
        changedAt,
        changedAt,
      );
  }

  public deleteDriveUploadSession(jobId: string): void {
    this.database.sqlite.prepare('delete from drive_upload_sessions where job_id = ?').run(jobId);
  }

  public getChannelManifestData(channelId: string, destinationId: string): ChannelManifestData {
    const channel = this.database.sqlite
      .prepare('select provider_channel_id, title from channels where id = ?')
      .get(channelId) as { provider_channel_id: string; title: string } | undefined;
    if (channel === undefined) throw new Error('Channel was not found');
    const media = this.database.sqlite
      .prepare(
        `select m.provider_media_id, m.media_type, mc.relative_path, mc.bytes, mc.sha256
         from media_copies mc join media_items m on m.id = mc.media_item_id
         where m.channel_id = ? and mc.destination_id = ? and mc.status = 'VERIFIED'
           and mc.relative_path is not null and mc.bytes is not null and mc.sha256 is not null
         order by m.provider_media_id`,
      )
      .all(channelId, destinationId) as Array<{
      provider_media_id: string;
      media_type: 'VIDEO' | 'SHORT' | 'LIVE';
      relative_path: string;
      bytes: number;
      sha256: string;
    }>;
    const playlists = this.database.sqlite
      .prepare(
        `select id, provider_playlist_id, title, source_status from playlists
         where channel_id = ? order by provider_playlist_id`,
      )
      .all(channelId) as Array<{
      id: string;
      provider_playlist_id: string;
      title: string;
      source_status: string;
    }>;
    const membership = this.database.sqlite.prepare(
      `select m.provider_media_id, pi.position from playlist_items pi
       join media_items m on m.id = pi.media_item_id where pi.playlist_id = ?
       order by coalesce(pi.position, 2147483647), m.provider_media_id`,
    );
    return {
      providerChannelId: channel.provider_channel_id,
      channelTitle: channel.title,
      media: media.map((row) => ({
        providerMediaId: row.provider_media_id,
        mediaType: row.media_type,
        relativePath: row.relative_path,
        bytes: row.bytes,
        sha256: row.sha256,
      })),
      playlists: playlists.map((playlist) => ({
        providerPlaylistId: playlist.provider_playlist_id,
        title: playlist.title,
        sourceStatus: playlist.source_status,
        items: (
          membership.all(playlist.id) as Array<{
            provider_media_id: string;
            position: number | null;
          }>
        ).map((row) => ({ providerMediaId: row.provider_media_id, position: row.position })),
      })),
    };
  }

  public mediaBackupDetails(mediaItemId: string): MediaBackupDetails {
    const media = this.getMediaContext(mediaItemId);
    const playlists = this.database.sqlite
      .prepare(
        `select p.id, p.title, p.source_status from playlist_items pi
         join playlists p on p.id = pi.playlist_id
         where pi.media_item_id = ? order by p.title collate nocase, p.id`,
      )
      .all(mediaItemId) as Array<{ id: string; title: string; source_status: string }>;
    const rows = this.database.sqlite
      .prepare(
        `select mc.*, d.destination_type, d.root_path, d.availability_status,
          a.email as account_email from media_copies mc
         join destinations d on d.id = mc.destination_id
         left join accounts a on a.id = d.account_id where mc.media_item_id = ?
         order by d.created_at`,
      )
      .all(mediaItemId) as Array<Record<string, unknown>>;
    return MediaBackupDetailsSchema.parse({
      mediaItemId,
      providerMediaId: media.providerMediaId,
      channelId: media.channelId,
      channelTitle: media.channelTitle,
      title: media.title,
      mediaType: media.mediaType,
      sourceStatus: media.sourceStatus,
      sourceUrl: media.sourceUrl,
      thumbnailUrl: media.thumbnailUrl,
      publishedAt: media.publishedAt,
      durationSeconds: media.durationSeconds,
      playlists: playlists.map((playlist) => ({
        id: playlist.id,
        title: playlist.title,
        sourceStatus: playlist.source_status,
      })),
      copies: rows.map((row) => ({
        id: row.id,
        destinationId: row.destination_id,
        destinationPath:
          row.destination_type === 'GOOGLE_DRIVE'
            ? `Google Drive${row.account_email === null ? '' : ` - ${String(row.account_email)}`}`
            : row.root_path,
        destinationType: row.destination_type,
        destinationAccountEmail: row.account_email,
        relativePath: row.relative_path,
        providerFileIdAvailable: row.provider_file_id !== null,
        status: row.status,
        availabilityStatus: row.availability_status,
        container: row.container,
        videoCodec: row.video_codec,
        audioCodec: row.audio_codec,
        width: row.width,
        height: row.height,
        fps: row.fps,
        bytes: row.bytes,
        sha256: row.sha256,
        qualityProfile: row.quality_profile,
        verificationStrength: row.verification_strength,
        verifiedAt: row.verified_at,
      })),
    });
  }

  public dashboardSummary(): DashboardSummary {
    const channels = this.database.sqlite
      .prepare('select count(*) as count from channels where backup_enabled = 1')
      .get() as { count: number };
    const media = this.database.sqlite
      .prepare(
        `select count(*) as count from media_items m join channels c on c.id = m.channel_id
         where c.backup_enabled = 1`,
      )
      .get() as { count: number };
    const copies = this.database.sqlite
      .prepare(
        `select count(*) as intended,
          sum(case when mc.status = 'VERIFIED' then 1 else 0 end) as verified,
          sum(case when mc.status in ('FAILED','MISSING','CORRUPT') then 1 else 0 end) as failed,
          sum(case when mc.status = 'VERIFIED' then coalesce(mc.bytes, 0) else 0 end) as bytes,
          sum(case when mc.status = 'VERIFIED' and d.destination_type = 'FILESYSTEM' then 1 else 0 end) as local_verified,
          sum(case when mc.status = 'VERIFIED' and d.destination_type = 'GOOGLE_DRIVE' then 1 else 0 end) as drive_verified
         from media_items m
         join channels c on c.id = m.channel_id and c.backup_enabled = 1
         join channel_destinations cd on cd.channel_id = c.id and cd.enabled = 1
         join destinations d on d.id = cd.destination_id and d.enabled = 1
         left join media_copies mc on mc.media_item_id = m.id and mc.destination_id = d.id`,
      )
      .get() as Record<string, number | null>;
    const intended = Number(copies.intended ?? 0);
    const verified = Number(copies.verified ?? 0);
    const failed = Number(copies.failed ?? 0);
    const lastRun = this.database.sqlite
      .prepare(
        `select max(completed_at) as completed_at from backup_runs
         where status in ('COMPLETED','COMPLETED_WITH_ERRORS')`,
      )
      .get() as { completed_at: number | null };
    return DashboardSummarySchema.parse({
      selectedChannelCount: channels.count,
      mediaCount: media.count,
      intendedCopyCount: intended,
      verifiedCopyCount: verified,
      pendingCopyCount: Math.max(0, intended - verified - failed),
      failedCopyCount: failed,
      verifiedBytes: Number(copies.bytes ?? 0),
      localVerifiedCount: Number(copies.local_verified ?? 0),
      driveVerifiedCount: Number(copies.drive_verified ?? 0),
      lastBackupAt: lastRun.completed_at,
    });
  }

  public recordActivity(input: {
    eventType: string;
    channelId?: string;
    mediaItemId?: string;
    destinationId?: string;
    backupRunId?: string;
    jobId?: string;
    summary: string;
    severity?: string;
    details?: unknown;
  }): void {
    this.insertActivity({ ...input, createdAt: this.now() });
  }

  public deleteStagingArtifacts(mediaItemId: string, generation?: string): void {
    if (generation !== undefined) {
      this.database.sqlite
        .prepare('delete from staging_artifacts where media_item_id = ? and generation = ?')
        .run(mediaItemId, generation);
      return;
    }
    this.database.sqlite
      .prepare('delete from staging_artifacts where media_item_id = ?')
      .run(mediaItemId);
  }

  private insertJob(input: PlannedJobInput): string {
    const existing = this.database.sqlite
      .prepare('select id, status from jobs where idempotency_key = ?')
      .get(input.idempotencyKey) as { id: string; status: string } | undefined;
    if (existing !== undefined) return existing.id;
    const id = randomUUID();
    const createdAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into jobs (
          id, backup_run_id, channel_id, media_item_id, destination_id, job_type, status,
          priority, attempt_count, max_attempts, bytes_processed, payload_json,
          idempotency_key, error_code, error_message_safe, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 0, 5, 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.backupRunId,
        input.channelId,
        input.mediaItemId ?? null,
        input.destinationId ?? null,
        input.jobType,
        input.status,
        input.priority,
        JSON.stringify(input.payload),
        input.idempotencyKey,
        input.errorCode ?? null,
        input.safeMessage ?? null,
        createdAt,
        createdAt,
      );
    const dependencyInsert = this.database.sqlite.prepare(
      'insert into job_dependencies (job_id, depends_on_job_id) values (?, ?)',
    );
    for (const dependency of input.dependencies ?? []) dependencyInsert.run(id, dependency);
    return id;
  }

  private ensureMediaCopy(mediaItemId: string, destinationId: string, createdAt: number): string {
    const existing = this.database.sqlite
      .prepare('select id from media_copies where media_item_id = ? and destination_id = ?')
      .get(mediaItemId, destinationId) as { id: string } | undefined;
    if (existing !== undefined) return existing.id;
    const id = randomUUID();
    this.database.sqlite
      .prepare(
        `insert into media_copies (
          id, media_item_id, destination_id, status, created_at, updated_at
        ) values (?, ?, ?, 'PENDING', ?, ?)`,
      )
      .run(id, mediaItemId, destinationId, createdAt, createdAt);
    return id;
  }

  private mediaCopyForDestination(
    mediaItemId: string,
    destinationId: string,
  ): MediaCopyContext | null {
    const row = this.database.sqlite
      .prepare('select id from media_copies where media_item_id = ? and destination_id = ?')
      .get(mediaItemId, destinationId) as { id: string } | undefined;
    return row === undefined ? null : this.getMediaCopy(row.id);
  }

  private copyRepairEpoch(copy: MediaCopyContext | null): number {
    if (copy === null || (copy.status !== 'MISSING' && copy.status !== 'CORRUPT')) return 0;
    return copy.missingSince ?? copy.corruptSince ?? copy.updatedAt;
  }

  private verifiedCopies(mediaItemId: string): MediaCopyContext[] {
    const rows = this.database.sqlite
      .prepare(
        `select mc.id from media_copies mc
         join destinations d on d.id = mc.destination_id
         where mc.media_item_id = ? and mc.status = 'VERIFIED'
           and d.enabled = 1 and d.availability_status = 'AVAILABLE'`,
      )
      .all(mediaItemId) as Array<{ id: string }>;
    return rows.map((row) => this.getMediaCopy(row.id));
  }

  private artifactGenerationCurrent(
    mediaItemId: string,
    destinationId: string,
    artifactType: string,
    contentGeneration: string,
  ): boolean {
    return (
      this.database.sqlite
        .prepare(
          `select 1 as found from media_artifacts where media_item_id = ? and destination_id = ?
           and artifact_type = ? and content_generation = ? and status = 'VERIFIED'`,
        )
        .get(mediaItemId, destinationId, artifactType, contentGeneration) !== undefined
    );
  }

  private countChannelMedia(channelId: string): number {
    return (
      this.database.sqlite
        .prepare('select count(*) as count from media_items where channel_id = ?')
        .get(channelId) as {
        count: number;
      }
    ).count;
  }

  private reconcileRun(runId: string): void {
    const counts = this.database.sqlite
      .prepare(
        `select
          sum(case when status in ('PENDING','READY','RUNNING','RETRY_WAIT','PAUSE_REQUESTED','CANCEL_REQUESTED','INTERRUPTED') then 1 else 0 end) as active,
          sum(case when status = 'PAUSED' then 1 else 0 end) as paused,
          sum(case when status = 'BLOCKED' and error_code <> 'INTERNAL_ERROR' then 1 else 0 end) as waiting_blocked,
          sum(case when status = 'BLOCKED' and error_code = 'INTERNAL_ERROR' then 1 else 0 end) as terminal_blocked,
          sum(case when status = 'FAILED' then 1 else 0 end) as failed,
          sum(case when status = 'CANCELLED' then 1 else 0 end) as cancelled,
          sum(case when status = 'COMPLETED' and job_type = 'DOWNLOAD_MEDIA' then 1 else 0 end) as downloaded,
          sum(case when status = 'COMPLETED' and job_type = 'VERIFY_FILESYSTEM_COPY' then 1 else 0 end) as copied,
          sum(case when status = 'COMPLETED' and job_type = 'VERIFY_GOOGLE_DRIVE_COPY' then 1 else 0 end) as drive_uploaded,
          sum(case when status = 'COMPLETED' and job_type in ('WRITE_DESTINATION_METADATA','UPDATE_GOOGLE_DRIVE_METADATA') then 1 else 0 end) as metadata,
          coalesce(sum(case when status = 'COMPLETED' and job_type = 'DOWNLOAD_MEDIA' then bytes_processed else 0 end), 0) as bytes_downloaded,
          coalesce(sum(case when status = 'COMPLETED' and job_type in ('COPY_TO_FILESYSTEM','UPLOAD_TO_GOOGLE_DRIVE') then bytes_processed else 0 end), 0) as bytes_transferred,
          count(*) as total
         from jobs where backup_run_id = ?`,
      )
      .get(runId) as Record<string, number | null>;
    const total = Number(counts.total ?? 0);
    const active = Number(counts.active ?? 0);
    const paused = Number(counts.paused ?? 0);
    const waitingBlocked = Number(counts.waiting_blocked ?? 0);
    const terminalBlocked = Number(counts.terminal_blocked ?? 0);
    const failed = Number(counts.failed ?? 0);
    const cancelled = Number(counts.cancelled ?? 0);
    let status: string;
    if (total === 0) status = 'COMPLETED';
    else if (active > 0 || waitingBlocked > 0) status = 'RUNNING';
    else if (paused > 0) status = 'PAUSED';
    else if (cancelled === total) status = 'CANCELLED';
    else if (failed > 0 || terminalBlocked > 0 || cancelled > 0) status = 'COMPLETED_WITH_ERRORS';
    else status = 'COMPLETED';
    const completedAt = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'CANCELLED'].includes(status)
      ? this.now()
      : null;
    const current = this.database.sqlite
      .prepare('select status, trigger_type from backup_runs where id = ?')
      .get(runId) as { status: string; trigger_type: string } | undefined;
    this.database.sqlite
      .prepare(
        `update backup_runs set status = ?, downloaded_count = ?, local_copy_count = ?, drive_upload_count = ?,
          metadata_update_count = ?, failed_count = ?, bytes_downloaded = ?,
          bytes_transferred = ?, completed_at = ?, updated_at = ? where id = ?`,
      )
      .run(
        status,
        Number(counts.downloaded ?? 0),
        Number(counts.copied ?? 0),
        Number(counts.drive_uploaded ?? 0),
        Number(counts.metadata ?? 0),
        failed + terminalBlocked,
        Number(counts.bytes_downloaded ?? 0),
        Number(counts.bytes_transferred ?? 0),
        completedAt,
        this.now(),
        runId,
      );
    if (
      current !== undefined &&
      current.status !== status &&
      (status === 'COMPLETED' || status === 'COMPLETED_WITH_ERRORS')
    ) {
      const completedAtValue = this.now();
      if (['MANUAL', 'CUSTOM_MANUAL', 'SCHEDULED', 'STARTUP'].includes(current.trigger_type)) {
        const run = this.getRun(runId);
        const backupFailed =
          status !== 'COMPLETED' &&
          Number(counts.downloaded ?? 0) === 0 &&
          Number(counts.copied ?? 0) === 0 &&
          Number(counts.drive_uploaded ?? 0) === 0;
        this.insertActivity({
          eventType: backupFailed ? 'BACKUP_FAILED' : 'BACKUP_COMPLETED',
          channelId: run.channelId,
          backupRunId: runId,
          summary: backupFailed
            ? `Backup failed for ${run.channelTitle}.`
            : status === 'COMPLETED'
              ? `Backup completed for ${run.channelTitle}.`
              : `Backup completed with errors for ${run.channelTitle}.`,
          severity: status === 'COMPLETED' ? 'INFO' : 'WARNING',
          createdAt: completedAtValue,
        });
        this.enqueueNotification({
          category: backupFailed
            ? 'BACKUP_FAILED'
            : status === 'COMPLETED'
              ? 'BACKUP_COMPLETED'
              : 'BACKUP_COMPLETED_WITH_ERRORS',
          dedupKey: `backup:${runId}:${status}`,
          title: backupFailed
            ? 'Backup failed'
            : status === 'COMPLETED'
              ? 'Backup completed'
              : 'Backup completed with errors',
          body: backupFailed
            ? `${run.channelTitle} could not finish its backup.`
            : status === 'COMPLETED'
              ? `${run.channelTitle} finished backing up.`
              : `${run.channelTitle} finished with items needing attention.`,
          section: 'backup',
          entityId: runId,
        });
      } else if (current.trigger_type === 'REPAIR') {
        const target = this.database.sqlite
          .prepare('select effective_config_json from backup_runs where id = ?')
          .get(runId) as { effective_config_json: string };
        const targetCopyId = (
          JSON.parse(target.effective_config_json) as { targetCopyId?: unknown }
        ).targetCopyId;
        this.insertActivity({
          eventType: status === 'COMPLETED' ? 'REPAIR_COMPLETED' : 'REPAIR_FAILED',
          backupRunId: runId,
          summary:
            status === 'COMPLETED'
              ? 'Backup copy repair completed and verified.'
              : 'Backup copy repair stopped with an error; the target remains unhealthy.',
          severity: status === 'COMPLETED' ? 'INFO' : 'WARNING',
          createdAt: completedAtValue,
        });
        this.enqueueNotification({
          category: status === 'COMPLETED' ? 'REPAIR_COMPLETED' : 'REPAIR_FAILED',
          dedupKey: `repair:${runId}:${status}`,
          title: status === 'COMPLETED' ? 'Repair completed' : 'Repair failed',
          body:
            status === 'COMPLETED'
              ? 'The replacement copy passed verification.'
              : 'The replacement was not promoted. Review the Repair Center.',
          section: 'integrity',
          entityId: typeof targetCopyId === 'string' ? targetCopyId : null,
        });
      } else if (current.trigger_type === 'VERIFY') {
        this.insertActivity({
          eventType: 'INTEGRITY_COMPLETED',
          backupRunId: runId,
          summary: 'Integrity verification completed.',
          severity: status === 'COMPLETED' ? 'INFO' : 'WARNING',
          createdAt: completedAtValue,
        });
      }
    }
  }

  private insertActivity(input: {
    eventType: string;
    channelId?: string;
    mediaItemId?: string;
    destinationId?: string;
    backupRunId?: string;
    jobId?: string;
    summary: string;
    severity?: string;
    details?: unknown;
    createdAt: number;
  }): void {
    this.database.sqlite
      .prepare(
        `insert into activity_log (
          id, event_type, severity, channel_id, media_item_id, destination_id,
          backup_run_id, job_id, summary, details_json, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.eventType,
        input.severity ?? 'INFO',
        input.channelId ?? null,
        input.mediaItemId ?? null,
        input.destinationId ?? null,
        input.backupRunId ?? null,
        input.jobId ?? null,
        input.summary,
        JSON.stringify(input.details ?? {}),
        input.createdAt,
      );
  }

  public restoreUnhealthyCopyStatus(copyId: string, status: string): void {
    if (!['MISSING', 'CORRUPT', 'UNAVAILABLE', 'FAILED'].includes(status)) return;
    this.database.sqlite
      .prepare(
        `update media_copies set status = ?, updated_at = ?
         where id = ? and status in ('TRANSFERRING','VERIFYING','FAILED','MISSING','CORRUPT','UNAVAILABLE')`,
      )
      .run(status, this.now(), copyId);
  }

  private enqueueNotification(input: {
    category: string;
    dedupKey: string;
    title: string;
    body: string;
    section: 'dashboard' | 'backup' | 'queue' | 'storage' | 'integrity' | 'settings';
    entityId: string | null;
  }): void {
    this.database.sqlite
      .prepare(
        `insert into notification_events (
          id, category, dedup_key, title, body, route_json, created_at
        ) values (?, ?, ?, ?, ?, ?, ?) on conflict(dedup_key) do nothing`,
      )
      .run(
        randomUUID(),
        input.category,
        input.dedupKey,
        input.title,
        input.body,
        JSON.stringify({ section: input.section, entityId: input.entityId }),
        this.now(),
      );
  }
}
