import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { NamedPipeWorkerSingleton, WorkerAlreadyRunningError } from '../src';

function testEndpoint(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\ytbm-singleton-test-${randomUUID()}`;
  }
  return `/tmp/ytbm-singleton-test-${randomUUID()}.sock`;
}

describe('NamedPipeWorkerSingleton', () => {
  it('allows exactly one worker to own a user-scoped endpoint', async () => {
    const endpoint = testEndpoint();
    const first = new NamedPipeWorkerSingleton(endpoint);
    const second = new NamedPipeWorkerSingleton(endpoint);

    await first.acquire();
    await expect(second.acquire()).rejects.toBeInstanceOf(WorkerAlreadyRunningError);
    await first.release();
    await expect(second.acquire()).resolves.toBeUndefined();
    await second.release();
  });
});
