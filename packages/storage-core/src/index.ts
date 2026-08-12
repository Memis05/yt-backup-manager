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

export interface StoredGoogleDriveDestination {
  id: string;
  accountId: string;
  providerRootId: string | null;
}

export interface GoogleDriveCapacityInfo {
  availableBytes: number | null;
  totalBytes: number | null;
}

export interface GoogleDriveObjectRef {
  destination: StoredGoogleDriveDestination;
  providerFileId: string;
}

export interface GoogleDriveObjectStat {
  providerFileId: string;
  name: string;
  mimeType: string;
  bytes: number | null;
  parents: string[];
  appProperties: Readonly<Record<string, string>>;
  modifiedTime: string | null;
}

export interface EnsureGoogleDriveFolderInput {
  destination: StoredGoogleDriveDestination;
  knownProviderId: string | null;
  parentProviderId: string | null;
  name: string;
  logicalKey: string;
  appProperties: Readonly<Record<string, string>>;
}

export interface EnsureGoogleDriveFolderResult {
  providerFolderId: string;
  name: string;
  parentProviderId: string | null;
  reconciled: boolean;
}

export interface GoogleDriveUploadCheckpoint {
  sessionUri: string;
  bytesAcknowledged: number;
  providerFileId: string | null;
  updatedAt: number;
}

export interface GoogleDriveResumableState {
  sessionUri: string;
  bytesAcknowledged: number;
  providerFileId: string | null;
}

export interface PutGoogleDriveFileInput {
  destination: StoredGoogleDriveDestination;
  sourcePath: string;
  parentProviderId: string;
  name: string;
  mimeType: string;
  expectedSha256: string;
  expectedBytes: number;
  appProperties: Readonly<Record<string, string>>;
  knownProviderFileId: string | null;
  resumableState: GoogleDriveResumableState | null;
  signal?: AbortSignal;
  onProgress?(bytesProcessed: number): void;
  onCheckpoint?(checkpoint: GoogleDriveUploadCheckpoint): Promise<void> | void;
}

export interface PutGoogleDriveFileResult {
  providerFileId: string;
  name: string;
  bytes: number;
  parents: string[];
  appProperties: Readonly<Record<string, string>>;
  reconciled: boolean;
}

export interface PutGoogleDriveContentInput {
  destination: StoredGoogleDriveDestination;
  parentProviderId: string;
  name: string;
  mimeType: string;
  content: Uint8Array;
  appProperties: Readonly<Record<string, string>>;
  knownProviderFileId: string | null;
  signal?: AbortSignal;
}

export interface GetGoogleDriveFileInput {
  destination: StoredGoogleDriveDestination;
  providerFileId: string;
  destinationPath: string;
  expectedSha256: string;
  expectedBytes: number;
  signal?: AbortSignal;
  onProgress?(bytesProcessed: number): void;
}

export interface GetGoogleDriveFileResult {
  path: string;
  bytes: number;
  sha256: string;
}

export interface GoogleDriveStorageProvider {
  readonly type: 'GOOGLE_DRIVE';
  probe(destination: StoredGoogleDriveDestination): Promise<DestinationProbe>;
  getCapacity(destination: StoredGoogleDriveDestination): Promise<GoogleDriveCapacityInfo>;
  ensureFolder(input: EnsureGoogleDriveFolderInput): Promise<EnsureGoogleDriveFolderResult>;
  putFile(input: PutGoogleDriveFileInput): Promise<PutGoogleDriveFileResult>;
  putContent(input: PutGoogleDriveContentInput): Promise<GoogleDriveObjectStat>;
  getFile(input: GetGoogleDriveFileInput): Promise<GetGoogleDriveFileResult>;
  stat(input: GoogleDriveObjectRef): Promise<GoogleDriveObjectStat | null>;
}

export interface VolumeIdentityProvider {
  identify(path: string): Promise<VolumeIdentity | null>;
  findMount(identity: VolumeIdentity): Promise<string | null>;
}
