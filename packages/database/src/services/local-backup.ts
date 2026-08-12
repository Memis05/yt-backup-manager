import { randomUUID } from 'node:crypto';
import { join, normalize, relative, resolve } from 'node:path';

import {
  BackupRunDtoSchema,
  BackupRunsListResultSchema,
  BackupStartResultSchema,
  ChannelBackupSettingsDtoSchema,
  MediaBackupDetailsSchema,
  QualityProfileSchema,
  type BackupRunDto,
  type BackupStartResult,
  type ChannelBackupSettingsDto,
  type JobType,
  type MediaBackupDetails,
  type QualityProfile,
} from '@ytbm/core';
import type { StoredFilesystemDestination, VolumeIdentity } from '@ytbm/storage-core';

import type { WorkerDatabase } from '../database';

export interface PersistedFilesystemDestination extends StoredFilesystemDestination {
  enabled: boolean;
  availabilityStatus: string;
  lastProbeAt: number | null;
  lastErrorCode: string | null;
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
  relativePath: string | null;
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
  trigger_type: 'MANUAL';
  status: string;
  effective_config_json: string;
  discovered_count: number;
  downloaded_count: number;
  local_copy_count: number;
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

  public updateDestinationProbe(
    id: string,
    input: DestinationPersistenceInput,
  ): PersistedFilesystemDestination {
    const changedAt = this.now();
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
            `select id from destinations where id = ? and destination_type = 'FILESYSTEM' and enabled = 1`,
          )
          .get(destinationId);
        if (destination === undefined)
          throw new Error('A selected filesystem destination is invalid');
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
  ): BackupStartResult {
    const settings = this.getChannelSettings(channelId, defaultQualityProfile);
    if (settings.destinationIds.length === 0) {
      throw new Error('Select at least one local destination before starting backup');
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
          ) values (?, ?, 'MANUAL', 'RUNNING', ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          channelId,
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
        summary: `Local backup started for ${channel.title}.`,
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
        manifestDependencies.set(destinationId, []);
        destinationRepairEpochs.set(destinationId, 0);
      }

      for (const media of mediaRows) {
        const verifiedCopies = this.verifiedCopies(media.id);
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
        if (missingDestinations.length > 0 && verifiedCopies.length === 0) {
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
          if (existingCopy === undefined) {
            const sourceCopy = verifiedCopies[0] ?? null;
            const copyId = this.ensureMediaCopy(media.id, destinationId, plannedAt);
            const dependencies = acquisitionDependency === null ? [] : [acquisitionDependency];
            const copyJobId = this.insertJob({
              backupRunId: runId,
              channelId,
              mediaItemId: media.id,
              destinationId,
              jobType: 'COPY_TO_FILESYSTEM',
              status: dependencies.length === 0 ? 'READY' : 'PENDING',
              priority: 50,
              payload: {
                mediaCopyId: copyId,
                qualityProfile: settings.effectiveQualityProfile,
                contentGeneration: `q1:${settings.effectiveQualityProfile}`,
                sourceCopyId: sourceCopy?.id ?? null,
              },
              idempotencyKey: `copy:${media.id}:${destinationId}:q1:${settings.effectiveQualityProfile}${repairSuffix}:run:${runId}`,
              dependencies,
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
            metadataId = this.insertJob({
              backupRunId: runId,
              channelId,
              mediaItemId: media.id,
              destinationId,
              jobType: 'WRITE_DESTINATION_METADATA',
              status: verifyId === null ? 'READY' : 'PENDING',
              priority: 30,
              payload: {
                mediaCopyId: copy?.id ?? this.ensureMediaCopy(media.id, destinationId, plannedAt),
                contentGeneration: metadataGeneration,
              },
              idempotencyKey: `metadata:${media.id}:${destinationId}:v${media.metadata_version}:q1:${settings.effectiveQualityProfile}${repairSuffix}:run:${runId}`,
              dependencies: verifyId === null ? [] : [verifyId],
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
              this.insertJob({
                backupRunId: runId,
                channelId,
                mediaItemId: media.id,
                destinationId,
                jobType: 'DOWNLOAD_THUMBNAIL',
                status: verifyId === null ? 'READY' : 'PENDING',
                priority: 20,
                payload: { contentGeneration: thumbnailGeneration },
                idempotencyKey: `thumbnail:${media.id}:${destinationId}:v${media.metadata_version}${repairSuffix}:run:${runId}`,
                dependencies: verifyId === null ? [] : [verifyId],
              });
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
          jobType: 'UPDATE_MANIFEST',
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
         where br.trigger_type = 'MANUAL' order by br.created_at desc limit ?`,
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
        `select mc.*, d.root_path as destination_root_path from media_copies mc
         join destinations d on d.id = mc.destination_id where mc.id = ?`,
      )
      .get(copyId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error('Media copy was not found');
    return {
      id: String(row.id),
      mediaItemId: String(row.media_item_id),
      destinationId: String(row.destination_id),
      destinationRootPath: String(row.destination_root_path),
      relativePath: row.relative_path as string | null,
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

  public markMediaCopyTransferring(copyId: string): void {
    this.database.sqlite
      .prepare(
        `update media_copies set status = 'TRANSFERRING', last_error_code = null,
          last_error_at = null, updated_at = ? where id = ? and status <> 'VERIFIED'`,
      )
      .run(this.now(), copyId);
  }

  public markMediaCopyVerified(copyId: string): boolean {
    const changedAt = this.now();
    return (
      this.database.sqlite
        .prepare(
          `update media_copies set status = 'VERIFIED', verified_at = ?, last_checked_at = ?,
          missing_since = null, corrupt_since = null, last_error_code = null,
          last_error_at = null, updated_at = ? where id = ? and status = 'VERIFYING'`,
        )
        .run(changedAt, changedAt, changedAt, copyId).changes === 1
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
  }): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into media_artifacts (
          id, media_item_id, destination_id, artifact_type, relative_path, bytes, sha256,
          content_generation, status, verified_at, last_checked_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?, ?, ?)
        on conflict(media_item_id, destination_id, artifact_type) do update set
          relative_path = excluded.relative_path, bytes = excluded.bytes, sha256 = excluded.sha256,
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
        input.bytes,
        input.sha256,
        input.contentGeneration,
        changedAt,
        changedAt,
        changedAt,
        changedAt,
      );
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
    const rows = this.database.sqlite
      .prepare(
        `select mc.*, d.root_path, d.availability_status from media_copies mc
         join destinations d on d.id = mc.destination_id where mc.media_item_id = ?
         order by d.created_at`,
      )
      .all(mediaItemId) as Array<Record<string, unknown>>;
    return MediaBackupDetailsSchema.parse({
      mediaItemId,
      providerMediaId: media.providerMediaId,
      title: media.title,
      mediaType: media.mediaType,
      sourceStatus: media.sourceStatus,
      copies: rows.map((row) => ({
        id: row.id,
        destinationId: row.destination_id,
        destinationPath: row.root_path,
        relativePath: row.relative_path,
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
        verifiedAt: row.verified_at,
      })),
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
      .prepare(`select id from media_copies where media_item_id = ? and status = 'VERIFIED'`)
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
          sum(case when status = 'COMPLETED' and job_type = 'WRITE_DESTINATION_METADATA' then 1 else 0 end) as metadata,
          coalesce(sum(case when status = 'COMPLETED' and job_type = 'DOWNLOAD_MEDIA' then bytes_processed else 0 end), 0) as bytes_downloaded,
          coalesce(sum(case when status = 'COMPLETED' and job_type = 'COPY_TO_FILESYSTEM' then bytes_processed else 0 end), 0) as bytes_transferred,
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
      .prepare('select status from backup_runs where id = ?')
      .get(runId) as { status: string } | undefined;
    this.database.sqlite
      .prepare(
        `update backup_runs set status = ?, downloaded_count = ?, local_copy_count = ?,
          metadata_update_count = ?, failed_count = ?, bytes_downloaded = ?,
          bytes_transferred = ?, completed_at = ?, updated_at = ? where id = ?`,
      )
      .run(
        status,
        Number(counts.downloaded ?? 0),
        Number(counts.copied ?? 0),
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
      const run = this.getRun(runId);
      this.insertActivity({
        eventType: 'BACKUP_COMPLETED',
        channelId: run.channelId,
        backupRunId: runId,
        summary:
          status === 'COMPLETED'
            ? `Local backup completed for ${run.channelTitle}.`
            : `Local backup completed with errors for ${run.channelTitle}.`,
        severity: status === 'COMPLETED' ? 'INFO' : 'WARNING',
        createdAt: this.now(),
      });
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
}
