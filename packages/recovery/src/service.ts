import type { RecoverySessionDto } from '@ytbm/core';
import type { WorkerDatabase } from '@ytbm/database/worker';
import type { GoogleDriveStorageProvider, VolumeIdentityProvider } from '@ytbm/storage-core';
import { WindowsVolumeIdentityProvider } from '@ytbm/storage-filesystem';

import { GoogleDriveBackupScanner } from './drive-scanner';
import { RecoveryImporter } from './importer';
import { LocalBackupScanner } from './local-scanner';
import { RecoveryRepository } from './repository';
import { RecoveryCancelledError } from './types';

export interface RecoveryServiceOptions {
  database: WorkerDatabase;
  googleDriveStorage: GoogleDriveStorageProvider;
  volumeIdentity?: VolumeIdentityProvider;
  now?: () => number;
}

export class RecoveryService {
  private readonly repository: RecoveryRepository;
  private readonly localScanner: LocalBackupScanner;
  private readonly driveScanner: GoogleDriveBackupScanner;
  private readonly importer: RecoveryImporter;
  private readonly volumeIdentity: VolumeIdentityProvider;
  private readonly active = new Map<string, AbortController>();

  public constructor(options: RecoveryServiceOptions) {
    this.repository = new RecoveryRepository(options.database, options.now);
    this.localScanner = new LocalBackupScanner(this.repository);
    this.driveScanner = new GoogleDriveBackupScanner(this.repository, options.googleDriveStorage);
    this.importer = new RecoveryImporter(this.repository, options.now);
    this.volumeIdentity = options.volumeIdentity ?? new WindowsVolumeIdentityProvider();
    this.repository.recoverInterruptedSessions();
  }

  public createSession(): RecoverySessionDto {
    return this.repository.createSession();
  }

  public latestSession(): RecoverySessionDto | null {
    return this.repository.latestSession();
  }

  public getSession(sessionId: string): RecoverySessionDto {
    return this.repository.getSession(sessionId);
  }

  public async addLocalSource(sessionId: string, rootPath: string): Promise<RecoverySessionDto> {
    const identity = await this.volumeIdentity.identify(rootPath);
    return this.repository.addLocalSource(sessionId, rootPath, identity);
  }

  public addDriveSource(sessionId: string, accountId: string): RecoverySessionDto {
    return this.repository.addDriveSource(sessionId, accountId);
  }

  public setDriveRootSelected(
    sessionId: string,
    sourceId: string,
    providerRootId: string,
    selected: boolean,
  ): RecoverySessionDto {
    return this.repository.setDriveRootSelected(sessionId, sourceId, providerRootId, selected);
  }

  public startScan(sessionId: string): RecoverySessionDto {
    if (this.active.has(sessionId)) throw new Error('Recovery work is already active');
    const session = this.repository.getSession(sessionId);
    if (session.sources.length === 0) throw new Error('Add at least one recovery source');
    if (session.status === 'IMPORTING') throw new Error('Recovery import is already active');
    this.repository.resetCandidates(sessionId);
    this.repository.setSessionStatus(sessionId, 'SCANNING');
    this.repository.setProgress(sessionId, 'SOURCES', 0, session.sources.length);
    const controller = new AbortController();
    this.active.set(sessionId, controller);
    void this.scan(sessionId, controller).finally(() => this.active.delete(sessionId));
    return this.repository.getSession(sessionId);
  }

  public startImport(sessionId: string): RecoverySessionDto {
    if (this.active.has(sessionId)) throw new Error('Recovery work is already active');
    const session = this.repository.getSession(sessionId);
    if (session.status !== 'READY_FOR_REVIEW') {
      throw new Error('Scan and review the recovery sources before restoring');
    }
    this.repository.setSessionStatus(sessionId, 'IMPORTING');
    this.repository.setProgress(sessionId, 'IMPORT', 0, null);
    const controller = new AbortController();
    this.active.set(sessionId, controller);
    void this.import(sessionId, controller).finally(() => this.active.delete(sessionId));
    return this.repository.getSession(sessionId);
  }

  public cancel(sessionId: string): RecoverySessionDto {
    this.repository.requestCancel(sessionId);
    this.active.get(sessionId)?.abort();
    return this.repository.getSession(sessionId);
  }

  public isIdle(): boolean {
    return this.active.size === 0;
  }

  public async stop(): Promise<void> {
    for (const controller of this.active.values()) controller.abort();
    while (this.active.size > 0) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  private async scan(sessionId: string, controller: AbortController): Promise<void> {
    try {
      const sources = this.repository.listSources(sessionId);
      let successful = 0;
      for (const [index, source] of sources.entries()) {
        if (controller.signal.aborted) throw new RecoveryCancelledError();
        this.repository.setSourceStatus(source.id, 'SCANNING');
        this.repository.setProgress(sessionId, 'SOURCES', index, sources.length);
        try {
          if (source.sourceType === 'FILESYSTEM') {
            this.repository.setProgress(sessionId, 'LOCAL_SCAN', 0, null);
            await this.localScanner.scan(source, controller.signal);
            this.repository.setSourceStatus(source.id, 'SCANNED', null, 1);
          } else {
            const roots = await this.driveScanner.scan(source, controller.signal);
            this.repository.setSourceStatus(source.id, 'SCANNED', null, roots);
          }
          successful += 1;
        } catch (error) {
          if (error instanceof RecoveryCancelledError) throw error;
          const message =
            source.sourceType === 'GOOGLE_DRIVE'
              ? 'Google Drive could not be scanned. Reauthorize this account and try again.'
              : 'This local backup source could not be scanned safely.';
          this.repository.setSourceStatus(source.id, 'FAILED', message);
          this.repository.addWarning(sessionId, {
            sourceId: source.id,
            code: source.sourceType === 'GOOGLE_DRIVE' ? 'DRIVE_AUTH_REQUIRED' : 'MANIFEST_INVALID',
            entityKey: null,
            safeMessage: message,
          });
        }
      }
      this.repository.detectHashConflicts(sessionId);
      this.repository.detectUnknownPlaylistReferences(sessionId);
      this.detectAmbiguousLocalSources(sessionId);
      this.repository.setProgress(sessionId, 'SOURCES', sources.length, sources.length);
      if (successful === 0) {
        this.repository.setSessionStatus(
          sessionId,
          'FAILED',
          'None of the selected backup sources could be scanned.',
        );
      } else {
        this.repository.setSessionStatus(sessionId, 'READY_FOR_REVIEW');
      }
    } catch (error) {
      if (error instanceof RecoveryCancelledError) {
        for (const source of this.repository.listSources(sessionId)) {
          if (source.status === 'SCANNING') this.repository.setSourceStatus(source.id, 'CANCELLED');
        }
        this.repository.setSessionStatus(sessionId, 'CANCELLED', 'Recovery scan was cancelled.');
        return;
      }
      this.repository.setSessionStatus(sessionId, 'FAILED', 'Recovery scan failed safely.');
    }
  }

  private async import(sessionId: string, controller: AbortController): Promise<void> {
    try {
      await this.importer.import(sessionId, controller.signal);
      const warnings = this.repository.getSession(sessionId).counts.warnings;
      this.repository.setSessionStatus(
        sessionId,
        warnings > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
      );
    } catch (error) {
      if (error instanceof RecoveryCancelledError) {
        this.repository.setSessionStatus(
          sessionId,
          'READY_FOR_REVIEW',
          'Recovery import was cancelled at a safe batch boundary. Confirm restore to resume.',
        );
        return;
      }
      this.repository.setSessionStatus(
        sessionId,
        'READY_FOR_REVIEW',
        'Recovery import stopped safely. Confirm restore to retry idempotently.',
      );
    }
  }

  private detectAmbiguousLocalSources(sessionId: string): void {
    const sources = this.repository
      .listSources(sessionId)
      .filter((source) => source.sourceType === 'FILESYSTEM');
    for (let left = 0; left < sources.length; left += 1) {
      for (let right = left + 1; right < sources.length; right += 1) {
        const first = sources[left]!;
        const second = sources[right]!;
        const sameVolume =
          (first.volumeGuid !== null && first.volumeGuid === second.volumeGuid) ||
          (first.volumeGuid === null &&
            first.volumeSerial !== null &&
            first.volumeSerial === second.volumeSerial);
        if (!sameVolume || first.rootPath === second.rootPath) continue;
        this.repository.addWarning(sessionId, {
          sourceId: null,
          code: 'AMBIGUOUS_DESTINATION',
          entityKey: `${first.id}:${second.id}`,
          safeMessage:
            'Multiple selected local backup roots report the same volume identity; they will remain independent destinations.',
        });
      }
    }
  }
}
