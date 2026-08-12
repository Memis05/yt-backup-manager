import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyManagedBinaryIntegrity } from '../src/main/managed-binary-integrity';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('packaged managed binary integrity', () => {
  it('rejects bytes that do not match the hash embedded in application code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-managed-binary-'));
    directories.push(directory);
    const path = join(directory, 'yt-dlp.exe');
    await writeFile(path, 'tampered');

    await expect(
      verifyManagedBinaryIntegrity([{ name: 'yt-dlp', path, expectedSha256: '0'.repeat(64) }]),
    ).rejects.toThrow(/integrity check/);
  });
});
