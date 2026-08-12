import { z } from 'zod';

import {
  AccountConnectionStateSchema,
  MediaTypeSchema,
  OAuthFlowStatusSchema,
  SourceErrorCodeSchema,
  SourceStatusSchema,
  SourceSyncStatusSchema,
} from './enums';

const EpochMillisecondsSchema = z.number().int().nonnegative();
const NullableEpochMillisecondsSchema = EpochMillisecondsSchema.nullable();
const NullableUrlSchema = z.string().url().nullable();
const NullableStringSchema = z.string().nullable();

export const AccountCapabilitiesSchema = z
  .object({
    youtubeReadonly: z.boolean(),
    grantedScopes: z.array(z.string()).max(20),
  })
  .strict();

export const AccountDtoSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.literal('GOOGLE'),
    providerAccountId: z.string().min(1),
    email: z.string().email().nullable(),
    displayName: NullableStringSchema,
    avatarUrl: NullableUrlSchema,
    connectionState: AccountConnectionStateSchema,
    capabilities: AccountCapabilitiesSchema,
    connectedAt: EpochMillisecondsSchema,
    lastAuthAt: NullableEpochMillisecondsSchema,
    lastErrorCode: SourceErrorCodeSchema.nullable(),
  })
  .strict();

export const ChannelDtoSchema = z
  .object({
    id: z.string().uuid(),
    providerChannelId: z.string().min(1),
    title: z.string().min(1),
    handle: NullableStringSchema,
    thumbnailUrl: NullableUrlSchema,
    backupEnabled: z.boolean(),
    sourceStatus: SourceStatusSchema,
    publishedAt: NullableEpochMillisecondsSchema,
    lastSyncAt: NullableEpochMillisecondsSchema,
    accessibleAccountIds: z.array(z.string().uuid()),
    videosCount: z.number().int().nonnegative(),
    shortsCount: z.number().int().nonnegative(),
    liveCount: z.number().int().nonnegative(),
    syncStatus: SourceSyncStatusSchema.nullable(),
  })
  .strict();

export const MediaLibraryItemDtoSchema = z
  .object({
    id: z.string().uuid(),
    providerMediaId: z.string().min(1),
    channelId: z.string().uuid(),
    channelTitle: z.string().min(1),
    title: z.string().min(1),
    originalTitle: z.string().min(1),
    sourceUrl: z.string().url(),
    sourceStatus: SourceStatusSchema,
    mediaType: MediaTypeSchema,
    publishedAt: NullableEpochMillisecondsSchema,
    durationSeconds: z.number().int().nonnegative().nullable(),
    thumbnailUrl: NullableUrlSchema,
    firstSeenAt: EpochMillisecondsSchema,
    lastSeenAt: NullableEpochMillisecondsSchema,
    playlistTitles: z.array(z.string()),
  })
  .strict();

export const PlaylistDtoSchema = z
  .object({
    id: z.string().uuid(),
    providerPlaylistId: z.string().min(1),
    channelId: z.string().uuid(),
    channelTitle: z.string().min(1),
    title: z.string().min(1),
    sourceStatus: SourceStatusSchema,
    mediaCount: z.number().int().nonnegative(),
    lastSeenAt: NullableEpochMillisecondsSchema,
    removedAt: NullableEpochMillisecondsSchema,
  })
  .strict();

export const PlaylistMemberDtoSchema = z
  .object({
    position: z.number().int().nonnegative().nullable(),
    media: MediaLibraryItemDtoSchema,
  })
  .strict();

export const AccountsListResultSchema = z.object({ accounts: z.array(AccountDtoSchema) }).strict();
export const ChannelsListResultSchema = z.object({ channels: z.array(ChannelDtoSchema) }).strict();

export const OAuthBeginWorkerResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('STARTED'),
      flowId: z.string().uuid(),
      authorizationUrl: z.string().url(),
      expiresAt: EpochMillisecondsSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('UNAVAILABLE'),
      errorCode: z.literal('OAUTH_CONFIGURATION_REQUIRED'),
      safeMessage: z.string().min(1).max(300),
    })
    .strict(),
]);

export const OAuthBeginResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('STARTED'),
      flowId: z.string().uuid(),
      expiresAt: EpochMillisecondsSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('UNAVAILABLE'),
      errorCode: z.literal('OAUTH_CONFIGURATION_REQUIRED'),
      safeMessage: z.string().min(1).max(300),
    })
    .strict(),
]);

export const OAuthFlowDtoSchema = z
  .object({
    flowId: z.string().uuid(),
    status: OAuthFlowStatusSchema,
    expiresAt: EpochMillisecondsSchema,
    account: AccountDtoSchema.nullable(),
    errorCode: SourceErrorCodeSchema.nullable(),
    safeMessage: z.string().max(300).nullable(),
  })
  .strict();

export const SourceSyncJobDtoSchema = z
  .object({
    id: z.string().uuid(),
    channelId: z.string().uuid(),
    status: SourceSyncStatusSchema,
    phase: z.enum(['QUEUED', 'MEDIA', 'PLAYLISTS', 'RECONCILING', 'COMPLETE', 'FAILED']),
    progressRatio: z.number().min(0).max(1).nullable(),
    errorCode: SourceErrorCodeSchema.nullable(),
    safeMessage: z.string().max(300).nullable(),
    nextRetryAt: NullableEpochMillisecondsSchema,
    createdAt: EpochMillisecondsSchema,
    updatedAt: EpochMillisecondsSchema,
  })
  .strict();

export const CatalogQuerySchema = z
  .object({
    search: z.string().trim().max(200).default(''),
    channelId: z.string().uuid().nullable().default(null),
    mediaType: MediaTypeSchema.nullable().default(null),
    sourceStatus: SourceStatusSchema.nullable().default(null),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(40),
  })
  .strict();

export const LibraryQueryResultSchema = z
  .object({
    items: z.array(MediaLibraryItemDtoSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();

export const PlaylistQuerySchema = z
  .object({
    channelId: z.string().uuid().nullable().default(null),
    search: z.string().trim().max(200).default(''),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(40),
  })
  .strict();

export const PlaylistQueryResultSchema = z
  .object({
    items: z.array(PlaylistDtoSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();

export const PlaylistMembersQuerySchema = z
  .object({
    playlistId: z.string().uuid(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(40),
  })
  .strict();

export const PlaylistMembersResultSchema = z
  .object({
    items: z.array(PlaylistMemberDtoSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .strict();

export type AccountCapabilities = z.infer<typeof AccountCapabilitiesSchema>;
export type AccountDto = z.infer<typeof AccountDtoSchema>;
export type ChannelDto = z.infer<typeof ChannelDtoSchema>;
export type MediaLibraryItemDto = z.infer<typeof MediaLibraryItemDtoSchema>;
export type PlaylistDto = z.infer<typeof PlaylistDtoSchema>;
export type PlaylistMemberDto = z.infer<typeof PlaylistMemberDtoSchema>;
export type OAuthBeginWorkerResult = z.infer<typeof OAuthBeginWorkerResultSchema>;
export type OAuthBeginResult = z.infer<typeof OAuthBeginResultSchema>;
export type OAuthFlowDto = z.infer<typeof OAuthFlowDtoSchema>;
export type SourceSyncJobDto = z.infer<typeof SourceSyncJobDtoSchema>;
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;
export type LibraryQueryResult = z.infer<typeof LibraryQueryResultSchema>;
export type PlaylistQuery = z.infer<typeof PlaylistQuerySchema>;
export type PlaylistQueryResult = z.infer<typeof PlaylistQueryResultSchema>;
export type PlaylistMembersQuery = z.infer<typeof PlaylistMembersQuerySchema>;
export type PlaylistMembersResult = z.infer<typeof PlaylistMembersResultSchema>;
