import type {
  SourceChannelRecord,
  SourceMediaRecord,
  SourcePlaylistMembershipRecord,
  SourcePlaylistRecord,
  SourceProvider,
  SourceSyncInput,
  SourceSyncResult,
  SourceSyncSink,
} from '@ytbm/core';

import type { YouTubeApiClient } from './api-client';
import {
  classifyYouTubeMedia,
  parseYouTubeDuration,
  sourceStatusFromPrivacy,
} from './classification';
import { SourceProviderError } from './errors';

interface ListResponse {
  nextPageToken?: unknown;
  pageInfo?: { totalResults?: unknown };
  items?: unknown;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestamp(value: unknown): number | null {
  const text = string(value);
  if (text === null) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function thumbnail(snippet: JsonObject): string | null {
  const thumbnails = object(snippet.thumbnails);
  for (const key of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = string(object(thumbnails[key]).url);
    if (url !== null) return url;
  }
  return null;
}

function pageToken(response: ListResponse): string | null {
  return string(response.nextPageToken);
}

function totalResults(response: ListResponse): number | null {
  const total = number(response.pageInfo?.totalResults);
  return total === null ? null : Math.max(0, Math.trunc(total));
}

async function paginate(
  load: (token: string | null) => Promise<ListResponse>,
  consume: (response: ListResponse, completed: number) => Promise<number>,
): Promise<number> {
  let token: string | null = null;
  let completed = 0;
  const seenTokens = new Set<string>();
  do {
    const response = await load(token);
    completed += await consume(response, completed);
    token = pageToken(response);
    if (token !== null) {
      if (seenTokens.has(token)) {
        throw new SourceProviderError(
          'PARTIAL_SYNC_FAILED',
          'YouTube returned an invalid repeated pagination cursor.',
          true,
        );
      }
      seenTokens.add(token);
    }
  } while (token !== null);
  return completed;
}

export class YouTubeSourceProvider implements SourceProvider {
  public readonly id = 'YOUTUBE' as const;

  public constructor(private readonly api: YouTubeApiClient) {}

  public async listChannels(accountId: string): Promise<SourceChannelRecord[]> {
    const channels: SourceChannelRecord[] = [];
    await paginate(
      (token) =>
        this.api.get(accountId, 'channels', {
          part: 'id,snippet',
          mine: 'true',
          maxResults: '50',
          ...(token === null ? {} : { pageToken: token }),
        }) as Promise<ListResponse>,
      async (response) => {
        const items = array(response.items);
        for (const raw of items) {
          const item = object(raw);
          const providerChannelId = string(item.id);
          const snippet = object(item.snippet);
          const title = string(snippet.title);
          if (providerChannelId === null || title === null) continue;
          channels.push({
            providerChannelId,
            title,
            handle: string(snippet.customUrl),
            thumbnailUrl: thumbnail(snippet),
            publishedAt: timestamp(snippet.publishedAt),
          });
        }
        return items.length;
      },
    );
    return channels;
  }

  public async syncChannel(
    input: SourceSyncInput,
    sink: SourceSyncSink,
  ): Promise<SourceSyncResult> {
    const channelResponse = (await this.api.get(input.accountId, 'channels', {
      part: 'id,contentDetails',
      id: input.providerChannelId,
      maxResults: '1',
    })) as ListResponse;
    const channel = object(array(channelResponse.items)[0]);
    const relatedPlaylists = object(object(channel.contentDetails).relatedPlaylists);
    const uploadsPlaylistId = string(relatedPlaylists.uploads);
    if (uploadsPlaylistId === null) {
      throw new SourceProviderError(
        'SOURCE_UNAVAILABLE',
        'The selected YouTube channel does not expose an uploads inventory.',
        false,
      );
    }

    let mediaCount = 0;
    await paginate(
      (token) =>
        this.api.get(input.accountId, 'playlistItems', {
          part: 'snippet,contentDetails',
          playlistId: uploadsPlaylistId,
          maxResults: '50',
          ...(token === null ? {} : { pageToken: token }),
        }) as Promise<ListResponse>,
      async (response, completed) => {
        const uploadItems = array(response.items).map(object);
        const videoIds = uploadItems
          .map(
            (item) =>
              string(object(item.contentDetails).videoId) ??
              string(object(object(item.snippet).resourceId).videoId),
          )
          .filter((id): id is string => id !== null);
        const detailsResponse =
          videoIds.length === 0
            ? ({ items: [] } satisfies ListResponse)
            : ((await this.api.get(input.accountId, 'videos', {
                part: 'id,snippet,contentDetails,status,liveStreamingDetails',
                id: videoIds.join(','),
                maxResults: '50',
              })) as ListResponse);
        const details = new Map(
          array(detailsResponse.items)
            .map(object)
            .map((item) => [string(item.id), item] as const)
            .filter((entry): entry is readonly [string, JsonObject] => entry[0] !== null),
        );
        const media: SourceMediaRecord[] = [];
        for (const uploadItem of uploadItems) {
          const uploadSnippet = object(uploadItem.snippet);
          const providerMediaId =
            string(object(uploadItem.contentDetails).videoId) ??
            string(object(uploadSnippet.resourceId).videoId);
          if (providerMediaId === null) continue;
          const detail = details.get(providerMediaId);
          const snippet = detail === undefined ? uploadSnippet : object(detail.snippet);
          const liveBroadcastContent = string(snippet.liveBroadcastContent);
          const liveDetails = object(detail?.liveStreamingDetails);
          const actualEndTime = string(liveDetails.actualEndTime);
          if (
            (liveBroadcastContent === 'live' || liveBroadcastContent === 'upcoming') &&
            actualEndTime === null
          ) {
            continue;
          }
          const durationSeconds = parseYouTubeDuration(
            string(object(detail?.contentDetails).duration),
          );
          const privacy = string(object(detail?.status).privacyStatus);
          const title = string(snippet.title) ?? `Unavailable video [${providerMediaId}]`;
          const publishedAt =
            timestamp(snippet.publishedAt) ??
            timestamp(object(uploadItem.contentDetails).videoPublishedAt);
          media.push({
            providerMediaId,
            providerChannelId: input.providerChannelId,
            title,
            sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(providerMediaId)}`,
            sourceStatus: detail === undefined ? 'UNAVAILABLE' : sourceStatusFromPrivacy(privacy),
            visibility: privacy,
            publishedAt,
            durationSeconds,
            thumbnailUrl: thumbnail(snippet),
            mediaType: classifyYouTubeMedia({ durationSeconds, actualEndTime, publishedAt }),
          });
        }
        await sink.writeMediaPage(media);
        mediaCount += media.length;
        await sink.reportProgress({
          phase: 'MEDIA',
          completed: completed + uploadItems.length,
          total: totalResults(response),
        });
        return uploadItems.length;
      },
    );

    const discoveredPlaylists: SourcePlaylistRecord[] = [];
    await paginate(
      (token) =>
        this.api.get(input.accountId, 'playlists', {
          part: 'id,snippet,status',
          channelId: input.providerChannelId,
          maxResults: '50',
          ...(token === null ? {} : { pageToken: token }),
        }) as Promise<ListResponse>,
      async (response, completed) => {
        const records: SourcePlaylistRecord[] = [];
        for (const raw of array(response.items)) {
          const item = object(raw);
          const providerPlaylistId = string(item.id);
          const snippet = object(item.snippet);
          const title = string(snippet.title);
          if (
            providerPlaylistId === null ||
            providerPlaylistId === uploadsPlaylistId ||
            title === null
          ) {
            continue;
          }
          records.push({
            providerPlaylistId,
            providerChannelId: input.providerChannelId,
            title,
            sourceStatus: sourceStatusFromPrivacy(string(object(item.status).privacyStatus)),
          });
        }
        discoveredPlaylists.push(...records);
        await sink.writePlaylistPage(records);
        await sink.reportProgress({
          phase: 'PLAYLISTS',
          completed: completed + records.length,
          total: totalResults(response),
        });
        return array(response.items).length;
      },
    );

    let playlistMembershipCount = 0;
    for (const playlist of discoveredPlaylists) {
      await paginate(
        (token) =>
          this.api.get(input.accountId, 'playlistItems', {
            part: 'snippet,contentDetails',
            playlistId: playlist.providerPlaylistId,
            maxResults: '50',
            ...(token === null ? {} : { pageToken: token }),
          }) as Promise<ListResponse>,
        async (response) => {
          const records: SourcePlaylistMembershipRecord[] = [];
          for (const raw of array(response.items)) {
            const item = object(raw);
            const snippet = object(item.snippet);
            const providerMediaId =
              string(object(item.contentDetails).videoId) ??
              string(object(snippet.resourceId).videoId);
            if (providerMediaId === null) continue;
            const position = number(snippet.position);
            records.push({
              providerMediaId,
              position: position === null ? null : Math.max(0, Math.trunc(position)),
            });
          }
          await sink.writePlaylistMembershipPage(playlist.providerPlaylistId, records);
          playlistMembershipCount += records.length;
          return array(response.items).length;
        },
      );
      await sink.completePlaylistMembership(playlist.providerPlaylistId);
    }

    return {
      mediaCount,
      playlistCount: discoveredPlaylists.length,
      playlistMembershipCount,
      authoritative: true,
    };
  }
}
