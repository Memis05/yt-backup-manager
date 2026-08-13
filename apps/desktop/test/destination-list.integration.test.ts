import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppSettingsSchema, DEFAULT_APP_SETTINGS } from '@ytbm/core';
import {
  LocalBackupRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
} from '@ytbm/database/worker';
import { MemoryLogSink, StructuredLogger } from '@ytbm/security';
import type { StorageProvider } from '@ytbm/storage-core';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalBackupRuntime } from '../src/worker-bootstrap/backup-runtime';

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('destination list snapshots', () => {
  it('returns persisted destination state without waiting for a live provider probe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-destination-list-'));
    directories.push(directory);
    const database = openWorkerDatabase({
      databasePath: join(directory, 'app.db'),
      ownership: acquireWorkerDatabaseOwnership(),
    });
    try {
      const repository = new LocalBackupRepository(database);
      const destination = repository.addDestination({
        rootPath: join(directory, 'backup'),
        identity: null,
        availabilityStatus: 'DISCONNECTED',
        lastErrorCode: 'DESTINATION_DISCONNECTED',
      });
      let probeCalls = 0;
      const storage: StorageProvider = {
        type: 'FILESYSTEM',
        probe: async () => {
          probeCalls += 1;
          throw new Error('Destination listing must not perform a live provider probe');
        },
        putFile: async () => {
          throw new Error('Not used by this test');
        },
        resolveCurrentRoot: async () => null,
      };
      const runtime = new LocalBackupRuntime({
        workerId: crypto.randomUUID(),
        database,
        stagingRoot: join(directory, 'staging'),
        ytDlpExecutable: join(directory, 'yt-dlp.exe'),
        ffmpegExecutable: join(directory, 'ffmpeg.exe'),
        logger: new StructuredLogger('destination-list-test', new MemoryLogSink()),
        settings: async () => AppSettingsSchema.parse(DEFAULT_APP_SETTINGS),
        storage,
      });

      await expect(runtime.listDestinations()).resolves.toEqual([
        expect.objectContaining({
          id: destination.id,
          destinationType: 'FILESYSTEM',
          availabilityStatus: 'DISCONNECTED',
          availableBytes: null,
          totalBytes: null,
        }),
      ]);
      expect(probeCalls).toBe(0);
    } finally {
      database.close();
    }
  });
});
