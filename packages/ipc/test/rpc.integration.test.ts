import { randomBytes, randomUUID } from 'node:crypto';
import { AppSettingsSchema } from '@ytbm/core';
import { describe, expect, it } from 'vitest';

import { WorkerRpcClient, WorkerRpcServer, type WorkerRpcHandlers } from '../src';

function endpoint(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\ytbm-rpc-test-${randomUUID()}`;
  return `/tmp/ytbm-rpc-test-${randomUUID()}.sock`;
}

const instanceId = randomUUID();
const defaultSettings = {
  startWithWindows: false,
  startMinimized: false,
  checkForUpdates: true,
  defaultQualityProfile: 'UP_TO_1080P' as const,
  concurrentDownloads: 2,
  concurrentLocalCopies: 2,
  concurrentDriveUploads: 2,
  notifications: {
    backupComplete: true,
    backupErrors: true,
    destinationDisconnected: true,
    authenticationRequired: true,
    integrityProblems: true,
  },
};
const handlers: WorkerRpcHandlers = {
  'worker.health': () => ({
    status: 'READY',
    instanceId,
    mode: 'DIRECT',
    startedAt: '2026-08-11T00:00:00.000Z',
    uptimeMs: 100,
  }),
  'worker.scheduledWake': () => ({ accepted: true }),
  'worker.shutdownIfIdle': () => ({ accepted: true }),
  'app.info': () => ({
    name: 'YouTube Backup Manager',
    version: '0.1.0',
    environment: 'test',
    platform: process.platform,
    arch: process.arch,
  }),
  'database.health': () => ({
    status: 'READY',
    schemaVersion: 1,
    foreignKeysEnabled: true,
    journalMode: 'wal',
  }),
  'settings.get': () => defaultSettings,
  'settings.update': (settings) => AppSettingsSchema.parse({ ...defaultSettings, ...settings }),
};

describe('authenticated worker RPC transport', () => {
  it('validates authentication and reconnects after a worker restart', async () => {
    const pipe = endpoint();
    const token = randomBytes(32).toString('hex');
    const server = new WorkerRpcServer(pipe, token, handlers);
    const client = new WorkerRpcClient(pipe, token);
    await server.start();

    await expect(client.request('worker.health', {})).resolves.toMatchObject({ instanceId });

    client.close();
    await server.stop();
    await server.start();
    await expect(client.request('database.health', {})).resolves.toMatchObject({
      foreignKeysEnabled: true,
    });

    client.close();
    await server.stop();
  });

  it('rejects a client with the wrong local authentication token', async () => {
    const pipe = endpoint();
    const server = new WorkerRpcServer(pipe, randomBytes(32).toString('hex'), handlers);
    const client = new WorkerRpcClient(pipe, randomBytes(32).toString('hex'));
    await server.start();

    await expect(client.request('worker.health', {})).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    client.close();
    await server.stop();
  });
});
