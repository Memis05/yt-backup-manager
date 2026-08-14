import type { YouTubeBackupManagerApi } from '../../../preload';

/**
 * Non-normative migration inventory for renderer ownership only.
 *
 * The preload contract and the project specifications remain authoritative. This registry records
 * current callers and intended renderer boundaries so a UI migration cannot silently drop an API
 * capability; it does not redefine IPC behavior or grant a feature additional authority.
 */
export const API_OWNERSHIP_REGISTRY_KIND = 'non-normative migration inventory' as const;

export type YouTubeBackupManagerApiMethod = keyof YouTubeBackupManagerApi;

export type LegacyRendererCaller = 'App.tsx' | 'no renderer caller';

export type CurrentLegacyFeature =
  | 'application startup and overview refresh'
  | 'unused preload compatibility method'
  | 'Settings > General'
  | 'Settings > Backup'
  | 'Settings > Scheduling'
  | 'Settings > Advanced'
  | 'Settings > Accounts'
  | 'Channels'
  | 'Library > Media'
  | 'Library > Playlists'
  | 'Backup configuration'
  | 'Backup runs and notification routing'
  | 'Activity and notification routing'
  | 'Storage and notification routing'
  | 'Integrity and notification routing'
  | 'Media details'
  | 'Storage and media details'
  | 'Home and overview refresh'
  | 'internal notification routing'
  | 'Recovery';

export type TargetRendererOwner =
  | 'app/bootstrap-controller'
  | 'app/internal-route-adapter'
  | 'features/home/controller'
  | 'features/settings/general-controller'
  | 'features/settings/backup-controller'
  | 'features/settings/scheduling-controller'
  | 'features/settings/advanced-controller'
  | 'features/settings/accounts-controller'
  | 'features/channels/controller'
  | 'features/channels/backup-controller'
  | 'features/library/media-controller'
  | 'features/library/playlists-controller'
  | 'features/library/media-details-controller'
  | 'features/storage/controller'
  | 'features/activity/controller'
  | 'features/integrity/controller'
  | 'features/recovery/controller'
  | 'platform/google-drive-object-action';

export interface ApiOwnershipEntry {
  readonly legacyCaller: LegacyRendererCaller;
  readonly currentFeature: CurrentLegacyFeature;
  readonly targetOwner: TargetRendererOwner;
}

export type ApiOwnershipRegistry = {
  readonly [Method in YouTubeBackupManagerApiMethod]: ApiOwnershipEntry;
};

/**
 * Every preload API method must appear here. Adding or removing a method from
 * `YouTubeBackupManagerApi` makes desktop type-checking fail until this inventory is reconciled.
 */
export const YTBM_API_OWNERSHIP_REGISTRY = Object.freeze({
  getFoundationStatus: {
    legacyCaller: 'App.tsx',
    currentFeature: 'application startup and overview refresh',
    targetOwner: 'app/bootstrap-controller',
  },
  updateStartMinimized: {
    legacyCaller: 'no renderer caller',
    currentFeature: 'unused preload compatibility method',
    targetOwner: 'features/settings/general-controller',
  },
  updateDefaultQuality: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Backup',
    targetOwner: 'features/settings/backup-controller',
  },
  updateSettings: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > General',
    targetOwner: 'features/settings/general-controller',
  },
  listSchedules: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Scheduling',
    targetOwner: 'features/settings/scheduling-controller',
  },
  upsertSchedule: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Scheduling',
    targetOwner: 'features/settings/scheduling-controller',
  },
  removeSchedule: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Scheduling',
    targetOwner: 'features/settings/scheduling-controller',
  },
  startIntegrity: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Integrity and notification routing',
    targetOwner: 'features/integrity/controller',
  },
  getIntegrityOverview: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Integrity and notification routing',
    targetOwner: 'features/integrity/controller',
  },
  startRepair: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Integrity and notification routing',
    targetOwner: 'features/integrity/controller',
  },
  onInternalRoute: {
    legacyCaller: 'App.tsx',
    currentFeature: 'internal notification routing',
    targetOwner: 'app/internal-route-adapter',
  },
  openLogFolder: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Advanced',
    targetOwner: 'features/settings/advanced-controller',
  },
  listAccounts: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Accounts',
    targetOwner: 'features/settings/accounts-controller',
  },
  beginGoogleOAuth: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Accounts',
    targetOwner: 'features/settings/accounts-controller',
  },
  getOAuthStatus: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Accounts',
    targetOwner: 'features/settings/accounts-controller',
  },
  disconnectAccount: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Accounts',
    targetOwner: 'features/settings/accounts-controller',
  },
  discoverChannels: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Accounts',
    targetOwner: 'features/settings/accounts-controller',
  },
  listChannels: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Channels',
    targetOwner: 'features/channels/controller',
  },
  setChannelEnabled: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Channels',
    targetOwner: 'features/channels/controller',
  },
  startChannelSync: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Channels',
    targetOwner: 'features/channels/controller',
  },
  getSyncStatus: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Channels',
    targetOwner: 'features/channels/controller',
  },
  queryLibrary: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Library > Media',
    targetOwner: 'features/library/media-controller',
  },
  queryPlaylists: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Library > Playlists',
    targetOwner: 'features/library/playlists-controller',
  },
  queryPlaylistMembers: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Library > Playlists',
    targetOwner: 'features/library/playlists-controller',
  },
  addFilesystemDestination: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Storage and notification routing',
    targetOwner: 'features/storage/controller',
  },
  addGoogleDriveDestination: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Storage and notification routing',
    targetOwner: 'features/storage/controller',
  },
  listDestinations: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Storage and notification routing',
    targetOwner: 'features/storage/controller',
  },
  disableDestination: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Storage and notification routing',
    targetOwner: 'features/storage/controller',
  },
  getChannelBackupSettings: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Backup configuration',
    targetOwner: 'features/channels/backup-controller',
  },
  updateChannelBackupSettings: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Backup configuration',
    targetOwner: 'features/channels/backup-controller',
  },
  previewChannelQualityChange: {
    legacyCaller: 'no renderer caller',
    currentFeature: 'Backup configuration',
    targetOwner: 'features/channels/backup-controller',
  },
  applyChannelQualityChange: {
    legacyCaller: 'no renderer caller',
    currentFeature: 'Backup configuration',
    targetOwner: 'features/channels/backup-controller',
  },
  startBackup: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Backup configuration',
    targetOwner: 'features/channels/backup-controller',
  },
  listBackupRuns: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Backup runs and notification routing',
    targetOwner: 'features/activity/controller',
  },
  controlBackupRun: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Backup runs and notification routing',
    targetOwner: 'features/activity/controller',
  },
  getQueueSnapshot: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Activity and notification routing',
    targetOwner: 'features/activity/controller',
  },
  controlJob: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Activity and notification routing',
    targetOwner: 'features/activity/controller',
  },
  getMediaBackupDetails: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Media details',
    targetOwner: 'features/library/media-details-controller',
  },
  openVerifiedCopyFolder: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Media details',
    targetOwner: 'features/library/media-details-controller',
  },
  openGoogleDriveObject: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Storage and media details',
    targetOwner: 'platform/google-drive-object-action',
  },
  getDashboardSummary: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Home and overview refresh',
    targetOwner: 'features/home/controller',
  },
  getToolDiagnostics: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Settings > Advanced',
    targetOwner: 'features/settings/advanced-controller',
  },
  createRecoverySession: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Recovery',
    targetOwner: 'features/recovery/controller',
  },
  getLatestRecoverySession: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Recovery',
    targetOwner: 'features/recovery/controller',
  },
  getRecoverySession: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Recovery',
    targetOwner: 'features/recovery/controller',
  },
  addRecoveryLocalSource: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Recovery',
    targetOwner: 'features/recovery/controller',
  },
  addRecoveryDriveSource: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Recovery',
    targetOwner: 'features/recovery/controller',
  },
  setRecoveryDriveRootSelected: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Recovery',
    targetOwner: 'features/recovery/controller',
  },
  startRecoveryScan: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Recovery',
    targetOwner: 'features/recovery/controller',
  },
  startRecoveryImport: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Recovery',
    targetOwner: 'features/recovery/controller',
  },
  cancelRecovery: {
    legacyCaller: 'App.tsx',
    currentFeature: 'Recovery',
    targetOwner: 'features/recovery/controller',
  },
} satisfies ApiOwnershipRegistry);
