import { z } from 'zod';

import { MediaTypeSchema, QualityProfileSchema, SourceStatusSchema } from '@ytbm/core';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const MediaMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('YOUTUBE'),
    providerMediaId: z.string().min(1),
    channelId: z.string().min(1),
    channelTitle: z.string().min(1),
    currentTitle: z.string().min(1),
    originalTitle: z.string().min(1),
    sourceUrl: z.string().url(),
    mediaType: MediaTypeSchema,
    sourceStatus: SourceStatusSchema,
    publishedAt: z.number().int().nonnegative().optional(),
    duration: z.number().int().nonnegative().optional(),
    selectedQualityProfile: QualityProfileSchema,
    container: z.string().min(1),
    videoCodec: z.string().min(1).optional(),
    audioCodec: z.string().min(1).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
    bytes: z.number().int().nonnegative(),
    sha256: Sha256Schema,
    downloadedAt: z.number().int().nonnegative(),
    verifiedAt: z.number().int().nonnegative(),
    lastSourceSyncAt: z.number().int().nonnegative().optional(),
    playlistIds: z.array(z.string().min(1)),
  })
  .strict();

export const PlaylistSidecarSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('YOUTUBE'),
    providerPlaylistId: z.string().min(1),
    channelId: z.string().min(1),
    title: z.string().min(1),
    sourceStatus: SourceStatusSchema,
    updatedAt: z.number().int().nonnegative(),
    items: z.array(
      z
        .object({
          providerMediaId: z.string().min(1),
          position: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const ManifestMediaEntrySchema = z
  .object({
    providerMediaId: z.string().min(1),
    mediaType: MediaTypeSchema,
    mediaDirectory: z.string().min(1),
    mediaFile: z.string().min(1),
    metadataFile: z.string().min(1),
    thumbnailFile: z.string().min(1).optional(),
    bytes: z.number().int().nonnegative(),
    sha256: Sha256Schema,
  })
  .strict();

export const ManifestPlaylistEntrySchema = z
  .object({
    providerPlaylistId: z.string().min(1),
    playlistFile: z.string().min(1),
    mediaIds: z.array(z.string().min(1)),
  })
  .strict();

export const ChannelManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('YOUTUBE'),
    providerChannelId: z.string().min(1),
    channelTitle: z.string().min(1),
    updatedAt: z.number().int().nonnegative(),
    media: z.array(ManifestMediaEntrySchema),
    playlists: z.array(ManifestPlaylistEntrySchema),
  })
  .strict();

export const ManifestVersionSchema = z
  .object({ schemaVersion: z.literal(1), provider: z.literal('YOUTUBE') })
  .strict();

export function parseMediaMetadata(value: unknown): z.infer<typeof MediaMetadataSchema> {
  return MediaMetadataSchema.parse(value);
}

export function parsePlaylistSidecar(value: unknown): z.infer<typeof PlaylistSidecarSchema> {
  return PlaylistSidecarSchema.parse(value);
}

export function parseChannelManifest(value: unknown): z.infer<typeof ChannelManifestSchema> {
  return ChannelManifestSchema.parse(value);
}

export type MediaMetadata = z.infer<typeof MediaMetadataSchema>;
export type PlaylistSidecar = z.infer<typeof PlaylistSidecarSchema>;
export type ChannelManifest = z.infer<typeof ChannelManifestSchema>;
