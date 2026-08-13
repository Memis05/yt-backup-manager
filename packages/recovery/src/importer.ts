import { randomUUID } from 'node:crypto';

import { LocalBackupRepository } from '@ytbm/database/worker';

import type { RecoveryRepository } from './repository';
import { throwIfAborted, type RecoverySourceRecord } from './types';

const BATCH_SIZE = 250;

interface DestinationMaps {
  local: Map<string, string>;
  drive: Map<string, string>;
}

function driveDestinationKey(sourceId: string, rootProviderId: string): string {
  return `${sourceId}:${rootProviderId}`;
}

export class RecoveryImporter {
  private readonly localBackup: LocalBackupRepository;

  public constructor(
    private readonly repository: RecoveryRepository,
    private readonly now: () => number = Date.now,
  ) {
    this.localBackup = new LocalBackupRepository(repository.database, now);
  }

  public async import(sessionId: string, signal: AbortSignal): Promise<void> {
    const sources = this.repository.listSources(sessionId);
    const destinations = this.reconstructDestinations(sources);
    await this.importProviderObjects(sessionId, sources, destinations, signal);
    let processed = 0;
    processed += this.importChannels(sessionId, signal);
    this.repository.setProgress(sessionId, 'IMPORT', processed, null);
    processed += this.importMedia(sessionId, signal);
    this.repository.setProgress(sessionId, 'IMPORT', processed, null);
    processed += this.importPlaylists(sessionId, signal);
    this.repository.setProgress(sessionId, 'IMPORT', processed, null);
    this.importPlaylistMembership(sessionId, signal);
    processed += this.importCopies(sessionId, destinations, signal);
    this.repository.setProgress(sessionId, 'IMPORT', processed, null);
    this.importArtifacts(sessionId, destinations, signal);
    throwIfAborted(signal);
    this.repository.setProgress(sessionId, 'FTS', 0, null);
    this.rebuildSearchIndex();
    this.recordRecoveryActivity(sessionId);
    this.repository.setProgress(sessionId, 'FTS', 1, 1);
  }

  private reconstructDestinations(sources: RecoverySourceRecord[]): DestinationMaps {
    const local = new Map<string, string>();
    const drive = new Map<string, string>();
    for (const source of sources) {
      if (source.sourceType === 'FILESYSTEM') {
        if (source.rootPath === null) continue;
        const destination = this.localBackup.addDestination({
          rootPath: source.rootPath,
          identity: {
            volumeGuid: source.volumeGuid,
            volumeSerial: source.volumeSerial,
            filesystemType: source.filesystemType,
            mountPath: source.lastKnownMountPath ?? source.rootPath,
          },
          availabilityStatus: 'AVAILABLE',
          lastErrorCode: null,
        });
        local.set(source.id, destination.id);
        continue;
      }
      if (source.accountId === null) continue;
      const roots = this.repository.listSelectedDriveRoots(source.sessionId, source.id);
      for (const root of roots) {
        const existing = this.repository.database.sqlite
          .prepare(
            `select id from destinations where destination_type = 'GOOGLE_DRIVE'
             and account_id = ? and provider_root_id = ?`,
          )
          .get(source.accountId, root.providerObjectId) as { id: string } | undefined;
        const destinationId = existing?.id ?? randomUUID();
        const changedAt = this.now();
        if (existing === undefined) {
          this.repository.database.sqlite
            .prepare(
              `insert into destinations (
                id, destination_type, account_id, provider_root_id, enabled,
                availability_status, last_probe_at, created_at, updated_at
              ) values (?, 'GOOGLE_DRIVE', ?, ?, 1, 'AVAILABLE', ?, ?, ?)`,
            )
            .run(
              destinationId,
              source.accountId,
              root.providerObjectId,
              changedAt,
              changedAt,
              changedAt,
            );
        } else {
          this.repository.database.sqlite
            .prepare(
              `update destinations set enabled = 1, availability_status = 'AVAILABLE',
                last_probe_at = ?, last_error_code = null, last_error_at = null,
                updated_at = ? where id = ?`,
            )
            .run(changedAt, changedAt, destinationId);
        }
        drive.set(driveDestinationKey(source.id, root.providerObjectId), destinationId);
      }
    }
    return { local, drive };
  }

  private async importProviderObjects(
    sessionId: string,
    sources: RecoverySourceRecord[],
    destinations: DestinationMaps,
    signal: AbortSignal,
  ): Promise<void> {
    for (const source of sources) {
      if (source.sourceType !== 'GOOGLE_DRIVE') continue;
      for (const root of this.repository.listSelectedDriveRoots(sessionId, source.id)) {
        const destinationId = destinations.drive.get(
          driveDestinationKey(source.id, root.providerObjectId),
        );
        if (destinationId === undefined) continue;
        let cursor: string | null = null;
        while (true) {
          throwIfAborted(signal);
          const objects = this.repository.listRootProviderObjects(
            sessionId,
            source.id,
            root.providerObjectId,
            cursor,
            BATCH_SIZE,
          );
          if (objects.length === 0) break;
          const changedAt = this.now();
          const transaction = this.repository.database.sqlite.transaction(() => {
            for (const object of objects) {
              this.repository.database.sqlite
                .prepare(
                  `insert into provider_objects (
                    id, destination_id, logical_key, object_type, provider_object_id,
                    parent_provider_object_id, current_name, created_at, updated_at
                  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  on conflict(destination_id, logical_key) do update set
                    object_type = excluded.object_type,
                    provider_object_id = excluded.provider_object_id,
                    parent_provider_object_id = excluded.parent_provider_object_id,
                    current_name = excluded.current_name, updated_at = excluded.updated_at`,
                )
                .run(
                  randomUUID(),
                  destinationId,
                  object.logicalKey,
                  object.objectType ?? 'RECOVERED_OBJECT',
                  object.providerObjectId,
                  object.parentProviderObjectId,
                  object.currentName,
                  changedAt,
                  changedAt,
                );
            }
          });
          transaction();
          cursor = objects.at(-1)?.logicalKey ?? cursor;
          if (objects.length < BATCH_SIZE) break;
        }
      }
    }
  }

  private importChannels(sessionId: string, signal: AbortSignal): number {
    let cursor = '';
    let processed = 0;
    while (true) {
      throwIfAborted(signal);
      const identities = this.repository.database.sqlite
        .prepare(
          `select distinct provider_channel_id from recovery_channels
           where session_id = ? and provider_channel_id > ?
           order by provider_channel_id limit ?`,
        )
        .all(sessionId, cursor, BATCH_SIZE) as Array<{ provider_channel_id: string }>;
      if (identities.length === 0) break;
      const transaction = this.repository.database.sqlite.transaction(() => {
        for (const identity of identities) {
          const candidate = this.repository.database.sqlite
            .prepare(
              `select * from recovery_channels where session_id = ? and provider_channel_id = ?
               order by metadata_updated_at desc, id limit 1`,
            )
            .get(sessionId, identity.provider_channel_id) as Record<string, unknown>;
          this.upsertChannel(candidate);
        }
      });
      transaction();
      processed += identities.length;
      cursor = identities.at(-1)!.provider_channel_id;
    }
    return processed;
  }

  private upsertChannel(candidate: Record<string, unknown>): string {
    const providerChannelId = String(candidate.provider_channel_id);
    const existing = this.repository.database.sqlite
      .prepare(
        `select id, last_seen_at from channels
         where source_provider = 'YOUTUBE' and provider_channel_id = ?`,
      )
      .get(providerChannelId) as { id: string; last_seen_at: number | null } | undefined;
    const id = existing?.id ?? randomUUID();
    const candidateTimestamp = Number(candidate.metadata_updated_at);
    const changedAt = this.now();
    if (existing === undefined) {
      this.repository.database.sqlite
        .prepare(
          `insert into channels (
            id, source_provider, provider_channel_id, title, backup_enabled, source_status,
            published_at, first_seen_at, last_seen_at, created_at, updated_at
          ) values (?, 'YOUTUBE', ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          providerChannelId,
          candidate.title,
          candidate.source_status,
          candidate.published_at,
          candidateTimestamp,
          candidate.last_seen_at,
          changedAt,
          changedAt,
        );
    } else if ((existing.last_seen_at ?? 0) <= candidateTimestamp) {
      this.repository.database.sqlite
        .prepare(
          `update channels set title = ?, backup_enabled = 1, source_status = ?,
            published_at = coalesce(?, published_at), last_seen_at = max(coalesce(last_seen_at, 0), ?),
            updated_at = ? where id = ?`,
        )
        .run(
          candidate.title,
          candidate.source_status,
          candidate.published_at,
          candidate.last_seen_at ?? candidateTimestamp,
          changedAt,
          id,
        );
    } else {
      this.repository.database.sqlite
        .prepare('update channels set backup_enabled = 1, updated_at = ? where id = ?')
        .run(changedAt, id);
    }
    return id;
  }

  private importMedia(sessionId: string, signal: AbortSignal): number {
    let cursor = '';
    let processed = 0;
    while (true) {
      throwIfAborted(signal);
      const identities = this.repository.database.sqlite
        .prepare(
          `select distinct provider_media_id from recovery_media
           where session_id = ? and provider_media_id > ?
           order by provider_media_id limit ?`,
        )
        .all(sessionId, cursor, BATCH_SIZE) as Array<{ provider_media_id: string }>;
      if (identities.length === 0) break;
      const transaction = this.repository.database.sqlite.transaction(() => {
        for (const identity of identities) {
          const candidate = this.repository.database.sqlite
            .prepare(
              `select * from recovery_media where session_id = ? and provider_media_id = ?
               order by metadata_updated_at desc, id limit 1`,
            )
            .get(sessionId, identity.provider_media_id) as Record<string, unknown>;
          const channel = this.repository.database.sqlite
            .prepare(
              `select id from channels where source_provider = 'YOUTUBE'
               and provider_channel_id = ?`,
            )
            .get(candidate.provider_channel_id) as { id: string } | undefined;
          if (channel !== undefined) this.upsertMedia(candidate, channel.id);
        }
      });
      transaction();
      processed += identities.length;
      cursor = identities.at(-1)!.provider_media_id;
    }
    return processed;
  }

  private upsertMedia(candidate: Record<string, unknown>, channelId: string): string {
    const providerMediaId = String(candidate.provider_media_id);
    const existing = this.repository.database.sqlite
      .prepare(
        `select id, last_seen_at from media_items
         where source_provider = 'YOUTUBE' and provider_media_id = ?`,
      )
      .get(providerMediaId) as { id: string; last_seen_at: number | null } | undefined;
    const id = existing?.id ?? randomUUID();
    const candidateTimestamp = Number(candidate.metadata_updated_at);
    const changedAt = this.now();
    if (existing === undefined) {
      this.repository.database.sqlite
        .prepare(
          `insert into media_items (
            id, channel_id, source_provider, provider_media_id, media_type, title,
            original_title, source_url, source_status, published_at, duration_seconds,
            thumbnail_url, first_seen_at, last_seen_at, metadata_version, created_at, updated_at
          ) values (?, ?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          channelId,
          providerMediaId,
          candidate.media_type,
          candidate.title,
          candidate.original_title,
          candidate.source_url,
          candidate.source_status,
          candidate.published_at,
          candidate.duration_seconds,
          candidate.thumbnail_url,
          candidateTimestamp,
          candidateTimestamp,
          changedAt,
          changedAt,
        );
    } else if ((existing.last_seen_at ?? 0) <= candidateTimestamp) {
      this.repository.database.sqlite
        .prepare(
          `update media_items set channel_id = ?, media_type = ?, title = ?, source_url = ?,
            source_status = ?, published_at = coalesce(?, published_at),
            duration_seconds = coalesce(?, duration_seconds),
            thumbnail_url = coalesce(?, thumbnail_url),
            last_seen_at = max(coalesce(last_seen_at, 0), ?), updated_at = ? where id = ?`,
        )
        .run(
          channelId,
          candidate.media_type,
          candidate.title,
          candidate.source_url,
          candidate.source_status,
          candidate.published_at,
          candidate.duration_seconds,
          candidate.thumbnail_url,
          candidateTimestamp,
          changedAt,
          id,
        );
    }
    return id;
  }

  private importPlaylists(sessionId: string, signal: AbortSignal): number {
    let cursor = '';
    let processed = 0;
    while (true) {
      throwIfAborted(signal);
      const identities = this.repository.database.sqlite
        .prepare(
          `select distinct provider_playlist_id from recovery_playlists
           where session_id = ? and provider_playlist_id > ?
           order by provider_playlist_id limit ?`,
        )
        .all(sessionId, cursor, BATCH_SIZE) as Array<{ provider_playlist_id: string }>;
      if (identities.length === 0) break;
      const transaction = this.repository.database.sqlite.transaction(() => {
        for (const identity of identities) {
          const candidate = this.repository.database.sqlite
            .prepare(
              `select * from recovery_playlists where session_id = ? and provider_playlist_id = ?
               order by metadata_updated_at desc, id limit 1`,
            )
            .get(sessionId, identity.provider_playlist_id) as Record<string, unknown>;
          const channel = this.repository.database.sqlite
            .prepare(
              `select id from channels where source_provider = 'YOUTUBE'
               and provider_channel_id = ?`,
            )
            .get(candidate.provider_channel_id) as { id: string } | undefined;
          if (channel !== undefined) this.upsertPlaylist(candidate, channel.id);
        }
      });
      transaction();
      processed += identities.length;
      cursor = identities.at(-1)!.provider_playlist_id;
    }
    return processed;
  }

  private upsertPlaylist(candidate: Record<string, unknown>, channelId: string): string {
    const providerPlaylistId = String(candidate.provider_playlist_id);
    const existing = this.repository.database.sqlite
      .prepare(
        `select id, last_seen_at from playlists
         where source_provider = 'YOUTUBE' and provider_playlist_id = ?`,
      )
      .get(providerPlaylistId) as { id: string; last_seen_at: number | null } | undefined;
    const id = existing?.id ?? randomUUID();
    const candidateTimestamp = Number(candidate.metadata_updated_at);
    const changedAt = this.now();
    if (existing === undefined) {
      this.repository.database.sqlite
        .prepare(
          `insert into playlists (
            id, channel_id, source_provider, provider_playlist_id, title, source_status,
            first_seen_at, last_seen_at, created_at, updated_at
          ) values (?, ?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          channelId,
          providerPlaylistId,
          candidate.title,
          candidate.source_status,
          candidateTimestamp,
          candidateTimestamp,
          changedAt,
          changedAt,
        );
    } else if ((existing.last_seen_at ?? 0) <= candidateTimestamp) {
      this.repository.database.sqlite
        .prepare(
          `update playlists set channel_id = ?, title = ?, source_status = ?,
            last_seen_at = max(coalesce(last_seen_at, 0), ?), updated_at = ? where id = ?`,
        )
        .run(
          channelId,
          candidate.title,
          candidate.source_status,
          candidateTimestamp,
          changedAt,
          id,
        );
    }
    return id;
  }

  private importPlaylistMembership(sessionId: string, signal: AbortSignal): void {
    const playlists = this.repository.database.sqlite
      .prepare(
        `select distinct provider_playlist_id from recovery_playlists
         where session_id = ? order by provider_playlist_id`,
      )
      .all(sessionId) as Array<{ provider_playlist_id: string }>;
    for (const identity of playlists) {
      throwIfAborted(signal);
      const playlist = this.repository.database.sqlite
        .prepare(
          `select id, last_seen_at from playlists where source_provider = 'YOUTUBE'
           and provider_playlist_id = ?`,
        )
        .get(identity.provider_playlist_id) as
        { id: string; last_seen_at: number | null } | undefined;
      if (playlist === undefined) continue;
      const candidateTimestamp = (
        this.repository.database.sqlite
          .prepare(
            `select max(metadata_updated_at) as updated_at from recovery_playlists
             where session_id = ? and provider_playlist_id = ?`,
          )
          .get(sessionId, identity.provider_playlist_id) as { updated_at: number | null }
      ).updated_at;
      if (candidateTimestamp === null || (playlist.last_seen_at ?? 0) > candidateTimestamp)
        continue;
      const items = this.repository.database.sqlite
        .prepare(
          `select provider_media_id, position from (
            select provider_media_id, position,
              row_number() over (
                partition by provider_media_id order by metadata_updated_at desc, source_id
              ) as rank
            from recovery_playlist_items
            where session_id = ? and provider_playlist_id = ?
          ) where rank = 1 order by coalesce(position, 2147483647), provider_media_id`,
        )
        .all(sessionId, identity.provider_playlist_id) as Array<{
        provider_media_id: string;
        position: number | null;
      }>;
      const transaction = this.repository.database.sqlite.transaction(() => {
        this.repository.database.sqlite
          .prepare('delete from playlist_items where playlist_id = ?')
          .run(playlist.id);
        const insert = this.repository.database.sqlite.prepare(
          `insert into playlist_items (
            playlist_id, media_item_id, position, last_seen_at, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?)`,
        );
        for (const item of items) {
          const media = this.repository.database.sqlite
            .prepare(
              `select id from media_items where source_provider = 'YOUTUBE'
               and provider_media_id = ?`,
            )
            .get(item.provider_media_id) as { id: string } | undefined;
          if (media === undefined) {
            this.repository.addWarning(sessionId, {
              sourceId: null,
              code: 'UNKNOWN_MEDIA_REFERENCE',
              entityKey: `${identity.provider_playlist_id}:${item.provider_media_id}`,
              safeMessage:
                'A recovered playlist references media not present in any selected source.',
            });
            continue;
          }
          const changedAt = this.now();
          insert.run(
            playlist.id,
            media.id,
            item.position,
            candidateTimestamp,
            changedAt,
            changedAt,
          );
        }
      });
      transaction();
    }
  }

  private importCopies(
    sessionId: string,
    destinations: DestinationMaps,
    signal: AbortSignal,
  ): number {
    let cursor = 0;
    let processed = 0;
    while (true) {
      throwIfAborted(signal);
      const rows = this.repository.database.sqlite
        .prepare(
          `select rowid as cursor, * from recovery_copies
           where session_id = ? and rowid > ? order by rowid limit ?`,
        )
        .all(sessionId, cursor, BATCH_SIZE) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      const transaction = this.repository.database.sqlite.transaction(() => {
        for (const row of rows) this.importCopy(sessionId, row, destinations);
      });
      transaction();
      processed += rows.length;
      cursor = Number(rows.at(-1)!.cursor);
    }
    return processed;
  }

  private importCopy(
    sessionId: string,
    row: Record<string, unknown>,
    destinations: DestinationMaps,
  ): void {
    const media = this.repository.database.sqlite
      .prepare(
        `select id, channel_id from media_items where source_provider = 'YOUTUBE'
         and provider_media_id = ?`,
      )
      .get(row.provider_media_id) as { id: string; channel_id: string } | undefined;
    if (media === undefined) return;
    const destinationId =
      row.destination_type === 'FILESYSTEM'
        ? destinations.local.get(String(row.source_id))
        : row.provider_root_id === null
          ? undefined
          : destinations.drive.get(
              driveDestinationKey(String(row.source_id), String(row.provider_root_id)),
            );
    if (destinationId === undefined) {
      this.repository.addWarning(sessionId, {
        sourceId: String(row.source_id),
        code: 'AMBIGUOUS_DESTINATION',
        entityKey: String(row.provider_media_id),
        safeMessage: 'A recovered copy could not be associated with one stable destination.',
      });
      return;
    }
    const existing = this.repository.database.sqlite
      .prepare(
        `select id, verified_at, status from media_copies
         where media_item_id = ? and destination_id = ?`,
      )
      .get(media.id, destinationId) as
      { id: string; verified_at: number | null; status: string } | undefined;
    const changedAt = this.now();
    const verifiedAt = row.verified_at as number | null;
    if (existing === undefined) {
      this.repository.database.sqlite
        .prepare(
          `insert into media_copies (
            id, media_item_id, destination_id, relative_path, provider_file_id,
            container, video_codec, audio_codec, width, height, fps, bytes, sha256,
            quality_profile, content_generation, verification_strength,
            provider_metadata_json, status, verified_at, last_checked_at,
            missing_since, corrupt_since, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          media.id,
          destinationId,
          row.relative_path,
          row.provider_file_id,
          row.container,
          row.video_codec,
          row.audio_codec,
          row.width,
          row.height,
          row.fps,
          row.bytes,
          row.sha256,
          row.quality_profile,
          row.content_generation,
          row.verification_strength,
          row.provider_metadata_json,
          row.status,
          verifiedAt,
          verifiedAt,
          row.status === 'MISSING' ? changedAt : null,
          row.status === 'CORRUPT' ? changedAt : null,
          changedAt,
          changedAt,
        );
    } else if (existing.status !== 'VERIFIED' || (verifiedAt ?? 0) >= (existing.verified_at ?? 0)) {
      this.repository.database.sqlite
        .prepare(
          `update media_copies set relative_path = ?, provider_file_id = ?, container = ?,
            video_codec = ?, audio_codec = ?, width = ?, height = ?, fps = ?, bytes = ?,
            sha256 = ?, quality_profile = ?, content_generation = ?, verification_strength = ?,
            provider_metadata_json = ?, status = ?, verified_at = ?, last_checked_at = ?,
            missing_since = ?, corrupt_since = ?, updated_at = ? where id = ?`,
        )
        .run(
          row.relative_path,
          row.provider_file_id,
          row.container,
          row.video_codec,
          row.audio_codec,
          row.width,
          row.height,
          row.fps,
          row.bytes,
          row.sha256,
          row.quality_profile,
          row.content_generation,
          row.verification_strength,
          row.provider_metadata_json,
          row.status,
          verifiedAt,
          verifiedAt,
          row.status === 'MISSING' ? changedAt : null,
          row.status === 'CORRUPT' ? changedAt : null,
          changedAt,
          existing.id,
        );
    }
    this.repository.database.sqlite
      .prepare(
        `insert into channel_destinations (
          channel_id, destination_id, enabled, created_at, updated_at
        ) values (?, ?, 1, ?, ?)
        on conflict(channel_id, destination_id) do update set
          enabled = 1, updated_at = excluded.updated_at`,
      )
      .run(media.channel_id, destinationId, changedAt, changedAt);
  }

  private importArtifacts(
    sessionId: string,
    destinations: DestinationMaps,
    signal: AbortSignal,
  ): void {
    let cursor = 0;
    while (true) {
      throwIfAborted(signal);
      const rows = this.repository.database.sqlite
        .prepare(
          `select rowid as cursor, * from recovery_artifacts
           where session_id = ? and rowid > ? order by rowid limit ?`,
        )
        .all(sessionId, cursor, BATCH_SIZE) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      const transaction = this.repository.database.sqlite.transaction(() => {
        for (const row of rows) {
          const media = this.repository.database.sqlite
            .prepare(
              `select id from media_items where source_provider = 'YOUTUBE'
               and provider_media_id = ?`,
            )
            .get(row.provider_media_id) as { id: string } | undefined;
          if (media === undefined) continue;
          const destinationId =
            row.provider_root_id === null
              ? destinations.local.get(String(row.source_id))
              : destinations.drive.get(
                  driveDestinationKey(String(row.source_id), String(row.provider_root_id)),
                );
          if (destinationId === undefined) continue;
          const changedAt = this.now();
          this.repository.database.sqlite
            .prepare(
              `insert into media_artifacts (
                id, media_item_id, destination_id, artifact_type, relative_path,
                provider_file_id, bytes, sha256, content_generation, status,
                verified_at, last_checked_at, created_at, updated_at
              ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              on conflict(media_item_id, destination_id, artifact_type) do update set
                relative_path = excluded.relative_path,
                provider_file_id = excluded.provider_file_id, bytes = excluded.bytes,
                sha256 = excluded.sha256, content_generation = excluded.content_generation,
                status = excluded.status, verified_at = excluded.verified_at,
                last_checked_at = excluded.last_checked_at, updated_at = excluded.updated_at`,
            )
            .run(
              randomUUID(),
              media.id,
              destinationId,
              row.artifact_type,
              row.relative_path,
              row.provider_file_id,
              row.bytes,
              row.sha256,
              `recovered:${String(row.metadata_updated_at)}`,
              row.status,
              row.metadata_updated_at,
              row.metadata_updated_at,
              changedAt,
              changedAt,
            );
        }
      });
      transaction();
      cursor = Number(rows.at(-1)!.cursor);
    }
  }

  private rebuildSearchIndex(): void {
    const transaction = this.repository.database.sqlite.transaction(() => {
      this.repository.database.sqlite.prepare('delete from media_search').run();
      this.repository.database.sqlite
        .prepare(
          `insert into media_search (media_item_id, title, channel_title, playlist_titles)
           select m.id, m.title, c.title,
             coalesce((select group_concat(p.title, ' ') from playlist_items pi
               join playlists p on p.id = pi.playlist_id where pi.media_item_id = m.id), '')
           from media_items m join channels c on c.id = m.channel_id`,
        )
        .run();
    });
    transaction();
  }

  private recordRecoveryActivity(sessionId: string): void {
    const counts = this.repository.getSession(sessionId).counts;
    this.repository.database.sqlite
      .prepare(
        `insert into activity_log (
          id, event_type, severity, summary, details_json, created_at
        ) values (?, 'RECOVERY_COMPLETED', ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        counts.warnings > 0 ? 'WARNING' : 'INFO',
        `Recovered ${counts.media} media items from ${counts.copies} backup copies.`,
        JSON.stringify({ sessionId, ...counts }),
        this.now(),
      );
  }
}
