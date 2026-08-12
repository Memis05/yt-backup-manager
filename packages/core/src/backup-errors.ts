import { BackupErrorCodeSchema, type BackupErrorCode, type DestinationAvailability } from './enums';

export type BackupFailureDisposition = 'RETRY' | 'BLOCK' | 'FAIL';

export interface BackupFailureOptions {
  disposition: BackupFailureDisposition;
  retryAfterMs?: number;
  cause?: unknown;
}

export class BackupOperationError extends Error {
  public readonly code: BackupErrorCode;
  public readonly disposition: BackupFailureDisposition;
  public readonly retryAfterMs: number | null;

  public constructor(code: BackupErrorCode, safeMessage: string, options: BackupFailureOptions) {
    super(safeMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BackupOperationError';
    this.code = BackupErrorCodeSchema.parse(code);
    this.disposition = options.disposition;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

export function destinationAvailabilityError(
  availability: DestinationAvailability,
  safeMessage?: string,
): BackupOperationError | null {
  switch (availability) {
    case 'AVAILABLE':
      return null;
    case 'DISCONNECTED':
      return new BackupOperationError(
        'DESTINATION_DISCONNECTED',
        safeMessage ?? 'The backup destination is disconnected.',
        { disposition: 'BLOCK' },
      );
    case 'READ_ONLY':
      return new BackupOperationError(
        'DESTINATION_READ_ONLY',
        safeMessage ?? 'The backup destination is read only.',
        { disposition: 'FAIL' },
      );
    case 'FULL':
      return new BackupOperationError(
        'DESTINATION_FULL',
        safeMessage ?? 'The backup destination does not have enough free space.',
        { disposition: 'FAIL' },
      );
    case 'AUTH_REQUIRED':
      return new BackupOperationError(
        'AUTH_REVOKED',
        safeMessage ?? 'The backup destination requires authentication.',
        { disposition: 'BLOCK' },
      );
    case 'ERROR':
      return new BackupOperationError(
        'COPY_FAILED',
        safeMessage ?? 'The backup destination could not be accessed.',
        { disposition: 'RETRY' },
      );
    case 'UNKNOWN':
      return new BackupOperationError(
        'DESTINATION_DISCONNECTED',
        safeMessage ?? 'The backup destination is not ready.',
        { disposition: 'BLOCK' },
      );
  }
}
