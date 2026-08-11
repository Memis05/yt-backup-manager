import { rm } from 'node:fs/promises';
import { createConnection, createServer, type Server } from 'node:net';

export class WorkerAlreadyRunningError extends Error {
  public constructor() {
    super('A worker already owns this user profile');
    this.name = 'WorkerAlreadyRunningError';
  }
}

export interface WorkerSingleton {
  acquire(): Promise<void>;
  release(): Promise<void>;
}

export class NamedPipeWorkerSingleton implements WorkerSingleton {
  private server: Server | null = null;

  public constructor(private readonly endpoint: string) {}

  public async acquire(): Promise<void> {
    if (this.server !== null) return;

    try {
      this.server = await this.listen();
      return;
    } catch (error) {
      if (!(error instanceof WorkerAlreadyRunningError) || process.platform === 'win32') {
        throw error;
      }
    }

    if (await this.endpointIsActive()) {
      throw new WorkerAlreadyRunningError();
    }
    await rm(this.endpoint, { force: true });
    this.server = await this.listen();
  }

  public async release(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server !== null && server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
    if (process.platform !== 'win32') {
      await rm(this.endpoint, { force: true });
    }
  }

  private async listen(): Promise<Server> {
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening);
        if (error.code === 'EADDRINUSE') {
          reject(new WorkerAlreadyRunningError());
          return;
        }
        reject(error);
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.endpoint);
    });
    return server;
  }

  private async endpointIsActive(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = createConnection(this.endpoint);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }
}
