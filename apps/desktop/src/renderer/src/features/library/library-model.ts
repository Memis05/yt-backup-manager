import type {
  CopyStatus,
  DestinationAvailability,
  MediaBackupDetails,
  MediaLibraryItemDto,
  MediaType,
  SourceStatus,
} from '@ytbm/core';

export type MediaPresentation = 'grid' | 'list';

export interface LibrarySessionViewState {
  mediaPresentation: MediaPresentation;
  mediaSearch: string;
  mediaChannelId: string | null;
  mediaType: MediaType | null;
  mediaSourceStatus: SourceStatus | null;
  mediaPage: number;
  playlistSearch: string;
  playlistChannelId: string | null;
  playlistPage: number;
  playlistMemberPage: number;
}

export const DEFAULT_LIBRARY_SESSION_STATE: LibrarySessionViewState = {
  mediaPresentation: 'grid',
  mediaSearch: '',
  mediaChannelId: null,
  mediaType: null,
  mediaSourceStatus: null,
  mediaPage: 1,
  playlistSearch: '',
  playlistChannelId: null,
  playlistPage: 1,
  playlistMemberPage: 1,
};

export const MEDIA_PAGE_SIZE = 36;
export const PLAYLIST_PAGE_SIZE = 30;
export const PLAYLIST_MEMBER_PAGE_SIZE = 50;

export function safeLibraryMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The Library request could not be completed.';
}

export function isWorkerConnectionError(message: string): boolean {
  return /worker|rpc|ipc|timed out|disconnected|not available/i.test(message);
}

export function formatLibraryDate(value: number | null): string {
  if (value === null) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(value);
}

export function formatLibraryDuration(seconds: number | null): string {
  if (seconds === null) return 'Duration unavailable';
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatLibraryBytes(bytes: number | null): string {
  if (bytes === null) return 'Size unavailable';
  if (bytes < 1_024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1_024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index]!;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

const SOURCE_LABELS: Record<SourceStatus, string> = {
  AVAILABLE: 'Available on YouTube',
  PRIVATE: 'Private on YouTube',
  UNLISTED: 'Unlisted on YouTube',
  REMOVED: 'Removed from YouTube',
  UNAVAILABLE: 'Unavailable on YouTube',
  UNKNOWN: 'YouTube status unknown',
};

export function sourceStatusLabel(status: SourceStatus): string {
  return SOURCE_LABELS[status];
}

const COPY_LABELS: Record<CopyStatus, string> = {
  PENDING: 'Pending',
  TRANSFERRING: 'Transferring',
  VERIFYING: 'Verifying',
  VERIFIED: 'Verified',
  MISSING: 'Missing',
  CORRUPT: 'Corrupt',
  FAILED: 'Failed',
  UNAVAILABLE: 'Unavailable',
};

export function copyStatusLabel(status: CopyStatus): string {
  return COPY_LABELS[status];
}

const AVAILABILITY_LABELS: Record<DestinationAvailability, string> = {
  AVAILABLE: 'Available',
  DISCONNECTED: 'Disconnected',
  READ_ONLY: 'Read only',
  FULL: 'Full',
  AUTH_REQUIRED: 'Authorization required',
  ERROR: 'Unavailable',
  UNKNOWN: 'Availability unknown',
};

export function availabilityLabel(status: DestinationAvailability): string {
  return AVAILABILITY_LABELS[status];
}

export type MediaException = { label: string; tone: 'warning' | 'danger' | 'neutral' } | null;

export function mediaException(item: MediaLibraryItemDto): MediaException {
  if (item.copySummary.authRequiredCount > 0) {
    return { label: 'Drive authorization required', tone: 'warning' };
  }
  if (item.copySummary.attentionCount > 0) {
    return { label: 'Backup needs attention', tone: 'danger' };
  }
  if (item.copySummary.unavailableCount > 0) {
    return { label: 'Destination unavailable', tone: 'neutral' };
  }
  if (item.sourceStatus !== 'AVAILABLE' && item.sourceStatus !== 'UNLISTED') {
    return { label: sourceStatusLabel(item.sourceStatus), tone: 'warning' };
  }
  return null;
}

export function copySummaryLabel(item: MediaLibraryItemDto): string {
  const summary = item.copySummary;
  if (summary.authRequiredCount > 0) return 'Authorization required';
  if (summary.attentionCount > 0) return 'Backup needs attention';
  if (summary.unavailableCount > 0) return 'Destination unavailable';
  if (summary.pendingCount > 0) return 'Backup in progress';
  if (summary.copyCount === 0) return 'No backup copies';
  return `${summary.verifiedCount} verified ${summary.verifiedCount === 1 ? 'copy' : 'copies'}`;
}

export function mediaDetailsBackupLabel(details: MediaBackupDetails): string {
  if (details.copies.length === 0) return 'No backup copies';
  if (details.copies.some((copy) => ['MISSING', 'CORRUPT', 'FAILED'].includes(copy.status))) {
    return 'Needs attention';
  }
  if (details.copies.some((copy) => copy.status === 'UNAVAILABLE')) return 'Unavailable';
  if (details.copies.some((copy) => copy.status !== 'VERIFIED')) return 'In progress';
  return `${details.copies.length} verified ${details.copies.length === 1 ? 'copy' : 'copies'}`;
}
