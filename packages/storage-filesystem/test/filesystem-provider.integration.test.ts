import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashFileSha256 } from '@ytbm/integrity';
import type { StoredFilesystemDestination, VolumeIdentityProvider } from '@ytbm/storage-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilesystemStorageProvider } from '../src';

const temporaryDirectories: string[] = [];
const volumes: VolumeIdentityProvider = {
  identify: async (path) => ({
    volumeGuid: 'volume-fixture',
    volumeSerial: 'serial-fixture',
    filesystemType: 'fixturefs',
    mountPath: path,
  }),
  findMount: async () => null,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function destination(rootPath: string): StoredFilesystemDestination {
  return {
    id: crypto.randomUUID(),
    rootPath,
    volumeGuid: 'volume-fixture',
    volumeSerial: 'serial-fixture',
    filesystemType: 'fixturefs',
    lastKnownMountPath: rootPath,
  };
}

describe('FilesystemStorageProvider', () => {
  it('does not run volume lookup merely to resolve a destination without stable identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-no-identity-'));
    temporaryDirectories.push(directory);
    const identify = vi.fn();
    const provider = new FilesystemStorageProvider({
      identify,
      findMount: vi.fn(),
    });

    await expect(
      provider.resolveCurrentRoot({
        ...destination(directory),
        volumeGuid: null,
        volumeSerial: null,
        filesystemType: null,
        lastKnownMountPath: null,
      }),
    ).resolves.toBe(directory);
    expect(identify).not.toHaveBeenCalled();
  });

  it('copies through a temporary file, verifies SHA-256, and atomically promotes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-'));
    temporaryDirectories.push(directory);
    const source = join(directory, 'source.bin');
    const root = join(directory, 'destination');
    await writeFile(source, Buffer.alloc(2 * 1024 * 1024 + 5, 0x42));
    await writeFile(join(directory, 'placeholder'), 'x');
    await (await import('node:fs/promises')).mkdir(root);
    const expected = await hashFileSha256(source);
    const progress: number[] = [];
    const provider = new FilesystemStorageProvider(volumes);

    const result = await provider.putFile({
      destination: destination(root),
      sourcePath: source,
      relativePath: 'Channel [UC1]\\Videos\\Title [abc]\\video.webm',
      expectedSha256: expected.sha256,
      expectedBytes: expected.bytes,
      onProgress: (bytes) => progress.push(bytes),
    });

    expect(result.reconciled).toBe(false);
    expect(progress.length).toBeGreaterThan(1);
    expect(await readFile(result.absolutePath)).toEqual(await readFile(source));
    expect((await readdir(join(root, 'Channel [UC1]\\Videos\\Title [abc]'))).sort()).toEqual([
      'video.webm',
    ]);
  });

  it('reconciles an existing correct final file instead of duplicating it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const source = join(directory, 'source.bin');
    await (await import('node:fs/promises')).mkdir(root);
    await writeFile(source, 'verified fixture');
    const expected = await hashFileSha256(source);
    const provider = new FilesystemStorageProvider(volumes);
    const input = {
      destination: destination(root),
      sourcePath: source,
      relativePath: 'video.mp4',
      expectedSha256: expected.sha256,
      expectedBytes: expected.bytes,
    };

    await expect(provider.putFile(input)).resolves.toMatchObject({ reconciled: false });
    await expect(provider.putFile(input)).resolves.toMatchObject({ reconciled: true });
    expect(await readdir(root)).toEqual(['video.mp4']);
  });

  it('does not silently overwrite a wrong existing final file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const source = join(directory, 'source.bin');
    await (await import('node:fs/promises')).mkdir(root);
    await writeFile(source, 'expected');
    await writeFile(join(root, 'video.mp4'), 'unrelated');
    const expected = await hashFileSha256(source);
    const provider = new FilesystemStorageProvider(volumes);

    await expect(
      provider.putFile({
        destination: destination(root),
        sourcePath: source,
        relativePath: 'video.mp4',
        expectedSha256: expected.sha256,
        expectedBytes: expected.bytes,
      }),
    ).rejects.toMatchObject({ code: 'COPY_CORRUPT' });
    await expect(readFile(join(root, 'video.mp4'), 'utf8')).resolves.toBe('unrelated');
  });

  it('repairs a wrong existing file through verified atomic replacement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-repair-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const source = join(directory, 'source.bin');
    await mkdir(root);
    await writeFile(source, 'trusted verified repair source');
    await writeFile(join(root, 'video.mp4'), 'corrupt destination bytes');
    const expected = await hashFileSha256(source);
    const provider = new FilesystemStorageProvider(volumes);

    await expect(
      provider.replaceFile({
        destination: destination(root),
        sourcePath: source,
        relativePath: 'video.mp4',
        expectedSha256: expected.sha256,
        expectedBytes: expected.bytes,
      }),
    ).resolves.toMatchObject({ sha256: expected.sha256, bytes: expected.bytes });
    await expect(readFile(join(root, 'video.mp4'), 'utf8')).resolves.toBe(
      'trusted verified repair source',
    );
    expect((await readdir(root)).filter((name) => name !== 'video.mp4')).toEqual([]);
  });

  it('preserves the unhealthy target when repair staging is interrupted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-repair-interrupt-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const source = join(directory, 'source.bin');
    await mkdir(root);
    await writeFile(source, Buffer.alloc(2 * 1024 * 1024, 0x71));
    await writeFile(join(root, 'video.mp4'), 'original corrupt bytes');
    const expected = await hashFileSha256(source);
    const controller = new AbortController();
    const provider = new FilesystemStorageProvider(volumes);

    await expect(
      provider.replaceFile({
        destination: destination(root),
        sourcePath: source,
        relativePath: 'video.mp4',
        expectedSha256: expected.sha256,
        expectedBytes: expected.bytes,
        signal: controller.signal,
        onProgress: () => controller.abort(new Error('repair interrupted')),
      }),
    ).rejects.toThrow('repair interrupted');
    await expect(readFile(join(root, 'video.mp4'), 'utf8')).resolves.toBe('original corrupt bytes');
    expect((await readdir(root)).filter((name) => name !== 'video.mp4')).toEqual([]);
  });

  it('reports a missing destination as disconnected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-'));
    temporaryDirectories.push(directory);
    const provider = new FilesystemStorageProvider({
      identify: async () => null,
      findMount: async () => null,
    });
    await expect(provider.probe(destination(join(directory, 'missing')))).resolves.toMatchObject({
      availability: 'DISCONNECTED',
    });
  });

  it('rejects a copy during preflight when destination capacity is insufficient', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-full-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const source = join(directory, 'source.bin');
    await (await import('node:fs/promises')).mkdir(root);
    await writeFile(source, 'small fixture');
    const expected = await hashFileSha256(source);
    const provider = new FilesystemStorageProvider(volumes);

    await expect(
      provider.putFile({
        destination: destination(root),
        sourcePath: source,
        relativePath: 'video.webm',
        expectedSha256: expected.sha256,
        expectedBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toMatchObject({ code: 'DESTINATION_FULL' });
    await expect(readFile(join(root, 'video.webm'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('surfaces a destination write permission failure without starting a copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-permission-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const source = join(directory, 'source.bin');
    await (await import('node:fs/promises')).mkdir(root);
    await writeFile(source, 'small fixture');
    const expected = await hashFileSha256(source);
    const provider = new FilesystemStorageProvider(volumes, {
      probeWritable: async () => {
        throw Object.assign(new Error('permission fixture'), { code: 'EACCES' });
      },
    });

    await expect(
      provider.putFile({
        destination: destination(root),
        sourcePath: source,
        relativePath: 'video.webm',
        expectedSha256: expected.sha256,
        expectedBytes: expected.bytes,
      }),
    ).rejects.toMatchObject({ code: 'DESTINATION_READ_ONLY' });
  });

  it('does not promote a final file when interrupted during local copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-interrupt-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const source = join(directory, 'source.bin');
    await (await import('node:fs/promises')).mkdir(root);
    await writeFile(source, Buffer.alloc(3 * 1024 * 1024, 0x31));
    const expected = await hashFileSha256(source);
    const controller = new AbortController();
    const provider = new FilesystemStorageProvider(volumes);

    await expect(
      provider.putFile({
        destination: destination(root),
        sourcePath: source,
        relativePath: 'video.webm',
        expectedSha256: expected.sha256,
        expectedBytes: expected.bytes,
        signal: controller.signal,
        onProgress: () => controller.abort(new Error('copy interrupted')),
      }),
    ).rejects.toThrow('copy interrupted');
    await expect(readFile(join(root, 'video.webm'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(root)).some((name) => name.endsWith('.ytbm-tmp'))).toBe(false);
  });

  it('rejects destination junctions that redirect a planned copy outside the root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-junction-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const outside = join(directory, 'outside');
    const source = join(directory, 'source.bin');
    await Promise.all([mkdir(root), mkdir(outside), writeFile(source, 'expected')]);
    await symlink(outside, join(root, 'redirect'), 'junction');
    const expected = await hashFileSha256(source);
    const provider = new FilesystemStorageProvider(volumes);

    await expect(
      provider.putFile({
        destination: destination(root),
        sourcePath: source,
        relativePath: 'redirect\\video.webm',
        expectedSha256: expected.sha256,
        expectedBytes: expected.bytes,
      }),
    ).rejects.toThrow(/symbolic link|junction|reparse point/i);
    await expect(readFile(join(outside, 'video.webm'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks safely when the destination disconnects after preflight', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-disconnect-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const source = join(directory, 'source.bin');
    await (await import('node:fs/promises')).mkdir(root);
    await writeFile(source, 'fixture');
    const expected = await hashFileSha256(source);
    let identityCalls = 0;
    const provider = new FilesystemStorageProvider({
      identify: async (path) => {
        identityCalls += 1;
        return identityCalls <= 2
          ? {
              volumeGuid: 'volume-fixture',
              volumeSerial: 'serial-fixture',
              filesystemType: 'fixturefs',
              mountPath: path,
            }
          : null;
      },
      findMount: async () => null,
    });

    await expect(
      provider.putFile({
        destination: destination(root),
        sourcePath: source,
        relativePath: 'video.webm',
        expectedSha256: expected.sha256,
        expectedBytes: expected.bytes,
      }),
    ).rejects.toMatchObject({ code: 'DESTINATION_DISCONNECTED', disposition: 'BLOCK' });
    await expect(readFile(join(root, 'video.webm'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks without promoting a final file when the destination disconnects during copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-copy-mid-disconnect-'));
    temporaryDirectories.push(directory);
    const root = join(directory, 'destination');
    const source = join(directory, 'source.bin');
    await (await import('node:fs/promises')).mkdir(root);
    await writeFile(source, Buffer.alloc(2 * 1024 * 1024, 0x2a));
    const expected = await hashFileSha256(source);
    const provider = new FilesystemStorageProvider();

    await expect(
      provider.putFile({
        destination: destination(root),
        sourcePath: source,
        relativePath: 'video.webm',
        expectedSha256: expected.sha256,
        expectedBytes: expected.bytes,
        onProgress: () => {
          throw Object.assign(new Error('device removed fixture'), { code: 'ENODEV' });
        },
      }),
    ).rejects.toMatchObject({ code: 'DESTINATION_DISCONNECTED', disposition: 'BLOCK' });
    await expect(readFile(join(root, 'video.webm'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
