import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export interface HashProgress {
  bytesProcessed: number;
  bytesTotal: number | null;
}

export interface HashFileOptions {
  bytesTotal?: number;
  signal?: AbortSignal;
  onProgress?(progress: HashProgress): void;
}

export interface FileHash {
  sha256: string;
  bytes: number;
}

export async function hashFileSha256(
  path: string,
  options: HashFileOptions = {},
): Promise<FileHash> {
  const hash = createHash('sha256');
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024, signal: options.signal });
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    bytes += buffer.length;
    options.onProgress?.({ bytesProcessed: bytes, bytesTotal: options.bytesTotal ?? null });
  }
  return { sha256: hash.digest('hex'), bytes };
}

export async function verifyFileSha256(
  path: string,
  expectedSha256: string,
  expectedBytes?: number,
  options: Omit<HashFileOptions, 'bytesTotal'> = {},
): Promise<FileHash & { verified: boolean }> {
  const result = await hashFileSha256(
    path,
    expectedBytes === undefined ? options : { ...options, bytesTotal: expectedBytes },
  );
  return {
    ...result,
    verified:
      result.sha256 === expectedSha256.toLowerCase() &&
      (expectedBytes === undefined || result.bytes === expectedBytes),
  };
}
