import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  SourceMediaRecord,
  SourcePlaylistMembershipRecord,
  SourcePlaylistRecord,
  SourceProvider,
} from '@ytbm/core';
import { SourceProviderError } from '@ytbm/source-youtube';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DrizzleGoogleAccountRepository,
  SourceCatalogService,
  SourceSyncCoordinator,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '../src';

const directories: string[] = [];
const databases: WorkerDatabase[] = [];
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

async function createDatabase(): Promise<WorkerDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-source-catalog-'));
  directories.push(directory);
  const database = openWorkerDatabase({
    databasePath: join(directory, 'app.db'),
    ownership: acquireWorkerDatabaseOwnership(),
    migrationsFolder,
  });
  databases.push(database);
  return database;
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function media(
  providerMediaId: string,
  title: string,
  mediaType: SourceMediaRecord['mediaType'] = 'VIDEO',
): SourceMediaRecord {
  return {
    providerMediaId,
    providerChannelId: 'UC-shared',
    title,
    sourceUrl: `https://www.youtube.com/watch?v=${providerMediaId}`,
    sourceStatus: 'AVAILABLE',
    visibility: 'public',
    publishedAt: 1_700_000_000_000,
    durationSeconds: mediaType === 'SHORT' ? 45 : mediaType === 'LIVE' ? 7_200 : 600,
    thumbnailUrl: `https://i.ytimg.com/vi/${providerMediaId}/hqdefault.jpg`,
    mediaType,
  };
}

function playlist(providerPlaylistId: string, title: string): SourcePlaylistRecord {
  return {
    providerPlaylistId,
    providerChannelId: 'UC-shared',
    title,
    sourceStatus: 'AVAILABLE',
  };
}

async function authoritativeSync(
  catalog: SourceCatalogService,
  channelId: string,
  timestamp: number,
  mediaItems: SourceMediaRecord[],
  playlists: SourcePlaylistRecord[],
  memberships: Record<string, SourcePlaylistMembershipRecord[]>,
): Promise<void> {
  const session = catalog.createSyncSession(
    channelId,
    'UC-shared',
    timestamp,
    async () => undefined,
  );
  await session.sink.writeMediaPage(mediaItems);
  await session.sink.writePlaylistPage(playlists);
  for (const sourcePlaylist of playlists) {
    await session.sink.writePlaylistMembershipPage(
      sourcePlaylist.providerPlaylistId,
      memberships[sourcePlaylist.providerPlaylistId] ?? [],
    );
    await session.sink.completePlaylistMembership(sourcePlaylist.providerPlaylistId);
  }
  await session.finalize();
}

describe('worker-owned source catalog', () => {
  it('normalizes account access and applies idempotent authoritative catalog changes', async () => {
    const database = await createDatabase();
    let now = 1_000;
    const accounts = new DrizzleGoogleAccountRepository(database);
    const catalog = new SourceCatalogService(database, () => now);
    const accountOne = await accounts.upsertConnectedAccount({
      providerAccountId: 'google-one',
      email: 'one@example.test',
      displayName: 'One',
      avatarUrl: null,
      credentialRef: 'google-oauth:one',
      grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
      connectedAt: now,
    });
    const accountTwo = await accounts.upsertConnectedAccount({
      providerAccountId: 'google-two',
      email: 'two@example.test',
      displayName: 'Two',
      avatarUrl: null,
      credentialRef: 'google-oauth:two',
      grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
      connectedAt: now,
    });
    const channelRecord = {
      providerChannelId: 'UC-shared',
      title: 'Shared Production Channel',
      handle: '@shared',
      thumbnailUrl: null,
      publishedAt: null,
    };
    await catalog.discoverChannels(accountOne.id, [channelRecord]);
    await catalog.discoverChannels(accountTwo.id, [channelRecord]);
    const [channel] = await catalog.listChannels({ accountId: null, selectedOnly: false });
    expect(channel).toMatchObject({
      providerChannelId: 'UC-shared',
      accessibleAccountIds: expect.arrayContaining([accountOne.id, accountTwo.id]),
    });
    expect(database.sqlite.prepare('select count(*) as count from channels').get()).toEqual({
      count: 1,
    });
    expect(database.sqlite.prepare('select count(*) as count from account_channels').get()).toEqual(
      { count: 2 },
    );
    await catalog.setChannelEnabled(channel!.id, true);

    now = 2_000;
    const firstMedia = [
      media('video-1', 'Original title'),
      media('short-1', 'Short item', 'SHORT'),
      media('live-1', 'Completed live', 'LIVE'),
    ];
    const firstPlaylists = [
      playlist('PL-one', 'Collection One'),
      playlist('PL-two', 'Collection Two'),
    ];
    await authoritativeSync(catalog, channel!.id, now, firstMedia, firstPlaylists, {
      'PL-one': [{ providerMediaId: 'video-1', position: 0 }],
      'PL-two': [{ providerMediaId: 'video-1', position: 0 }],
    });
    expect(database.sqlite.prepare('select count(*) as count from media_items').get()).toEqual({
      count: 3,
    });
    expect(database.sqlite.prepare('select count(*) as count from playlist_items').get()).toEqual({
      count: 2,
    });

    now = 3_000;
    await authoritativeSync(catalog, channel!.id, now, firstMedia, firstPlaylists, {
      'PL-one': [{ providerMediaId: 'video-1', position: 0 }],
      'PL-two': [{ providerMediaId: 'video-1', position: 0 }],
    });
    expect(database.sqlite.prepare('select count(*) as count from media_items').get()).toEqual({
      count: 3,
    });
    expect(database.sqlite.prepare('select count(*) as count from playlists').get()).toEqual({
      count: 2,
    });

    now = 4_000;
    await authoritativeSync(
      catalog,
      channel!.id,
      now,
      [media('video-1', 'Renamed title'), firstMedia[1]!, firstMedia[2]!],
      firstPlaylists,
      {
        'PL-one': [{ providerMediaId: 'short-1', position: 0 }],
        'PL-two': [{ providerMediaId: 'video-1', position: 2 }],
      },
    );
    expect(
      database.sqlite
        .prepare(
          "select title, original_title from media_items where provider_media_id = 'video-1'",
        )
        .get(),
    ).toEqual({ title: 'Renamed title', original_title: 'Original title' });
    expect(
      database.sqlite
        .prepare(
          "select count(*) as count from media_metadata_history where change_type = 'TITLE_CHANGED'",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.sqlite
        .prepare(
          "select count(*) as count from activity_log where event_type = 'PLAYLIST_MEMBERSHIP_CHANGED'",
        )
        .get(),
    ).toEqual({ count: 4 });
    expect(
      database.sqlite
        .prepare(
          `select m.provider_media_id, pi.position from playlist_items pi
           join playlists p on p.id = pi.playlist_id
           join media_items m on m.id = pi.media_item_id
           where p.provider_playlist_id = 'PL-one'`,
        )
        .all(),
    ).toEqual([{ provider_media_id: 'short-1', position: 0 }]);

    now = 5_000;
    const partial = catalog.createSyncSession(channel!.id, 'UC-shared', now, async () => undefined);
    await partial.sink.writeMediaPage([media('video-1', 'Renamed title')]);
    expect(
      database.sqlite
        .prepare("select source_status from media_items where provider_media_id = 'short-1'")
        .get(),
    ).toEqual({ source_status: 'AVAILABLE' });

    const video = database.sqlite
      .prepare("select id from media_items where provider_media_id = 'short-1'")
      .get() as { id: string };
    database.sqlite
      .prepare(
        `insert into destinations (
          id, destination_type, root_path, enabled, availability_status, created_at, updated_at
        ) values ('destination-1', 'FILESYSTEM', 'E:\\Backup', 1, 'AVAILABLE', ?, ?)`,
      )
      .run(now, now);
    database.sqlite
      .prepare(
        `insert into media_copies (
          id, media_item_id, destination_id, status, created_at, updated_at
        ) values ('copy-1', ?, 'destination-1', 'VERIFIED', ?, ?)`,
      )
      .run(video.id, now, now);

    now = 6_000;
    await authoritativeSync(
      catalog,
      channel!.id,
      now,
      [media('video-1', 'Renamed title')],
      [playlist('PL-two', 'Collection Two')],
      { 'PL-two': [{ providerMediaId: 'video-1', position: 0 }] },
    );
    expect(
      database.sqlite
        .prepare("select source_status from media_items where provider_media_id = 'short-1'")
        .get(),
    ).toEqual({ source_status: 'REMOVED' });
    expect(
      database.sqlite
        .prepare("select count(*) as count from media_copies where id = 'copy-1'")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.sqlite
        .prepare("select source_status from playlists where provider_playlist_id = 'PL-one'")
        .get(),
    ).toEqual({ source_status: 'REMOVED' });

    await expect(
      catalog.queryLibrary({
        search: 'Renamed',
        channelId: null,
        mediaType: null,
        sourceStatus: null,
        page: 1,
        pageSize: 40,
      }),
    ).resolves.toMatchObject({ total: 1, items: [{ providerMediaId: 'video-1' }] });
    await expect(
      catalog.queryLibrary({
        search: 'Collection Two',
        channelId: null,
        mediaType: null,
        sourceStatus: null,
        page: 1,
        pageSize: 40,
      }),
    ).resolves.toMatchObject({ total: 1, items: [{ providerMediaId: 'video-1' }] });
    await expect(
      catalog.queryLibrary({
        search: 'Shared Production',
        channelId: null,
        mediaType: null,
        sourceStatus: null,
        page: 1,
        pageSize: 40,
      }),
    ).resolves.toMatchObject({ total: 3 });
  });

  it('does not reconcile unseen rows when a provider fails after a partial page', async () => {
    const database = await createDatabase();
    let now = 10_000;
    const accounts = new DrizzleGoogleAccountRepository(database);
    const catalog = new SourceCatalogService(database, () => now);
    const account = await accounts.upsertConnectedAccount({
      providerAccountId: 'partial-account',
      email: 'partial@example.test',
      displayName: null,
      avatarUrl: null,
      credentialRef: 'google-oauth:partial',
      grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
      connectedAt: now,
    });
    const [channel] = await catalog.discoverChannels(account.id, [
      {
        providerChannelId: 'UC-shared',
        title: 'Partial Sync Channel',
        handle: null,
        thumbnailUrl: null,
        publishedAt: null,
      },
    ]);
    await catalog.setChannelEnabled(channel!.id, true);
    await authoritativeSync(
      catalog,
      channel!.id,
      now,
      [media('video-1', 'One'), media('video-2', 'Two')],
      [],
      {},
    );
    now = 11_000;
    const failingProvider: SourceProvider = {
      id: 'YOUTUBE',
      listChannels: async () => [],
      syncChannel: async (_input, sink) => {
        await sink.writeMediaPage([media('video-1', 'One')]);
        throw new SourceProviderError('PARTIAL_SYNC_FAILED', 'A later page failed.', false);
      },
    };
    const coordinator = new SourceSyncCoordinator('worker-1', catalog, failingProvider, () => now);
    const job = coordinator.start(channel!.id);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (coordinator.status(job.id).status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(coordinator.status(job.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'PARTIAL_SYNC_FAILED',
    });
    expect(
      database.sqlite
        .prepare("select source_status from media_items where provider_media_id = 'video-2'")
        .get(),
    ).toEqual({ source_status: 'AVAILABLE' });
    await coordinator.stop();
  });
});
