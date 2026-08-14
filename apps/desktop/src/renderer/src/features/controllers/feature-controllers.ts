import {
  useDebouncedController,
  useLoadController,
  usePollingController,
  type AsyncControllerOptions,
  type FeatureController,
} from './controller-core';

export const CONTROLLER_CADENCE_MS = {
  oauthStatus: 1_000,
  sourceSync: 1_000,
  activity: 1_000,
  integrity: 2_000,
  recovery: 750,
  library: 200,
  playlists: 200,
} as const;

const CONTROLLER_OWNER = {
  oauthStatus: 'oauth-status',
  sourceSync: 'source-sync',
  activity: 'activity',
  integrity: 'integrity',
  recovery: 'recovery',
  library: 'library',
  playlists: 'playlists',
  libraryChannels: 'library-channels',
  playlistMembers: 'playlist-members',
  mediaDetails: 'media-details',
  backup: 'backup',
  settings: 'settings',
} as const;

export interface DebouncedFeatureControllerOptions<Result> extends AsyncControllerOptions<Result> {
  /** Stable serialization of every filter/page input used by `request`. */
  queryKey: string;
}

export interface PollingFeatureControllerOptions<Result> extends AsyncControllerOptions<Result> {
  /** Stable identity for a flow, session, filter, or page owned by the poller. */
  queryKey?: string;
}

export interface LoadFeatureControllerOptions<Result> extends AsyncControllerOptions<Result> {
  /** Stable identity for route-owned loader inputs. */
  queryKey?: string;
}

/** Polls a pending OAuth flow after the first one-second interval. */
export function useOAuthStatusController<Result>(
  options: PollingFeatureControllerOptions<Result>,
): FeatureController {
  return usePollingController({
    ...options,
    ownerKey: CONTROLLER_OWNER.oauthStatus,
    intervalMs: CONTROLLER_CADENCE_MS.oauthStatus,
    immediate: false,
  });
}

/** Polls all active source-sync jobs as one controller-owned request. */
export function useSourceSyncController<Result>(
  options: PollingFeatureControllerOptions<Result>,
): FeatureController {
  return usePollingController({
    ...options,
    ownerKey: CONTROLLER_OWNER.sourceSync,
    intervalMs: CONTROLLER_CADENCE_MS.sourceSync,
    immediate: false,
  });
}

/** Compatibility name matching the current `sync.status` terminology. */
export const useSyncStatusController = useSourceSyncController;

/** Loads immediately and then refreshes active/attention activity each second. */
export function useActivityController<Result>(
  options: PollingFeatureControllerOptions<Result>,
): FeatureController {
  return usePollingController({
    ...options,
    ownerKey: CONTROLLER_OWNER.activity,
    intervalMs: CONTROLLER_CADENCE_MS.activity,
    immediate: true,
  });
}

/** Loads immediately and then refreshes integrity every two seconds. */
export function useIntegrityController<Result>(
  options: PollingFeatureControllerOptions<Result>,
): FeatureController {
  return usePollingController({
    ...options,
    ownerKey: CONTROLLER_OWNER.integrity,
    intervalMs: CONTROLLER_CADENCE_MS.integrity,
    immediate: true,
  });
}

/** Polls only while a recovery scan/import is active, after the first 750 ms. */
export function useRecoveryController<Result>(
  options: PollingFeatureControllerOptions<Result>,
): FeatureController {
  return usePollingController({
    ...options,
    ownerKey: CONTROLLER_OWNER.recovery,
    intervalMs: CONTROLLER_CADENCE_MS.recovery,
    immediate: false,
  });
}

/** Owns backup-run and per-channel backup-settings loading and mutation refreshes. */
export function useBackupController<Result>(
  options: LoadFeatureControllerOptions<Result>,
): FeatureController {
  return useLoadController({
    ...options,
    ownerKey: CONTROLLER_OWNER.backup,
  });
}

/** Owns Settings route data such as durable schedule loading and refreshes. */
export function useSettingsController<Result>(
  options: LoadFeatureControllerOptions<Result>,
): FeatureController {
  return useLoadController({
    ...options,
    ownerKey: CONTROLLER_OWNER.settings,
  });
}

/** Owns the existing 200 ms Library query debounce. */
export function useLibraryController<Result>(
  options: DebouncedFeatureControllerOptions<Result>,
): FeatureController {
  return useDebouncedController({
    ...options,
    ownerKey: CONTROLLER_OWNER.library,
    delayMs: CONTROLLER_CADENCE_MS.library,
  });
}

/** Owns the existing 200 ms Playlists query debounce. */
export function usePlaylistsController<Result>(
  options: DebouncedFeatureControllerOptions<Result>,
): FeatureController {
  return useDebouncedController({
    ...options,
    ownerKey: CONTROLLER_OWNER.playlists,
    delayMs: CONTROLLER_CADENCE_MS.playlists,
  });
}

/** Loads the channel facets used by both Library views. */
export function useLibraryChannelsController<Result>(
  options: LoadFeatureControllerOptions<Result>,
): FeatureController {
  return useLoadController({
    ...options,
    ownerKey: CONTROLLER_OWNER.libraryChannels,
  });
}

/** Loads one paged playlist membership query for the selected playlist. */
export function usePlaylistMembersController<Result>(
  options: LoadFeatureControllerOptions<Result>,
): FeatureController {
  return useLoadController({
    ...options,
    ownerKey: CONTROLLER_OWNER.playlistMembers,
  });
}

/** Loads the route-owned Media Details snapshot and integrity eligibility. */
export function useMediaDetailsController<Result>(
  options: LoadFeatureControllerOptions<Result>,
): FeatureController {
  return useLoadController({
    ...options,
    ownerKey: CONTROLLER_OWNER.mediaDetails,
  });
}
