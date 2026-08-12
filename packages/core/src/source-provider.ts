import type { MediaType, SourceStatus } from './enums';

export interface SourceChannelRecord {
  providerChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  publishedAt: number | null;
}

export interface SourceMediaRecord {
  providerMediaId: string;
  providerChannelId: string;
  title: string;
  sourceUrl: string;
  sourceStatus: SourceStatus;
  visibility: string | null;
  publishedAt: number | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  mediaType: MediaType;
}

export interface SourcePlaylistRecord {
  providerPlaylistId: string;
  providerChannelId: string;
  title: string;
  sourceStatus: SourceStatus;
}

export interface SourcePlaylistMembershipRecord {
  providerMediaId: string;
  position: number | null;
}

export interface SourceSyncProgress {
  phase: 'MEDIA' | 'PLAYLISTS';
  completed: number;
  total: number | null;
}

export interface SourceSyncSink {
  writeMediaPage(items: SourceMediaRecord[]): Promise<void>;
  writePlaylistPage(items: SourcePlaylistRecord[]): Promise<void>;
  writePlaylistMembershipPage(
    providerPlaylistId: string,
    items: SourcePlaylistMembershipRecord[],
  ): Promise<void>;
  completePlaylistMembership(providerPlaylistId: string): Promise<void>;
  reportProgress(progress: SourceSyncProgress): Promise<void>;
}

export interface SourceSyncInput {
  accountId: string;
  providerChannelId: string;
}

export interface SourceSyncResult {
  mediaCount: number;
  playlistCount: number;
  playlistMembershipCount: number;
  authoritative: true;
}

export interface SourceProvider {
  readonly id: 'YOUTUBE';
  listChannels(accountId: string): Promise<SourceChannelRecord[]>;
  syncChannel(input: SourceSyncInput, sink: SourceSyncSink): Promise<SourceSyncResult>;
}
