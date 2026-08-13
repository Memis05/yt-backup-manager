import type { MediaType, QualityProfile, RecoveryWarningCode, SourceStatus } from '@ytbm/core';
import type { GoogleDriveObjectStat } from '@ytbm/storage-core';

export const MAX_METADATA_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_PLAYLIST_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_MANIFEST_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_JSON_DEPTH = 64;

export interface RecoverySourceRecord {
  id: string;
  sessionId: string;
  sourceType: 'FILESYSTEM' | 'GOOGLE_DRIVE';
  status: 'PENDING' | 'SCANNING' | 'SCANNED' | 'FAILED' | 'CANCELLED';
  label: string;
  rootPath: string | null;
  accountId: string | null;
  accountEmail: string | null;
  volumeGuid: string | null;
  volumeSerial: string | null;
  filesystemType: string | null;
  lastKnownMountPath: string | null;
}

export interface RecoveryChannelCandidate {
  sourceId: string;
  providerChannelId: string;
  title: string;
  sourceStatus: SourceStatus;
  publishedAt: number | null;
  lastSeenAt: number | null;
  metadataUpdatedAt: number;
}

export interface RecoveryMediaCandidate {
  sourceId: string;
  providerChannelId: string;
  providerMediaId: string;
  mediaType: MediaType;
  title: string;
  originalTitle: string;
  sourceUrl: string;
  sourceStatus: SourceStatus;
  publishedAt: number | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  metadataUpdatedAt: number;
}

export interface RecoveryPlaylistCandidate {
  sourceId: string;
  providerChannelId: string;
  providerPlaylistId: string;
  title: string;
  sourceStatus: SourceStatus;
  metadataUpdatedAt: number;
  items: Array<{ providerMediaId: string; position: number | null }>;
}

export interface RecoveryCopyCandidate {
  sourceId: string;
  providerRootId: string | null;
  providerMediaId: string;
  destinationType: 'FILESYSTEM' | 'GOOGLE_DRIVE';
  relativePath: string | null;
  providerFileId: string | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  bytes: number | null;
  sha256: string | null;
  qualityProfile: QualityProfile | null;
  verificationStrength: 'LOCAL_SHA256' | 'PROVIDER_METADATA_SIZE' | null;
  status: 'VERIFIED' | 'MISSING' | 'CORRUPT';
  verifiedAt: number | null;
  metadataUpdatedAt: number;
  providerMetadata: unknown;
}

export interface RecoveryArtifactCandidate {
  sourceId: string;
  providerRootId: string | null;
  providerMediaId: string;
  artifactType: 'METADATA' | 'THUMBNAIL';
  relativePath: string | null;
  providerFileId: string | null;
  bytes: number | null;
  sha256: string | null;
  status: 'VERIFIED' | 'MISSING' | 'CORRUPT';
  metadataUpdatedAt: number;
}

export interface RecoveryDriveObjectCandidate {
  sourceId: string;
  object: GoogleDriveObjectStat;
}

export interface RecoveryWarningInput {
  sourceId: string | null;
  code: RecoveryWarningCode;
  entityKey: string | null;
  safeMessage: string;
  details?: unknown;
}

export class RecoveryCancelledError extends Error {
  public constructor() {
    super('Recovery was cancelled');
    this.name = 'RecoveryCancelledError';
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new RecoveryCancelledError();
}

export function safeProviderId(value: string, kind: string): string {
  if (!/^[A-Za-z0-9_-]{1,250}$/.test(value)) {
    throw new Error(`Invalid ${kind} provider identity`);
  }
  return value;
}

export function jsonDepth(value: unknown, maximum = MAX_JSON_DEPTH): number {
  const visit = (entry: unknown, depth: number): number => {
    if (depth > maximum) return depth;
    if (entry === null || typeof entry !== 'object') return depth;
    const children = Array.isArray(entry) ? entry : Object.values(entry);
    let deepest = depth;
    for (const child of children) deepest = Math.max(deepest, visit(child, depth + 1));
    return deepest;
  };
  return visit(value, 0);
}
