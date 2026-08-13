import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import {
  RecoverySessionDtoSchema,
  type RecoverySessionDto,
  type RecoverySessionStatus,
  type RecoverySourceStatus,
} from '@ytbm/core';
import type { WorkerDatabase } from '@ytbm/database/worker';
import type { VolumeIdentity } from '@ytbm/storage-core';

import type {
  RecoveryArtifactCandidate,
  RecoveryChannelCandidate,
  RecoveryCopyCandidate,
  RecoveryDriveObjectCandidate,
  RecoveryMediaCandidate,
  RecoveryPlaylistCandidate,
  RecoverySourceRecord,
  RecoveryWarningInput,
} from './types';

interface SourceRow {
  id: string;
  session_id: string;
  source_type: 'FILESYSTEM' | 'GOOGLE_DRIVE';
  status: RecoverySourceStatus;
  label: string;
  root_path: string | null;
  account_id: string | null;
  account_email: string | null;
  volume_guid: string | null;
  volume_serial: string | null;
  filesystem_type: string | null;
  last_known_mount_path: string | null;
  discovered_root_count: number;
  error_message_safe: string | null;
}

export interface PersistedDriveObject {
  providerObjectId: string;
  parentProviderObjectId: string | null;
  currentName: string;
  mimeType: string;
  bytes: number | null;
  modifiedAt: number | null;
  logicalKey: string | null;
  objectType: string | null;
  appProperties: Readonly<Record<string, string>>;
  selectedForImport: boolean;
}

function sourceRecord(row: SourceRow): RecoverySourceRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceType: row.source_type,
    status: row.status,
    label: row.label,
    rootPath: row.root_path,
    accountId: row.account_id,
    accountEmail: row.account_email,
    volumeGuid: row.volume_guid,
    volumeSerial: row.volume_serial,
    filesystemType: row.filesystem_type,
    lastKnownMountPath: row.last_known_mount_path,
  };
}

function driveObject(row: Record<string, unknown>): PersistedDriveObject {
  return {
    providerObjectId: String(row.provider_object_id),
    parentProviderObjectId: row.parent_provider_object_id as string | null,
    currentName: String(row.current_name),
    mimeType: String(row.mime_type),
    bytes: row.bytes as number | null,
    modifiedAt: row.modified_at as number | null,
    logicalKey: row.logical_key as string | null,
    objectType: row.object_type as string | null,
    appProperties: JSON.parse(String(row.app_properties_json)) as Record<string, string>,
    selectedForImport:
      row.selected_for_import === undefined || Number(row.selected_for_import) === 1,
  };
}

export class RecoveryRepository {
  public constructor(
    public readonly database: WorkerDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  public recoverInterruptedSessions(): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `update recovery_sessions set status = 'FAILED', progress_phase = null,
          error_message_safe = 'The recovery scan was interrupted. Scan the sources again.',
          updated_at = ? where status = 'SCANNING'`,
      )
      .run(changedAt);
    this.database.sqlite
      .prepare(
        `update recovery_sessions set status = 'READY_FOR_REVIEW', progress_phase = null,
          error_message_safe = 'The recovery import was interrupted. Confirm restore again to resume safely.',
          updated_at = ? where status = 'IMPORTING'`,
      )
      .run(changedAt);
    this.database.sqlite
      .prepare(
        `update recovery_sources set status = 'FAILED',
          error_message_safe = 'The source scan was interrupted.', updated_at = ?
         where status = 'SCANNING'`,
      )
      .run(changedAt);
  }

  public createSession(): RecoverySessionDto {
    const id = randomUUID();
    const createdAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into recovery_sessions (
          id, status, progress_processed, cancel_requested, created_at, updated_at
        ) values (?, 'DRAFT', 0, 0, ?, ?)`,
      )
      .run(id, createdAt, createdAt);
    return this.getSession(id);
  }

  public latestSession(): RecoverySessionDto | null {
    const row = this.database.sqlite
      .prepare('select id from recovery_sessions order by created_at desc limit 1')
      .get() as { id: string } | undefined;
    return row === undefined ? null : this.getSession(row.id);
  }

  public getSession(id: string): RecoverySessionDto {
    const row = this.database.sqlite
      .prepare('select * from recovery_sessions where id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error('Recovery session was not found');
    const sources = this.sourceRows(id).map((source) => ({
      id: source.id,
      sourceType: source.source_type,
      status: source.status,
      label: source.label,
      rootPath: source.root_path,
      accountId: source.account_id,
      accountEmail: source.account_email,
      discoveredRootCount: source.discovered_root_count,
      driveRoots:
        source.source_type === 'GOOGLE_DRIVE'
          ? this.listDriveRoots(id, source.id).map((root) => ({
              providerRootId: root.providerObjectId,
              name: root.currentName,
              selected: root.selectedForImport,
            }))
          : [],
      safeMessage: source.error_message_safe,
    }));
    const counts = this.database.sqlite
      .prepare(
        `select
          (select count(distinct source_provider || ':' || provider_channel_id)
             from recovery_channels where session_id = ?) as channels,
          (select count(distinct source_provider || ':' || provider_media_id)
             from recovery_media where session_id = ?) as media,
          (select count(distinct source_provider || ':' || provider_playlist_id)
             from recovery_playlists where session_id = ?) as playlists,
          (select count(*) from recovery_copies where session_id = ?) as copies,
          (select count(*) from recovery_copies where session_id = ? and destination_type = 'FILESYSTEM') as local_copies,
          (select count(*) from recovery_copies where session_id = ? and destination_type = 'GOOGLE_DRIVE') as drive_copies,
          (select count(*) from recovery_warnings where session_id = ?) as warnings`,
      )
      .get(id, id, id, id, id, id, id) as Record<string, number>;
    const warnings = this.database.sqlite
      .prepare(
        `select id, code, source_id, entity_key, message_safe, created_at
         from recovery_warnings where session_id = ? order by created_at, id limit 200`,
      )
      .all(id) as Array<Record<string, unknown>>;
    return RecoverySessionDtoSchema.parse({
      id,
      status: row.status,
      sources,
      counts: {
        channels: counts.channels,
        media: counts.media,
        playlists: counts.playlists,
        copies: counts.copies,
        localCopies: counts.local_copies,
        driveCopies: counts.drive_copies,
        warnings: counts.warnings,
      },
      warnings: warnings.map((warning) => ({
        id: warning.id,
        code: warning.code,
        sourceId: warning.source_id,
        entityKey: warning.entity_key,
        safeMessage: warning.message_safe,
        createdAt: warning.created_at,
      })),
      progress:
        row.progress_phase === null
          ? null
          : {
              phase: row.progress_phase,
              processed: row.progress_processed,
              total: row.progress_total,
            },
      safeMessage: row.error_message_safe,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    });
  }

  public addLocalSource(
    sessionId: string,
    rootPath: string,
    identity: VolumeIdentity | null,
  ): RecoverySessionDto {
    this.requireMutableSession(sessionId);
    const normalized = resolve(rootPath).toLocaleLowerCase('en-US');
    const existing = this.sourceRows(sessionId).find(
      (source) =>
        source.source_type === 'FILESYSTEM' &&
        source.root_path !== null &&
        resolve(source.root_path).toLocaleLowerCase('en-US') === normalized,
    );
    if (existing !== undefined) return this.getSession(sessionId);
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into recovery_sources (
          id, session_id, source_type, status, label, root_path, account_id,
          volume_guid, volume_serial, filesystem_type, last_known_mount_path,
          discovered_root_count, created_at, updated_at
        ) values (?, ?, 'FILESYSTEM', 'PENDING', ?, ?, null, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        randomUUID(),
        sessionId,
        rootPath,
        rootPath,
        identity?.volumeGuid ?? null,
        identity?.volumeSerial ?? null,
        identity?.filesystemType ?? null,
        identity?.mountPath ?? rootPath,
        changedAt,
        changedAt,
      );
    this.touchSession(sessionId);
    return this.getSession(sessionId);
  }

  public addDriveSource(sessionId: string, accountId: string): RecoverySessionDto {
    this.requireMutableSession(sessionId);
    const account = this.database.sqlite
      .prepare(
        `select id, email, display_name from accounts where id = ? and provider = 'GOOGLE'
          and drive_credential_ref is not null
          and json_extract(capabilities_json, '$.driveFile') = 1
          and json_extract(capabilities_json, '$.driveConnectionState') = 'CONNECTED'`,
      )
      .get(accountId) as
      { id: string; email: string | null; display_name: string | null } | undefined;
    if (account === undefined)
      throw new Error('Authorize Google Drive before adding it to recovery');
    const duplicate = this.sourceRows(sessionId).some(
      (source) => source.source_type === 'GOOGLE_DRIVE' && source.account_id === accountId,
    );
    if (duplicate) return this.getSession(sessionId);
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into recovery_sources (
          id, session_id, source_type, status, label, account_id,
          discovered_root_count, created_at, updated_at
        ) values (?, ?, 'GOOGLE_DRIVE', 'PENDING', ?, ?, 0, ?, ?)`,
      )
      .run(
        randomUUID(),
        sessionId,
        `Google Drive - ${account.email ?? account.display_name ?? 'Google account'}`,
        accountId,
        changedAt,
        changedAt,
      );
    this.touchSession(sessionId);
    return this.getSession(sessionId);
  }

  public listSources(sessionId: string): RecoverySourceRecord[] {
    return this.sourceRows(sessionId).map(sourceRecord);
  }

  public hasMediaCandidate(sessionId: string, sourceId: string, providerMediaId: string): boolean {
    return (
      this.database.sqlite
        .prepare(
          `select 1 from recovery_media
           where session_id = ? and source_id = ? and provider_media_id = ? limit 1`,
        )
        .get(sessionId, sourceId, providerMediaId) !== undefined
    );
  }

  public hasPlaylistCandidate(
    sessionId: string,
    sourceId: string,
    providerPlaylistId: string,
  ): boolean {
    return (
      this.database.sqlite
        .prepare(
          `select 1 from recovery_playlists
           where session_id = ? and source_id = ? and provider_playlist_id = ? limit 1`,
        )
        .get(sessionId, sourceId, providerPlaylistId) !== undefined
    );
  }

  public resetCandidates(sessionId: string): void {
    const transaction = this.database.sqlite.transaction(() => {
      for (const table of [
        'recovery_playlist_items',
        'recovery_artifacts',
        'recovery_copies',
        'recovery_playlists',
        'recovery_media',
        'recovery_channels',
        'recovery_warnings',
        'recovery_drive_objects',
      ]) {
        this.database.sqlite.prepare(`delete from ${table} where session_id = ?`).run(sessionId);
      }
      this.database.sqlite
        .prepare(
          `update recovery_sources set status = 'PENDING', discovered_root_count = 0,
            error_message_safe = null, updated_at = ? where session_id = ?`,
        )
        .run(this.now(), sessionId);
    });
    transaction();
  }

  public setSessionStatus(
    sessionId: string,
    status: RecoverySessionStatus,
    safeMessage: string | null = null,
  ): void {
    const changedAt = this.now();
    const terminal = status === 'COMPLETED' || status === 'COMPLETED_WITH_WARNINGS';
    const result = this.database.sqlite
      .prepare(
        `update recovery_sessions set status = ?, error_message_safe = ?,
          progress_phase = case when ? then null else progress_phase end,
          completed_at = case when ? then ? else completed_at end,
          cancel_requested = 0, updated_at = ? where id = ?`,
      )
      .run(
        status,
        safeMessage,
        terminal ? 1 : 0,
        terminal ? 1 : 0,
        changedAt,
        changedAt,
        sessionId,
      );
    if (result.changes !== 1) throw new Error('Recovery session was not found');
  }

  public setProgress(
    sessionId: string,
    phase: 'SOURCES' | 'LOCAL_SCAN' | 'DRIVE_LIST' | 'DRIVE_SIDECARS' | 'IMPORT' | 'FTS',
    processed: number,
    total: number | null,
  ): void {
    this.database.sqlite
      .prepare(
        `update recovery_sessions set progress_phase = ?, progress_processed = ?,
          progress_total = ?, updated_at = ? where id = ?`,
      )
      .run(phase, processed, total, this.now(), sessionId);
  }

  public requestCancel(sessionId: string): void {
    this.database.sqlite
      .prepare('update recovery_sessions set cancel_requested = 1, updated_at = ? where id = ?')
      .run(this.now(), sessionId);
  }

  public setSourceStatus(
    sourceId: string,
    status: RecoverySourceStatus,
    safeMessage: string | null = null,
    discoveredRootCount?: number,
  ): void {
    this.database.sqlite
      .prepare(
        `update recovery_sources set status = ?, error_message_safe = ?,
          discovered_root_count = coalesce(?, discovered_root_count), updated_at = ? where id = ?`,
      )
      .run(status, safeMessage, discoveredRootCount ?? null, this.now(), sourceId);
  }

  public addWarning(sessionId: string, input: RecoveryWarningInput): void {
    this.database.sqlite
      .prepare(
        `insert into recovery_warnings (
          id, session_id, source_id, code, entity_key, message_safe, details_json, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        sessionId,
        input.sourceId,
        input.code,
        input.entityKey,
        input.safeMessage,
        JSON.stringify(input.details ?? {}),
        this.now(),
      );
  }

  public upsertChannel(sessionId: string, input: RecoveryChannelCandidate): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into recovery_channels (
          id, session_id, source_id, source_provider, provider_channel_id, title,
          source_status, published_at, last_seen_at, metadata_updated_at, created_at, updated_at
        ) values (?, ?, ?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(session_id, source_id, source_provider, provider_channel_id) do update set
          title = excluded.title, source_status = excluded.source_status,
          published_at = excluded.published_at, last_seen_at = excluded.last_seen_at,
          metadata_updated_at = excluded.metadata_updated_at, updated_at = excluded.updated_at
        where excluded.metadata_updated_at >= recovery_channels.metadata_updated_at`,
      )
      .run(
        randomUUID(),
        sessionId,
        input.sourceId,
        input.providerChannelId,
        input.title,
        input.sourceStatus,
        input.publishedAt,
        input.lastSeenAt,
        input.metadataUpdatedAt,
        changedAt,
        changedAt,
      );
  }

  public upsertMedia(sessionId: string, input: RecoveryMediaCandidate): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into recovery_media (
          id, session_id, source_id, source_provider, provider_channel_id, provider_media_id,
          media_type, title, original_title, source_url, source_status, published_at,
          duration_seconds, thumbnail_url, metadata_updated_at, created_at, updated_at
        ) values (?, ?, ?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(session_id, source_id, source_provider, provider_media_id) do update set
          provider_channel_id = excluded.provider_channel_id, media_type = excluded.media_type,
          title = excluded.title, original_title = excluded.original_title,
          source_url = excluded.source_url, source_status = excluded.source_status,
          published_at = excluded.published_at, duration_seconds = excluded.duration_seconds,
          thumbnail_url = excluded.thumbnail_url,
          metadata_updated_at = excluded.metadata_updated_at, updated_at = excluded.updated_at
        where excluded.metadata_updated_at >= recovery_media.metadata_updated_at`,
      )
      .run(
        randomUUID(),
        sessionId,
        input.sourceId,
        input.providerChannelId,
        input.providerMediaId,
        input.mediaType,
        input.title,
        input.originalTitle,
        input.sourceUrl,
        input.sourceStatus,
        input.publishedAt,
        input.durationSeconds,
        input.thumbnailUrl,
        input.metadataUpdatedAt,
        changedAt,
        changedAt,
      );
  }

  public upsertPlaylist(sessionId: string, input: RecoveryPlaylistCandidate): void {
    const changedAt = this.now();
    const transaction = this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          `insert into recovery_playlists (
            id, session_id, source_id, source_provider, provider_channel_id,
            provider_playlist_id, title, source_status, metadata_updated_at, created_at, updated_at
          ) values (?, ?, ?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?)
          on conflict(session_id, source_id, source_provider, provider_playlist_id) do update set
            provider_channel_id = excluded.provider_channel_id, title = excluded.title,
            source_status = excluded.source_status,
            metadata_updated_at = excluded.metadata_updated_at, updated_at = excluded.updated_at
          where excluded.metadata_updated_at >= recovery_playlists.metadata_updated_at`,
        )
        .run(
          randomUUID(),
          sessionId,
          input.sourceId,
          input.providerChannelId,
          input.providerPlaylistId,
          input.title,
          input.sourceStatus,
          input.metadataUpdatedAt,
          changedAt,
          changedAt,
        );
      this.database.sqlite
        .prepare(
          `delete from recovery_playlist_items
           where session_id = ? and source_id = ? and provider_playlist_id = ?`,
        )
        .run(sessionId, input.sourceId, input.providerPlaylistId);
      const insert = this.database.sqlite.prepare(
        `insert into recovery_playlist_items (
          session_id, source_id, provider_playlist_id, provider_media_id,
          position, metadata_updated_at
        ) values (?, ?, ?, ?, ?, ?)`,
      );
      for (const item of input.items) {
        insert.run(
          sessionId,
          input.sourceId,
          input.providerPlaylistId,
          item.providerMediaId,
          item.position,
          input.metadataUpdatedAt,
        );
      }
    });
    transaction();
  }

  public insertCopy(sessionId: string, input: RecoveryCopyCandidate): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into recovery_copies (
          id, session_id, source_id, provider_root_id, source_provider, provider_media_id,
          destination_type, relative_path, provider_file_id, container, video_codec,
          audio_codec, width, height, fps, bytes, sha256, quality_profile,
          content_generation, verification_strength, status, verified_at,
          metadata_updated_at, provider_metadata_json, created_at, updated_at
        ) values (?, ?, ?, ?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        sessionId,
        input.sourceId,
        input.providerRootId,
        input.providerMediaId,
        input.destinationType,
        input.relativePath,
        input.providerFileId,
        input.container,
        input.videoCodec,
        input.audioCodec,
        input.width,
        input.height,
        input.fps,
        input.bytes,
        input.sha256,
        input.qualityProfile,
        input.sha256 === null ? null : `recovered:${input.sha256.slice(0, 12)}`,
        input.verificationStrength,
        input.status,
        input.verifiedAt,
        input.metadataUpdatedAt,
        JSON.stringify(input.providerMetadata),
        changedAt,
        changedAt,
      );
  }

  public insertArtifact(sessionId: string, input: RecoveryArtifactCandidate): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into recovery_artifacts (
          id, session_id, source_id, provider_root_id, provider_media_id, artifact_type,
          relative_path, provider_file_id, bytes, sha256, status, metadata_updated_at,
          created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        sessionId,
        input.sourceId,
        input.providerRootId,
        input.providerMediaId,
        input.artifactType,
        input.relativePath,
        input.providerFileId,
        input.bytes,
        input.sha256,
        input.status,
        input.metadataUpdatedAt,
        changedAt,
        changedAt,
      );
  }

  public persistDriveObjects(sessionId: string, candidates: RecoveryDriveObjectCandidate[]): void {
    const insert = this.database.sqlite.prepare(
      `insert into recovery_drive_objects (
        id, session_id, source_id, provider_object_id, parent_provider_object_id,
        current_name, mime_type, bytes, modified_at, logical_key, object_type,
        app_properties_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(session_id, source_id, provider_object_id) do update set
        parent_provider_object_id = excluded.parent_provider_object_id,
        current_name = excluded.current_name, mime_type = excluded.mime_type,
        bytes = excluded.bytes, modified_at = excluded.modified_at,
        logical_key = excluded.logical_key, object_type = excluded.object_type,
        app_properties_json = excluded.app_properties_json`,
    );
    const transaction = this.database.sqlite.transaction(() => {
      for (const candidate of candidates) {
        const properties = candidate.object.appProperties;
        const modifiedAt =
          candidate.object.modifiedTime === null ? null : Date.parse(candidate.object.modifiedTime);
        insert.run(
          randomUUID(),
          sessionId,
          candidate.sourceId,
          candidate.object.providerFileId,
          candidate.object.parents[0] ?? null,
          candidate.object.name,
          candidate.object.mimeType,
          candidate.object.bytes,
          Number.isFinite(modifiedAt) ? modifiedAt : null,
          properties.ytbmObjectKey ?? null,
          properties.ytbmObjectType ?? properties.artifactType ?? null,
          JSON.stringify(properties),
          this.now(),
        );
      }
    });
    transaction();
  }

  public listDriveRoots(sessionId: string, sourceId: string): PersistedDriveObject[] {
    const rows = this.database.sqlite
      .prepare(
        `select object.*, coalesce(selection.selected, 1) as selected_for_import
         from recovery_drive_objects object
         left join recovery_drive_root_selections selection
           on selection.session_id = object.session_id and selection.source_id = object.source_id
          and selection.provider_root_id = object.provider_object_id
         where object.session_id = ? and object.source_id = ?
           and (object.logical_key = 'root' or object.object_type = 'backup-root')
         order by object.provider_object_id`,
      )
      .all(sessionId, sourceId) as Array<Record<string, unknown>>;
    return rows.map(driveObject);
  }

  public listSelectedDriveRoots(sessionId: string, sourceId: string): PersistedDriveObject[] {
    return this.listDriveRoots(sessionId, sourceId).filter((root) => root.selectedForImport);
  }

  public setDriveRootSelected(
    sessionId: string,
    sourceId: string,
    providerRootId: string,
    selected: boolean,
  ): RecoverySessionDto {
    this.requireMutableSession(sessionId);
    const root = this.listDriveRoots(sessionId, sourceId).find(
      (candidate) => candidate.providerObjectId === providerRootId,
    );
    if (root === undefined) throw new Error('The discovered Drive backup root was not found');
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into recovery_drive_root_selections (
          session_id, source_id, provider_root_id, selected, updated_at
        ) values (?, ?, ?, ?, ?)
        on conflict(session_id, source_id, provider_root_id) do update set
          selected = excluded.selected, updated_at = excluded.updated_at`,
      )
      .run(sessionId, sourceId, providerRootId, selected ? 1 : 0, changedAt);
    this.touchSession(sessionId);
    return this.getSession(sessionId);
  }

  public listRootManifestObjects(
    sessionId: string,
    sourceId: string,
    rootProviderId: string,
  ): PersistedDriveObject[] {
    return this.descendantObjects(
      sessionId,
      sourceId,
      rootProviderId,
      "logical_key like 'channel:%:manifest'",
    );
  }

  public listRootObjectsByLogicalKeyPattern(
    sessionId: string,
    sourceId: string,
    rootProviderId: string,
    pattern: string,
  ): PersistedDriveObject[] {
    return this.descendantObjects(
      sessionId,
      sourceId,
      rootProviderId,
      'logical_key like ?',
      pattern,
    );
  }

  public findRootObjectByLogicalKey(
    sessionId: string,
    sourceId: string,
    rootProviderId: string,
    logicalKey: string,
  ): PersistedDriveObject[] {
    return this.descendantObjects(
      sessionId,
      sourceId,
      rootProviderId,
      'logical_key = ?',
      logicalKey,
    );
  }

  public listRootProviderObjects(
    sessionId: string,
    sourceId: string,
    rootProviderId: string,
    afterLogicalKey: string | null,
    limit = 500,
  ): PersistedDriveObject[] {
    const rows = this.database.sqlite
      .prepare(
        `with recursive tree(provider_object_id) as (
          select ?
          union
          select child.provider_object_id from recovery_drive_objects child
          join tree parent on child.parent_provider_object_id = parent.provider_object_id
          where child.session_id = ? and child.source_id = ?
        ), ranked as (
          select object.*,
            row_number() over (
              partition by object.logical_key
              order by coalesce(object.modified_at, 0) desc, object.provider_object_id
            ) as rank
          from recovery_drive_objects object
          where object.session_id = ? and object.source_id = ?
            and object.provider_object_id in (select provider_object_id from tree)
            and object.logical_key is not null
        )
        select * from ranked where rank = 1 and (? is null or logical_key > ?)
        order by logical_key limit ?`,
      )
      .all(
        rootProviderId,
        sessionId,
        sourceId,
        sessionId,
        sourceId,
        afterLogicalKey,
        afterLogicalKey,
        limit,
      ) as Array<Record<string, unknown>>;
    return rows.map(driveObject);
  }

  public detectHashConflicts(sessionId: string): void {
    const rows = this.database.sqlite
      .prepare(
        `select distinct a.provider_media_id, a.sha256 as left_hash, b.sha256 as right_hash
         from recovery_copies a join recovery_copies b
           on b.session_id = a.session_id and b.provider_media_id = a.provider_media_id
          and b.id > a.id
         where a.session_id = ? and a.sha256 is not null and b.sha256 is not null
           and a.sha256 <> b.sha256
           and coalesce(a.quality_profile, '') = coalesce(b.quality_profile, '')
           and coalesce(a.container, '') = coalesce(b.container, '')
           and coalesce(a.width, -1) = coalesce(b.width, -1)
           and coalesce(a.height, -1) = coalesce(b.height, -1)
         order by a.provider_media_id`,
      )
      .all(sessionId) as Array<{
      provider_media_id: string;
      left_hash: string;
      right_hash: string;
    }>;
    for (const row of rows) {
      this.addWarning(sessionId, {
        sourceId: null,
        code: 'HASH_CONFLICT',
        entityKey: row.provider_media_id,
        safeMessage:
          'Copies with the same media identity and archive properties report different SHA-256 values.',
        details: { hashes: [row.left_hash, row.right_hash].sort() },
      });
    }
  }

  public detectUnknownPlaylistReferences(sessionId: string): void {
    const rows = this.database.sqlite
      .prepare(
        `select distinct item.provider_playlist_id, item.provider_media_id
         from recovery_playlist_items item
         left join recovery_media media on media.session_id = item.session_id
           and media.source_provider = 'YOUTUBE'
           and media.provider_media_id = item.provider_media_id
         where item.session_id = ? and media.id is null
         order by item.provider_playlist_id, item.provider_media_id`,
      )
      .all(sessionId) as Array<{
      provider_playlist_id: string;
      provider_media_id: string;
    }>;
    for (const row of rows) {
      this.addWarning(sessionId, {
        sourceId: null,
        code: 'UNKNOWN_MEDIA_REFERENCE',
        entityKey: `${row.provider_playlist_id}:${row.provider_media_id}`,
        safeMessage: 'A recovered playlist references media not present in any selected source.',
      });
    }
  }

  private descendantObjects(
    sessionId: string,
    sourceId: string,
    rootProviderId: string,
    condition: string,
    ...parameters: Array<string | number | null>
  ): PersistedDriveObject[] {
    const rows = this.database.sqlite
      .prepare(
        `with recursive tree(provider_object_id) as (
          select ?
          union
          select child.provider_object_id from recovery_drive_objects child
          join tree parent on child.parent_provider_object_id = parent.provider_object_id
          where child.session_id = ? and child.source_id = ?
        )
        select object.* from recovery_drive_objects object
        where object.session_id = ? and object.source_id = ?
          and object.provider_object_id in (select provider_object_id from tree)
          and ${condition}
        order by object.modified_at desc, object.provider_object_id`,
      )
      .all(rootProviderId, sessionId, sourceId, sessionId, sourceId, ...parameters) as Array<
      Record<string, unknown>
    >;
    return rows.map(driveObject);
  }

  private sourceRows(sessionId: string): SourceRow[] {
    return this.database.sqlite
      .prepare(
        `select rs.*, a.email as account_email from recovery_sources rs
         left join accounts a on a.id = rs.account_id
         where rs.session_id = ? order by rs.created_at, rs.id`,
      )
      .all(sessionId) as SourceRow[];
  }

  private requireMutableSession(sessionId: string): void {
    const row = this.database.sqlite
      .prepare('select status from recovery_sessions where id = ?')
      .get(sessionId) as { status: RecoverySessionStatus } | undefined;
    if (row === undefined) throw new Error('Recovery session was not found');
    if (row.status === 'SCANNING' || row.status === 'IMPORTING') {
      throw new Error('Recovery sources cannot be changed while work is active');
    }
  }

  private touchSession(sessionId: string): void {
    this.database.sqlite
      .prepare(
        `update recovery_sessions set status = 'DRAFT', error_message_safe = null,
          completed_at = null, updated_at = ? where id = ?`,
      )
      .run(this.now(), sessionId);
  }
}
