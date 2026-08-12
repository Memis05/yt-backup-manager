import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hashFileSha256, verifyFileSha256 } from '../src';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('streaming SHA-256', () => {
  it('hashes a known fixture without loading it as one application buffer', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-hash-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'fixture.bin');
    await writeFile(path, 'abc');

    await expect(hashFileSha256(path)).resolves.toEqual({
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      bytes: 3,
    });
  });

  it('streams a large-ish fixture and detects size or content corruption', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-hash-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'fixture.bin');
    await writeFile(path, Buffer.alloc(3 * 1024 * 1024 + 17, 0x5a));
    const progress: number[] = [];
    const expected = await hashFileSha256(path, {
      onProgress: ({ bytesProcessed }) => progress.push(bytesProcessed),
    });

    expect(progress.length).toBeGreaterThan(1);
    await expect(verifyFileSha256(path, expected.sha256, expected.bytes)).resolves.toMatchObject({
      verified: true,
    });
    await expect(
      verifyFileSha256(path, expected.sha256, expected.bytes + 1),
    ).resolves.toMatchObject({
      verified: false,
    });
    await writeFile(path, Buffer.alloc(expected.bytes, 0x59));
    await expect(verifyFileSha256(path, expected.sha256, expected.bytes)).resolves.toMatchObject({
      verified: false,
    });
  });

  it('does not produce a completed hash when interrupted mid-stream', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-hash-interrupt-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'fixture.bin');
    const bytes = 5 * 1024 * 1024;
    await writeFile(path, Buffer.alloc(bytes, 0x2a));
    const controller = new AbortController();
    let processed = 0;

    await expect(
      hashFileSha256(path, {
        signal: controller.signal,
        onProgress: (progress) => {
          processed = progress.bytesProcessed;
          controller.abort(new Error('hash interrupted'));
        },
      }),
    ).rejects.toThrow();
    expect(processed).toBeGreaterThan(0);
    expect(processed).toBeLessThan(bytes);
  });
});
