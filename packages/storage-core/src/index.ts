import type { DestinationAvailability } from '@ytbm/core';

export interface VolumeIdentity {
  volumeGuid: string | null;
  volumeSerial: string | null;
  filesystemType: string | null;
  mountPath: string;
}

export interface DestinationProbe {
  availability: DestinationAvailability;
  availableBytes: number | null;
  totalBytes: number | null;
  identity: VolumeIdentity | null;
  safeMessage: string | null;
}

export interface StoredFilesystemDestination {
  id: string;
  rootPath: string;
  volumeGuid: string | null;
  volumeSerial: string | null;
  filesystemType: string | null;
  lastKnownMountPath: string | null;
}

export interface PutFileInput {
  destination: StoredFilesystemDestination;
  sourcePath: string;
  relativePath: string;
  expectedSha256: string;
  expectedBytes: number;
  signal?: AbortSignal;
  onProgress?(bytesProcessed: number): void;
}

export interface PutFileResult {
  relativePath: string;
  absolutePath: string;
  sha256: string;
  bytes: number;
  reconciled: boolean;
}

export interface StorageProvider {
  readonly type: 'FILESYSTEM';
  probe(destination: StoredFilesystemDestination): Promise<DestinationProbe>;
  putFile(input: PutFileInput): Promise<PutFileResult>;
  resolveCurrentRoot(destination: StoredFilesystemDestination): Promise<string | null>;
}

export interface VolumeIdentityProvider {
  identify(path: string): Promise<VolumeIdentity | null>;
  findMount(identity: VolumeIdentity): Promise<string | null>;
}
