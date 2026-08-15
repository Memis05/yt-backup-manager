import type {
  ChannelDto,
  IntegrityOverview,
  LibraryQueryResult,
  MediaBackupDetails,
  MediaLibraryItemDto,
  PlaylistDto,
  PlaylistMembersResult,
  PlaylistQueryResult,
} from '@ytbm/core';
import { vi } from 'vitest';

export const LIBRARY_IDS = {
  channel: '00000000-0000-4000-8000-000000000101',
  media: '00000000-0000-4000-8000-000000000102',
  mediaTwo: '00000000-0000-4000-8000-000000000103',
  playlist: '00000000-0000-4000-8000-000000000104',
  destination: '00000000-0000-4000-8000-000000000105',
  copy: '00000000-0000-4000-8000-000000000106',
  sourceCopy: '00000000-0000-4000-8000-000000000107',
  run: '00000000-0000-4000-8000-000000000108',
} as const;

export const libraryChannel: ChannelDto = {
  id: LIBRARY_IDS.channel,
  providerChannelId: 'UC-library',
  title: 'Archive Studio',
  handle: '@archive',
  thumbnailUrl: null,
  backupEnabled: true,
  sourceStatus: 'AVAILABLE',
  publishedAt: 1_700_000_000_000,
  lastSyncAt: 1_787_097_600_000,
  accessibleAccountIds: [],
  videosCount: 2,
  shortsCount: 0,
  liveCount: 0,
  syncStatus: 'COMPLETED',
};

export function mediaFixture(overrides: Partial<MediaLibraryItemDto> = {}): MediaLibraryItemDto {
  return {
    id: LIBRARY_IDS.media,
    providerMediaId: 'video-library',
    channelId: LIBRARY_IDS.channel,
    channelTitle: 'Archive Studio',
    title: 'A durable local archive',
    originalTitle: 'A durable local archive',
    sourceUrl: 'https://www.youtube.com/watch?v=video-library',
    sourceStatus: 'AVAILABLE',
    mediaType: 'VIDEO',
    publishedAt: 1_780_000_000_000,
    durationSeconds: 615,
    thumbnailUrl: 'https://i.ytimg.com/vi/video-library/hqdefault.jpg',
    firstSeenAt: 1_780_000_000_000,
    lastSeenAt: 1_787_097_600_000,
    playlistTitles: ['Research'],
    copySummary: {
      copyCount: 1,
      verifiedCount: 1,
      pendingCount: 0,
      attentionCount: 0,
      unavailableCount: 0,
      authRequiredCount: 0,
    },
    ...overrides,
  };
}

export const playlistFixture: PlaylistDto = {
  id: LIBRARY_IDS.playlist,
  providerPlaylistId: 'PL-library',
  channelId: LIBRARY_IDS.channel,
  channelTitle: 'Archive Studio',
  title: 'Research',
  sourceStatus: 'AVAILABLE',
  mediaCount: 72,
  lastSeenAt: 1_787_097_600_000,
  removedAt: null,
};

export const libraryResult: LibraryQueryResult = {
  items: [mediaFixture()],
  total: 1,
  page: 1,
  pageSize: 36,
};

export const playlistResult: PlaylistQueryResult = {
  items: [playlistFixture],
  total: 1,
  page: 1,
  pageSize: 30,
};

export const memberResult: PlaylistMembersResult = {
  items: [{ position: 0, media: mediaFixture() }],
  total: 72,
  page: 1,
  pageSize: 50,
};

export function mediaDetailsFixture(
  overrides: Partial<MediaBackupDetails> = {},
): MediaBackupDetails {
  return {
    mediaItemId: LIBRARY_IDS.media,
    providerMediaId: 'video-library',
    channelId: LIBRARY_IDS.channel,
    channelTitle: 'Archive Studio',
    title: 'A durable local archive',
    mediaType: 'VIDEO',
    sourceStatus: 'REMOVED',
    sourceUrl: 'https://www.youtube.com/watch?v=video-library',
    thumbnailUrl: 'https://i.ytimg.com/vi/video-library/hqdefault.jpg',
    publishedAt: 1_780_000_000_000,
    durationSeconds: 615,
    playlists: [{ id: LIBRARY_IDS.playlist, title: 'Research', sourceStatus: 'AVAILABLE' }],
    copies: [
      {
        id: LIBRARY_IDS.copy,
        destinationId: LIBRARY_IDS.destination,
        destinationPath: 'D:\\YouTube Archive',
        destinationType: 'FILESYSTEM',
        destinationAccountEmail: null,
        relativePath: 'Archive Studio\\video-library\\media.webm',
        providerFileIdAvailable: false,
        status: 'CORRUPT',
        availabilityStatus: 'AVAILABLE',
        container: 'webm',
        videoCodec: 'vp9',
        audioCodec: 'opus',
        width: 1920,
        height: 1080,
        fps: 30,
        bytes: 1_048_576,
        sha256: 'a'.repeat(64),
        qualityProfile: 'MAX_1080P',
        verificationStrength: 'LOCAL_SHA256',
        verifiedAt: 1_787_000_000_000,
      },
    ],
    ...overrides,
  };
}

export function integrityFixture(repairable = true): IntegrityOverview {
  return {
    health: {
      complete: 0,
      partial: 0,
      pending: 0,
      missing: 0,
      corrupt: 1,
      unavailable: 0,
      authRequired: 0,
    },
    channels: [],
    media: [],
    issues: repairable
      ? [
          {
            copyId: LIBRARY_IDS.copy,
            mediaItemId: LIBRARY_IDS.media,
            mediaTitle: 'A durable local archive',
            channelId: LIBRARY_IDS.channel,
            channelTitle: 'Archive Studio',
            destinationId: LIBRARY_IDS.destination,
            destinationType: 'FILESYSTEM',
            copyStatus: 'CORRUPT',
            destinationAvailability: 'AVAILABLE',
            health: 'CORRUPT',
            lastCheckedAt: 1_787_000_000_000,
            safeMessage: 'The stored hash no longer matches this local copy.',
            repairSources: [
              {
                copyId: LIBRARY_IDS.sourceCopy,
                destinationId: '00000000-0000-4000-8000-000000000109',
                destinationType: 'GOOGLE_DRIVE',
                verificationStrength: 'PROVIDER_METADATA_SIZE',
                preferred: true,
              },
            ],
            youtubeFallbackAvailable: true,
          },
        ]
      : [],
    history: [],
  };
}

export function installLibraryApi(
  overrides: Partial<Window['ytbm']> = {},
): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listChannels: vi.fn(async () => [libraryChannel]),
    queryLibrary: vi.fn(async () => libraryResult),
    queryPlaylists: vi.fn(async () => playlistResult),
    queryPlaylistMembers: vi.fn(async () => memberResult),
    getMediaBackupDetails: vi.fn(async () => mediaDetailsFixture()),
    getIntegrityOverview: vi.fn(async () => integrityFixture()),
    startIntegrity: vi.fn(async () => ({
      runId: LIBRARY_IDS.run,
      plannedChecks: 1,
      status: 'PENDING' as const,
    })),
    startRepair: vi.fn(async () => ({
      runId: LIBRARY_IDS.run,
      targetCopyId: LIBRARY_IDS.copy,
      source: 'GOOGLE_DRIVE' as const,
      status: 'PENDING' as const,
      plannedJobs: 1,
    })),
    openVerifiedCopyFolder: vi.fn(async () => ({ status: 'OPENED' as const })),
    openGoogleDriveObject: vi.fn(async () => ({ status: 'OPENED' as const })),
    ...overrides,
  };
  Object.defineProperty(window, 'ytbm', {
    configurable: true,
    value: api as unknown as Window['ytbm'],
  });
  return api as unknown as Record<string, ReturnType<typeof vi.fn>>;
}
