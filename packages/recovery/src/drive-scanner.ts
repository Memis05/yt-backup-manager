import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { BackupOperationError } from '@ytbm/core';
import type { GoogleDriveStorageProvider, StoredGoogleDriveDestination } from '@ytbm/storage-core';
import { archiveFolderName } from '@ytbm/storage-filesystem';

import type { PersistedDriveObject, RecoveryRepository } from './repository';
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

function parseJson(text: string): unknown {
  const value = JSON.parse(text) as unknown;
  if (jsonDepth(value) > 64) throw new Error('Recovery JSON is nested too deeply');
  return value;
}

function modifiedTimestamp(object: PersistedDriveObject, fallback: number): number {
  return object.modifiedAt ?? fallback;
}

export class GoogleDriveBackupScanner {
  public constructor(
    private readonly repository: RecoveryRepository,
    private readonly drive: GoogleDriveStorageProvider,
  ) {}

  public async scan(source: RecoverySourceRecord, signal: AbortSignal): Promise<number> {
    if (source.accountId === null) throw new Error('Drive recovery source has no account');
    const destination: StoredGoogleDriveDestination = {
      id: source.id,
      accountId: source.accountId,
      providerRootId: null,
    };
    let pageToken: string | null = null;
    let listed = 0;
    do {
      throwIfAborted(signal);
      const page = await this.withRetry(
        () => this.drive.listRecoveryObjects({ destination, pageToken, signal }),
        signal,
      );
      this.repository.persistDriveObjects(
        source.sessionId,
        page.objects.map((object) => ({ sourceId: source.id, object })),
      );
      listed += page.objects.length;
      pageToken = page.nextPageToken;
      this.repository.setProgress(source.sessionId, 'DRIVE_LIST', listed, null);
    } while (pageToken !== null);

    const roots = this.repository.listDriveRoots(source.sessionId, source.id);
    if (roots.length === 0) {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'MANIFEST_MISSING',
        entityKey: null,
        safeMessage: 'No app-created Google Drive backup root was discovered for this account.',
      });
      return 0;
    }
    if (roots.length > 1) {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'DRIVE_ROOT_DUPLICATE',
        entityKey: null,
        safeMessage:
          'Multiple app-created Google Drive backup roots were found and will be restored independently.',
      });
    }
    this.repository.setSourceStatus(source.id, 'SCANNING', null, roots.length);
    let processed = 0;
    for (const root of roots) {
      throwIfAborted(signal);
      if (!root.selectedForImport) continue;
      const manifests = this.repository.listRootManifestObjects(
        source.sessionId,
        source.id,
        root.providerObjectId,
      );
      if (manifests.length === 0) {
        this.repository.addWarning(source.sessionId, {
          sourceId: source.id,
          code: 'MANIFEST_MISSING',
          entityKey: root.providerObjectId,
          safeMessage: 'A discovered Google Drive backup root contains no channel manifest.',
        });
        await this.scanStandaloneRoot(source, destination, root, signal);
        continue;
      }
      let validManifests = 0;
      for (const manifestObject of manifests) {
        throwIfAborted(signal);
        if (await this.scanManifest(source, destination, root, manifestObject, signal)) {
          validManifests += 1;
        }
        processed += 1;
        this.repository.setProgress(
          source.sessionId,
          'DRIVE_SIDECARS',
          processed,
          manifests.length,
        );
      }
      await this.scanStandaloneRoot(source, destination, root, signal, validManifests > 0);
    }
    return roots.length;
  }

  private async scanManifest(
    source: RecoverySourceRecord,
    destination: StoredGoogleDriveDestination,
    root: PersistedDriveObject,
    manifestObject: PersistedDriveObject,
    signal: AbortSignal,
  ): Promise<boolean> {
    let manifest: ReturnType<typeof parseRecoveryChannelManifest>;
    try {
      const manifestText = await this.withRetry(
        () =>
          this.drive.getTextContent({
            destination,
            providerFileId: manifestObject.providerObjectId,
            maximumBytes: MAX_MANIFEST_JSON_BYTES,
            signal,
          }),
        signal,
      );
      manifest = parseRecoveryChannelManifest(parseJson(manifestText));
      const providerChannelId = safeProviderId(manifest.providerChannelId, 'channel');
      const versions = this.repository.findRootObjectByLogicalKey(
        source.sessionId,
        source.id,
        root.providerObjectId,
        `channel:${providerChannelId}:version`,
      );
      if (versions.length > 0) {
        const versionText = await this.withRetry(
          () =>
            this.drive.getTextContent({
              destination,
              providerFileId: versions[0]!.providerObjectId,
              maximumBytes: MAX_METADATA_JSON_BYTES,
              signal,
            }),
          signal,
        );
        parseRecoveryManifestVersion(parseJson(versionText));
      }
    } catch {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'MANIFEST_INVALID',
        entityKey: manifestObject.providerObjectId,
        safeMessage: 'A Google Drive channel manifest is malformed or could not be read safely.',
      });
      return false;
    }
    const providerChannelId = safeProviderId(manifest.providerChannelId, 'channel');
    this.repository.upsertChannel(source.sessionId, {
      sourceId: source.id,
      providerChannelId,
      title: manifest.channelTitle,
      sourceStatus: 'UNKNOWN',
      publishedAt: null,
      lastSeenAt: manifest.updatedAt,
      metadataUpdatedAt: manifest.updatedAt,
    });
    for (const entry of manifest.media) {
      throwIfAborted(signal);
      await this.scanMedia(source, destination, root, manifest, entry, signal);
    }
    for (const playlist of manifest.playlists) {
      throwIfAborted(signal);
      await this.scanPlaylist(source, destination, root, manifest, playlist, signal);
    }
    return true;
  }

  private async scanMedia(
    source: RecoverySourceRecord,
    destination: StoredGoogleDriveDestination,
    root: PersistedDriveObject,
    manifest: ReturnType<typeof parseRecoveryChannelManifest>,
    entry: ReturnType<typeof parseRecoveryChannelManifest>['media'][number],
    signal: AbortSignal,
  ): Promise<void> {
    let providerMediaId: string;
    try {
      providerMediaId = safeProviderId(entry.providerMediaId, 'media');
    } catch {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'MANIFEST_INVALID',
        entityKey: entry.providerMediaId,
        safeMessage: 'A Drive manifest media entry has an invalid stable identity.',
      });
      return;
    }
    const videos = this.repository.findRootObjectByLogicalKey(
      source.sessionId,
      source.id,
      root.providerObjectId,
      `media:${providerMediaId}:video`,
    );
    if (videos.length > 1) {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'DUPLICATE_OBJECT',
        entityKey: providerMediaId,
        safeMessage:
          'Multiple Drive media objects share one stable application identity; the newest is previewed.',
      });
    }
    const video = videos[0] ?? null;
    const metadataObjects = this.repository.findRootObjectByLogicalKey(
      source.sessionId,
      source.id,
      root.providerObjectId,
      `media:${providerMediaId}:metadata`,
    );
    const metadataObject = metadataObjects[0] ?? null;
    let metadata: ReturnType<typeof parseRecoveryMediaMetadata> | null = null;
    let metadataText: string | null = null;
    if (metadataObject !== null) {
      try {
        metadataText = await this.withRetry(
          () =>
            this.drive.getTextContent({
              destination,
              providerFileId: metadataObject.providerObjectId,
              maximumBytes: MAX_METADATA_JSON_BYTES,
              signal,
            }),
          signal,
        );
        const parsed = parseRecoveryMediaMetadata(parseJson(metadataText));
        if (
          parsed.providerMediaId !== providerMediaId ||
          parsed.channelId !== manifest.providerChannelId
        ) {
          throw new Error('Drive media metadata identity is invalid');
        }
        metadata = parsed;
      } catch {
        this.repository.addWarning(source.sessionId, {
          sourceId: source.id,
          code: 'METADATA_INVALID',
          entityKey: providerMediaId,
          safeMessage: 'One Drive media metadata sidecar is malformed; manifest data was retained.',
        });
      }
    } else {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'ORPHAN_METADATA',
        entityKey: providerMediaId,
        safeMessage: 'A Drive media entry has no metadata sidecar.',
      });
    }
    const metadataUpdatedAt =
      metadata?.lastSourceSyncAt ??
      metadata?.verifiedAt ??
      modifiedTimestamp(
        metadataObject ?? manifestObjectFallback(manifest.updatedAt),
        manifest.updatedAt,
      );
    const title = metadata?.currentTitle ?? providerMediaId;
    this.repository.upsertChannel(source.sessionId, {
      sourceId: source.id,
      providerChannelId: manifest.providerChannelId,
      title: metadata?.channelTitle ?? manifest.channelTitle,
      sourceStatus: metadata?.sourceStatus ?? 'UNKNOWN',
      publishedAt: null,
      lastSeenAt: metadata?.lastSourceSyncAt ?? manifest.updatedAt,
      metadataUpdatedAt,
    });
    this.repository.upsertMedia(source.sessionId, {
      sourceId: source.id,
      providerChannelId: manifest.providerChannelId,
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
    let status: 'VERIFIED' | 'MISSING' | 'CORRUPT' = 'VERIFIED';
    if (video === null) {
      status = 'MISSING';
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'DRIVE_OBJECT_MISSING',
        entityKey: providerMediaId,
        safeMessage: 'A Drive media object referenced by the manifest is missing.',
      });
    } else if (
      video.bytes !== entry.bytes ||
      (video.appProperties.sha256 !== undefined && video.appProperties.sha256 !== entry.sha256)
    ) {
      status = 'CORRUPT';
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'SIZE_MISMATCH',
        entityKey: providerMediaId,
        safeMessage:
          'A Drive media object does not match its manifest size or expected SHA-256 metadata.',
      });
    }
    const channelDirectory = archiveFolderName(manifest.channelTitle, manifest.providerChannelId);
    this.repository.insertCopy(source.sessionId, {
      sourceId: source.id,
      providerRootId: root.providerObjectId,
      providerMediaId,
      destinationType: 'GOOGLE_DRIVE',
      relativePath: posix.join(channelDirectory, entry.mediaFile.replaceAll('\\', '/')),
      providerFileId: video?.providerObjectId ?? null,
      container: metadata?.container ?? (posix.extname(entry.mediaFile).slice(1) || null),
      videoCodec: metadata?.videoCodec ?? null,
      audioCodec: metadata?.audioCodec ?? null,
      width: metadata?.width ?? null,
      height: metadata?.height ?? null,
      fps: metadata?.fps ?? null,
      bytes: entry.bytes,
      sha256: entry.sha256,
      qualityProfile: metadata?.selectedQualityProfile ?? null,
      verificationStrength: 'PROVIDER_METADATA_SIZE',
      status,
      verifiedAt: metadata?.verifiedAt ?? manifest.updatedAt,
      metadataUpdatedAt,
      providerMetadata: {
        fastRecoveryScan: true,
        parents:
          video?.parentProviderObjectId === null || video?.parentProviderObjectId === undefined
            ? []
            : [video.parentProviderObjectId],
        appProperties: video?.appProperties ?? {},
      },
    });
    if (metadataObject !== null && metadataText !== null) {
      this.repository.insertArtifact(source.sessionId, {
        sourceId: source.id,
        providerRootId: root.providerObjectId,
        providerMediaId,
        artifactType: 'METADATA',
        relativePath: posix.join(channelDirectory, entry.metadataFile.replaceAll('\\', '/')),
        providerFileId: metadataObject.providerObjectId,
        bytes: Buffer.byteLength(metadataText, 'utf8'),
        sha256: createHash('sha256').update(metadataText).digest('hex'),
        status: 'VERIFIED',
        metadataUpdatedAt,
      });
    }
    const thumbnails = this.repository.findRootObjectByLogicalKey(
      source.sessionId,
      source.id,
      root.providerObjectId,
      `media:${providerMediaId}:thumbnail`,
    );
    if (thumbnails[0] !== undefined) {
      const thumbnail = thumbnails[0];
      this.repository.insertArtifact(source.sessionId, {
        sourceId: source.id,
        providerRootId: root.providerObjectId,
        providerMediaId,
        artifactType: 'THUMBNAIL',
        relativePath:
          entry.thumbnailFile === undefined
            ? null
            : posix.join(channelDirectory, entry.thumbnailFile.replaceAll('\\', '/')),
        providerFileId: thumbnail.providerObjectId,
        bytes: thumbnail.bytes,
        sha256: thumbnail.appProperties.sha256 ?? null,
        status: 'VERIFIED',
        metadataUpdatedAt,
      });
    }
  }

  private async scanStandaloneRoot(
    source: RecoverySourceRecord,
    destination: StoredGoogleDriveDestination,
    root: PersistedDriveObject,
    signal: AbortSignal,
    orphaned = false,
  ): Promise<void> {
    const metadataObjects = this.repository.listRootObjectsByLogicalKeyPattern(
      source.sessionId,
      source.id,
      root.providerObjectId,
      'media:%:metadata',
    );
    let recovered = 0;
    for (const metadataObject of metadataObjects) {
      throwIfAborted(signal);
      try {
        const text = await this.withRetry(
          () =>
            this.drive.getTextContent({
              destination,
              providerFileId: metadataObject.providerObjectId,
              maximumBytes: MAX_METADATA_JSON_BYTES,
              signal,
            }),
          signal,
        );
        const metadata = parseRecoveryMediaMetadata(parseJson(text));
        const providerMediaId = safeProviderId(metadata.providerMediaId, 'media');
        const providerChannelId = safeProviderId(metadata.channelId, 'channel');
        if (this.repository.hasMediaCandidate(source.sessionId, source.id, providerMediaId)) {
          continue;
        }
        const updatedAt = metadata.lastSourceSyncAt ?? metadata.verifiedAt;
        const videos = this.repository.findRootObjectByLogicalKey(
          source.sessionId,
          source.id,
          root.providerObjectId,
          `media:${providerMediaId}:video`,
        );
        const video = videos[0] ?? null;
        let status: 'VERIFIED' | 'MISSING' | 'CORRUPT' = 'VERIFIED';
        if (video === null) status = 'MISSING';
        else if (
          video.bytes !== metadata.bytes ||
          (video.appProperties.sha256 !== undefined &&
            video.appProperties.sha256 !== metadata.sha256)
        ) {
          status = 'CORRUPT';
        }
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
        this.repository.insertCopy(source.sessionId, {
          sourceId: source.id,
          providerRootId: root.providerObjectId,
          providerMediaId,
          destinationType: 'GOOGLE_DRIVE',
          relativePath:
            video === null
              ? null
              : posix.join(
                  archiveFolderName(metadata.channelTitle, providerChannelId),
                  video.currentName,
                ),
          providerFileId: video?.providerObjectId ?? null,
          container: metadata.container,
          videoCodec: metadata.videoCodec ?? null,
          audioCodec: metadata.audioCodec ?? null,
          width: metadata.width ?? null,
          height: metadata.height ?? null,
          fps: metadata.fps ?? null,
          bytes: metadata.bytes,
          sha256: metadata.sha256,
          qualityProfile: metadata.selectedQualityProfile,
          verificationStrength: 'PROVIDER_METADATA_SIZE',
          status,
          verifiedAt: metadata.verifiedAt,
          metadataUpdatedAt: updatedAt,
          providerMetadata: {
            fastRecoveryScan: true,
            standaloneSidecar: true,
            appProperties: video?.appProperties ?? {},
          },
        });
        this.repository.insertArtifact(source.sessionId, {
          sourceId: source.id,
          providerRootId: root.providerObjectId,
          providerMediaId,
          artifactType: 'METADATA',
          relativePath: null,
          providerFileId: metadataObject.providerObjectId,
          bytes: Buffer.byteLength(text, 'utf8'),
          sha256: createHash('sha256').update(text).digest('hex'),
          status: 'VERIFIED',
          metadataUpdatedAt: updatedAt,
        });
        if (status !== 'VERIFIED') {
          this.repository.addWarning(source.sessionId, {
            sourceId: source.id,
            code: status === 'MISSING' ? 'DRIVE_OBJECT_MISSING' : 'SIZE_MISMATCH',
            entityKey: providerMediaId,
            safeMessage:
              status === 'MISSING'
                ? 'A standalone Drive metadata sidecar has no media object.'
                : 'A standalone Drive media object does not match its metadata sidecar.',
          });
        }
        recovered += 1;
        if (orphaned) {
          this.repository.addWarning(source.sessionId, {
            sourceId: source.id,
            code: 'ORPHAN_METADATA',
            entityKey: metadataObject.providerObjectId,
            safeMessage:
              'A valid Drive media sidecar was not referenced by a manifest and was recovered independently.',
          });
        }
      } catch {
        this.repository.addWarning(source.sessionId, {
          sourceId: source.id,
          code: 'METADATA_INVALID',
          entityKey: metadataObject.providerObjectId,
          safeMessage: 'A standalone Drive metadata sidecar is malformed and was skipped.',
        });
      }
    }
    const playlistObjects = this.repository.listRootObjectsByLogicalKeyPattern(
      source.sessionId,
      source.id,
      root.providerObjectId,
      'playlist:%:sidecar',
    );
    for (const playlistObject of playlistObjects) {
      throwIfAborted(signal);
      try {
        const text = await this.withRetry(
          () =>
            this.drive.getTextContent({
              destination,
              providerFileId: playlistObject.providerObjectId,
              maximumBytes: MAX_PLAYLIST_JSON_BYTES,
              signal,
            }),
          signal,
        );
        const playlist = parseRecoveryPlaylist(parseJson(text));
        if (
          this.repository.hasPlaylistCandidate(
            source.sessionId,
            source.id,
            playlist.providerPlaylistId,
          )
        ) {
          continue;
        }
        this.repository.upsertPlaylist(source.sessionId, {
          sourceId: source.id,
          providerChannelId: safeProviderId(playlist.channelId, 'channel'),
          providerPlaylistId: safeProviderId(playlist.providerPlaylistId, 'playlist'),
          title: playlist.title,
          sourceStatus: playlist.sourceStatus,
          metadataUpdatedAt: playlist.updatedAt,
          items: playlist.items.map((item) => ({
            providerMediaId: safeProviderId(item.providerMediaId, 'media'),
            position: item.position,
          })),
        });
      } catch {
        this.repository.addWarning(source.sessionId, {
          sourceId: source.id,
          code: 'PLAYLIST_INVALID',
          entityKey: playlistObject.providerObjectId,
          safeMessage: 'A standalone Drive playlist sidecar is malformed and was skipped.',
        });
      }
    }
    if (recovered > 0 && !orphaned) {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'PARTIAL_BACKUP',
        entityKey: root.providerObjectId,
        safeMessage: 'Drive manifests are unusable, so healthy standalone sidecars were recovered.',
      });
    }
  }

  private async scanPlaylist(
    source: RecoverySourceRecord,
    destination: StoredGoogleDriveDestination,
    root: PersistedDriveObject,
    manifest: ReturnType<typeof parseRecoveryChannelManifest>,
    entry: ReturnType<typeof parseRecoveryChannelManifest>['playlists'][number],
    signal: AbortSignal,
  ): Promise<void> {
    let providerPlaylistId: string;
    try {
      providerPlaylistId = safeProviderId(entry.providerPlaylistId, 'playlist');
    } catch {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'PLAYLIST_INVALID',
        entityKey: entry.providerPlaylistId,
        safeMessage: 'A Drive playlist has an invalid stable identity and was skipped.',
      });
      return;
    }
    const sidecars = this.repository.findRootObjectByLogicalKey(
      source.sessionId,
      source.id,
      root.providerObjectId,
      `playlist:${providerPlaylistId}:sidecar`,
    );
    let title = providerPlaylistId;
    let sourceStatus: 'AVAILABLE' | 'PRIVATE' | 'UNLISTED' | 'REMOVED' | 'UNAVAILABLE' | 'UNKNOWN' =
      'UNKNOWN';
    let updatedAt = manifest.updatedAt;
    let items: Array<{ providerMediaId: string; position: number | null }> = entry.mediaIds.map(
      (providerMediaId, position) => ({ providerMediaId, position }),
    );
    if (sidecars[0] !== undefined) {
      const sidecar = sidecars[0];
      try {
        const text = await this.withRetry(
          () =>
            this.drive.getTextContent({
              destination,
              providerFileId: sidecar.providerObjectId,
              maximumBytes: MAX_PLAYLIST_JSON_BYTES,
              signal,
            }),
          signal,
        );
        const parsed = parseRecoveryPlaylist(parseJson(text));
        if (
          parsed.providerPlaylistId !== providerPlaylistId ||
          parsed.channelId !== manifest.providerChannelId
        ) {
          throw new Error('Invalid playlist sidecar identity');
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
          safeMessage: 'A Drive playlist sidecar is malformed; manifest membership was retained.',
        });
      }
    } else {
      this.repository.addWarning(source.sessionId, {
        sourceId: source.id,
        code: 'PLAYLIST_INVALID',
        entityKey: providerPlaylistId,
        safeMessage: 'A Drive playlist sidecar is missing; manifest membership was retained.',
      });
    }
    this.repository.upsertPlaylist(source.sessionId, {
      sourceId: source.id,
      providerChannelId: manifest.providerChannelId,
      providerPlaylistId,
      title,
      sourceStatus,
      metadataUpdatedAt: updatedAt,
      items: items.flatMap((item) => {
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
      }),
    });
  }

  private async withRetry<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(signal);
      try {
        return await operation();
      } catch (error) {
        if (
          !(error instanceof BackupOperationError) ||
          error.disposition !== 'RETRY' ||
          attempt >= 3
        ) {
          throw error;
        }
        const delay = Math.min(error.retryAfterMs ?? 250 * 2 ** attempt, 2_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
}

function manifestObjectFallback(updatedAt: number): PersistedDriveObject {
  return {
    providerObjectId: 'manifest',
    parentProviderObjectId: null,
    currentName: 'manifest.json',
    mimeType: 'application/json',
    bytes: null,
    modifiedAt: updatedAt,
    logicalKey: null,
    objectType: null,
    appProperties: {},
    selectedForImport: true,
  };
}
