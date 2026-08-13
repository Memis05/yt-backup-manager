import { createHash } from 'node:crypto';
import { lstat, opendir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

import { assertPathPhysicallyUnderRoot, resolvePathUnderRoot } from '@ytbm/storage-filesystem';

import type { RecoveryRepository } from './repository';
import {
  parseRecoveryChannelManifest,
  parseRecoveryManifestVersion,
  parseRecoveryMediaMetadata,
  parseRecoveryPlaylist,
} from './parsers';
import {
  MAX_MANIFEST_JSON_BYTES,
  MAX_METADATA_JSON_BYTES,
  MAX_PLAYLIST_JSON_BYTES,
  jsonDepth,
  safeProviderId,
  throwIfAborted,
  type RecoverySourceRecord,
} from './types';

interface ParsedJsonFile {
  value: unknown;
  text: string;
  bytes: number;
}

function nodeErrorCode(error: unknown): string | null {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}

function folderTitle(path: string, providerId: string): string {
  const name = basename(path);
  const suffix = ` [${providerId}]`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) || providerId : providerId;
}

async function readJsonFile(
  selectedRoot: string,
  path: string,
  maximumBytes: number,
): Promise<ParsedJsonFile> {
  await assertPathPhysicallyUnderRoot(selectedRoot, path);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Recovery JSON is not a file');
  if (info.size > maximumBytes) throw new Error('Recovery JSON exceeds the allowed size');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new Error('Recovery JSON exceeds the allowed size');
  }
  const value = JSON.parse(text) as unknown;
  if (jsonDepth(value) > 64) throw new Error('Recovery JSON is nested too deeply');
  return { value, text, bytes: Buffer.byteLength(text, 'utf8') };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

export class LocalBackupScanner {
  public constructor(private readonly repository: RecoveryRepository) {}

  public async scan(source: RecoverySourceRecord, signal: AbortSignal): Promise<void> {
    if (source.rootPath === null) throw new Error('Local recovery source has no root path');
    const selectedRoot = resolve(source.rootPath);
    await assertPathPhysicallyUnderRoot(selectedRoot, selectedRoot, { allowRoot: true });
    const channelRoots = await this.channelRoots(selectedRoot, signal);
    if (channelRoots.length === 0) {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'MANIFEST_MISSING',
        entityKey: null,
        safeMessage: 'No channel manifest was found in the selected local backup folder.',
      });
      return;
    }
    let processed = 0;
    for (const channelRoot of channelRoots) {
      throwIfAborted(signal);
      processed += await this.scanChannel(source, selectedRoot, channelRoot, signal, processed);
    }
  }

  private async channelRoots(root: string, signal: AbortSignal): Promise<string[]> {
    const ownVersion = join(root, '.ytbackup', 'version.json');
    if (await pathExists(ownVersion)) return [root];
    const found: string[] = [];
    const directory = await opendir(root);
    try {
      for await (const entry of directory) {
        throwIfAborted(signal);
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const child = resolve(root, entry.name);
        try {
          await assertPathPhysicallyUnderRoot(root, child);
          if (await pathExists(join(child, '.ytbackup', 'version.json'))) found.push(child);
        } catch {
          // Unsafe entries are isolated. A warning is emitted when their manifest is selected.
        }
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
    return found.sort((left, right) => left.localeCompare(right));
  }

  private async scanChannel(
    source: RecoverySourceRecord,
    selectedRoot: string,
    channelRoot: string,
    signal: AbortSignal,
    progressOffset: number,
  ): Promise<number> {
    const versionPath = join(channelRoot, '.ytbackup', 'version.json');
    const manifestPath = join(channelRoot, '.ytbackup', 'manifest.json');
    let versionRaw: ParsedJsonFile;
    try {
      versionRaw = await readJsonFile(selectedRoot, versionPath, MAX_METADATA_JSON_BYTES);
      try {
        parseRecoveryManifestVersion(versionRaw.value);
      } catch {
        const schemaVersion =
          versionRaw.value !== null && typeof versionRaw.value === 'object'
            ? (versionRaw.value as Record<string, unknown>).schemaVersion
            : null;
        this.repository.addWarning(source.sessionId, {
          sourceId: source.id,
          code: schemaVersion === 1 ? 'MANIFEST_INVALID' : 'UNSUPPORTED_SCHEMA',
          entityKey: relative(selectedRoot, versionPath),
          safeMessage:
            schemaVersion === 1
              ? 'A local recovery version marker is invalid.'
              : 'A local backup uses an unsupported manifest schema.',
        });
        return 0;
      }
    } catch {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'MANIFEST_INVALID',
        entityKey: relative(selectedRoot, versionPath),
        safeMessage: 'A local recovery version marker could not be read safely.',
      });
      return 0;
    }

    let manifestRaw: ParsedJsonFile;
    try {
      manifestRaw = await readJsonFile(selectedRoot, manifestPath, MAX_MANIFEST_JSON_BYTES);
    } catch (error) {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: nodeErrorCode(error) === 'ENOENT' ? 'MANIFEST_MISSING' : 'MANIFEST_INVALID',
        entityKey: relative(selectedRoot, manifestPath),
        safeMessage: 'A local channel manifest is missing or could not be read safely.',
      });
      return this.scanStandaloneArchive(source, selectedRoot, channelRoot, signal);
    }
    let manifest: ReturnType<typeof parseRecoveryChannelManifest>;
    try {
      manifest = parseRecoveryChannelManifest(manifestRaw.value);
    } catch {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'MANIFEST_INVALID',
        entityKey: relative(selectedRoot, manifestPath),
        safeMessage: 'A local channel manifest is malformed.',
      });
      return this.scanStandaloneArchive(source, selectedRoot, channelRoot, signal);
    }
    let providerChannelId: string;
    try {
      providerChannelId = safeProviderId(manifest.providerChannelId, 'channel');
    } catch {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'MANIFEST_INVALID',
        entityKey: relative(selectedRoot, manifestPath),
        safeMessage: 'A local channel manifest contains an invalid stable channel identity.',
      });
      return 0;
    }
    this.repository.upsertChannel(source.sessionId, {
      sourceId: source.id,
      providerChannelId,
      title: manifest.channelTitle,
      sourceStatus: 'UNKNOWN',
      publishedAt: null,
      lastSeenAt: manifest.updatedAt,
      metadataUpdatedAt: manifest.updatedAt,
    });

    let processed = 0;
    for (const entry of manifest.media) {
      throwIfAborted(signal);
      try {
        await this.scanMedia(
          source,
          selectedRoot,
          channelRoot,
          providerChannelId,
          manifest.updatedAt,
          entry,
        );
      } catch {
        this.repository.addWarning(source.sessionId, {
          sourceId: source.id,
          code: 'UNSAFE_PATH',
          entityKey: entry.providerMediaId,
          safeMessage: 'One local media entry used an unsafe or inaccessible path and was skipped.',
        });
      }
      processed += 1;
      this.repository.setProgress(source.sessionId, 'LOCAL_SCAN', progressOffset + processed, null);
    }
    for (const playlist of manifest.playlists) {
      throwIfAborted(signal);
      await this.scanPlaylist(
        source,
        selectedRoot,
        channelRoot,
        providerChannelId,
        manifest.updatedAt,
        playlist,
      );
    }
    processed += await this.scanStandaloneArchive(source, selectedRoot, channelRoot, signal, true);
    return processed;
  }

  private async scanMedia(
    source: RecoverySourceRecord,
    selectedRoot: string,
    channelRoot: string,
    manifestProviderChannelId: string,
    manifestUpdatedAt: number,
    entry: {
      providerMediaId: string;
      mediaType: 'VIDEO' | 'SHORT' | 'LIVE';
      mediaDirectory: string;
      mediaFile: string;
      metadataFile: string;
      thumbnailFile?: string | undefined;
      bytes: number;
      sha256: string;
    },
  ): Promise<void> {
    const providerMediaId = safeProviderId(entry.providerMediaId, 'media');
    const mediaPath = resolvePathUnderRoot(channelRoot, entry.mediaFile);
    await assertPathPhysicallyUnderRoot(selectedRoot, mediaPath, { allowMissing: true });
    let actualBytes: number | null = null;
    let copyStatus: 'VERIFIED' | 'MISSING' | 'CORRUPT' = 'MISSING';
    try {
      await assertPathPhysicallyUnderRoot(selectedRoot, mediaPath);
      const mediaInfo = await lstat(mediaPath);
      if (!mediaInfo.isFile() || mediaInfo.isSymbolicLink()) throw new Error('Unsafe media file');
      actualBytes = mediaInfo.size;
      copyStatus = mediaInfo.size === entry.bytes ? 'VERIFIED' : 'CORRUPT';
      if (copyStatus === 'CORRUPT') {
        this.repository.addWarning(source.sessionId, {
          sourceId: source.id,
          code: 'SIZE_MISMATCH',
          entityKey: providerMediaId,
          safeMessage: 'A local media file size does not match its recovery manifest.',
        });
      }
    } catch (error) {
      if (nodeErrorCode(error) !== 'ENOENT') throw error;
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'FILE_MISSING',
        entityKey: providerMediaId,
        safeMessage: 'A media file referenced by the local manifest is missing.',
      });
    }

    const metadataPath = resolvePathUnderRoot(channelRoot, entry.metadataFile);
    let metadata: ReturnType<typeof parseRecoveryMediaMetadata> | null = null;
    let metadataFile: ParsedJsonFile | null = null;
    try {
      metadataFile = await readJsonFile(selectedRoot, metadataPath, MAX_METADATA_JSON_BYTES);
      const parsed = parseRecoveryMediaMetadata(metadataFile.value);
      if (
        parsed.providerMediaId !== providerMediaId ||
        safeProviderId(parsed.channelId, 'channel') !== parsed.channelId
      ) {
        throw new Error('Metadata identity is invalid');
      }
      metadata = parsed;
    } catch {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'METADATA_INVALID',
        entityKey: providerMediaId,
        safeMessage:
          'One media metadata sidecar is missing or malformed; manifest data was retained.',
      });
    }
    const metadataUpdatedAt =
      metadata?.lastSourceSyncAt ?? metadata?.verifiedAt ?? manifestUpdatedAt;
    const providerChannelId =
      metadata === null ? manifestProviderChannelId : safeProviderId(metadata.channelId, 'channel');
    const title = metadata?.currentTitle ?? folderTitle(dirname(mediaPath), providerMediaId);
    this.repository.upsertChannel(source.sessionId, {
      sourceId: source.id,
      providerChannelId,
      title: metadata?.channelTitle ?? folderTitle(channelRoot, providerChannelId),
      sourceStatus: metadata?.sourceStatus ?? 'UNKNOWN',
      publishedAt: null,
      lastSeenAt: metadata?.lastSourceSyncAt ?? manifestUpdatedAt,
      metadataUpdatedAt,
    });
    this.repository.upsertMedia(source.sessionId, {
      sourceId: source.id,
      providerChannelId,
      providerMediaId,
      mediaType: metadata?.mediaType ?? entry.mediaType,
      title,
      originalTitle: metadata?.originalTitle ?? title,
      sourceUrl: metadata?.sourceUrl ?? `https://www.youtube.com/watch?v=${providerMediaId}`,
      sourceStatus: metadata?.sourceStatus ?? 'UNKNOWN',
      publishedAt: metadata?.publishedAt ?? null,
      durationSeconds: metadata?.duration ?? null,
      thumbnailUrl: null,
      metadataUpdatedAt,
    });
    this.repository.insertCopy(source.sessionId, {
      sourceId: source.id,
      providerRootId: null,
      providerMediaId,
      destinationType: 'FILESYSTEM',
      relativePath: relative(selectedRoot, mediaPath),
      providerFileId: null,
      container: metadata?.container ?? (extname(mediaPath).slice(1) || null),
      videoCodec: metadata?.videoCodec ?? null,
      audioCodec: metadata?.audioCodec ?? null,
      width: metadata?.width ?? null,
      height: metadata?.height ?? null,
      fps: metadata?.fps ?? null,
      bytes: entry.bytes,
      sha256: entry.sha256,
      qualityProfile: metadata?.selectedQualityProfile ?? null,
      verificationStrength: null,
      status: copyStatus,
      verifiedAt: metadata?.verifiedAt ?? manifestUpdatedAt,
      metadataUpdatedAt,
      providerMetadata: { actualBytes, fastRecoveryScan: true },
    });
    if (metadataFile !== null) {
      this.repository.insertArtifact(source.sessionId, {
        sourceId: source.id,
        providerRootId: null,
        providerMediaId,
        artifactType: 'METADATA',
        relativePath: relative(selectedRoot, metadataPath),
        providerFileId: null,
        bytes: metadataFile.bytes,
        sha256: createHash('sha256').update(metadataFile.text).digest('hex'),
        status: 'VERIFIED',
        metadataUpdatedAt,
      });
    }
    if (entry.thumbnailFile !== undefined) {
      const thumbnailPath = resolvePathUnderRoot(channelRoot, entry.thumbnailFile);
      try {
        await assertPathPhysicallyUnderRoot(selectedRoot, thumbnailPath);
        const thumbnail = await lstat(thumbnailPath);
        if (thumbnail.isFile() && !thumbnail.isSymbolicLink()) {
          this.repository.insertArtifact(source.sessionId, {
            sourceId: source.id,
            providerRootId: null,
            providerMediaId,
            artifactType: 'THUMBNAIL',
            relativePath: relative(selectedRoot, thumbnailPath),
            providerFileId: null,
            bytes: thumbnail.size,
            sha256: null,
            status: 'VERIFIED',
            metadataUpdatedAt,
          });
        }
      } catch {
        // A thumbnail is optional and cannot invalidate a healthy media copy.
      }
    }
  }

  private async scanPlaylist(
    source: RecoverySourceRecord,
    selectedRoot: string,
    channelRoot: string,
    providerChannelId: string,
    manifestUpdatedAt: number,
    entry: { providerPlaylistId: string; playlistFile: string; mediaIds: string[] },
  ): Promise<void> {
    let providerPlaylistId: string;
    try {
      providerPlaylistId = safeProviderId(entry.providerPlaylistId, 'playlist');
    } catch {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'PLAYLIST_INVALID',
        entityKey: entry.providerPlaylistId,
        safeMessage: 'A playlist has an invalid stable identity and was skipped.',
      });
      return;
    }
    let title = providerPlaylistId;
    let sourceStatus: 'AVAILABLE' | 'PRIVATE' | 'UNLISTED' | 'REMOVED' | 'UNAVAILABLE' | 'UNKNOWN' =
      'UNKNOWN';
    let updatedAt = manifestUpdatedAt;
    let items: Array<{ providerMediaId: string; position: number | null }> = entry.mediaIds.map(
      (providerMediaId, position) => ({
        providerMediaId,
        position,
      }),
    );
    try {
      const playlistPath = resolvePathUnderRoot(channelRoot, entry.playlistFile);
      const raw = await readJsonFile(selectedRoot, playlistPath, MAX_PLAYLIST_JSON_BYTES);
      const parsed = parseRecoveryPlaylist(raw.value);
      if (
        parsed.providerPlaylistId !== providerPlaylistId ||
        parsed.channelId !== providerChannelId
      ) {
        throw new Error('Playlist sidecar identity is invalid');
      }
      title = parsed.title;
      sourceStatus = parsed.sourceStatus;
      updatedAt = parsed.updatedAt;
      items = parsed.items;
    } catch {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'PLAYLIST_INVALID',
        entityKey: providerPlaylistId,
        safeMessage:
          'A playlist sidecar is missing or malformed; manifest membership was retained.',
      });
    }
    const safeItems = items.flatMap((item) => {
      try {
        return [
          {
            providerMediaId: safeProviderId(item.providerMediaId, 'media'),
            position: item.position,
          },
        ];
      } catch {
        return [];
      }
    });
    this.repository.upsertPlaylist(source.sessionId, {
      sourceId: source.id,
      providerChannelId,
      providerPlaylistId,
      title,
      sourceStatus,
      metadataUpdatedAt: updatedAt,
      items: safeItems,
    });
  }

  private async scanStandaloneArchive(
    source: RecoverySourceRecord,
    selectedRoot: string,
    channelRoot: string,
    signal: AbortSignal,
    orphaned = false,
  ): Promise<number> {
    let processed = 0;
    for (const category of ['Videos', 'Shorts', 'Live']) {
      const categoryRoot = join(channelRoot, category);
      if (!(await pathExists(categoryRoot))) continue;
      for await (const metadataPath of this.namedFiles(
        selectedRoot,
        categoryRoot,
        'metadata.json',
        signal,
      )) {
        throwIfAborted(signal);
        try {
          if (await this.scanStandaloneMetadata(source, selectedRoot, metadataPath)) {
            processed += 1;
            if (orphaned) {
              this.repository.addWarning(source.sessionId, {
                sourceId: source.id,
                code: 'ORPHAN_METADATA',
                entityKey: relative(selectedRoot, metadataPath),
                safeMessage:
                  'A valid media sidecar was not referenced by the manifest and was recovered independently.',
              });
            }
          }
        } catch {
          this.repository.addWarning(source.sessionId, {
            sourceId: source.id,
            code: 'METADATA_INVALID',
            entityKey: relative(selectedRoot, metadataPath),
            safeMessage: 'A standalone media metadata sidecar is malformed and was skipped.',
          });
        }
        this.repository.setProgress(source.sessionId, 'LOCAL_SCAN', processed, null);
      }
    }
    const playlistsRoot = join(channelRoot, 'Playlists');
    if (await pathExists(playlistsRoot)) {
      for await (const playlistPath of this.namedFiles(
        selectedRoot,
        playlistsRoot,
        'playlist.json',
        signal,
      )) {
        try {
          const raw = await readJsonFile(selectedRoot, playlistPath, MAX_PLAYLIST_JSON_BYTES);
          const parsed = parseRecoveryPlaylist(raw.value);
          if (
            this.repository.hasPlaylistCandidate(
              source.sessionId,
              source.id,
              parsed.providerPlaylistId,
            )
          ) {
            continue;
          }
          this.repository.upsertPlaylist(source.sessionId, {
            sourceId: source.id,
            providerChannelId: safeProviderId(parsed.channelId, 'channel'),
            providerPlaylistId: safeProviderId(parsed.providerPlaylistId, 'playlist'),
            title: parsed.title,
            sourceStatus: parsed.sourceStatus,
            metadataUpdatedAt: parsed.updatedAt,
            items: parsed.items.map((item) => ({
              providerMediaId: safeProviderId(item.providerMediaId, 'media'),
              position: item.position,
            })),
          });
        } catch {
          this.repository.addWarning(source.sessionId, {
            sourceId: source.id,
            code: 'PLAYLIST_INVALID',
            entityKey: relative(selectedRoot, playlistPath),
            safeMessage: 'A standalone playlist sidecar is malformed and was skipped.',
          });
        }
      }
    }
    if (processed > 0 && !orphaned) {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'PARTIAL_BACKUP',
        entityKey: relative(selectedRoot, channelRoot),
        safeMessage:
          'The channel manifest is unusable, so healthy standalone sidecars were recovered.',
      });
    }
    return processed;
  }

  private async scanStandaloneMetadata(
    source: RecoverySourceRecord,
    selectedRoot: string,
    metadataPath: string,
  ): Promise<boolean> {
    const raw = await readJsonFile(selectedRoot, metadataPath, MAX_METADATA_JSON_BYTES);
    const metadata = parseRecoveryMediaMetadata(raw.value);
    const providerMediaId = safeProviderId(metadata.providerMediaId, 'media');
    const providerChannelId = safeProviderId(metadata.channelId, 'channel');
    if (this.repository.hasMediaCandidate(source.sessionId, source.id, providerMediaId)) {
      return false;
    }
    const updatedAt = metadata.lastSourceSyncAt ?? metadata.verifiedAt;
    this.repository.upsertChannel(source.sessionId, {
      sourceId: source.id,
      providerChannelId,
      title: metadata.channelTitle,
      sourceStatus: metadata.sourceStatus,
      publishedAt: null,
      lastSeenAt: metadata.lastSourceSyncAt ?? metadata.verifiedAt,
      metadataUpdatedAt: updatedAt,
    });
    this.repository.upsertMedia(source.sessionId, {
      sourceId: source.id,
      providerChannelId,
      providerMediaId,
      mediaType: metadata.mediaType,
      title: metadata.currentTitle,
      originalTitle: metadata.originalTitle,
      sourceUrl: metadata.sourceUrl,
      sourceStatus: metadata.sourceStatus,
      publishedAt: metadata.publishedAt ?? null,
      durationSeconds: metadata.duration ?? null,
      thumbnailUrl: null,
      metadataUpdatedAt: updatedAt,
    });
    const mediaPath = await this.findStandaloneMedia(selectedRoot, dirname(metadataPath));
    const mediaInfo = mediaPath === null ? null : await lstat(mediaPath);
    const status =
      mediaInfo === null ? 'MISSING' : mediaInfo.size === metadata.bytes ? 'VERIFIED' : 'CORRUPT';
    if (status === 'MISSING') {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'FILE_MISSING',
        entityKey: providerMediaId,
        safeMessage: 'A standalone metadata sidecar has no recoverable media file.',
      });
    } else if (status === 'CORRUPT') {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'SIZE_MISMATCH',
        entityKey: providerMediaId,
        safeMessage: 'A standalone media file size does not match its metadata sidecar.',
      });
    }
    this.repository.insertCopy(source.sessionId, {
      sourceId: source.id,
      providerRootId: null,
      providerMediaId,
      destinationType: 'FILESYSTEM',
      relativePath: mediaPath === null ? null : relative(selectedRoot, mediaPath),
      providerFileId: null,
      container: metadata.container,
      videoCodec: metadata.videoCodec ?? null,
      audioCodec: metadata.audioCodec ?? null,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      fps: metadata.fps ?? null,
      bytes: metadata.bytes,
      sha256: metadata.sha256,
      qualityProfile: metadata.selectedQualityProfile,
      verificationStrength: null,
      status,
      verifiedAt: metadata.verifiedAt,
      metadataUpdatedAt: updatedAt,
      providerMetadata: { fastRecoveryScan: true, standaloneSidecar: true },
    });
    this.repository.insertArtifact(source.sessionId, {
      sourceId: source.id,
      providerRootId: null,
      providerMediaId,
      artifactType: 'METADATA',
      relativePath: relative(selectedRoot, metadataPath),
      providerFileId: null,
      bytes: raw.bytes,
      sha256: createHash('sha256').update(raw.text).digest('hex'),
      status: 'VERIFIED',
      metadataUpdatedAt: updatedAt,
    });
    return true;
  }

  private async findStandaloneMedia(
    selectedRoot: string,
    directoryPath: string,
  ): Promise<string | null> {
    const directory = await opendir(directoryPath);
    try {
      for await (const entry of directory) {
        if (!entry.isFile() || entry.isSymbolicLink()) continue;
        if (!['.mp4', '.webm', '.mkv', '.m4v'].includes(extname(entry.name).toLowerCase()))
          continue;
        const candidate = resolve(directoryPath, entry.name);
        await assertPathPhysicallyUnderRoot(selectedRoot, candidate);
        return candidate;
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
    return null;
  }

  private async *namedFiles(
    selectedRoot: string,
    start: string,
    fileName: string,
    signal: AbortSignal,
  ): AsyncGenerator<string> {
    const pending = [start];
    while (pending.length > 0) {
      throwIfAborted(signal);
      const current = pending.pop()!;
      await assertPathPhysicallyUnderRoot(selectedRoot, current);
      const directory = await opendir(current);
      try {
        for await (const entry of directory) {
          throwIfAborted(signal);
          if (entry.isSymbolicLink()) continue;
          const child = resolve(current, entry.name);
          if (entry.isDirectory()) pending.push(child);
          else if (entry.isFile() && entry.name.toLowerCase() === fileName) yield child;
        }
      } finally {
        await directory.close().catch(() => undefined);
      }
    }
  }
}
