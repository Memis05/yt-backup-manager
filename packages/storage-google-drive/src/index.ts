import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat as fileStat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { BackupOperationError } from '@ytbm/core';
import type {
  DestinationProbe,
  EnsureGoogleDriveFolderInput,
  EnsureGoogleDriveFolderResult,
  GetGoogleDriveFileInput,
  GetGoogleDriveFileResult,
  GoogleDriveCapacityInfo,
  GoogleDriveObjectRef,
  GoogleDriveRecoveryObjectPage,
  GoogleDriveObjectStat,
  GoogleDriveResumableState,
  GoogleDriveStorageProvider as GoogleDriveStorageProviderContract,
  PutGoogleDriveContentInput,
  PutGoogleDriveFileInput,
  PutGoogleDriveFileResult,
  StoredGoogleDriveDestination,
  GetGoogleDriveTextContentInput,
  ListGoogleDriveRecoveryObjectsInput,
} from '@ytbm/storage-core';

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{3,500}$/;

export const GOOGLE_DRIVE_ROOT_NAME = 'YouTube Backup Manager';
export const GOOGLE_DRIVE_FOLDER_MIME = DRIVE_FOLDER_MIME;

export interface GoogleDriveAccessTokenProvider {
  getAccessToken(accountId: string, forceRefresh?: boolean): Promise<string>;
  markDriveAuthorizationInvalid?(accountId: string): Promise<void>;
}

export interface GoogleDriveStorageProviderOptions {
  apiRoot?: string;
  uploadRoot?: string;
  fetch?: typeof fetch;
  chunkBytes?: number;
  now?: () => number;
}

interface DriveFileResponse {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  size?: unknown;
  parents?: unknown;
  appProperties?: unknown;
  modifiedTime?: unknown;
}

interface DriveListResponse {
  files?: unknown;
  nextPageToken?: unknown;
}

class ResumableSessionExpiredError extends Error {
  public constructor() {
    super('Google Drive resumable session expired');
    this.name = 'ResumableSessionExpiredError';
  }
}

function validateProviderId(value: string): string {
  if (!PROVIDER_ID_PATTERN.test(value)) {
    throw new BackupOperationError(
      'PROVIDER_OBJECT_MISSING',
      'Google Drive returned an invalid provider object identity.',
      { disposition: 'FAIL' },
    );
  }
  return value;
}

function safeInteger(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeProperties(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string',
    ),
  );
}

function objectStat(value: DriveFileResponse): GoogleDriveObjectStat {
  const id = typeof value.id === 'string' ? validateProviderId(value.id) : null;
  if (id === null || typeof value.name !== 'string' || typeof value.mimeType !== 'string') {
    throw new BackupOperationError(
      'PROVIDER_5XX',
      'Google Drive returned invalid object metadata.',
      { disposition: 'RETRY' },
    );
  }
  const parents = Array.isArray(value.parents)
    ? value.parents.filter((parent): parent is string => typeof parent === 'string')
    : [];
  return {
    providerFileId: id,
    name: value.name,
    mimeType: value.mimeType,
    bytes: safeInteger(value.size),
    parents,
    appProperties: normalizeProperties(value.appProperties),
    modifiedTime: typeof value.modifiedTime === 'string' ? value.modifiedTime : null,
  };
}

async function responseJson(response: Response): Promise<unknown> {
  const declared = safeInteger(response.headers.get('content-length'));
  if (declared !== null && declared > MAX_JSON_BYTES) {
    throw new BackupOperationError('PROVIDER_5XX', 'Google Drive returned an oversized response.', {
      disposition: 'RETRY',
    });
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) {
    throw new BackupOperationError('PROVIDER_5XX', 'Google Drive returned an oversized response.', {
      disposition: 'RETRY',
    });
  }
  if (text === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BackupOperationError('PROVIDER_5XX', 'Google Drive returned an invalid response.', {
      disposition: 'RETRY',
    });
  }
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : undefined;
}

function retryOptions(response: Response): { disposition: 'RETRY'; retryAfterMs?: number } {
  const delay = retryAfterMs(response);
  return delay === undefined
    ? { disposition: 'RETRY' }
    : { disposition: 'RETRY', retryAfterMs: delay };
}

async function providerError(response: Response): Promise<BackupOperationError> {
  if (response.status === 401) {
    return new BackupOperationError(
      'AUTH_REVOKED',
      'Google Drive authorization is required. Reconnect Drive for this account.',
      { disposition: 'BLOCK' },
    );
  }
  if (response.status === 429) {
    return new BackupOperationError(
      'RATE_LIMITED',
      'Google Drive asked the upload to wait.',
      retryOptions(response),
    );
  }
  if (response.status >= 500) {
    return new BackupOperationError(
      'PROVIDER_5XX',
      'Google Drive is temporarily unavailable.',
      retryOptions(response),
    );
  }
  if (response.status === 403) {
    let reason: string | null = null;
    try {
      const body = (await responseJson(response)) as {
        error?: { errors?: Array<{ reason?: unknown }> };
      };
      const value = body.error?.errors?.[0]?.reason;
      reason = typeof value === 'string' ? value : null;
    } catch {
      // Error bodies are optional and never surfaced verbatim.
    }
    if (reason === 'storageQuotaExceeded') {
      return new BackupOperationError(
        'DESTINATION_FULL',
        'Google Drive does not have enough storage for this backup.',
        { disposition: 'FAIL' },
      );
    }
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
      return new BackupOperationError(
        'RATE_LIMITED',
        'Google Drive asked the upload to wait.',
        retryOptions(response),
      );
    }
    return new BackupOperationError(
      'DESTINATION_PERMISSION_DENIED',
      'Google Drive refused access or has no available storage. Check the account and quota.',
      { disposition: 'FAIL' },
    );
  }
  return new BackupOperationError('UPLOAD_FAILED', 'Google Drive rejected the backup operation.', {
    disposition: response.status >= 408 ? 'RETRY' : 'FAIL',
  });
}

function networkError(cause: unknown): BackupOperationError {
  return new BackupOperationError(
    'NETWORK_UNAVAILABLE',
    'Google Drive could not be reached. The operation will retry when the network is available.',
    { disposition: 'RETRY', cause },
  );
}

function escapeDriveQueryValue(value: string): string {
  if (!/^[A-Za-z0-9:._-]{1,250}$/.test(value)) {
    throw new BackupOperationError(
      'INTERNAL_ERROR',
      'A Google Drive application identity was invalid.',
      { disposition: 'FAIL' },
    );
  }
  return value.replaceAll("'", "\\'");
}

function parseAcknowledgedRange(value: string | null): number {
  if (value === null) return 0;
  const match = /^bytes=0-(\d+)$/.exec(value);
  if (match === null) return 0;
  const end = Number(match[1]);
  return Number.isSafeInteger(end) && end >= 0 ? end + 1 : 0;
}

function mimeForContainer(container: string): string {
  if (container === 'mp4') return 'video/mp4';
  if (container === 'webm') return 'video/webm';
  if (container === 'mkv') return 'video/x-matroska';
  return 'application/octet-stream';
}

export { mimeForContainer as googleDriveMediaMimeType };

export class GoogleDriveStorageProvider implements GoogleDriveStorageProviderContract {
  public readonly type = 'GOOGLE_DRIVE' as const;
  private readonly apiRoot: string;
  private readonly uploadRoot: string;
  private readonly fetcher: typeof fetch;
  private readonly chunkBytes: number;
  private readonly now: () => number;
  private readonly allowedSessionOrigins: ReadonlySet<string>;

  public constructor(
    private readonly tokens: GoogleDriveAccessTokenProvider,
    options: GoogleDriveStorageProviderOptions = {},
  ) {
    this.apiRoot = (options.apiRoot ?? 'https://www.googleapis.com/drive/v3').replace(/\/$/, '');
    this.uploadRoot = (options.uploadRoot ?? 'https://www.googleapis.com/upload/drive/v3').replace(
      /\/$/,
      '',
    );
    this.fetcher = options.fetch ?? fetch;
    this.chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    if (this.chunkBytes <= 0 || this.chunkBytes % (256 * 1024) !== 0) {
      throw new Error('Google Drive upload chunks must be positive multiples of 256 KiB');
    }
    this.now = options.now ?? Date.now;
    this.allowedSessionOrigins = new Set([
      new URL(this.uploadRoot).origin,
      'https://www.googleapis.com',
    ]);
  }

  public async probe(destination: StoredGoogleDriveDestination): Promise<DestinationProbe> {
    try {
      const capacity = await this.getCapacity(destination);
      return {
        availability: 'AVAILABLE',
        availableBytes: capacity.availableBytes,
        totalBytes: capacity.totalBytes,
        identity: null,
        safeMessage: null,
      };
    } catch (error) {
      if (error instanceof BackupOperationError && error.code === 'AUTH_REVOKED') {
        return {
          availability: 'AUTH_REQUIRED',
          availableBytes: null,
          totalBytes: null,
          identity: null,
          safeMessage: error.message,
        };
      }
      if (error instanceof BackupOperationError && error.code === 'DESTINATION_FULL') {
        return {
          availability: 'FULL',
          availableBytes: 0,
          totalBytes: null,
          identity: null,
          safeMessage: error.message,
        };
      }
      if (error instanceof BackupOperationError && error.code === 'DESTINATION_PERMISSION_DENIED') {
        return {
          availability: 'READ_ONLY',
          availableBytes: null,
          totalBytes: null,
          identity: null,
          safeMessage: error.message,
        };
      }
      return {
        availability: 'ERROR',
        availableBytes: null,
        totalBytes: null,
        identity: null,
        safeMessage:
          error instanceof BackupOperationError
            ? error.message
            : 'Google Drive could not be probed.',
      };
    }
  }

  public async getCapacity(
    destination: StoredGoogleDriveDestination,
  ): Promise<GoogleDriveCapacityInfo> {
    const response = await this.authorizedFetch(
      destination,
      `${this.apiRoot}/about?fields=storageQuota(limit%2Cusage)`,
      { method: 'GET' },
    );
    if (!response.ok) throw await providerError(response);
    const body = (await responseJson(response)) as {
      storageQuota?: { limit?: unknown; usage?: unknown };
    };
    const totalBytes = safeInteger(body.storageQuota?.limit);
    const usage = safeInteger(body.storageQuota?.usage);
    return {
      totalBytes,
      availableBytes:
        totalBytes === null || usage === null ? null : Math.max(0, totalBytes - usage),
    };
  }

  public async ensureFolder(
    input: EnsureGoogleDriveFolderInput,
  ): Promise<EnsureGoogleDriveFolderResult> {
    if (input.knownProviderId !== null) {
      const known = await this.stat({
        destination: input.destination,
        providerFileId: input.knownProviderId,
      });
      if (known !== null && known.mimeType === DRIVE_FOLDER_MIME) {
        return {
          providerFolderId: known.providerFileId,
          name: known.name,
          parentProviderId: known.parents[0] ?? null,
          reconciled: true,
        };
      }
    }
    const existing = await this.findByObjectKey(
      input.destination,
      input.appProperties.ytbmObjectKey ?? input.logicalKey,
      DRIVE_FOLDER_MIME,
    );
    if (existing !== null) {
      return {
        providerFolderId: existing.providerFileId,
        name: existing.name,
        parentProviderId: existing.parents[0] ?? null,
        reconciled: true,
      };
    }
    const metadata = {
      name: input.name,
      mimeType: DRIVE_FOLDER_MIME,
      ...(input.parentProviderId === null ? {} : { parents: [input.parentProviderId] }),
      appProperties: input.appProperties,
    };
    const response = await this.authorizedFetch(
      input.destination,
      `${this.apiRoot}/files?fields=id%2Cname%2CmimeType%2Cparents%2CappProperties%2CmodifiedTime`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(metadata),
      },
    );
    if (!response.ok) throw await providerError(response);
    const created = objectStat((await responseJson(response)) as DriveFileResponse);
    return {
      providerFolderId: created.providerFileId,
      name: created.name,
      parentProviderId: created.parents[0] ?? null,
      reconciled: false,
    };
  }

  public async stat(input: GoogleDriveObjectRef): Promise<GoogleDriveObjectStat | null> {
    validateProviderId(input.providerFileId);
    const fields = 'id%2Cname%2CmimeType%2Csize%2Cparents%2CappProperties%2CmodifiedTime';
    const response = await this.authorizedFetch(
      input.destination,
      `${this.apiRoot}/files/${encodeURIComponent(input.providerFileId)}?fields=${fields}`,
      { method: 'GET' },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw await providerError(response);
    return objectStat((await responseJson(response)) as DriveFileResponse);
  }

  public async listRecoveryObjects(
    input: ListGoogleDriveRecoveryObjectsInput,
  ): Promise<GoogleDriveRecoveryObjectPage> {
    const q = [
      'trashed = false',
      "appProperties has { key='ytbmSchemaVersion' and value='1' }",
    ].join(' and ');
    const fields = 'nextPageToken,files(id,name,mimeType,size,parents,appProperties,modifiedTime)';
    const query = new URLSearchParams({
      q,
      spaces: 'drive',
      pageSize: '1000',
      fields,
    });
    if (input.pageToken !== null) {
      if (input.pageToken.length === 0 || input.pageToken.length > 2_000) {
        throw new BackupOperationError(
          'PROVIDER_5XX',
          'Google Drive returned an invalid recovery page token.',
          { disposition: 'RETRY' },
        );
      }
      query.set('pageToken', input.pageToken);
    }
    const response = await this.authorizedFetch(
      input.destination,
      `${this.apiRoot}/files?${query.toString()}`,
      {
        method: 'GET',
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );
    if (!response.ok) throw await providerError(response);
    const body = (await responseJson(response)) as DriveListResponse;
    const objects = Array.isArray(body.files)
      ? body.files.map((entry) => objectStat(entry as DriveFileResponse))
      : [];
    const nextPageToken =
      typeof body.nextPageToken === 'string' && body.nextPageToken.length > 0
        ? body.nextPageToken
        : null;
    return { objects, nextPageToken };
  }

  public async getTextContent(input: GetGoogleDriveTextContentInput): Promise<string> {
    validateProviderId(input.providerFileId);
    if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1) {
      throw new BackupOperationError('MANIFEST_INVALID', 'Recovery JSON size limit is invalid.', {
        disposition: 'FAIL',
      });
    }
    const response = await this.authorizedFetch(
      input.destination,
      `${this.apiRoot}/files/${encodeURIComponent(input.providerFileId)}?alt=media`,
      {
        method: 'GET',
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );
    if (response.status === 404) {
      throw new BackupOperationError(
        'PROVIDER_OBJECT_MISSING',
        'A Google Drive recovery sidecar is missing.',
        { disposition: 'FAIL' },
      );
    }
    if (!response.ok) throw await providerError(response);
    const declared = safeInteger(response.headers.get('content-length'));
    if (declared !== null && declared > input.maximumBytes) {
      throw new BackupOperationError(
        'MANIFEST_INVALID',
        'A Google Drive recovery sidecar exceeds the allowed size.',
        { disposition: 'FAIL' },
      );
    }
    const reader = response.body?.getReader();
    if (reader === undefined) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > input.maximumBytes) {
        await reader.cancel();
        throw new BackupOperationError(
          'MANIFEST_INVALID',
          'A Google Drive recovery sidecar exceeds the allowed size.',
          { disposition: 'FAIL' },
        );
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  public async putFile(input: PutGoogleDriveFileInput): Promise<PutGoogleDriveFileResult> {
    const source = await fileStat(input.sourcePath);
    if (!source.isFile() || source.size !== input.expectedBytes) {
      throw new BackupOperationError(
        'VERIFY_FAILED',
        'The verified upload source no longer matches its expected size.',
        { disposition: 'FAIL' },
      );
    }
    let providerFileId = input.knownProviderFileId;
    if (providerFileId !== null) {
      const known = await this.stat({ destination: input.destination, providerFileId });
      if (this.matchesUpload(known, input)) return this.uploadResult(known!, true);
      if (known === null) providerFileId = null;
    }
    if (providerFileId === null) {
      const existing = await this.findByObjectKey(
        input.destination,
        input.appProperties.ytbmObjectKey ?? '',
      );
      if (this.matchesUpload(existing, input)) return this.uploadResult(existing!, true);
      providerFileId = existing?.providerFileId ?? null;
    }

    let state = input.resumableState;
    if (state !== null) {
      try {
        const reconciled = await this.reconcileSession(input, state);
        if ('completed' in reconciled) return reconciled.completed;
        state = reconciled.state;
      } catch (error) {
        if (!(error instanceof ResumableSessionExpiredError)) throw error;
        const existing = await this.findByObjectKey(
          input.destination,
          input.appProperties.ytbmObjectKey ?? '',
        );
        if (this.matchesUpload(existing, input)) return this.uploadResult(existing!, true);
        state = null;
      }
    }
    if (state === null) state = await this.startSession(input, providerFileId);

    while (state.bytesAcknowledged < input.expectedBytes) {
      try {
        const next = await this.uploadChunk(input, state);
        if ('completed' in next) return next.completed;
        state = next.state;
      } catch (error) {
        if (!(error instanceof ResumableSessionExpiredError)) throw error;
        const existing = await this.findByObjectKey(
          input.destination,
          input.appProperties.ytbmObjectKey ?? '',
        );
        if (this.matchesUpload(existing, input)) return this.uploadResult(existing!, true);
        state = await this.startSession(input, providerFileId);
      }
    }
    const reconciled = await this.reconcileSession(input, state);
    if ('completed' in reconciled) return reconciled.completed;
    throw new BackupOperationError(
      'UPLOAD_FAILED',
      'Google Drive did not confirm the completed upload.',
      { disposition: 'RETRY' },
    );
  }

  public async putContent(input: PutGoogleDriveContentInput): Promise<GoogleDriveObjectStat> {
    let providerFileId = input.knownProviderFileId;
    if (providerFileId !== null) {
      const known = await this.stat({ destination: input.destination, providerFileId });
      if (known === null) providerFileId = null;
    }
    if (providerFileId === null) {
      providerFileId =
        (await this.findByObjectKey(input.destination, input.appProperties.ytbmObjectKey ?? ''))
          ?.providerFileId ?? null;
    }
    const boundary = `ytbm-${randomUUID()}`;
    const metadata = Buffer.from(
      JSON.stringify({
        name: input.name,
        ...(providerFileId === null ? { parents: [input.parentProviderId] } : {}),
        appProperties: input.appProperties,
      }),
      'utf8',
    );
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, 'utf8'),
      metadata,
      Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`, 'utf8'),
      Buffer.from(input.content),
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
    ]);
    const suffix =
      providerFileId === null ? '/files' : `/files/${encodeURIComponent(providerFileId)}`;
    const response = await this.authorizedFetch(
      input.destination,
      `${this.uploadRoot}${suffix}?uploadType=multipart&fields=id%2Cname%2CmimeType%2Csize%2Cparents%2CappProperties%2CmodifiedTime`,
      {
        method: providerFileId === null ? 'POST' : 'PATCH',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );
    if (!response.ok) throw await providerError(response);
    return objectStat((await responseJson(response)) as DriveFileResponse);
  }

  public async getFile(input: GetGoogleDriveFileInput): Promise<GetGoogleDriveFileResult> {
    validateProviderId(input.providerFileId);
    await mkdir(dirname(input.destinationPath), { recursive: true });
    const partialPath = `${input.destinationPath}.ytbm-drive-part`;
    let offset = 0;
    try {
      const partial = await fileStat(partialPath);
      if (partial.isFile() && partial.size <= input.expectedBytes) offset = partial.size;
    } catch {
      // A missing partial starts from zero.
    }
    const headers: Record<string, string> = {};
    if (offset > 0) headers.Range = `bytes=${offset}-`;
    const response = await this.authorizedFetch(
      input.destination,
      `${this.apiRoot}/files/${encodeURIComponent(input.providerFileId)}?alt=media`,
      {
        method: 'GET',
        headers,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );
    if (response.status === 404) {
      throw new BackupOperationError(
        'PROVIDER_OBJECT_MISSING',
        'The Google Drive media object is missing.',
        { disposition: 'FAIL' },
      );
    }
    if (!response.ok) throw await providerError(response);
    if (response.body === null) {
      throw new BackupOperationError('DOWNLOAD_FAILED', 'Google Drive returned no media bytes.', {
        disposition: 'RETRY',
      });
    }
    const append = offset > 0 && response.status === 206;
    if (!append) offset = 0;
    let received = offset;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        input.onProgress?.(received);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body as never),
        counter,
        createWriteStream(partialPath, { flags: append ? 'a' : 'w', mode: 0o600 }),
        { signal: input.signal },
      );
    } catch (error) {
      if (input.signal?.aborted === true) throw error;
      throw networkError(error);
    }
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(partialPath)) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    const sha256 = hash.digest('hex');
    if (bytes !== input.expectedBytes || sha256 !== input.expectedSha256) {
      await rm(partialPath, { force: true });
      throw new BackupOperationError(
        'COPY_CORRUPT',
        'The downloaded Google Drive bytes failed SHA-256 verification.',
        { disposition: 'FAIL' },
      );
    }
    await rename(partialPath, input.destinationPath);
    return { path: input.destinationPath, bytes, sha256 };
  }

  private async authorizedFetch(
    destination: StoredGoogleDriveDestination,
    url: string,
    init: RequestInit,
    forceRefresh = false,
  ): Promise<Response> {
    let token: string;
    try {
      token = await this.tokens.getAccessToken(destination.accountId, forceRefresh);
    } catch (error) {
      throw new BackupOperationError(
        'AUTH_REVOKED',
        'Google Drive authorization is required. Reconnect Drive for this account.',
        { disposition: 'BLOCK', cause: error },
      );
    }
    try {
      const response = await this.fetcher(url, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init.headers).entries()),
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.status === 401 && !forceRefresh) {
        return this.authorizedFetch(destination, url, init, true);
      }
      if (response.status === 401)
        await this.tokens.markDriveAuthorizationInvalid?.(destination.accountId);
      return response;
    } catch (error) {
      if (error instanceof BackupOperationError) throw error;
      throw networkError(error);
    }
  }

  private async findByObjectKey(
    destination: StoredGoogleDriveDestination,
    objectKey: string,
    mimeType?: string,
  ): Promise<GoogleDriveObjectStat | null> {
    const key = escapeDriveQueryValue(objectKey);
    const q = [
      `trashed = false`,
      `appProperties has { key='ytbmObjectKey' and value='${key}' }`,
      ...(mimeType === undefined ? [] : [`mimeType = '${mimeType}'`]),
    ].join(' and ');
    const fields = 'files(id%2Cname%2CmimeType%2Csize%2Cparents%2CappProperties%2CmodifiedTime)';
    const response = await this.authorizedFetch(
      destination,
      `${this.apiRoot}/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=10&fields=${fields}`,
      { method: 'GET' },
    );
    if (!response.ok) throw await providerError(response);
    const body = (await responseJson(response)) as DriveListResponse;
    if (!Array.isArray(body.files) || body.files.length === 0) return null;
    return objectStat(body.files[0] as DriveFileResponse);
  }

  private matchesUpload(
    current: GoogleDriveObjectStat | null,
    input: PutGoogleDriveFileInput,
  ): boolean {
    return (
      current !== null &&
      current.bytes === input.expectedBytes &&
      current.appProperties.sha256 === input.expectedSha256 &&
      current.appProperties.ytbmObjectKey === input.appProperties.ytbmObjectKey
    );
  }

  private uploadResult(
    current: GoogleDriveObjectStat,
    reconciled: boolean,
  ): PutGoogleDriveFileResult {
    if (current.bytes === null) {
      throw new BackupOperationError(
        'VERIFY_FAILED',
        'Google Drive did not report the uploaded file size.',
        { disposition: 'RETRY' },
      );
    }
    return {
      providerFileId: current.providerFileId,
      name: current.name,
      bytes: current.bytes,
      parents: current.parents,
      appProperties: current.appProperties,
      reconciled,
    };
  }

  private sessionUri(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !this.allowedSessionOrigins.has(url.origin)) {
      throw new BackupOperationError(
        'UPLOAD_FAILED',
        'Google Drive returned an invalid resumable upload session.',
        { disposition: 'FAIL' },
      );
    }
    return url.toString();
  }

  private async startSession(
    input: PutGoogleDriveFileInput,
    providerFileId: string | null,
  ): Promise<GoogleDriveResumableState> {
    const suffix =
      providerFileId === null ? '/files' : `/files/${encodeURIComponent(providerFileId)}`;
    const metadata = {
      name: input.name,
      ...(providerFileId === null ? { parents: [input.parentProviderId] } : {}),
      appProperties: input.appProperties,
    };
    const response = await this.authorizedFetch(
      input.destination,
      `${this.uploadRoot}${suffix}?uploadType=resumable&fields=id%2Cname%2CmimeType%2Csize%2Cparents%2CappProperties%2CmodifiedTime`,
      {
        method: providerFileId === null ? 'POST' : 'PATCH',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Upload-Content-Type': input.mimeType,
          'X-Upload-Content-Length': String(input.expectedBytes),
        },
        body: JSON.stringify(metadata),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );
    if (!response.ok) throw await providerError(response);
    const location = response.headers.get('location');
    if (location === null) {
      throw new BackupOperationError(
        'UPLOAD_FAILED',
        'Google Drive did not create a resumable upload session.',
        { disposition: 'RETRY' },
      );
    }
    const state = { sessionUri: this.sessionUri(location), bytesAcknowledged: 0, providerFileId };
    await input.onCheckpoint?.({ ...state, updatedAt: this.now() });
    return state;
  }

  private async reconcileSession(
    input: PutGoogleDriveFileInput,
    state: GoogleDriveResumableState,
  ): Promise<{ state: GoogleDriveResumableState } | { completed: PutGoogleDriveFileResult }> {
    const sessionUri = this.sessionUri(state.sessionUri);
    const response = await this.authorizedFetch(input.destination, sessionUri, {
      method: 'PUT',
      headers: { 'Content-Length': '0', 'Content-Range': `bytes */${input.expectedBytes}` },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (response.status === 404 || response.status === 410)
      throw new ResumableSessionExpiredError();
    if (response.status === 308) {
      const bytesAcknowledged = Math.min(
        input.expectedBytes,
        parseAcknowledgedRange(response.headers.get('range')),
      );
      const next = { ...state, sessionUri, bytesAcknowledged };
      await input.onCheckpoint?.({ ...next, updatedAt: this.now() });
      input.onProgress?.(bytesAcknowledged);
      return { state: next };
    }
    if (!response.ok) throw await providerError(response);
    const completed = objectStat((await responseJson(response)) as DriveFileResponse);
    const result = this.uploadResult(completed, true);
    await input.onCheckpoint?.({
      sessionUri,
      bytesAcknowledged: input.expectedBytes,
      providerFileId: result.providerFileId,
      updatedAt: this.now(),
    });
    input.onProgress?.(input.expectedBytes);
    return { completed: result };
  }

  private async uploadChunk(
    input: PutGoogleDriveFileInput,
    state: GoogleDriveResumableState,
  ): Promise<{ state: GoogleDriveResumableState } | { completed: PutGoogleDriveFileResult }> {
    const start = state.bytesAcknowledged;
    const end = Math.min(input.expectedBytes - 1, start + this.chunkBytes - 1);
    const length = end - start + 1;
    const body = createReadStream(input.sourcePath, { start, end });
    const request = {
      method: 'PUT',
      headers: {
        'Content-Type': input.mimeType,
        'Content-Length': String(length),
        'Content-Range': `bytes ${start}-${end}/${input.expectedBytes}`,
      },
      body: body as unknown as BodyInit,
      signal: input.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' };
    const response = await this.authorizedFetch(
      input.destination,
      this.sessionUri(state.sessionUri),
      request,
    );
    if (response.status === 404 || response.status === 410)
      throw new ResumableSessionExpiredError();
    if (response.status === 308) {
      const acknowledged = Math.min(
        input.expectedBytes,
        parseAcknowledgedRange(response.headers.get('range')),
      );
      if (acknowledged <= start) {
        throw new BackupOperationError(
          'UPLOAD_FAILED',
          'Google Drive did not acknowledge progress for the resumable upload chunk.',
          { disposition: 'RETRY' },
        );
      }
      const next = { ...state, bytesAcknowledged: acknowledged };
      await input.onCheckpoint?.({ ...next, updatedAt: this.now() });
      input.onProgress?.(acknowledged);
      return { state: next };
    }
    if (!response.ok) throw await providerError(response);
    const completed = objectStat((await responseJson(response)) as DriveFileResponse);
    const result = this.uploadResult(completed, false);
    await input.onCheckpoint?.({
      sessionUri: state.sessionUri,
      bytesAcknowledged: input.expectedBytes,
      providerFileId: result.providerFileId,
      updatedAt: this.now(),
    });
    input.onProgress?.(input.expectedBytes);
    return { completed: result };
  }
}
