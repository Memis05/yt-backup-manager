import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseChannelManifest,
  parseMediaMetadata,
  parsePlaylistSidecar,
  serializeDeterministicJson,
  writeJsonAtomic,
} from '../src';

const temporaryDirectories: string[] = [];
const sha256 = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('recovery sidecar schemas', () => {
  it('parses media metadata independently with stable IDs, relative identity, and hash', () => {
    expect(
      parseMediaMetadata({
        schemaVersion: 1,
        provider: 'YOUTUBE',
        providerMediaId: 'abc123',
        channelId: 'UC123',
        channelTitle: 'Channel',
        currentTitle: 'Current',
        originalTitle: 'Original',
        sourceUrl: 'https://www.youtube.com/watch?v=abc123',
        mediaType: 'VIDEO',
        sourceStatus: 'AVAILABLE',
        selectedQualityProfile: 'MAX_1080P',
        container: 'webm',
        bytes: 42,
        sha256,
        downloadedAt: 1,
        verifiedAt: 2,
        playlistIds: ['PL1'],
      }),
    ).toMatchObject({ providerMediaId: 'abc123', sha256 });
  });

  it('keeps one media archive when multiple playlists reference it', () => {
    const manifest = parseChannelManifest({
      schemaVersion: 1,
      provider: 'YOUTUBE',
      providerChannelId: 'UC123',
      channelTitle: 'Channel',
      updatedAt: 1,
      media: [
        {
          providerMediaId: 'abc123',
          mediaType: 'VIDEO',
          mediaDirectory: 'Videos/Title [abc123]',
          mediaFile: 'Videos/Title [abc123]/video.webm',
          metadataFile: 'Videos/Title [abc123]/metadata.json',
          bytes: 42,
          sha256,
        },
      ],
      playlists: [
        {
          providerPlaylistId: 'PL1',
          playlistFile: 'Playlists/One [PL1]/playlist.json',
          mediaIds: ['abc123'],
        },
        {
          providerPlaylistId: 'PL2',
          playlistFile: 'Playlists/Two [PL2]/playlist.json',
          mediaIds: ['abc123'],
        },
      ],
    });
    expect(manifest.media).toHaveLength(1);
    expect(manifest.playlists.flatMap((playlist) => playlist.mediaIds)).toEqual([
      'abc123',
      'abc123',
    ]);
  });

  it('parses playlist sidecars independently', () => {
    expect(
      parsePlaylistSidecar({
        schemaVersion: 1,
        provider: 'YOUTUBE',
        providerPlaylistId: 'PL1',
        channelId: 'UC1',
        title: 'Playlist',
        sourceStatus: 'AVAILABLE',
        updatedAt: 1,
        items: [{ providerMediaId: 'abc', position: 0 }],
      }),
    ).toMatchObject({ providerPlaylistId: 'PL1' });
  });

  it('rejects unsupported manifest versions safely', () => {
    expect(() => parseChannelManifest({ schemaVersion: 2 })).toThrow();
  });
});

describe('deterministic atomic JSON', () => {
  it('serializes object keys deterministically', () => {
    expect(serializeDeterministicJson({ z: 1, a: { d: 2, b: 1 } })).toBe(
      '{\n  "a": {\n    "b": 1,\n    "d": 2\n  },\n  "z": 1\n}\n',
    );
  });

  it('atomically replaces a prior valid JSON file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-manifest-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'manifest.json');
    await writeFile(path, '{"schemaVersion":1}\n');
    await writeJsonAtomic(path, { schemaVersion: 1, provider: 'YOUTUBE' });

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      provider: 'YOUTUBE',
      schemaVersion: 1,
    });
  });

  it('keeps the previous canonical manifest valid when a replacement cannot be serialized', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-manifest-interrupt-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'manifest.json');
    const previous = { schemaVersion: 1, provider: 'YOUTUBE', generation: 'previous' };
    await writeJsonAtomic(path, previous);

    await expect(writeJsonAtomic(path, { schemaVersion: 1, unsupported: 1n })).rejects.toThrow();

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(previous);
  });
});
