import { constants } from 'node:fs';
import { Buffer } from 'node:buffer';
import { access, link, mkdir, open, realpath, stat, statfs, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { BackupOperationError, destinationAvailabilityError } from '@ytbm/core';
import { verifyFileSha256 } from '@ytbm/integrity';
import type {
  DestinationProbe,
  PutFileInput,
  PutFileResult,
  StorageProvider,
  StoredFilesystemDestination,
  VolumeIdentity,
  VolumeIdentityProvider,
} from '@ytbm/storage-core';

import { assertPathPhysicallyUnderRoot, resolvePathUnderRoot } from './path-safety';
import {
  minimalPowerShellEnvironment,
  resolveWindowsPowerShellExecutable,
  WindowsVolumeIdentityProvider,
} from './volume-identity';

const COPY_BUFFER_BYTES = 1024 * 1024;
const CAPACITY_SAFETY_BYTES = 16 * 1024 * 1024;
const PROMOTION_TIMEOUT_MS = 5_000;
const MOVE_NO_REPLACE_SCRIPT = [
  '$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:YTBM_MOVE_SOURCE_B64))',
  '$destination = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:YTBM_MOVE_DESTINATION_B64))',
  '[System.IO.File]::Move($source, $destination)',
].join('; ');

export interface FilesystemStorageProviderOptions {
  capacitySafetyBytes?: number;
  probeWritable?(rootPath: string): Promise<void>;
}

function safeNodeErrorCode(error: unknown): string | null {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}

function probeFailure(error: unknown): DestinationProbe {
  const code = safeNodeErrorCode(error);
  if (code === 'ENOENT' || code === 'ENODEV' || code === 'ENOTREADY') {
    return {
      availability: 'DISCONNECTED',
      availableBytes: null,
      totalBytes: null,
      identity: null,
      safeMessage: 'The configured backup destination is disconnected.',
    };
  }
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return {
      availability: 'READ_ONLY',
      availableBytes: null,
      totalBytes: null,
      identity: null,
      safeMessage: 'The configured backup destination is not writable.',
    };
  }
  return {
    availability: 'ERROR',
    availableBytes: null,
    totalBytes: null,
    identity: null,
    safeMessage: 'The configured backup destination could not be probed.',
  };
}

async function moveNoReplaceWithPowerShell(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await new Promise<void>((resolveMove, reject) => {
    const child = spawn(
      resolveWindowsPowerShellExecutable(),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(MOVE_NO_REPLACE_SCRIPT, 'utf16le').toString('base64'),
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
        env: minimalPowerShellEnvironment({
          YTBM_MOVE_SOURCE_B64: Buffer.from(sourcePath, 'utf8').toString('base64'),
          YTBM_MOVE_DESTINATION_B64: Buffer.from(destinationPath, 'utf8').toString('base64'),
        }),
      },
    );
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error === undefined) resolveMove();
      else reject(error);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error('Timed out while atomically promoting the destination copy'));
    }, PROMOTION_TIMEOUT_MS);
    timeout.unref();
    child.once('error', (error) => finish(error));
    child.once('close', (code) =>
      code === 0
        ? finish()
        : finish(new Error('The destination filesystem rejected atomic no-overwrite promotion')),
    );
  });
}

async function promoteFileNoReplace(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await link(sourcePath, destinationPath);
  } catch (error) {
    const code = safeNodeErrorCode(error);
    if (
      process.platform !== 'win32' ||
      !['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(code ?? '')
    ) {
      throw error;
    }
    await moveNoReplaceWithPowerShell(sourcePath, destinationPath);
    return;
  }
  await unlink(sourcePath).catch(() => undefined);
}

export class FilesystemStorageProvider implements StorageProvider {
  public readonly type = 'FILESYSTEM' as const;

  public constructor(
    private readonly volumes: VolumeIdentityProvider = new WindowsVolumeIdentityProvider(),
    private readonly options: FilesystemStorageProviderOptions = {},
  ) {}

  public async resolveCurrentRoot(
    destination: StoredFilesystemDestination,
  ): Promise<string | null> {
    try {
      await access(destination.rootPath, constants.F_OK);
      const safeRoot = await this.safeExistingRoot(destination.rootPath);
      if (destination.volumeGuid === null && destination.volumeSerial === null) {
        return safeRoot;
      }
      const identity = await this.volumes.identify(safeRoot);
      if (this.matchesStoredIdentity(destination, identity)) return safeRoot;
    } catch {
      // Try volume re-detection below.
    }
    if (destination.volumeGuid === null && destination.volumeSerial === null) return null;
    const previousMount = destination.lastKnownMountPath ?? destination.rootPath;
    const currentMount = await this.volumes.findMount({
      volumeGuid: destination.volumeGuid,
      volumeSerial: destination.volumeSerial,
      filesystemType: destination.filesystemType,
      mountPath: previousMount,
    });
    if (currentMount === null) return null;
    const subdirectory = relative(resolve(previousMount), resolve(destination.rootPath));
    if (subdirectory === '' || subdirectory === '.') return this.safeExistingRoot(currentMount);
    if (
      subdirectory === '..' ||
      subdirectory.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
      isAbsolute(subdirectory)
    ) {
      return null;
    }
    const candidate = resolve(currentMount, subdirectory);
    try {
      await assertPathPhysicallyUnderRoot(currentMount, candidate, { allowRoot: true });
      const safeRoot = await this.safeExistingRoot(candidate);
      const identity = await this.volumes.identify(safeRoot);
      return this.matchesStoredIdentity(destination, identity) ? safeRoot : null;
    } catch {
      return null;
    }
  }

  public async probe(destination: StoredFilesystemDestination): Promise<DestinationProbe> {
    const currentRoot = await this.resolveCurrentRoot(destination);
    if (currentRoot === null)
      return probeFailure(Object.assign(new Error('Disconnected'), { code: 'ENOENT' }));
    try {
      await access(currentRoot, constants.R_OK | constants.W_OK);
      if (this.options.probeWritable !== undefined) {
        await this.options.probeWritable(currentRoot);
      } else {
        const temporary = join(currentRoot, `.ytbm-probe-${crypto.randomUUID()}.tmp`);
        const handle = await open(temporary, 'wx', 0o600);
        await handle.sync();
        await handle.close();
        await unlink(temporary);
      }
      const capacity = await statfs(currentRoot, { bigint: true });
      const availableBytes = Number(capacity.bavail * capacity.bsize);
      const totalBytes = Number(capacity.blocks * capacity.bsize);
      const identity = await this.volumes.identify(currentRoot);
      return {
        availability: availableBytes <= 0 ? 'FULL' : 'AVAILABLE',
        availableBytes,
        totalBytes,
        identity,
        safeMessage: availableBytes <= 0 ? 'The backup destination is full.' : null,
      };
    } catch (error) {
      return probeFailure(error);
    }
  }

  public async putFile(input: PutFileInput): Promise<PutFileResult> {
    const probe = await this.probe(input.destination);
    const unavailable = destinationAvailabilityError(
      probe.availability,
      probe.safeMessage ?? undefined,
    );
    if (unavailable !== null) throw unavailable;
    if (
      probe.availableBytes !== null &&
      probe.availableBytes <
        input.expectedBytes + (this.options.capacitySafetyBytes ?? CAPACITY_SAFETY_BYTES)
    ) {
      throw new BackupOperationError(
        'DESTINATION_FULL',
        'The backup destination does not have enough free space for this media file.',
        { disposition: 'FAIL' },
      );
    }

    const currentRoot = await this.resolveCurrentRoot(input.destination);
    if (currentRoot === null) {
      throw new BackupOperationError(
        'DESTINATION_DISCONNECTED',
        'The backup destination was disconnected.',
        {
          disposition: 'BLOCK',
        },
      );
    }
    const finalPath = resolvePathUnderRoot(currentRoot, input.relativePath);
    await assertPathPhysicallyUnderRoot(currentRoot, dirname(finalPath), {
      allowMissing: true,
      allowRoot: true,
    });
    await mkdir(dirname(finalPath), { recursive: true });
    await assertPathPhysicallyUnderRoot(currentRoot, dirname(finalPath), { allowRoot: true });
    if (await this.pathExists(finalPath)) {
      await assertPathPhysicallyUnderRoot(currentRoot, finalPath);
      const existing = await verifyFileSha256(
        finalPath,
        input.expectedSha256,
        input.expectedBytes,
        input.signal === undefined ? {} : { signal: input.signal },
      );
      if (existing.verified) {
        return {
          relativePath: relative(currentRoot, finalPath),
          absolutePath: finalPath,
          sha256: existing.sha256,
          bytes: existing.bytes,
          reconciled: true,
        };
      }
      throw new BackupOperationError(
        'COPY_CORRUPT',
        'A different file already exists at the planned backup path. It was not overwritten.',
        { disposition: 'FAIL' },
      );
    }

    const temporaryPath = join(
      dirname(finalPath),
      `.${basename(finalPath)}.${input.expectedSha256.slice(0, 12)}.${crypto.randomUUID()}.ytbm-tmp`,
    );
    let temporaryHash;
    try {
      await this.copyAndFlush(currentRoot, input.sourcePath, temporaryPath, input);
      await assertPathPhysicallyUnderRoot(currentRoot, temporaryPath);
      temporaryHash = await verifyFileSha256(
        temporaryPath,
        input.expectedSha256,
        input.expectedBytes,
        input.signal === undefined ? {} : { signal: input.signal },
      );
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    if (!temporaryHash.verified) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new BackupOperationError(
        'COPY_CORRUPT',
        'The temporary destination copy failed SHA-256 verification.',
        { disposition: 'RETRY' },
      );
    }
    try {
      await this.assertDestinationIdentity(input.destination, currentRoot);
      await assertPathPhysicallyUnderRoot(currentRoot, dirname(finalPath), { allowRoot: true });
      await promoteFileNoReplace(temporaryPath, finalPath);
      await assertPathPhysicallyUnderRoot(currentRoot, finalPath);
      await this.assertDestinationIdentity(input.destination, currentRoot);
    } catch (error) {
      if (await this.pathExists(finalPath)) {
        await assertPathPhysicallyUnderRoot(currentRoot, finalPath);
        await this.assertDestinationIdentity(input.destination, currentRoot);
        const raced = await verifyFileSha256(finalPath, input.expectedSha256, input.expectedBytes);
        if (raced.verified) {
          await unlink(temporaryPath).catch(() => undefined);
          return {
            relativePath: relative(currentRoot, finalPath),
            absolutePath: finalPath,
            sha256: raced.sha256,
            bytes: raced.bytes,
            reconciled: true,
          };
        }
      }
      await unlink(temporaryPath).catch(() => undefined);
      throw new BackupOperationError(
        'COPY_FAILED',
        'The verified temporary copy could not be promoted.',
        {
          disposition: 'RETRY',
          cause: error,
        },
      );
    }
    return {
      relativePath: relative(currentRoot, finalPath),
      absolutePath: finalPath,
      sha256: temporaryHash.sha256,
      bytes: temporaryHash.bytes,
      reconciled: false,
    };
  }

  private matchesStoredIdentity(
    destination: StoredFilesystemDestination,
    identity: VolumeIdentity | null,
  ): boolean {
    if (destination.volumeGuid === null && destination.volumeSerial === null) return true;
    if (identity === null) return false;
    if (destination.volumeGuid !== null && identity.volumeGuid !== null) {
      if (destination.volumeGuid !== identity.volumeGuid) return false;
      if (
        destination.volumeSerial !== null &&
        identity.volumeSerial !== null &&
        destination.volumeSerial !== identity.volumeSerial
      )
        return false;
      return (
        destination.filesystemType === null ||
        identity.filesystemType === null ||
        destination.filesystemType.toLowerCase() === identity.filesystemType.toLowerCase()
      );
    }
    return (
      destination.volumeGuid === null &&
      identity.volumeGuid === null &&
      destination.volumeSerial !== null &&
      destination.volumeSerial === identity.volumeSerial &&
      (destination.filesystemType === null ||
        (identity.filesystemType !== null &&
          destination.filesystemType.toLowerCase() === identity.filesystemType.toLowerCase()))
    );
  }

  private async assertDestinationIdentity(
    destination: StoredFilesystemDestination,
    currentRoot: string,
  ): Promise<void> {
    if (destination.volumeGuid === null && destination.volumeSerial === null) return;
    const identity = await this.volumes.identify(currentRoot);
    if (!this.matchesStoredIdentity(destination, identity)) {
      throw new BackupOperationError(
        'DESTINATION_DISCONNECTED',
        'The backup destination identity changed during the copy.',
        { disposition: 'BLOCK' },
      );
    }
  }

  private async copyAndFlush(
    rootPath: string,
    sourcePath: string,
    targetPath: string,
    input: PutFileInput,
  ): Promise<void> {
    const source = await open(sourcePath, 'r');
    const target = await open(targetPath, 'wx', 0o600);
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let offset = 0;
    try {
      await assertPathPhysicallyUnderRoot(rootPath, targetPath);
      while (true) {
        if (input.signal?.aborted === true) throw input.signal.reason;
        const { bytesRead } = await source.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) break;
        let written = 0;
        while (written < bytesRead) {
          const result = await target.write(buffer, written, bytesRead - written, offset + written);
          written += result.bytesWritten;
        }
        offset += bytesRead;
        input.onProgress?.(offset);
      }
      await target.sync();
    } catch (error) {
      const code = safeNodeErrorCode(error);
      if (code === 'ENOSPC') {
        throw new BackupOperationError(
          'DESTINATION_FULL',
          'The backup destination became full during copy.',
          {
            disposition: 'FAIL',
            cause: error,
          },
        );
      }
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
        throw new BackupOperationError(
          'DESTINATION_PERMISSION_DENIED',
          'Permission was denied while writing the backup destination.',
          { disposition: 'FAIL', cause: error },
        );
      }
      if (
        code === 'ENOENT' ||
        code === 'ENODEV' ||
        code === 'ENXIO' ||
        code === 'ENOTREADY' ||
        code === 'EIO'
      ) {
        throw new BackupOperationError(
          'DESTINATION_DISCONNECTED',
          'The backup destination was disconnected during copy.',
          { disposition: 'BLOCK', cause: error },
        );
      }
      throw error;
    } finally {
      await Promise.allSettled([source.close(), target.close()]);
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (safeNodeErrorCode(error) === 'ENOENT') return false;
      throw error;
    }
  }

  private async safeExistingRoot(path: string): Promise<string> {
    const resolved = resolve(path);
    await assertPathPhysicallyUnderRoot(resolved, resolved, { allowRoot: true });
    return resolve(await realpath(resolved));
  }
}
