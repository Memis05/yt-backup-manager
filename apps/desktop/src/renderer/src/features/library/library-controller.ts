import { useCallback, useMemo, useState } from 'react';

import type {
  ChannelDto,
  IntegrityIssueDto,
  LibraryQueryResult,
  MediaBackupDetails,
  PlaylistMembersResult,
  PlaylistQueryResult,
} from '@ytbm/core';

import type { AppRoute } from '../../app/routes';
import {
  useLibraryChannelsController,
  useLibraryController,
  useMediaDetailsController,
  usePlaylistMembersController,
  usePlaylistsController,
} from '../controllers';
import {
  MEDIA_PAGE_SIZE,
  PLAYLIST_MEMBER_PAGE_SIZE,
  PLAYLIST_PAGE_SIZE,
  safeLibraryMessage,
  type LibrarySessionViewState,
} from './library-model';

interface KeyedValue<T> {
  key: string;
  value: T;
}

interface KeyedError {
  key: string;
  message: string;
}

export interface MediaDetailsSnapshot {
  details: MediaBackupDetails;
  issues: IntegrityIssueDto[];
}

export interface LibraryFeatureSnapshot {
  channels: ChannelDto[] | null;
  channelsError: string | null;
  media: LibraryQueryResult | null;
  mediaPending: boolean;
  mediaError: string | null;
  playlists: PlaylistQueryResult | null;
  playlistsPending: boolean;
  playlistsError: string | null;
  playlistMembers: PlaylistMembersResult | null;
  playlistMembersPending: boolean;
  playlistMembersError: string | null;
  mediaDetails: MediaDetailsSnapshot | null;
  mediaDetailsPending: boolean;
  mediaDetailsError: string | null;
  refreshChannels(): Promise<void>;
  refreshMedia(): Promise<void>;
  refreshPlaylists(): Promise<void>;
  refreshPlaylistMembers(): Promise<void>;
  refreshMediaDetails(): Promise<void>;
}

export function useLibraryFeatureController(
  route: Extract<AppRoute, { area: 'library' }>,
  viewState: LibrarySessionViewState,
): LibraryFeatureSnapshot {
  const [channels, setChannels] = useState<ChannelDto[] | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [mediaState, setMediaState] = useState<KeyedValue<LibraryQueryResult> | null>(null);
  const [mediaErrorState, setMediaErrorState] = useState<KeyedError | null>(null);
  const [playlistState, setPlaylistState] = useState<KeyedValue<PlaylistQueryResult> | null>(null);
  const [playlistErrorState, setPlaylistErrorState] = useState<KeyedError | null>(null);
  const [memberState, setMemberState] = useState<KeyedValue<PlaylistMembersResult> | null>(null);
  const [memberErrorState, setMemberErrorState] = useState<KeyedError | null>(null);
  const [detailState, setDetailState] = useState<KeyedValue<MediaDetailsSnapshot> | null>(null);
  const [detailErrorState, setDetailErrorState] = useState<KeyedError | null>(null);

  const mediaEnabled = route.view === 'media' && route.entityId === undefined;
  const playlistsEnabled = route.view === 'playlists';
  const membersEnabled = route.view === 'playlists' && route.entityId !== undefined;
  const detailsEnabled = route.view === 'media' && route.entityId !== undefined;

  const mediaKey = useMemo(
    () =>
      JSON.stringify([
        viewState.mediaSearch,
        viewState.mediaChannelId,
        viewState.mediaType,
        viewState.mediaSourceStatus,
        viewState.mediaPage,
      ]),
    [
      viewState.mediaChannelId,
      viewState.mediaPage,
      viewState.mediaSearch,
      viewState.mediaSourceStatus,
      viewState.mediaType,
    ],
  );
  const playlistKey = useMemo(
    () =>
      JSON.stringify([
        viewState.playlistSearch,
        viewState.playlistChannelId,
        viewState.playlistPage,
      ]),
    [viewState.playlistChannelId, viewState.playlistPage, viewState.playlistSearch],
  );
  const memberKey = `${route.entityId ?? ''}:${viewState.playlistMemberPage}`;
  const detailKey = route.entityId ?? '';

  const channelsController = useLibraryChannelsController<ChannelDto[]>({
    request: () => window.ytbm.listChannels(),
    onSuccess: (result) => {
      setChannels(result);
      setChannelsError(null);
    },
    onError: (error) => setChannelsError(safeLibraryMessage(error)),
  });

  const mediaController = useLibraryController<LibraryQueryResult>({
    enabled: mediaEnabled,
    queryKey: mediaKey,
    request: () =>
      window.ytbm.queryLibrary({
        search: viewState.mediaSearch,
        channelId: viewState.mediaChannelId,
        mediaType: viewState.mediaType,
        sourceStatus: viewState.mediaSourceStatus,
        page: viewState.mediaPage,
        pageSize: MEDIA_PAGE_SIZE,
      }),
    onSuccess: (result) => {
      setMediaState({ key: mediaKey, value: result });
      setMediaErrorState(null);
    },
    onError: (error) => setMediaErrorState({ key: mediaKey, message: safeLibraryMessage(error) }),
  });

  const playlistsController = usePlaylistsController<PlaylistQueryResult>({
    enabled: playlistsEnabled,
    queryKey: playlistKey,
    request: () =>
      window.ytbm.queryPlaylists({
        channelId: viewState.playlistChannelId,
        search: viewState.playlistSearch,
        page: viewState.playlistPage,
        pageSize: PLAYLIST_PAGE_SIZE,
      }),
    onSuccess: (result) => {
      setPlaylistState({ key: playlistKey, value: result });
      setPlaylistErrorState(null);
    },
    onError: (error) =>
      setPlaylistErrorState({ key: playlistKey, message: safeLibraryMessage(error) }),
  });

  const membersController = usePlaylistMembersController<PlaylistMembersResult>({
    enabled: membersEnabled,
    queryKey: memberKey,
    request: () => {
      if (route.entityId === undefined) throw new Error('No playlist is selected.');
      return window.ytbm.queryPlaylistMembers({
        playlistId: route.entityId,
        page: viewState.playlistMemberPage,
        pageSize: PLAYLIST_MEMBER_PAGE_SIZE,
      });
    },
    onSuccess: (result) => {
      setMemberState({ key: memberKey, value: result });
      setMemberErrorState(null);
    },
    onError: (error) => setMemberErrorState({ key: memberKey, message: safeLibraryMessage(error) }),
  });

  const detailsController = useMediaDetailsController<MediaDetailsSnapshot>({
    enabled: detailsEnabled,
    queryKey: detailKey,
    request: async () => {
      if (route.entityId === undefined) throw new Error('No media item is selected.');
      const details = await window.ytbm.getMediaBackupDetails(route.entityId);
      const integrity = await window.ytbm.getIntegrityOverview().catch(() => null);
      return {
        details,
        issues: integrity?.issues.filter((issue) => issue.mediaItemId === route.entityId) ?? [],
      };
    },
    onSuccess: (result) => {
      setDetailState({ key: detailKey, value: result });
      setDetailErrorState(null);
    },
    onError: (error) => setDetailErrorState({ key: detailKey, message: safeLibraryMessage(error) }),
  });

  const refreshChannels = useCallback(async () => {
    setChannelsError(null);
    await channelsController.refresh();
  }, [channelsController]);
  const refreshMedia = useCallback(async () => {
    setMediaErrorState(null);
    await mediaController.refresh();
  }, [mediaController]);
  const refreshPlaylists = useCallback(async () => {
    setPlaylistErrorState(null);
    await playlistsController.refresh();
  }, [playlistsController]);
  const refreshPlaylistMembers = useCallback(async () => {
    setMemberErrorState(null);
    await membersController.refresh();
  }, [membersController]);
  const refreshMediaDetails = useCallback(async () => {
    setDetailErrorState(null);
    await detailsController.refresh();
  }, [detailsController]);

  return {
    channels,
    channelsError,
    media: mediaState?.value ?? null,
    mediaPending: mediaEnabled && mediaState?.key !== mediaKey && mediaErrorState?.key !== mediaKey,
    mediaError: mediaErrorState?.key === mediaKey ? mediaErrorState.message : null,
    playlists: playlistState?.value ?? null,
    playlistsPending:
      playlistsEnabled &&
      playlistState?.key !== playlistKey &&
      playlistErrorState?.key !== playlistKey,
    playlistsError: playlistErrorState?.key === playlistKey ? playlistErrorState.message : null,
    playlistMembers: memberState?.key === memberKey ? memberState.value : null,
    playlistMembersPending:
      membersEnabled && memberState?.key !== memberKey && memberErrorState?.key !== memberKey,
    playlistMembersError: memberErrorState?.key === memberKey ? memberErrorState.message : null,
    mediaDetails: detailState?.key === detailKey ? detailState.value : null,
    mediaDetailsPending:
      detailsEnabled && detailState?.key !== detailKey && detailErrorState?.key !== detailKey,
    mediaDetailsError: detailErrorState?.key === detailKey ? detailErrorState.message : null,
    refreshChannels,
    refreshMedia,
    refreshPlaylists,
    refreshPlaylistMembers,
    refreshMediaDetails,
  };
}
