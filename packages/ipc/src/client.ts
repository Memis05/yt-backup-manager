import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';

import {
  RpcProtocolError,
  RpcResponseEnvelopeSchema,
  WorkerRpcContracts,
  type RpcResponseEnvelope,
  type WorkerRpcMethod,
  type WorkerRpcParams,
  type WorkerRpcResult,
} from './contracts';

interface PendingRequest {
  method: WorkerRpcMethod;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export interface WorkerRpcClientOptions {
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
}

export interface WorkerRpcRequestOptions {
  timeoutMs?: number;
}

export class WorkerRpcClient {
  private socket: Socket | null = null;
  private connectPromise: Promise<void> | null = null;
  private buffer = '';
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  public constructor(
    private readonly endpoint: string,
    private readonly authToken: string,
    options: WorkerRpcClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2_000;
  }

  public async request<Method extends WorkerRpcMethod>(
    method: Method,
    params: WorkerRpcParams<Method>,
    options: WorkerRpcRequestOptions = {},
  ): Promise<WorkerRpcResult<Method>> {
    const contract = WorkerRpcContracts[method];
    const validatedParams = contract.params.parse(params);
    await this.ensureConnected();

    const socket = this.socket;
    if (socket === null || socket.destroyed) {
      throw new RpcProtocolError('CONNECTION_ERROR', 'Worker RPC connection is unavailable');
    }

    const id = randomUUID();
    const response = new Promise<WorkerRpcResult<Method>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcProtocolError('TIMEOUT', 'Worker RPC request timed out'));
      }, options.timeoutMs ?? this.requestTimeoutMs);
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as WorkerRpcResult<Method>),
        reject,
        timeout,
      });
    });

    socket.write(
      `${JSON.stringify({ id, authToken: this.authToken, method, params: validatedParams })}\n`,
    );
    return response;
  }

  public async waitUntilConnected(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let delay = 50;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await this.ensureConnected();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 500);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new RpcProtocolError('CONNECTION_ERROR', 'Worker did not become available');
  }

  public close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.connectPromise = null;
    this.rejectPending(new RpcProtocolError('CONNECTION_ERROR', 'Worker RPC client closed'));
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket !== null && !this.socket.destroyed) return;
    if (this.connectPromise !== null) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = connect(this.endpoint);
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new RpcProtocolError('CONNECTION_ERROR', 'Worker RPC connection timed out'));
      }, this.connectTimeoutMs);

      socket.setEncoding('utf8');
      socket.once('connect', () => {
        clearTimeout(timeout);
        this.socket = socket;
        this.bindSocket(socket);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(new RpcProtocolError('CONNECTION_ERROR', error.message));
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private bindSocket(socket: Socket): void {
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (line.length > 0) this.handleResponse(line);
        newline = this.buffer.indexOf('\n');
      }
    });
    socket.on('close', () => this.handleDisconnect(socket));
    socket.on('error', () => this.handleDisconnect(socket));
  }

  private handleResponse(line: string): void {
    let response: RpcResponseEnvelope;
    try {
      response = RpcResponseEnvelopeSchema.parse(JSON.parse(line) as unknown);
    } catch {
      this.rejectPending(new RpcProtocolError('INVALID_REQUEST', 'Worker RPC response is invalid'));
      return;
    }

    const pending = this.pending.get(response.id);
    if (pending === undefined) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);

    if (!response.ok) {
      pending.reject(new RpcProtocolError(response.error.code, response.error.message));
      return;
    }

    try {
      pending.resolve(WorkerRpcContracts[pending.method].result.parse(response.result));
    } catch {
      pending.reject(new RpcProtocolError('INVALID_REQUEST', 'Worker RPC result is invalid'));
    }
  }

  private handleDisconnect(socket: Socket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.buffer = '';
    this.rejectPending(new RpcProtocolError('CONNECTION_ERROR', 'Worker RPC connection closed'));
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }
}
