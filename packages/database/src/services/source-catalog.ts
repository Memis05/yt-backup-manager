import { randomUUID } from 'node:crypto';

import {
  ChannelDtoSchema,
  LibraryQueryResultSchema,
  PlaylistMembersResultSchema,
  PlaylistQueryResultSchema,
  SourceSyncJobDtoSchema,
  type CatalogQuery,
  type ChannelDto,
  type LibraryQueryResult,
  type MediaLibraryItemDto,
  type PlaylistMembersQuery,
  type PlaylistMembersResult,
  type PlaylistQuery,
  type PlaylistQueryResult,
  type SourceChannelRecord,
  type SourceMediaRecord,
  type SourcePlaylistMembershipRecord,
  type SourcePlaylistRecord,
  type SourceProvider,
  type SourceSyncJobDto,
  type SourceSyncProgress,
  type SourceSyncSink,
} from '@ytbm/core';
import { SourceProviderError } from '@ytbm/source-youtube';

import type { WorkerDatabase } from '../database';

type SqlValue = string | number | null;

const RETRY_DELAYS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;

interface ChannelAccess {
  accountId: string;
  providerChannelId: string;
}

interface MediaRow {
  id: string;
  provider_media_id: string;
  channel_id: string;
  channel_title: string;
  title: string;
  original_title: string;
  source_url: string;
  source_status: string;
  media_type: string;
  published_at: number | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  first_seen_at: number;
  last_seen_at: number | null;
  playlist_titles_json: string;
}

interface ExistingMediaRow {
  id: string;
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  source_status: string;
  metadata_version: number;
}

interface SyncSessionState {
  channelId: string;
  providerChannelId: string;
  startedAt: number;
  completedMemberships: Set<string>;
  membershipAdded: Map<string, number>;
  membershipReordered: Map<string, number>;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function mediaRowToDto(row: MediaRow): MediaLibraryItemDto {
  return {
    id: row.id,
    providerMediaId: row.provider_media_id,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    title: row.title,
    originalTitle: row.original_title,
    sourceUrl: row.source_url,
    sourceStatus: row.source_status as MediaLibraryItemDto['sourceStatus'],
    mediaType: row.media_type as MediaLibraryItemDto['mediaType'],
    publishedAt: row.published_at,
    durationSeconds: row.duration_seconds,
    thumbnailUrl: row.thumbnail_url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    playlistTitles: parseJsonArray(row.playlist_titles_json),
  };
}

function syncStatus(value: string | null): ChannelDto['syncStatus'] {
  if (value === null) return null;
  if (value === 'PENDING' || value === 'READY' || value === 'INTERRUPTED') return 'QUEUED';
  if (value === 'RUNNING') return 'RUNNING';
  if (value === 'RETRY_WAIT') return 'RETRY_WAIT';
  if (value === 'COMPLETED') return 'COMPLETED';
  if (value === 'FAILED') return 'FAILED';
  return null;
}

function ftsQuery(value: string): string | null {
  const tokens = value.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
}

function jobPhase(payloadJson: string): SourceSyncJobDto['phase'] {
  try {
    const payload = JSON.parse(payloadJson) as { phase?: unknown };
    if (
      payload.phase === 'QUEUED' ||
      payload.phase === 'MEDIA' ||
      payload.phase === 'PLAYLISTS' ||
      payload.phase === 'RECONCILING' ||
      payload.phase === 'COMPLETE' ||
      payload.phase === 'FAILED'
    ) {
      return payload.phase;
    }
  } catch {
    // Fall through to the safe default.
  }
  return 'QUEUED';
}

export class SourceCatalogService {
  public constructor(
    private readonly database: WorkerDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  public async discoverChannels(
    accountId: string,
    records: SourceChannelRecord[],
  ): Promise<ChannelDto[]> {
    const observedAt = this.now();
    const seenChannelIds = new Set<string>();
    const transaction = this.database.sqlite.transaction(() => {
      for (const record of records) {
        const existing = this.database.sqlite
          .prepare(
            `select id from channels where source_provider = 'YOUTUBE' and provider_channel_id = ?`,
          )
          .get(record.providerChannelId) as { id: string } | undefined;
        const channelId = existing?.id ?? randomUUID();
        if (existing === undefined) {
          this.database.sqlite
            .prepare(
              `insert into channels (
                id, source_provider, provider_channel_id, title, handle, thumbnail_url,
                backup_enabled, source_status, published_at, first_seen_at, last_seen_at,
                created_at, updated_at
              ) values (?, 'YOUTUBE', ?, ?, ?, ?, 0, 'AVAILABLE', ?, ?, ?, ?, ?)`,
            )
            .run(
              channelId,
              record.providerChannelId,
              record.title,
              record.handle,
              record.thumbnailUrl,
              record.publishedAt,
              observedAt,
              observedAt,
              observedAt,
              observedAt,
            );
        } else {
          this.database.sqlite
            .prepare(
              `update channels set title = ?, handle = ?, thumbnail_url = ?, published_at = ?,
                source_status = 'AVAILABLE', last_seen_at = ?, updated_at = ? where id = ?`,
            )
            .run(
              record.title,
              record.handle,
              record.thumbnailUrl,
              record.publishedAt,
              observedAt,
              observedAt,
              channelId,
            );
        }
        seenChannelIds.add(channelId);
        this.database.sqlite
          .prepare(
            `insert into account_channels (account_id, channel_id, relationship_metadata_json, created_at)
             values (?, ?, '{}', ?) on conflict(account_id, channel_id) do nothing`,
          )
          .run(accountId, channelId, observedAt);
      }

      const mappings = this.database.sqlite
        .prepare('select channel_id from account_channels where account_id = ?')
        .all(accountId) as Array<{ channel_id: string }>;
      const remove = this.database.sqlite.prepare(
        'delete from account_channels where account_id = ? and channel_id = ?',
      );
      for (const mapping of mappings) {
        if (!seenChannelIds.has(mapping.channel_id)) remove.run(accountId, mapping.channel_id);
      }
    });
    transaction();
    return this.listChannels({ accountId, selectedOnly: false });
  }

  public async listChannels(options: {
    accountId: string | null;
    selectedOnly: boolean;
  }): Promise<ChannelDto[]> {
    const conditions: string[] = [];
    const parameters: SqlValue[] = [];
    if (options.accountId !== null) {
      conditions.push(
        'exists (select 1 from account_channels filter_ac where filter_ac.channel_id = c.id and filter_ac.account_id = ?)',
      );
      parameters.push(options.accountId);
    }
    if (options.selectedOnly) conditions.push('c.backup_enabled = 1');
    const where = conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`;
    const rows = this.database.sqlite
      .prepare(
        `select
          c.id, c.provider_channel_id, c.title, c.handle, c.thumbnail_url, c.backup_enabled,
          c.source_status, c.published_at, c.last_sync_at,
          coalesce((select json_group_array(ac.account_id) from account_channels ac where ac.channel_id = c.id), '[]') as account_ids,
          (select count(*) from media_items m where m.channel_id = c.id and m.media_type = 'VIDEO') as videos_count,
          (select count(*) from media_items m where m.channel_id = c.id and m.media_type = 'SHORT') as shorts_count,
          (select count(*) from media_items m where m.channel_id = c.id and m.media_type = 'LIVE') as live_count,
          (select j.status from jobs j where j.channel_id = c.id and j.job_type = 'CHANNEL_SYNC' order by j.created_at desc limit 1) as sync_status
         from channels c ${where} order by c.title collate nocase, c.id`,
      )
      .all(...parameters) as Array<{
      id: string;
      provider_channel_id: string;
      title: string;
      handle: string | null;
      thumbnail_url: string | null;
      backup_enabled: number;
      source_status: string;
      published_at: number | null;
      last_sync_at: number | null;
      account_ids: string;
      videos_count: number;
      shorts_count: number;
      live_count: number;
      sync_status: string | null;
    }>;
    return rows.map((row) =>
      ChannelDtoSchema.parse({
        id: row.id,
        providerChannelId: row.provider_channel_id,
        title: row.title,
        handle: row.handle,
        thumbnailUrl: row.thumbnail_url,
        backupEnabled: row.backup_enabled === 1,
        sourceStatus: row.source_status,
        publishedAt: row.published_at,
        lastSyncAt: row.last_sync_at,
        accessibleAccountIds: parseJsonArray(row.account_ids),
        videosCount: row.videos_count,
        shortsCount: row.shorts_count,
        liveCount: row.live_count,
        syncStatus: syncStatus(row.sync_status),
      }),
    );
  }

  public async setChannelEnabled(channelId: string, enabled: boolean): Promise<ChannelDto> {
    const changedAt = this.now();
    const result = this.database.sqlite
      .prepare('update channels set backup_enabled = ?, updated_at = ? where id = ?')
      .run(enabled ? 1 : 0, changedAt, channelId);
    if (result.changes !== 1) throw new Error('YouTube channel was not found');
    const channels = await this.listChannels({ accountId: null, selectedOnly: false });
    const channel = channels.find((item) => item.id === channelId);
    if (channel === undefined) throw new Error('YouTube channel was not found');
    return channel;
  }

  public getChannelAccess(channelId: string): ChannelAccess | null {
    const row = this.database.sqlite
      .prepare(
        `select a.id as account_id, c.provider_channel_id
         from channels c
         join account_channels ac on ac.channel_id = c.id
         join accounts a on a.id = ac.account_id
         where c.id = ? and c.backup_enabled = 1 and a.connection_state = 'CONNECTED'
         order by a.last_auth_at desc, a.id asc limit 1`,
      )
      .get(channelId) as { account_id: string; provider_channel_id: string } | undefined;
    return row === undefined
      ? null
      : { accountId: row.account_id, providerChannelId: row.provider_channel_id };
  }

  public async queryLibrary(query: CatalogQuery): Promise<LibraryQueryResult> {
    const conditions: string[] = [];
    const parameters: SqlValue[] = [];
    const match = ftsQuery(query.search);
    if (match !== null) {
      conditions.push(
        'm.id in (select media_item_id from media_search where media_search match ?)',
      );
      parameters.push(match);
    }
    if (query.channelId !== null) {
      conditions.push('m.channel_id = ?');
      parameters.push(query.channelId);
    }
    if (query.mediaType !== null) {
      conditions.push('m.media_type = ?');
      parameters.push(query.mediaType);
    }
    if (query.sourceStatus !== null) {
      conditions.push('m.source_status = ?');
      parameters.push(query.sourceStatus);
    }
    const where = conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`;
    const total = this.database.sqlite
      .prepare(`select count(*) as count from media_items m ${where}`)
      .get(...parameters) as { count: number };
    const offset = (query.page - 1) * query.pageSize;
    const rows = this.database.sqlite
      .prepare(
        `select
          m.id, m.provider_media_id, m.channel_id, c.title as channel_title, m.title,
          m.original_title, m.source_url, m.source_status, m.media_type, m.published_at,
          m.duration_seconds, m.thumbnail_url, m.first_seen_at, m.last_seen_at,
          coalesce((select json_group_array(title) from (
            select p.title as title from playlist_items pi
            join playlists p on p.id = pi.playlist_id
            where pi.media_item_id = m.id order by p.title collate nocase
          )), '[]') as playlist_titles_json
         from media_items m join channels c on c.id = m.channel_id
         ${where}
         order by coalesce(m.published_at, 0) desc, m.id desc limit ? offset ?`,
      )
      .all(...parameters, query.pageSize, offset) as MediaRow[];
    return LibraryQueryResultSchema.parse({
      items: rows.map(mediaRowToDto),
      total: total.count,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  public async queryPlaylists(query: PlaylistQuery): Promise<PlaylistQueryResult> {
    const conditions: string[] = [];
    const parameters: SqlValue[] = [];
    if (query.channelId !== null) {
      conditions.push('p.channel_id = ?');
      parameters.push(query.channelId);
    }
    if (query.search !== '') {
      conditions.push("p.title like ? escape '\\'");
      const escaped = query.search
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
      parameters.push(`%${escaped}%`);
    }
    const where = conditions.length === 0 ? '' : `where ${conditions.join(' and ')}`;
    const total = this.database.sqlite
      .prepare(`select count(*) as count from playlists p ${where}`)
      .get(...parameters) as { count: number };
    const offset = (query.page - 1) * query.pageSize;
    const rows = this.database.sqlite
      .prepare(
        `select p.id, p.provider_playlist_id, p.channel_id, c.title as channel_title,
          p.title, p.source_status, p.last_seen_at, p.removed_at,
          (select count(*) from playlist_items pi where pi.playlist_id = p.id) as media_count
         from playlists p join channels c on c.id = p.channel_id ${where}
         order by p.title collate nocase, p.id limit ? offset ?`,
      )
      .all(...parameters, query.pageSize, offset) as Array<{
      id: string;
      provider_playlist_id: string;
      channel_id: string;
      channel_title: string;
      title: string;
      source_status: string;
      last_seen_at: number | null;
      removed_at: number | null;
      media_count: number;
    }>;
    return PlaylistQueryResultSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        providerPlaylistId: row.provider_playlist_id,
        channelId: row.channel_id,
        channelTitle: row.channel_title,
        title: row.title,
        sourceStatus: row.source_status,
        mediaCount: row.media_count,
        lastSeenAt: row.last_seen_at,
        removedAt: row.removed_at,
      })),
      total: total.count,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  public async queryPlaylistMembers(query: PlaylistMembersQuery): Promise<PlaylistMembersResult> {
    const total = this.database.sqlite
      .prepare('select count(*) as count from playlist_items where playlist_id = ?')
      .get(query.playlistId) as { count: number };
    const offset = (query.page - 1) * query.pageSize;
    const rows = this.database.sqlite
      .prepare(
        `select pi.position,
          m.id, m.provider_media_id, m.channel_id, c.title as channel_title, m.title,
          m.original_title, m.source_url, m.source_status, m.media_type, m.published_at,
          m.duration_seconds, m.thumbnail_url, m.first_seen_at, m.last_seen_at,
          coalesce((select json_group_array(title) from (
            select p2.title as title from playlist_items pi2
            join playlists p2 on p2.id = pi2.playlist_id
            where pi2.media_item_id = m.id order by p2.title collate nocase
          )), '[]') as playlist_titles_json
         from playlist_items pi
         join media_items m on m.id = pi.media_item_id
         join channels c on c.id = m.channel_id
         where pi.playlist_id = ?
         order by coalesce(pi.position, 2147483647), m.id limit ? offset ?`,
      )
      .all(query.playlistId, query.pageSize, offset) as Array<
      MediaRow & { position: number | null }
    >;
    return PlaylistMembersResultSchema.parse({
      items: rows.map((row) => ({ position: row.position, media: mediaRowToDto(row) })),
      total: total.count,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  public createSyncSession(
    channelId: string,
    providerChannelId: string,
    startedAt: number,
    onProgress: (progress: SourceSyncProgress) => Promise<void>,
  ): { sink: SourceSyncSink; finalize(): Promise<void> } {
    const state: SyncSessionState = {
      channelId,
      providerChannelId,
      startedAt,
      completedMemberships: new Set(),
      membershipAdded: new Map(),
      membershipReordered: new Map(),
    };
    return {
      sink: {
        writeMediaPage: (items) => this.writeMediaPage(state, items),
        writePlaylistPage: (items) => this.writePlaylistPage(state, items),
        writePlaylistMembershipPage: (playlistId, items) =>
          this.writeMembershipPage(state, playlistId, items),
        completePlaylistMembership: async (playlistId) => {
          state.completedMemberships.add(playlistId);
        },
        reportProgress: onProgress,
      },
      finalize: () => this.finalizeSync(state),
    };
  }

  public createSyncJob(channelId: string): SourceSyncJobDto {
    const existing = this.database.sqlite
      .prepare(
        `select * from jobs where channel_id = ? and job_type = 'CHANNEL_SYNC'
         and status in ('PENDING', 'READY', 'RUNNING', 'RETRY_WAIT', 'INTERRUPTED')
         order by created_at desc limit 1`,
      )
      .get(channelId) as Record<string, unknown> | undefined;
    if (existing !== undefined) return this.jobRowToDto(existing);
    const id = randomUUID();
    const createdAt = this.now();
    this.database.sqlite
      .prepare(
        `insert into jobs (
          id, channel_id, job_type, status, priority, attempt_count, max_attempts,
          bytes_processed, payload_json, idempotency_key, created_at, updated_at
        ) values (?, ?, 'CHANNEL_SYNC', 'READY', 0, 0, 5, 0, ?, ?, ?, ?)`,
      )
      .run(
        id,
        channelId,
        JSON.stringify({ phase: 'QUEUED' }),
        `channel-sync:${channelId}:${id}`,
        createdAt,
        createdAt,
      );
    return this.getSyncJob(id);
  }

  public getSyncJob(jobId: string): SourceSyncJobDto {
    const row = this.database.sqlite
      .prepare("select * from jobs where id = ? and job_type = 'CHANNEL_SYNC'")
      .get(jobId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error('Synchronization job was not found');
    return this.jobRowToDto(row);
  }

  public recoverSyncJobs(): SourceSyncJobDto[] {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `update jobs set status = 'READY', lock_owner = null, lease_until = null,
          updated_at = ? where job_type = 'CHANNEL_SYNC' and status in ('RUNNING', 'INTERRUPTED')`,
      )
      .run(changedAt);
    const rows = this.database.sqlite
      .prepare(
        `select * from jobs where job_type = 'CHANNEL_SYNC'
         and status in ('READY', 'RETRY_WAIT') order by created_at asc`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.jobRowToDto(row));
  }

  public claimSyncJob(jobId: string, workerId: string): boolean {
    const changedAt = this.now();
    const result = this.database.sqlite
      .prepare(
        `update jobs set status = 'RUNNING', lock_owner = ?, lease_until = ?,
          last_heartbeat_at = ?, started_at = coalesce(started_at, ?), updated_at = ?
         where id = ? and job_type = 'CHANNEL_SYNC'
         and (status in ('READY', 'INTERRUPTED') or (status = 'RETRY_WAIT' and next_retry_at <= ?))`,
      )
      .run(workerId, changedAt + 60_000, changedAt, changedAt, changedAt, jobId, changedAt);
    return result.changes === 1;
  }

  public updateSyncProgress(jobId: string, progress: SourceSyncProgress): void {
    const ratio =
      progress.total === null || progress.total === 0
        ? null
        : Math.min(1, progress.completed / progress.total);
    this.database.sqlite
      .prepare(
        `update jobs set payload_json = ?, progress_ratio = ?, bytes_processed = ?,
          bytes_total = ?, last_heartbeat_at = ?, lease_until = ?, updated_at = ? where id = ?`,
      )
      .run(
        JSON.stringify({ phase: progress.phase }),
        ratio,
        progress.completed,
        progress.total,
        this.now(),
        this.now() + 60_000,
        this.now(),
        jobId,
      );
  }

  public setSyncPhase(jobId: string, phase: 'RECONCILING'): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare('update jobs set payload_json = ?, updated_at = ? where id = ?')
      .run(JSON.stringify({ phase }), changedAt, jobId);
  }

  public completeSyncJob(jobId: string, result: unknown): void {
    const changedAt = this.now();
    this.database.sqlite
      .prepare(
        `update jobs set status = 'COMPLETED', payload_json = ?, result_json = ?,
          progress_ratio = 1, completed_at = ?, lock_owner = null, lease_until = null,
          error_code = null, error_message_safe = null, updated_at = ? where id = ?`,
      )
      .run(
        JSON.stringify({ phase: 'COMPLETE' }),
        JSON.stringify(result),
        changedAt,
        changedAt,
        jobId,
      );
  }

  public failSyncJob(jobId: string, error: SourceProviderError): SourceSyncJobDto {
    const current = this.database.sqlite
      .prepare('select attempt_count, max_attempts from jobs where id = ?')
      .get(jobId) as { attempt_count: number; max_attempts: number };
    const attempts = current.attempt_count + 1;
    const retry = error.retryable && attempts < current.max_attempts;
    const changedAt = this.now();
    const retryDelay =
      error.retryAfterMs ?? RETRY_DELAYS[Math.min(RETRY_DELAYS.length - 1, attempts - 1)]!;
    const retryAt = retry ? changedAt + retryDelay : null;
    this.database.sqlite
      .prepare(
        `update jobs set status = ?, attempt_count = ?, next_retry_at = ?, payload_json = ?,
          error_code = ?, error_message_safe = ?, lock_owner = null, lease_until = null,
          completed_at = ?, updated_at = ? where id = ?`,
      )
      .run(
        retry ? 'RETRY_WAIT' : 'FAILED',
        attempts,
        retry ? retryAt : null,
        JSON.stringify({ phase: 'FAILED' }),
        error.code,
        error.safeMessage,
        retry ? null : changedAt,
        changedAt,
        jobId,
      );
    return this.getSyncJob(jobId);
  }

  private async writeMediaPage(state: SyncSessionState, items: SourceMediaRecord[]): Promise<void> {
    const transaction = this.database.sqlite.transaction(() => {
      for (const item of items) {
        if (item.providerChannelId !== state.providerChannelId) {
          throw new Error('Source media channel identity mismatch');
        }
        const existing = this.database.sqlite
          .prepare(
            `select id, channel_id, title, thumbnail_url, source_status, metadata_version
             from media_items where source_provider = 'YOUTUBE' and provider_media_id = ?`,
          )
          .get(item.providerMediaId) as ExistingMediaRow | undefined;
        if (existing === undefined) {
          const mediaId = randomUUID();
          this.database.sqlite
            .prepare(
              `insert into media_items (
                id, channel_id, source_provider, provider_media_id, media_type, title,
                original_title, source_url, visibility, source_status, published_at,
                duration_seconds, thumbnail_url, first_seen_at, last_seen_at, metadata_version,
                created_at, updated_at
              ) values (?, ?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            )
            .run(
              mediaId,
              state.channelId,
              item.providerMediaId,
              item.mediaType,
              item.title,
              item.title,
              item.sourceUrl,
              item.visibility,
              item.sourceStatus,
              item.publishedAt,
              item.durationSeconds,
              item.thumbnailUrl,
              state.startedAt,
              state.startedAt,
              state.startedAt,
              state.startedAt,
            );
          this.activity(
            'MEDIA_DISCOVERED',
            state.channelId,
            mediaId,
            null,
            'New media discovered',
            {
              providerMediaId: item.providerMediaId,
              mediaType: item.mediaType,
            },
            state.startedAt,
          );
          continue;
        }
        if (existing.channel_id !== state.channelId) {
          throw new Error('YouTube media identity is already associated with another channel');
        }
        let metadataVersion = existing.metadata_version;
        if (existing.title !== item.title) {
          metadataVersion += 1;
          this.metadataChange(
            existing.id,
            'TITLE_CHANGED',
            existing.title,
            item.title,
            state.startedAt,
          );
          this.activity(
            'TITLE_CHANGED',
            state.channelId,
            existing.id,
            null,
            'Media title changed',
            {
              previousTitle: existing.title,
              currentTitle: item.title,
            },
            state.startedAt,
          );
        }
        if (existing.thumbnail_url !== item.thumbnailUrl) {
          metadataVersion += 1;
          this.metadataChange(
            existing.id,
            'THUMBNAIL_CHANGED',
            existing.thumbnail_url,
            item.thumbnailUrl,
            state.startedAt,
          );
          this.activity(
            'THUMBNAIL_CHANGED',
            state.channelId,
            existing.id,
            null,
            'Media thumbnail changed',
            {},
            state.startedAt,
          );
        }
        if (existing.source_status !== item.sourceStatus) {
          metadataVersion += 1;
          this.metadataChange(
            existing.id,
            'SOURCE_STATUS_CHANGED',
            existing.source_status,
            item.sourceStatus,
            state.startedAt,
          );
        }
        this.database.sqlite
          .prepare(
            `update media_items set media_type = ?, title = ?, source_url = ?, visibility = ?,
              source_status = ?, published_at = ?, duration_seconds = ?, thumbnail_url = ?,
              last_seen_at = ?, removed_at = null, metadata_version = ?, updated_at = ? where id = ?`,
          )
          .run(
            item.mediaType,
            item.title,
            item.sourceUrl,
            item.visibility,
            item.sourceStatus,
            item.publishedAt,
            item.durationSeconds,
            item.thumbnailUrl,
            state.startedAt,
            metadataVersion,
            state.startedAt,
            existing.id,
          );
      }
    });
    transaction();
  }

  private async writePlaylistPage(
    state: SyncSessionState,
    items: SourcePlaylistRecord[],
  ): Promise<void> {
    const transaction = this.database.sqlite.transaction(() => {
      for (const item of items) {
        if (item.providerChannelId !== state.providerChannelId) {
          throw new Error('Source playlist channel identity mismatch');
        }
        const existing = this.database.sqlite
          .prepare(
            `select id, channel_id, title, source_status from playlists
             where source_provider = 'YOUTUBE' and provider_playlist_id = ?`,
          )
          .get(item.providerPlaylistId) as
          { id: string; channel_id: string; title: string; source_status: string } | undefined;
        if (existing === undefined) {
          const playlistId = randomUUID();
          this.database.sqlite
            .prepare(
              `insert into playlists (
                id, channel_id, source_provider, provider_playlist_id, title, source_status,
                first_seen_at, last_seen_at, created_at, updated_at
              ) values (?, ?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              playlistId,
              state.channelId,
              item.providerPlaylistId,
              item.title,
              item.sourceStatus,
              state.startedAt,
              state.startedAt,
              state.startedAt,
              state.startedAt,
            );
          continue;
        }
        if (existing.channel_id !== state.channelId) {
          throw new Error('YouTube playlist identity is already associated with another channel');
        }
        this.database.sqlite
          .prepare(
            `update playlists set title = ?, source_status = ?, last_seen_at = ?, removed_at = null,
              updated_at = ? where id = ?`,
          )
          .run(item.title, item.sourceStatus, state.startedAt, state.startedAt, existing.id);
      }
    });
    transaction();
  }

  private async writeMembershipPage(
    state: SyncSessionState,
    providerPlaylistId: string,
    items: SourcePlaylistMembershipRecord[],
  ): Promise<void> {
    const transaction = this.database.sqlite.transaction(() => {
      const playlist = this.database.sqlite
        .prepare(
          `select id from playlists where channel_id = ? and source_provider = 'YOUTUBE'
           and provider_playlist_id = ?`,
        )
        .get(state.channelId, providerPlaylistId) as { id: string } | undefined;
      if (playlist === undefined) return;
      for (const item of items) {
        const media = this.database.sqlite
          .prepare(
            `select id from media_items where channel_id = ? and source_provider = 'YOUTUBE'
             and provider_media_id = ?`,
          )
          .get(state.channelId, item.providerMediaId) as { id: string } | undefined;
        if (media === undefined) continue;
        const existing = this.database.sqlite
          .prepare(
            'select position from playlist_items where playlist_id = ? and media_item_id = ?',
          )
          .get(playlist.id, media.id) as { position: number | null } | undefined;
        if (existing === undefined) {
          state.membershipAdded.set(
            providerPlaylistId,
            (state.membershipAdded.get(providerPlaylistId) ?? 0) + 1,
          );
          this.database.sqlite
            .prepare(
              `insert into playlist_items (
                playlist_id, media_item_id, position, last_seen_at, created_at, updated_at
              ) values (?, ?, ?, ?, ?, ?)`,
            )
            .run(
              playlist.id,
              media.id,
              item.position,
              state.startedAt,
              state.startedAt,
              state.startedAt,
            );
        } else {
          if (existing.position !== item.position) {
            state.membershipReordered.set(
              providerPlaylistId,
              (state.membershipReordered.get(providerPlaylistId) ?? 0) + 1,
            );
          }
          this.database.sqlite
            .prepare(
              `update playlist_items set position = ?, last_seen_at = ?, updated_at = ?
               where playlist_id = ? and media_item_id = ?`,
            )
            .run(item.position, state.startedAt, state.startedAt, playlist.id, media.id);
        }
      }
    });
    transaction();
  }

  private async finalizeSync(state: SyncSessionState): Promise<void> {
    const reconciliationBatchSize = 500;
    while (true) {
      const staleMedia = this.database.sqlite
        .prepare(
          `select id, source_status from media_items where channel_id = ?
           and (last_seen_at is null or last_seen_at < ?) and source_status <> 'REMOVED'
           order by id limit ?`,
        )
        .all(state.channelId, state.startedAt, reconciliationBatchSize) as Array<{
        id: string;
        source_status: string;
      }>;
      if (staleMedia.length === 0) break;
      this.database.sqlite.transaction(() => {
        for (const media of staleMedia) {
          this.metadataChange(
            media.id,
            'SOURCE_STATUS_CHANGED',
            media.source_status,
            'REMOVED',
            state.startedAt,
          );
          this.database.sqlite
            .prepare(
              `update media_items set source_status = 'REMOVED', removed_at = ?,
                metadata_version = metadata_version + 1, updated_at = ? where id = ?`,
            )
            .run(state.startedAt, state.startedAt, media.id);
          this.activity(
            'MEDIA_REMOVED_FROM_SOURCE',
            state.channelId,
            media.id,
            null,
            'Media is no longer present in the completed YouTube inventory',
            {},
            state.startedAt,
          );
        }
      })();
    }

    while (true) {
      const stalePlaylists = this.database.sqlite
        .prepare(
          `select id from playlists where channel_id = ?
           and (last_seen_at is null or last_seen_at < ?) and source_status <> 'REMOVED'
           order by id limit ?`,
        )
        .all(state.channelId, state.startedAt, reconciliationBatchSize) as Array<{ id: string }>;
      if (stalePlaylists.length === 0) break;
      this.database.sqlite.transaction(() => {
        for (const playlist of stalePlaylists) {
          this.database.sqlite
            .prepare(
              `update playlists set source_status = 'REMOVED', removed_at = ?, updated_at = ? where id = ?`,
            )
            .run(state.startedAt, state.startedAt, playlist.id);
          this.activity(
            'PLAYLIST_REMOVED_FROM_SOURCE',
            state.channelId,
            null,
            playlist.id,
            'Playlist is no longer present in the completed YouTube inventory',
            {},
            state.startedAt,
          );
        }
      })();
    }

    for (const providerPlaylistId of state.completedMemberships) {
      this.database.sqlite.transaction(() => {
        const playlist = this.database.sqlite
          .prepare(`select id from playlists where channel_id = ? and provider_playlist_id = ?`)
          .get(state.channelId, providerPlaylistId) as { id: string } | undefined;
        if (playlist === undefined) return;
        const stale = this.database.sqlite
          .prepare(
            `select count(*) as count from playlist_items where playlist_id = ?
             and (last_seen_at is null or last_seen_at < ?)`,
          )
          .get(playlist.id, state.startedAt) as { count: number };
        if (stale.count > 0) {
          this.database.sqlite
            .prepare(
              `delete from playlist_items where playlist_id = ?
               and (last_seen_at is null or last_seen_at < ?)`,
            )
            .run(playlist.id, state.startedAt);
        }
        const added = state.membershipAdded.get(providerPlaylistId) ?? 0;
        const reordered = state.membershipReordered.get(providerPlaylistId) ?? 0;
        if (added > 0 || stale.count > 0 || reordered > 0) {
          this.activity(
            'PLAYLIST_MEMBERSHIP_CHANGED',
            state.channelId,
            null,
            playlist.id,
            'Playlist membership changed',
            { added, removed: stale.count, reordered },
            state.startedAt,
          );
        }
      })();
    }

    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare('update channels set last_sync_at = ?, updated_at = ? where id = ?')
        .run(state.startedAt, state.startedAt, state.channelId);
      this.rebuildSearchForChannel(state.channelId);
    })();
  }

  private metadataChange(
    mediaItemId: string,
    changeType: string,
    oldValue: unknown,
    newValue: unknown,
    capturedAt: number,
  ): void {
    this.database.sqlite
      .prepare(
        `insert into media_metadata_history (
          id, media_item_id, change_type, old_value_json, new_value_json, captured_at
        ) values (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        mediaItemId,
        changeType,
        JSON.stringify(oldValue),
        JSON.stringify(newValue),
        capturedAt,
      );
  }

  private activity(
    eventType: string,
    channelId: string,
    mediaItemId: string | null,
    playlistId: string | null,
    summary: string,
    details: Record<string, unknown>,
    createdAt: number,
  ): void {
    this.database.sqlite
      .prepare(
        `insert into activity_log (
          id, event_type, severity, channel_id, media_item_id, playlist_id,
          summary, details_json, created_at
        ) values (?, ?, 'INFO', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        eventType,
        channelId,
        mediaItemId,
        playlistId,
        summary,
        JSON.stringify(details),
        createdAt,
      );
  }

  private rebuildSearchForChannel(channelId: string): void {
    this.database.sqlite
      .prepare(
        `delete from media_search where media_item_id in (
          select id from media_items where channel_id = ?
        )`,
      )
      .run(channelId);
    this.database.sqlite
      .prepare(
        `insert into media_search (media_item_id, title, channel_title, playlist_titles)
         select m.id, m.title, c.title,
           coalesce((select group_concat(p.title, ' ') from playlist_items pi
             join playlists p on p.id = pi.playlist_id where pi.media_item_id = m.id), '')
         from media_items m join channels c on c.id = m.channel_id where m.channel_id = ?`,
      )
      .run(channelId);
  }

  private jobRowToDto(row: Record<string, unknown>): SourceSyncJobDto {
    const status = syncStatus(String(row.status));
    if (status === null) throw new Error('Synchronization job has an invalid status');
    return SourceSyncJobDtoSchema.parse({
      id: row.id,
      channelId: row.channel_id,
      status,
      phase: jobPhase(String(row.payload_json)),
      progressRatio: row.progress_ratio,
      errorCode: row.error_code,
      safeMessage: row.error_message_safe,
      nextRetryAt: row.next_retry_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

export class SourceSyncCoordinator {
  private readonly active = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private stopping = false;

  public constructor(
    private readonly workerId: string,
    private readonly catalog: SourceCatalogService,
    private readonly provider: SourceProvider,
    private readonly now: () => number = Date.now,
    private readonly onAccountAuthorizationError?: (accountId: string) => Promise<void>,
  ) {}

  public start(channelId: string): SourceSyncJobDto {
    const job = this.catalog.createSyncJob(channelId);
    this.schedule(job);
    return job;
  }

  public status(jobId: string): SourceSyncJobDto {
    return this.catalog.getSyncJob(jobId);
  }

  public resumePending(): void {
    for (const job of this.catalog.recoverSyncJobs()) this.schedule(job);
  }

  public isIdle(): boolean {
    return this.active.size === 0;
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled(this.active.values());
  }

  private schedule(job: SourceSyncJobDto): void {
    if (this.stopping) return;
    if (this.active.has(job.id) || this.timers.has(job.id)) return;
    if (job.status === 'RETRY_WAIT') {
      const delay = Math.max(0, (job.nextRetryAt ?? this.now()) - this.now());
      const timer = setTimeout(() => {
        this.timers.delete(job.id);
        this.run(job.id);
      }, delay);
      timer.unref();
      this.timers.set(job.id, timer);
      return;
    }
    this.run(job.id);
  }

  private run(jobId: string): void {
    if (this.active.has(jobId)) return;
    const promise = this.execute(jobId)
      .catch(() => {
        try {
          this.catalog.failSyncJob(
            jobId,
            new SourceProviderError(
              'INTERNAL_ERROR',
              'Synchronization stopped because of an internal catalog error.',
              false,
            ),
          );
        } catch {
          // A database failure is already terminal for this worker instance.
        }
      })
      .finally(() => {
        this.active.delete(jobId);
        try {
          const current = this.catalog.getSyncJob(jobId);
          if (current.status === 'RETRY_WAIT') this.schedule(current);
        } catch {
          // The worker will surface database health failure through its normal boundary.
        }
      });
    this.active.set(jobId, promise);
  }

  private async execute(jobId: string): Promise<void> {
    if (!this.catalog.claimSyncJob(jobId, this.workerId)) return;
    const job = this.catalog.getSyncJob(jobId);
    const access = this.catalog.getChannelAccess(job.channelId);
    if (access === null) {
      this.catalog.failSyncJob(
        jobId,
        new SourceProviderError(
          'AUTH_REVOKED',
          'No connected Google account can access this selected channel.',
          false,
        ),
      );
      return;
    }
    const startedAt = this.now();
    const session = this.catalog.createSyncSession(
      job.channelId,
      access.providerChannelId,
      startedAt,
      async (progress) => this.catalog.updateSyncProgress(jobId, progress),
    );
    try {
      const result = await this.provider.syncChannel(
        { accountId: access.accountId, providerChannelId: access.providerChannelId },
        session.sink,
      );
      if (!result.authoritative) {
        throw new SourceProviderError(
          'PARTIAL_SYNC_FAILED',
          'YouTube synchronization did not complete an authoritative inventory.',
          true,
        );
      }
      this.catalog.setSyncPhase(jobId, 'RECONCILING');
      await session.finalize();
      this.catalog.completeSyncJob(jobId, result);
    } catch (error) {
      const sourceError =
        error instanceof SourceProviderError
          ? error
          : new SourceProviderError(
              'PARTIAL_SYNC_FAILED',
              'YouTube synchronization stopped before the inventory completed.',
              true,
            );
      if (sourceError.code === 'AUTH_REVOKED' || sourceError.code === 'AUTH_REFRESH_FAILED') {
        await this.onAccountAuthorizationError?.(access.accountId);
      }
      this.catalog.failSyncJob(jobId, sourceError);
    }
  }
}
