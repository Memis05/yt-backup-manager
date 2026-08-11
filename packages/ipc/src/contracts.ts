import {
  AppSettingsSchema,
  ApplicationInfoSchema,
  DatabaseHealthSchema,
  FoundationStatusSchema,
  RendererSettingsPatchSchema,
  SettingsPatchSchema,
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
} as const;

export type WorkerRpcMethod = keyof typeof WorkerRpcContracts;
export type WorkerRpcParams<Method extends WorkerRpcMethod> = z.input<
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
  params: WorkerRpcParams<Method>;
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
