import {
  ChannelManifestSchema,
  ManifestVersionSchema,
  MediaMetadataSchema,
  PlaylistSidecarSchema,
} from '@ytbm/manifest';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseRecoveryManifestVersion(value: unknown) {
  const input = record(value);
  return ManifestVersionSchema.parse({
    schemaVersion: input.schemaVersion,
    provider: input.provider,
  });
}

export function parseRecoveryChannelManifest(value: unknown) {
  const input = record(value);
  return ChannelManifestSchema.parse({
    schemaVersion: input.schemaVersion,
    provider: input.provider,
    providerChannelId: input.providerChannelId,
    channelTitle: input.channelTitle,
    updatedAt: input.updatedAt,
    media: array(input.media).map((entry) => {
      const item = record(entry);
      return {
        providerMediaId: item.providerMediaId,
        mediaType: item.mediaType,
        mediaDirectory: item.mediaDirectory,
        mediaFile: item.mediaFile,
        metadataFile: item.metadataFile,
        ...(item.thumbnailFile === undefined ? {} : { thumbnailFile: item.thumbnailFile }),
        bytes: item.bytes,
        sha256: item.sha256,
      };
    }),
    playlists: array(input.playlists).map((entry) => {
      const item = record(entry);
      return {
        providerPlaylistId: item.providerPlaylistId,
        playlistFile: item.playlistFile,
        mediaIds: item.mediaIds,
      };
    }),
  });
}

export function parseRecoveryMediaMetadata(value: unknown) {
  const input = record(value);
  return MediaMetadataSchema.parse({
    schemaVersion: input.schemaVersion,
    provider: input.provider,
    providerMediaId: input.providerMediaId,
    channelId: input.channelId,
    channelTitle: input.channelTitle,
    currentTitle: input.currentTitle,
    originalTitle: input.originalTitle,
    sourceUrl: input.sourceUrl,
    mediaType: input.mediaType,
    sourceStatus: input.sourceStatus,
    ...(input.publishedAt === undefined ? {} : { publishedAt: input.publishedAt }),
    ...(input.duration === undefined ? {} : { duration: input.duration }),
    selectedQualityProfile: input.selectedQualityProfile,
    container: input.container,
    ...(input.videoCodec === undefined ? {} : { videoCodec: input.videoCodec }),
    ...(input.audioCodec === undefined ? {} : { audioCodec: input.audioCodec }),
    ...(input.width === undefined ? {} : { width: input.width }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(input.fps === undefined ? {} : { fps: input.fps }),
    bytes: input.bytes,
    sha256: input.sha256,
    downloadedAt: input.downloadedAt,
    verifiedAt: input.verifiedAt,
    ...(input.lastSourceSyncAt === undefined ? {} : { lastSourceSyncAt: input.lastSourceSyncAt }),
    playlistIds: input.playlistIds,
  });
}

export function parseRecoveryPlaylist(value: unknown) {
  const input = record(value);
  return PlaylistSidecarSchema.parse({
    schemaVersion: input.schemaVersion,
    provider: input.provider,
    providerPlaylistId: input.providerPlaylistId,
    channelId: input.channelId,
    title: input.title,
    sourceStatus: input.sourceStatus,
    updatedAt: input.updatedAt,
    items: array(input.items).map((entry) => {
      const item = record(entry);
      return { providerMediaId: item.providerMediaId, position: item.position };
    }),
  });
}
