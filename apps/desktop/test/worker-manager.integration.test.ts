import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { waitForWorkerEndpointRelease } from '../src/main/worker-manager';

const servers: Server[] = [];
const socketPaths: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const path of socketPaths.splice(0)) await rm(path, { force: true });
});

function endpoint(): string {
  const identity = crypto.randomUUID();
  if (process.platform === 'win32') return `\\\\.\\pipe\\ytbm-worker-release-${identity}`;
  const path = join(tmpdir(), `ytbm-worker-release-${identity}.sock`);
  socketPaths.push(path);
  return path;
}

async function listen(server: Server, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

describe('DesktopWorkerManager shutdown coordination', () => {
  it('waits for the worker singleton endpoint instead of only the RPC disconnect', async () => {
    const path = endpoint();
    const server = createServer((socket) => socket.destroy());
    servers.push(server);
    await listen(server, path);

    const release = waitForWorkerEndpointRelease(path, 2_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });

    await expect(release).resolves.toBeUndefined();
  });

  it('fails with a bounded diagnostic when the worker never releases its endpoint', async () => {
    const path = endpoint();
    const server = createServer((socket) => socket.destroy());
    servers.push(server);
    await listen(server, path);

    await expect(waitForWorkerEndpointRelease(path, 100)).rejects.toThrow(
      /did not release its process lock/,
    );
  });
});
