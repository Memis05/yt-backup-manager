import { rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';

import { tokensMatch } from '@ytbm/security';

import {
  RpcProtocolError,
  WorkerRpcContracts,
  parseWorkerRpcRequest,
  type ParsedWorkerRpcRequest,
  type RpcErrorCode,
  type WorkerRpcMethod,
  type WorkerRpcParsedParams,
  type WorkerRpcResult,
} from './contracts';

const MAX_MESSAGE_BYTES = 64 * 1024;

export type WorkerRpcHandlers = {
  [Method in WorkerRpcMethod]: (
    params: WorkerRpcParsedParams<Method>,
  ) => Promise<WorkerRpcResult<Method>> | WorkerRpcResult<Method>;
};

function failure(id: string, code: RpcErrorCode, message: string): string {
  return `${JSON.stringify({ id, ok: false, error: { code, message } })}\n`;
}

export class WorkerRpcServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();

  public constructor(
    private readonly endpoint: string,
    private readonly authToken: string,
    private readonly handlers: WorkerRpcHandlers,
  ) {}

  public async start(): Promise<void> {
    if (this.server !== null) return;
    if (process.platform !== 'win32') {
      await rm(this.endpoint, { force: true });
    }

    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once('error', onError);
      server.listen(this.endpoint, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });
    this.server = server;
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
    if (process.platform !== 'win32') {
      await rm(this.endpoint, { force: true });
    }
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
        socket.write(failure(crypto.randomUUID(), 'INVALID_REQUEST', 'RPC message is too large'));
        socket.destroy();
        return;
      }

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) void this.handleLine(socket, line);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => this.sockets.delete(socket));
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      socket.write(
        failure(crypto.randomUUID(), 'INVALID_REQUEST', 'RPC request is not valid JSON'),
      );
      return;
    }

    let request: ParsedWorkerRpcRequest;
    try {
      request = parseWorkerRpcRequest(raw);
    } catch (error) {
      const id = this.extractRequestId(raw);
      const protocolError =
        error instanceof RpcProtocolError
          ? error
          : new RpcProtocolError('INVALID_REQUEST', 'Worker RPC request is invalid');
      socket.write(failure(id, protocolError.code, protocolError.message));
      return;
    }

    if (!tokensMatch(this.authToken, request.authToken)) {
      socket.write(failure(request.id, 'UNAUTHORIZED', 'Worker RPC authentication failed'));
      return;
    }

    try {
      const result = await this.dispatch(request);
      socket.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    } catch {
      socket.write(failure(request.id, 'INTERNAL_ERROR', 'Worker RPC method failed'));
    }
  }

  private async dispatch(request: ParsedWorkerRpcRequest): Promise<unknown> {
    const handler = this.handlers[request.method] as (
      params: unknown,
    ) => Promise<unknown> | unknown;
    const result = await handler(request.params);
    return WorkerRpcContracts[request.method].result.parse(result);
  }

  private extractRequestId(raw: unknown): string {
    if (
      raw !== null &&
      typeof raw === 'object' &&
      'id' in raw &&
      typeof raw.id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(raw.id)
    ) {
      return raw.id;
    }
    return crypto.randomUUID();
  }
}
