import {
  AccountDtoSchema,
  AccountsListResultSchema,
  AppSettingsSchema,
  ApplicationInfoSchema,
  CatalogQuerySchema,
  ChannelDtoSchema,
  ChannelsListResultSchema,
  DatabaseHealthSchema,
  FoundationStatusSchema,
  LibraryQueryResultSchema,
  OAuthBeginResultSchema,
  OAuthBeginWorkerResultSchema,
  OAuthFlowDtoSchema,
  PlaylistMembersQuerySchema,
  PlaylistMembersResultSchema,
  PlaylistQueryResultSchema,
  PlaylistQuerySchema,
  RendererSettingsPatchSchema,
  SettingsPatchSchema,
  SourceSyncJobDtoSchema,
  WorkerHealthSchema,
} from '@ytbm/core';
import { z } from 'zod';

const EmptyParamsSchema = z.object({}).strict();

export const WorkerRpcContracts = {
  'worker.health': {
    params: EmptyParamsSchema,
    result: WorkerHealthSchema,
  },
  'worker.scheduledWake': {
    params: z.object({ requestedAt: z.string().datetime() }).strict(),
    result: z.object({ accepted: z.literal(true) }).strict(),
  },
  'worker.shutdownIfIdle': {
    params: EmptyParamsSchema,
    result: z.object({ accepted: z.boolean() }).strict(),
  },
  'app.info': {
    params: EmptyParamsSchema,
    result: ApplicationInfoSchema,
  },
  'database.health': {
    params: EmptyParamsSchema,
    result: DatabaseHealthSchema,
  },
  'settings.get': {
    params: EmptyParamsSchema,
    result: AppSettingsSchema,
  },
  'settings.update': {
    params: SettingsPatchSchema,
    result: AppSettingsSchema,
  },
  'accounts.oauthBegin': {
    params: z.object({ accountId: z.string().uuid().nullable() }).strict(),
    result: OAuthBeginWorkerResultSchema,
  },
  'accounts.oauthConfigure': {
    params: z
      .object({
        clientId: z.string().min(1).max(300).nullable(),
        clientSecret: z.string().min(1).max(300).nullable(),
      })
      .strict(),
    result: z.object({ configured: z.boolean() }).strict(),
  },
  'accounts.oauthStatus': {
    params: z.object({ flowId: z.string().uuid() }).strict(),
    result: OAuthFlowDtoSchema,
  },
  'accounts.list': {
    params: EmptyParamsSchema,
    result: AccountsListResultSchema,
  },
  'accounts.disconnect': {
    params: z.object({ accountId: z.string().uuid() }).strict(),
    result: AccountDtoSchema,
  },
  'channels.discover': {
    params: z.object({ accountId: z.string().uuid() }).strict(),
    result: ChannelsListResultSchema,
  },
  'channels.list': {
    params: z
      .object({ accountId: z.string().uuid().nullable(), selectedOnly: z.boolean() })
      .strict(),
    result: ChannelsListResultSchema,
  },
  'channels.setEnabled': {
    params: z.object({ channelId: z.string().uuid(), enabled: z.boolean() }).strict(),
    result: ChannelDtoSchema,
  },
  'sync.start': {
    params: z.object({ channelId: z.string().uuid() }).strict(),
    result: SourceSyncJobDtoSchema,
  },
  'sync.status': {
    params: z.object({ syncId: z.string().uuid() }).strict(),
    result: SourceSyncJobDtoSchema,
  },
  'library.query': {
    params: CatalogQuerySchema,
    result: LibraryQueryResultSchema,
  },
  'playlists.query': {
    params: PlaylistQuerySchema,
    result: PlaylistQueryResultSchema,
  },
  'playlists.members': {
    params: PlaylistMembersQuerySchema,
    result: PlaylistMembersResultSchema,
  },
} as const;

export type WorkerRpcMethod = keyof typeof WorkerRpcContracts;
export type WorkerRpcParams<Method extends WorkerRpcMethod> = z.input<
  (typeof WorkerRpcContracts)[Method]['params']
>;
export type WorkerRpcParsedParams<Method extends WorkerRpcMethod> = z.output<
  (typeof WorkerRpcContracts)[Method]['params']
>;
export type WorkerRpcResult<Method extends WorkerRpcMethod> = z.output<
  (typeof WorkerRpcContracts)[Method]['result']
>;

export const RPC_ERROR_CODES = [
  'INVALID_REQUEST',
  'METHOD_NOT_FOUND',
  'UNAUTHORIZED',
  'INTERNAL_ERROR',
  'CONNECTION_ERROR',
  'TIMEOUT',
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export class RpcProtocolError extends Error {
  public constructor(
    public readonly code: RpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RpcProtocolError';
  }
}

const RpcRequestEnvelopeSchema = z
  .object({
    id: z.string().uuid(),
    authToken: z.string().min(1).max(256),
    method: z.string().min(1).max(100),
    params: z.unknown(),
  })
  .strict();

export interface ParsedWorkerRpcRequest<Method extends WorkerRpcMethod = WorkerRpcMethod> {
  id: string;
  authToken: string;
  method: Method;
  params: WorkerRpcParsedParams<Method>;
}

export function isWorkerRpcMethod(value: string): value is WorkerRpcMethod {
  return Object.hasOwn(WorkerRpcContracts, value);
}

export function parseWorkerRpcRequest(input: unknown): ParsedWorkerRpcRequest {
  const envelopeResult = RpcRequestEnvelopeSchema.safeParse(input);
  if (!envelopeResult.success) {
    throw new RpcProtocolError('INVALID_REQUEST', 'Worker RPC request is invalid');
  }

  const envelope = envelopeResult.data;
  if (!isWorkerRpcMethod(envelope.method)) {
    throw new RpcProtocolError('METHOD_NOT_FOUND', 'Worker RPC method is not allowed');
  }

  const contract = WorkerRpcContracts[envelope.method];
  const paramsResult = contract.params.safeParse(envelope.params);
  if (!paramsResult.success) {
    throw new RpcProtocolError('INVALID_REQUEST', 'Worker RPC parameters are invalid');
  }

  return {
    id: envelope.id,
    authToken: envelope.authToken,
    method: envelope.method,
    params: paramsResult.data,
  } as ParsedWorkerRpcRequest;
}

export const RpcResponseEnvelopeSchema = z.discriminatedUnion('ok', [
  z
    .object({
      id: z.string().uuid(),
      ok: z.literal(true),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      id: z.string().uuid(),
      ok: z.literal(false),
      error: z
        .object({
          code: z.enum(RPC_ERROR_CODES),
          message: z.string().min(1).max(500),
        })
        .strict(),
    })
    .strict(),
]);

export type RpcResponseEnvelope = z.infer<typeof RpcResponseEnvelopeSchema>;

export const DESKTOP_IPC_CHANNELS = {
  foundationStatus: 'ytbm:foundation-status',
  updateSettings: 'ytbm:settings-update',
  openLogFolder: 'ytbm:logs-open',
  beginGoogleOAuth: 'ytbm:accounts-oauth-begin',
  oauthStatus: 'ytbm:accounts-oauth-status',
  accountsList: 'ytbm:accounts-list',
  disconnectAccount: 'ytbm:accounts-disconnect',
  discoverChannels: 'ytbm:channels-discover',
  channelsList: 'ytbm:channels-list',
  setChannelEnabled: 'ytbm:channels-enabled',
  startSync: 'ytbm:sync-start',
  syncStatus: 'ytbm:sync-status',
  libraryQuery: 'ytbm:library-query',
  playlistsQuery: 'ytbm:playlists-query',
  playlistMembers: 'ytbm:playlists-members',
} as const;

export type DesktopIpcChannel = (typeof DESKTOP_IPC_CHANNELS)[keyof typeof DESKTOP_IPC_CHANNELS];

const DesktopIpcContracts = {
  [DESKTOP_IPC_CHANNELS.foundationStatus]: {
    input: EmptyParamsSchema,
    output: FoundationStatusSchema,
  },
  [DESKTOP_IPC_CHANNELS.updateSettings]: {
    input: RendererSettingsPatchSchema,
    output: AppSettingsSchema,
  },
  [DESKTOP_IPC_CHANNELS.openLogFolder]: {
    input: EmptyParamsSchema,
    output: z.object({ opened: z.literal(true) }).strict(),
  },
  [DESKTOP_IPC_CHANNELS.beginGoogleOAuth]: {
    input: z.object({ accountId: z.string().uuid().nullable() }).strict(),
    output: OAuthBeginResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.oauthStatus]: {
    input: z.object({ flowId: z.string().uuid() }).strict(),
    output: OAuthFlowDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.accountsList]: {
    input: EmptyParamsSchema,
    output: AccountsListResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.disconnectAccount]: {
    input: z.object({ accountId: z.string().uuid() }).strict(),
    output: AccountDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.discoverChannels]: {
    input: z.object({ accountId: z.string().uuid() }).strict(),
    output: ChannelsListResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.channelsList]: {
    input: z
      .object({ accountId: z.string().uuid().nullable(), selectedOnly: z.boolean() })
      .strict(),
    output: ChannelsListResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.setChannelEnabled]: {
    input: z.object({ channelId: z.string().uuid(), enabled: z.boolean() }).strict(),
    output: ChannelDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.startSync]: {
    input: z.object({ channelId: z.string().uuid() }).strict(),
    output: SourceSyncJobDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.syncStatus]: {
    input: z.object({ syncId: z.string().uuid() }).strict(),
    output: SourceSyncJobDtoSchema,
  },
  [DESKTOP_IPC_CHANNELS.libraryQuery]: {
    input: CatalogQuerySchema,
    output: LibraryQueryResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.playlistsQuery]: {
    input: PlaylistQuerySchema,
    output: PlaylistQueryResultSchema,
  },
  [DESKTOP_IPC_CHANNELS.playlistMembers]: {
    input: PlaylistMembersQuerySchema,
    output: PlaylistMembersResultSchema,
  },
} as const;

export function isDesktopIpcChannel(value: string): value is DesktopIpcChannel {
  return Object.hasOwn(DesktopIpcContracts, value);
}

export function parseDesktopIpcInput(channel: string, input: unknown): unknown {
  if (!isDesktopIpcChannel(channel)) {
    throw new RpcProtocolError('METHOD_NOT_FOUND', 'Desktop IPC channel is not allowed');
  }
  const parsed = DesktopIpcContracts[channel].input.safeParse(input);
  if (!parsed.success) {
    throw new RpcProtocolError('INVALID_REQUEST', 'Desktop IPC input is invalid');
  }
  return parsed.data;
}

export function parseDesktopIpcOutput(channel: DesktopIpcChannel, output: unknown): unknown {
  return DesktopIpcContracts[channel].output.parse(output);
}
