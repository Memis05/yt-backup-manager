import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { StoredGoogleDriveDestination } from '@ytbm/storage-core';
import { afterEach, describe, expect, it } from 'vitest';

import { GoogleDriveStorageProvider } from '../src';

const CHUNK_BYTES = 256 * 1024;
const directories: string[] = [];
const destination: StoredGoogleDriveDestination = {
  id: '00000000-0000-4000-8000-000000000001',
  accountId: '00000000-0000-4000-8000-000000000002',
  providerRootId: 'root_123',
};

interface FakeObject {
  id: string;
  name: string;
  bytes: number;
  parents: string[];
  appProperties: Record<string, string>;
  content: Buffer;
}

interface FakeSession {
  id: string;
  acknowledged: number;
  metadata: { name: string; parents?: string[]; appProperties: Record<string, string> };
  expired: boolean;
}

interface UploadCheckpoint {
  sessionUri: string;
  bytesAcknowledged: number;
  providerFileId: string | null;
}

class FakeDriveEndpoint {
  public readonly objects = new Map<string, FakeObject>();
  public readonly sessions = new Map<string, FakeSession>();
  public failAtOffset: number | null = null;
  public loseFinalResponse = false;
  public authorizationStatuses: number[] = [];
  public requestCount = 0;
  private sequence = 0;

  public readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    this.requestCount += 1;
    const forcedStatus = this.authorizationStatuses.shift();
    if (forcedStatus !== undefined) return new Response('{}', { status: forcedStatus });
    expect(new Headers(init?.headers).get('Authorization')).toMatch(/^Bearer token-/);
    const url = new URL(input.toString());
    const method = init?.method ?? 'GET';

    if (url.pathname === '/drive/v3/about') {
      return Response.json({ storageQuota: { limit: '1000000', usage: '250000' } });
    }

    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const query = decodeURIComponent(url.searchParams.get('q') ?? '');
      const key = /value='([^']+)'/.exec(query)?.[1];
      const object = [...this.objects.values()].find(
        (candidate) => candidate.appProperties.ytbmObjectKey === key,
      );
      return Response.json({ files: object === undefined ? [] : [this.metadata(object)] });
    }

    const statMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (statMatch !== null && method === 'GET' && url.searchParams.get('alt') !== 'media') {
      const object = this.objects.get(statMatch[1]!);
      return object === undefined
        ? new Response('{}', { status: 404 })
        : Response.json(this.metadata(object));
    }

    if (statMatch !== null && method === 'GET' && url.searchParams.get('alt') === 'media') {
      const object = this.objects.get(statMatch[1]!);
      if (object === undefined) return new Response('{}', { status: 404 });
      const range = new Headers(init?.headers).get('range');
      const offset = range === null ? 0 : Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0);
      const responseBytes = Uint8Array.from(object.content.subarray(offset)).buffer as ArrayBuffer;
      return new Response(responseBytes, {
        status: offset > 0 ? 206 : 200,
        headers:
          offset > 0
            ? { 'content-range': `bytes ${offset}-${object.bytes - 1}/${object.bytes}` }
            : {},
      });
    }

    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const metadata = JSON.parse(String(init?.body)) as FakeSession['metadata'];
      const id = `session_${++this.sequence}`;
      this.sessions.set(id, { id, acknowledged: 0, metadata, expired: false });
      return new Response('', {
        status: 200,
        headers: { location: `https://fake.test/session/${id}` },
      });
    }

    const sessionMatch = /^\/session\/(session_\d+)$/.exec(url.pathname);
    if (sessionMatch !== null && method === 'PUT') {
      const session = this.sessions.get(sessionMatch[1]!);
      if (session === undefined || session.expired) return new Response('{}', { status: 410 });
      const contentRange = new Headers(init?.headers).get('content-range') ?? '';
      if (contentRange.startsWith('bytes */')) {
        return new Response('', {
          status: 308,
          headers:
            session.acknowledged === 0 ? {} : { range: `bytes=0-${session.acknowledged - 1}` },
        });
      }
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
      if (match === null) return new Response('{}', { status: 400 });
      const start = Number(match[1]);
      const end = Number(match[2]);
      const total = Number(match[3]);
      if (this.failAtOffset === start) {
        this.failAtOffset = null;
        throw new TypeError('simulated network loss');
      }
      session.acknowledged = end + 1;
      if (session.acknowledged < total) {
        return new Response('', { status: 308, headers: { range: `bytes=0-${end}` } });
      }
      const object: FakeObject = {
        id: `file_${++this.sequence}`,
        name: session.metadata.name,
        bytes: total,
        parents: session.metadata.parents ?? [],
        appProperties: session.metadata.appProperties,
        content: Buffer.alloc(total, 0x61),
      };
      this.objects.set(object.id, object);
      if (this.loseFinalResponse) {
        this.loseFinalResponse = false;
        throw new TypeError('simulated lost final response');
      }
      return Response.json(this.metadata(object));
    }

    throw new Error(`Unexpected fake Drive request: ${method} ${url.toString()}`);
  }) as typeof fetch;

  private metadata(object: FakeObject): Record<string, unknown> {
    return {
      id: object.id,
      name: object.name,
      mimeType: 'video/mp4',
      size: String(object.bytes),
      parents: object.parents,
      appProperties: object.appProperties,
      modifiedTime: '2026-08-12T00:00:00.000Z',
    };
  }
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function sourceFixture(
  chunks = 10,
): Promise<{ path: string; bytes: number; sha256: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-drive-provider-'));
  directories.push(directory);
  const content = Buffer.alloc(CHUNK_BYTES * chunks, 0x61);
  const path = join(directory, 'source.mp4');
  await writeFile(path, content);
  return {
    path,
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

function uploadInput(
  source: Awaited<ReturnType<typeof sourceFixture>>,
  checkpoint: {
    sessionUri: string;
    bytesAcknowledged: number;
    providerFileId: string | null;
  } | null,
  onCheckpoint: (value: {
    sessionUri: string;
    bytesAcknowledged: number;
    providerFileId: string | null;
  }) => void,
) {
  return {
    destination,
    sourcePath: source.path,
    parentProviderId: 'parent_123',
    name: 'Fixture [media123].mp4',
    mimeType: 'video/mp4',
    expectedSha256: source.sha256,
    expectedBytes: source.bytes,
    appProperties: { ytbmObjectKey: 'media:media123', sha256: source.sha256 },
    knownProviderFileId: null,
    resumableState: checkpoint,
    onCheckpoint,
  };
}

describe('Google Drive storage provider', () => {
  for (const percentage of [10, 50, 90]) {
    it(`resumes one object without duplicate bytes after interruption at ${percentage}%`, async () => {
      const endpoint = new FakeDriveEndpoint();
      const source = await sourceFixture();
      endpoint.failAtOffset = (percentage / 10) * CHUNK_BYTES;
      let checkpoint: {
        sessionUri: string;
        bytesAcknowledged: number;
        providerFileId: string | null;
      } | null = null;
      const provider = new GoogleDriveStorageProvider(
        { getAccessToken: async () => 'token-1' },
        {
          apiRoot: 'https://fake.test/drive/v3',
          uploadRoot: 'https://fake.test/upload/drive/v3',
          chunkBytes: CHUNK_BYTES,
          fetch: endpoint.fetch,
        },
      );

      await expect(
        provider.putFile(uploadInput(source, checkpoint, (next) => (checkpoint = next))),
      ).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
      const persistedCheckpoint = checkpoint as unknown as UploadCheckpoint;
      expect(persistedCheckpoint.bytesAcknowledged).toBe((percentage / 10) * CHUNK_BYTES);

      const completed = await provider.putFile(
        uploadInput(source, persistedCheckpoint, (next) => (checkpoint = next)),
      );
      expect(completed.bytes).toBe(source.bytes);
      expect(endpoint.objects).toHaveLength(1);
      await expect(
        provider.putFile({
          ...uploadInput(source, null, () => undefined),
          knownProviderFileId: completed.providerFileId,
        }),
      ).resolves.toMatchObject({ providerFileId: completed.providerFileId, reconciled: true });
      expect(endpoint.objects).toHaveLength(1);
    });
  }

  it('reconciles a committed object after the final provider response is lost', async () => {
    const endpoint = new FakeDriveEndpoint();
    endpoint.loseFinalResponse = true;
    const source = await sourceFixture(2);
    let checkpoint = null as {
      sessionUri: string;
      bytesAcknowledged: number;
      providerFileId: string | null;
    } | null;
    const provider = new GoogleDriveStorageProvider(
      { getAccessToken: async () => 'token-1' },
      {
        apiRoot: 'https://fake.test/drive/v3',
        uploadRoot: 'https://fake.test/upload/drive/v3',
        chunkBytes: CHUNK_BYTES,
        fetch: endpoint.fetch,
      },
    );

    await expect(
      provider.putFile(uploadInput(source, checkpoint, (next) => (checkpoint = next))),
    ).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
    await expect(
      provider.putFile(uploadInput(source, checkpoint, (next) => (checkpoint = next))),
    ).resolves.toMatchObject({ reconciled: true });
    expect(endpoint.objects).toHaveLength(1);
  });

  it('restarts an expired resumable session without creating duplicate objects', async () => {
    const endpoint = new FakeDriveEndpoint();
    const source = await sourceFixture(3);
    endpoint.failAtOffset = CHUNK_BYTES;
    let checkpoint = null as {
      sessionUri: string;
      bytesAcknowledged: number;
      providerFileId: string | null;
    } | null;
    const provider = new GoogleDriveStorageProvider(
      { getAccessToken: async () => 'token-1' },
      {
        apiRoot: 'https://fake.test/drive/v3',
        uploadRoot: 'https://fake.test/upload/drive/v3',
        chunkBytes: CHUNK_BYTES,
        fetch: endpoint.fetch,
      },
    );
    await expect(
      provider.putFile(uploadInput(source, checkpoint, (next) => (checkpoint = next))),
    ).rejects.toMatchObject({ code: 'NETWORK_UNAVAILABLE' });
    endpoint.sessions.get(new URL(checkpoint!.sessionUri).pathname.split('/').at(-1)!)!.expired =
      true;

    await expect(
      provider.putFile(uploadInput(source, checkpoint, (next) => (checkpoint = next))),
    ).resolves.toMatchObject({ bytes: source.bytes });
    expect(endpoint.sessions.size).toBe(2);
    expect(endpoint.objects).toHaveLength(1);
  });

  it('refreshes once after 401 and reports capacity without exposing credentials', async () => {
    const endpoint = new FakeDriveEndpoint();
    endpoint.authorizationStatuses.push(401);
    const tokenCalls: boolean[] = [];
    const provider = new GoogleDriveStorageProvider(
      {
        getAccessToken: async (_accountId, forceRefresh) => {
          tokenCalls.push(forceRefresh === true);
          return forceRefresh === true ? 'token-refreshed' : 'token-initial';
        },
      },
      { apiRoot: 'https://fake.test/drive/v3', fetch: endpoint.fetch },
    );

    await expect(provider.getCapacity(destination)).resolves.toEqual({
      totalBytes: 1_000_000,
      availableBytes: 750_000,
    });
    expect(tokenCalls).toEqual([false, true]);
  });

  it('classifies Drive storage quota exhaustion as a non-retryable full destination', async () => {
    const provider = new GoogleDriveStorageProvider(
      { getAccessToken: async () => 'token-1' },
      {
        apiRoot: 'https://fake.test/drive/v3',
        fetch: (async () =>
          Response.json(
            { error: { errors: [{ reason: 'storageQuotaExceeded' }] } },
            { status: 403 },
          )) as typeof fetch,
      },
    );

    await expect(provider.getCapacity(destination)).rejects.toMatchObject({
      code: 'DESTINATION_FULL',
      disposition: 'FAIL',
    });
    await expect(provider.probe(destination)).resolves.toMatchObject({
      availability: 'FULL',
      availableBytes: 0,
    });
  });

  it('resumes a ranged Drive download and verifies SHA-256 before publishing it', async () => {
    const endpoint = new FakeDriveEndpoint();
    const source = await sourceFixture(2);
    endpoint.objects.set('file_download', {
      id: 'file_download',
      name: 'Fixture.mp4',
      bytes: source.bytes,
      parents: ['parent_123'],
      appProperties: { ytbmObjectKey: 'media:download', sha256: source.sha256 },
      content: Buffer.alloc(source.bytes, 0x61),
    });
    const target = join(dirnameOf(source.path), 'download.mp4');
    await writeFile(`${target}.ytbm-drive-part`, Buffer.alloc(CHUNK_BYTES, 0x61));
    const provider = new GoogleDriveStorageProvider(
      { getAccessToken: async () => 'token-1' },
      { apiRoot: 'https://fake.test/drive/v3', fetch: endpoint.fetch },
    );

    await expect(
      provider.getFile({
        destination,
        providerFileId: 'file_download',
        destinationPath: target,
        expectedBytes: source.bytes,
        expectedSha256: source.sha256,
      }),
    ).resolves.toMatchObject({ bytes: source.bytes, sha256: source.sha256 });
    expect(await readFile(target)).toEqual(Buffer.alloc(source.bytes, 0x61));
  });

  it('lists app-created recovery objects with pagination and bounds sidecar reads', async () => {
    const requestedUrls: URL[] = [];
    const provider = new GoogleDriveStorageProvider(
      { getAccessToken: async () => 'token-recovery' },
      {
        apiRoot: 'https://fake.test/drive/v3',
        fetch: (async (input, init) => {
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-recovery');
          const url = new URL(input.toString());
          requestedUrls.push(url);
          if (url.pathname.endsWith('/files')) {
            return Response.json({
              files: [
                {
                  id: 'root_recovery_123',
                  name: 'Renamed root',
                  mimeType: 'application/vnd.google-apps.folder',
                  parents: [],
                  appProperties: {
                    ytbmSchemaVersion: '1',
                    ytbmObjectKey: 'root',
                    ytbmObjectType: 'backup-root',
                  },
                  modifiedTime: '2026-08-12T00:00:00.000Z',
                },
              ],
              nextPageToken: 'next-page',
            });
          }
          return new Response('0123456789', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as typeof fetch,
      },
    );

    await expect(
      provider.listRecoveryObjects({ destination, pageToken: 'prior-page' }),
    ).resolves.toMatchObject({
      objects: [{ providerFileId: 'root_recovery_123', name: 'Renamed root' }],
      nextPageToken: 'next-page',
    });
    expect(requestedUrls[0]?.searchParams.get('pageToken')).toBe('prior-page');
    expect(requestedUrls[0]?.searchParams.get('q')).toContain("key='ytbmSchemaVersion'");
    expect(requestedUrls[0]?.searchParams.get('fields')).toContain('files(id,name,mimeType');
    await expect(
      provider.getTextContent({
        destination,
        providerFileId: 'sidecar_123',
        maximumBytes: 5,
      }),
    ).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
  });
});

function dirnameOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
}
