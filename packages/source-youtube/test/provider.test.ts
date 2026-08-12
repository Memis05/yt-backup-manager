import type {
  SourceMediaRecord,
  SourcePlaylistMembershipRecord,
  SourcePlaylistRecord,
  SourceSyncProgress,
  SourceSyncSink,
} from '@ytbm/core';
import { describe, expect, it } from 'vitest';

import { YouTubeApiClient, YouTubeSourceProvider } from '../src';

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('paginated YouTube source provider', () => {
  it('discovers paginated media/playlists and keeps shared playlist media logical', async () => {
    const calls: URL[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input.toString());
      calls.push(url);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token');
      const resource = url.pathname.split('/').at(-1);
      const token = url.searchParams.get('pageToken');
      if (resource === 'channels' && url.searchParams.get('mine') === 'true') {
        return token === null
          ? json({
              items: [{ id: 'UC1', snippet: { title: 'Channel One' } }],
              nextPageToken: 'channel-page-2',
            })
          : json({ items: [{ id: 'UC2', snippet: { title: 'Channel Two' } }] });
      }
      if (resource === 'channels') {
        return json({
          items: [{ id: 'UC1', contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }],
        });
      }
      if (resource === 'playlistItems' && url.searchParams.get('playlistId') === 'UU1') {
        return token === null
          ? json({
              items: [
                { snippet: { position: 0 }, contentDetails: { videoId: 'video-1' } },
                { snippet: { position: 1 }, contentDetails: { videoId: 'short-1' } },
              ],
              pageInfo: { totalResults: 3 },
              nextPageToken: 'uploads-page-2',
            })
          : json({
              items: [
                { snippet: { position: 2 }, contentDetails: { videoId: 'live-1' } },
                { snippet: { position: 3 }, contentDetails: { videoId: 'upcoming-1' } },
              ],
              pageInfo: { totalResults: 4 },
            });
      }
      if (resource === 'videos') {
        const ids = url.searchParams.get('id')?.split(',') ?? [];
        return json({
          items: ids.map((id) => {
            if (id === 'video-1') {
              return {
                id,
                snippet: { title: 'Full video', publishedAt: '2026-08-01T00:00:00Z' },
                contentDetails: { duration: 'PT12M' },
                status: { privacyStatus: 'public' },
              };
            }
            if (id === 'short-1') {
              return {
                id,
                snippet: { title: 'Short clip' },
                contentDetails: { duration: 'PT45S' },
                status: { privacyStatus: 'unlisted' },
              };
            }
            if (id === 'live-1') {
              return {
                id,
                snippet: { title: 'Completed stream' },
                contentDetails: { duration: 'PT2H' },
                status: { privacyStatus: 'public' },
                liveStreamingDetails: { actualEndTime: '2026-08-02T00:00:00Z' },
              };
            }
            return {
              id,
              snippet: { title: 'Upcoming stream', liveBroadcastContent: 'upcoming' },
              contentDetails: { duration: 'PT0S' },
              status: { privacyStatus: 'public' },
            };
          }),
        });
      }
      if (resource === 'playlists') {
        return json({
          items: [
            { id: 'PL1', snippet: { title: 'Playlist One' }, status: { privacyStatus: 'public' } },
            { id: 'PL2', snippet: { title: 'Playlist Two' }, status: { privacyStatus: 'private' } },
          ],
          pageInfo: { totalResults: 2 },
        });
      }
      if (resource === 'playlistItems') {
        return json({
          items: [{ snippet: { position: 0 }, contentDetails: { videoId: 'video-1' } }],
        });
      }
      throw new Error(`Unexpected API request: ${url.toString()}`);
    };
    const api = new YouTubeApiClient({ getAccessToken: async () => 'access-token' }, fetcher);
    const provider = new YouTubeSourceProvider(api);

    await expect(provider.listChannels('account-1')).resolves.toHaveLength(2);
    const media: SourceMediaRecord[] = [];
    const playlists: SourcePlaylistRecord[] = [];
    const memberships = new Map<string, SourcePlaylistMembershipRecord[]>();
    const completed = new Set<string>();
    const progress: SourceSyncProgress[] = [];
    const sink: SourceSyncSink = {
      writeMediaPage: async (items) => void media.push(...items),
      writePlaylistPage: async (items) => void playlists.push(...items),
      writePlaylistMembershipPage: async (playlistId, items) =>
        void memberships.set(playlistId, [...(memberships.get(playlistId) ?? []), ...items]),
      completePlaylistMembership: async (playlistId) => void completed.add(playlistId),
      reportProgress: async (value) => void progress.push(value),
    };

    await expect(
      provider.syncChannel({ accountId: 'account-1', providerChannelId: 'UC1' }, sink),
    ).resolves.toEqual({
      mediaCount: 3,
      playlistCount: 2,
      playlistMembershipCount: 2,
      authoritative: true,
    });
    expect(media.map((item) => [item.providerMediaId, item.mediaType])).toEqual([
      ['video-1', 'VIDEO'],
      ['short-1', 'SHORT'],
      ['live-1', 'LIVE'],
    ]);
    expect(playlists).toHaveLength(2);
    expect(memberships.get('PL1')).toEqual([{ providerMediaId: 'video-1', position: 0 }]);
    expect(memberships.get('PL2')).toEqual([{ providerMediaId: 'video-1', position: 0 }]);
    expect(completed).toEqual(new Set(['PL1', 'PL2']));
    expect(progress.some((item) => item.phase === 'MEDIA')).toBe(true);
    expect(calls.filter((url) => url.pathname.endsWith('/videos'))).toHaveLength(2);
  });
});
