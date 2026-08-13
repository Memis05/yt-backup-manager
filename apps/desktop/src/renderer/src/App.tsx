import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import type {
  AccountDto,
  BackupRunDto,
  ChannelDto,
  ChannelBackupSettingsDto,
  DestinationDto,
  DashboardSummary,
  FoundationStatus,
  JobStatus,
  LibraryQueryResult,
  MediaType,
  MediaBackupDetails,
  OAuthFlowDto,
  PlaylistDto,
  PlaylistMembersResult,
  QualityProfile,
  QueueSection,
  QueueSnapshot,
  RecoverySessionDto,
  SourceStatus,
  SourceSyncJobDto,
  ToolDiagnostics,
  IntegrityOverview,
  IntegrityScope,
  ScheduleDto,
  ScheduleFrequency,
  GoogleOAuthCapability,
} from '@ytbm/core';
import {
  appRouteToLegacySection,
  appRouteToQueueSection,
  defaultAppRoute,
  legacySectionToAppRoute,
  queueSectionToAppRoute,
  type AppRoute,
  type LegacySection,
} from './app/routes';
import {
  createLatestEventGuard,
  resolveInternalRoute,
  type InternalRouteResolutionContext,
} from './app/internal-route-adapter';
import {
  useActivityController,
  useBackupController,
  useIntegrityController,
  useLibraryController,
  useOAuthStatusController,
  usePlaylistsController,
  useRecoveryController,
  useSettingsController,
  useSourceSyncController,
} from './features/controllers';
import { usePendingOperations } from './app/use-pending-operations';
import { AppShell } from './shell/AppShell';

type LibraryView = 'grid' | 'list';

const QUEUE_PAGE_SIZE = 50;

function queueStatusLabel(status: JobStatus): string {
  const labels: Record<JobStatus, string> = {
    PENDING: 'Waiting for prior step',
    READY: 'Ready to start',
    RUNNING: 'Active',
    PAUSE_REQUESTED: 'Pausing',
    PAUSED: 'Paused',
    RETRY_WAIT: 'Waiting to retry',
    CANCEL_REQUESTED: 'Cancelling',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
    INTERRUPTED: 'Interrupted',
    BLOCKED: 'Needs attention',
  };
  return labels[status];
}

const QUALITY_OPTIONS: Array<{ value: QualityProfile; label: string }> = [
  { value: 'BEST_AVAILABLE', label: 'Best available' },
  { value: 'MAX_4K', label: 'Up to 4K' },
  { value: 'MAX_1080P', label: 'Up to 1080p' },
  { value: 'MAX_720P', label: 'Up to 720p' },
];

const NOTIFICATION_OPTIONS = [
  ['backupComplete', 'Successful backups'],
  ['backupErrors', 'Backups completed with errors or failed'],
  ['destinationDisconnected', 'Destination disconnected'],
  ['destinationReconnected', 'Destination reconnected'],
  ['authenticationRequired', 'Google Drive authorization required'],
  ['integrityProblems', 'Missing or corrupt backup copies'],
  ['repairResults', 'Repair completed or failed'],
  ['scheduleErrors', 'Automatic schedule errors'],
] as const;

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}

function formatDate(value: number | null): string {
  return value === null
    ? 'Never'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Duration unavailable';
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function destinationLabel(destination: DestinationDto): string {
  return destination.destinationType === 'FILESYSTEM'
    ? destination.rootPath
    : `${destination.rootName} · ${destination.accountEmail ?? destination.accountDisplayName ?? 'Google account'}`;
}

function StatePill({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`state-pill state-pill--${tone}`}>{children}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  return url === null ? (
    <div className="thumbnail-placeholder" aria-label={`${alt} thumbnail unavailable`}>
      YT
    </div>
  ) : (
    <img className="thumbnail" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
  );
}

function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage(page: number): void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="pager">
      <button
        className="button button--secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {pages}
      </span>
      <button
        className="button button--secondary"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

function CompletedMediaRows({
  items,
  onShowDetails,
}: {
  items: QueueSnapshot['completedMedia'];
  onShowDetails(mediaItemId: string): void;
}) {
  return items.map((media) => (
    <article className="queue-row queue-row--completed" key={media.mediaItemId}>
      <div>
        <strong>{media.mediaTitle}</strong>
        <small>
          Verified {formatDate(media.verifiedAt)} · {formatBytes(media.bytes)}
        </small>
        <small className="queue-destinations">{media.destinationPaths.join(' · ')}</small>
      </div>
      <StatePill tone="success">Backed up</StatePill>
      <div className="queue-completed-summary">
        <strong>
          {media.verifiedCopyCount} verified {media.verifiedCopyCount === 1 ? 'copy' : 'copies'}
        </strong>
        <small>Integrity check passed</small>
      </div>
      <div className="queue-actions">
        <button onClick={() => onShowDetails(media.mediaItemId)}>View details</button>
      </div>
    </article>
  ));
}

function routeTitle(route: AppRoute): string {
  const titles: Record<AppRoute['area'], string> = {
    home: 'Home',
    library: 'Library',
    channels: 'Channels',
    activity: 'Activity',
    storage: 'Storage',
    integrity: 'Integrity',
    settings: 'Settings',
  };
  return titles[route.area];
}

interface LocalRouteTab {
  value: string;
  label: string;
  route: AppRoute;
}

function localRouteTabId(area: 'library' | 'activity', value: string): string {
  return `legacy-route-tab-${area}-${value}`;
}

function localRouteTabPanelId(area: 'library' | 'activity', value: string): string {
  return `legacy-route-tabpanel-${area}-${value}`;
}

function localRouteTabPanelProps(route: AppRoute): {
  id?: string;
  role?: 'tabpanel';
  'aria-labelledby'?: string;
  tabIndex?: number;
} {
  if (route.area !== 'library' && route.area !== 'activity') return {};
  return {
    id: localRouteTabPanelId(route.area, route.view),
    role: 'tabpanel',
    'aria-labelledby': localRouteTabId(route.area, route.view),
    tabIndex: 0,
  };
}

export function RouteLocalNavigation({
  route,
  onNavigate,
}: {
  route: AppRoute;
  onNavigate(route: AppRoute): void;
}) {
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const tabs: readonly LocalRouteTab[] =
    route.area === 'library'
      ? [
          { value: 'media', label: 'Media', route: { area: 'library', view: 'media' } },
          {
            value: 'playlists',
            label: 'Playlists',
            route: { area: 'library', view: 'playlists' },
          },
        ]
      : route.area === 'activity'
        ? [
            { value: 'active', label: 'Active', route: { area: 'activity', view: 'active' } },
            {
              value: 'history',
              label: 'History',
              route: { area: 'activity', view: 'history' },
            },
            {
              value: 'attention',
              label: 'Needs attention',
              route: { area: 'activity', view: 'attention' },
            },
          ]
        : [];

  if (route.area !== 'library' && route.area !== 'activity') return null;
  const area = route.area;
  const selectedValue = route.view;

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentValue: string,
    direction: -1 | 1 | 'first' | 'last',
  ): void => {
    const currentIndex = tabs.findIndex((tab) => tab.value === currentValue);
    const nextIndex =
      direction === 'first'
        ? 0
        : direction === 'last'
          ? tabs.length - 1
          : (Math.max(0, currentIndex) + direction + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (nextTab === undefined) return;
    event.preventDefault();
    onNavigate(nextTab.route);
    tabRefs.current.get(nextTab.value)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, value: string): void => {
    switch (event.key) {
      case 'ArrowRight':
        moveFocus(event, value, 1);
        break;
      case 'ArrowLeft':
        moveFocus(event, value, -1);
        break;
      case 'Home':
        moveFocus(event, value, 'first');
        break;
      case 'End':
        moveFocus(event, value, 'last');
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="legacy-local-navigation"
      role="tablist"
      aria-label={`${routeTitle(route)} views`}
    >
      {tabs.map((tab) => {
        const selected = tab.value === selectedValue;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              if (node === null) tabRefs.current.delete(tab.value);
              else tabRefs.current.set(tab.value, node);
            }}
            id={localRouteTabId(area, tab.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-current={selected ? 'page' : undefined}
            aria-controls={localRouteTabPanelId(area, tab.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onNavigate(tab.route)}
            onKeyDown={(event) => handleKeyDown(event, tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(defaultAppRoute);
  return (
    <AppShell route={route} onNavigate={setRoute}>
      <LegacyRouteOutlet route={route} onNavigate={setRoute} />
    </AppShell>
  );
}

function LegacyRouteOutlet({
  route,
  onNavigate,
}: {
  route: AppRoute;
  onNavigate(route: AppRoute): void;
}) {
  const section = appRouteToLegacySection(route);
  const routeTabPanelProps = localRouteTabPanelProps(route);
  const setSection = useCallback(
    (nextSection: LegacySection) => onNavigate(legacySectionToAppRoute(nextSection)),
    [onNavigate],
  );
  const [foundation, setFoundation] = useState<FoundationStatus | null>(null);
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [startupPending, setStartupPending] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oauthFlow, setOAuthFlow] = useState<OAuthFlowDto | null>(null);
  const [syncJobs, setSyncJobs] = useState<Record<string, SourceSyncJobDto>>({});
  const [destinations, setDestinations] = useState<DestinationDto[]>([]);
  const [backupSettings, setBackupSettings] = useState<Record<string, ChannelBackupSettingsDto>>(
    {},
  );
  const [backupRuns, setBackupRuns] = useState<BackupRunDto[]>([]);
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [selectedQueueSection, setQueueSection] = useState<QueueSection>('ACTIVE');
  const queueSection = appRouteToQueueSection(route, selectedQueueSection);
  const queueRouteScope =
    route.area === 'activity' ? `${route.view}:${route.entityId ?? ''}` : 'inactive';
  const [queuePageState, setQueuePageState] = useState({ scope: queueRouteScope, page: 1 });
  const queuePage = queuePageState.scope === queueRouteScope ? queuePageState.page : 1;
  const setQueuePage = useCallback(
    (page: number): void => setQueuePageState({ scope: queueRouteScope, page }),
    [queueRouteScope],
  );
  const [mediaDetails, setMediaDetails] = useState<MediaBackupDetails | null>(null);
  const [toolDiagnostics, setToolDiagnostics] = useState<ToolDiagnostics | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [recovery, setRecovery] = useState<RecoverySessionDto | null>(null);
  const [schedules, setSchedules] = useState<ScheduleDto[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityOverview | null>(null);
  const [integrityScope, setIntegrityScope] = useState('ALL');
  const [scheduleScope, setScheduleScope] = useState<string>('GLOBAL');
  const [scheduleFrequency, setScheduleFrequency] = useState<ScheduleFrequency>('DAILY');
  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [scheduleWeekday, setScheduleWeekday] = useState(1);
  const [scheduleEveryHours, setScheduleEveryHours] = useState(6);
  const [scheduleCatchUp, setScheduleCatchUp] = useState(true);
  const [scheduleStartup, setScheduleStartup] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(true);

  const [libraryView, setLibraryView] = useState<LibraryView>('grid');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryChannel, setLibraryChannel] = useState<string | null>(null);
  const [libraryType, setLibraryType] = useState<MediaType | null>(null);
  const [libraryStatus, setLibraryStatus] = useState<SourceStatus | null>(null);
  const [libraryPage, setLibraryPage] = useState(1);
  const [library, setLibrary] = useState<LibraryQueryResult>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 40,
  });

  const [playlistSearch, setPlaylistSearch] = useState('');
  const [playlistChannel, setPlaylistChannel] = useState<string | null>(null);
  const [playlistPage, setPlaylistPage] = useState(1);
  const [playlists, setPlaylists] = useState<{
    items: PlaylistDto[];
    total: number;
    page: number;
    pageSize: number;
  }>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 30,
  });
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDto | null>(null);
  const [playlistMembers, setPlaylistMembers] = useState<PlaylistMembersResult | null>(null);
  const pendingOperations = usePendingOperations();
  const busy = startupPending
    ? 'startup'
    : (pendingOperations.pendingOperations.values().next().value ?? null);

  const refreshCore = useCallback(async () => {
    const [foundationStatus, accountItems, channelItems, destinationItems, tools, summary] =
      await Promise.all([
        window.ytbm.getFoundationStatus(),
        window.ytbm.listAccounts(),
        window.ytbm.listChannels(),
        window.ytbm.listDestinations(),
        window.ytbm.getToolDiagnostics(),
        window.ytbm.getDashboardSummary(),
      ]);
    setFoundation(foundationStatus);
    setAccounts(accountItems);
    setChannels(channelItems);
    setDestinations(destinationItems);
    setToolDiagnostics(tools);
    setDashboard(summary);
  }, []);

  useEffect(() => {
    let active = true;
    const routeEvents = createLatestEventGuard();

    const resolveContext = async (
      internalRoute: Parameters<typeof resolveInternalRoute>[0],
    ): Promise<InternalRouteResolutionContext> => {
      switch (internalRoute.section) {
        case 'backup':
          return { backupRunIds: (await window.ytbm.listBackupRuns()).map((run) => run.id) };
        case 'queue': {
          const activityEntities: NonNullable<
            InternalRouteResolutionContext['activityEntities']
          >[number][] = [];
          let page = 1;
          for (;;) {
            const snapshot = await window.ytbm.getQueueSnapshot({
              section: 'ALL',
              page,
              pageSize: 100,
            });
            activityEntities.push(
              ...snapshot.jobs.map((job) => ({
                entityId: job.id,
                view:
                  job.status === 'BLOCKED' || job.status === 'FAILED'
                    ? ('attention' as const)
                    : ('active' as const),
              })),
            );
            const pageCount = Math.max(1, Math.ceil(snapshot.totalItems / snapshot.pageSize));
            if (page >= pageCount) break;
            page += 1;
          }
          return { activityEntities };
        }
        case 'storage':
          return {
            destinationIds: (await window.ytbm.listDestinations()).map(
              (destination) => destination.id,
            ),
          };
        case 'integrity':
          return {
            integrityCopyIds: (await window.ytbm.getIntegrityOverview()).issues.map(
              (issue) => issue.copyId,
            ),
          };
        case 'dashboard':
        case 'settings':
          return {};
      }
    };

    const navigateFromInternalRoute = async (
      internalRoute: Parameters<typeof resolveInternalRoute>[0],
      isLatestEvent: () => boolean,
    ): Promise<void> => {
      let resolution;
      try {
        resolution = resolveInternalRoute(internalRoute, await resolveContext(internalRoute));
      } catch {
        resolution = resolveInternalRoute(internalRoute);
      }
      if (!active || !isLatestEvent()) return;
      onNavigate(resolution.route);
      if (resolution.fallbackMessage !== null) setNotice(resolution.fallbackMessage);
    };

    const unsubscribe = window.ytbm.onInternalRoute((internalRoute) => {
      void navigateFromInternalRoute(internalRoute, routeEvents.begin());
    });
    return () => {
      active = false;
      routeEvents.invalidate();
      unsubscribe();
    };
  }, [onNavigate]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.ytbm.getFoundationStatus(),
      window.ytbm.listAccounts(),
      window.ytbm.listChannels(),
      window.ytbm.listDestinations(),
      window.ytbm.getToolDiagnostics(),
      window.ytbm.getDashboardSummary(),
    ])
      .then(([foundationStatus, accountItems, channelItems, destinationItems, tools, summary]) => {
        if (!active) return;
        setFoundation(foundationStatus);
        setAccounts(accountItems);
        setChannels(channelItems);
        setDestinations(destinationItems);
        setToolDiagnostics(tools);
        setDashboard(summary);
      })
      .catch((caught: unknown) => {
        if (active) setError(safeMessage(caught));
      })
      .finally(() => {
        if (active) setStartupPending(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useOAuthStatusController<OAuthFlowDto>({
    enabled: oauthFlow?.status === 'PENDING',
    queryKey: oauthFlow?.flowId ?? '',
    request: async () => {
      if (oauthFlow === null) throw new Error('No OAuth flow is active.');
      return window.ytbm.getOAuthStatus(oauthFlow.flowId);
    },
    onSuccess: (flow) => {
      setOAuthFlow(flow);
      if (flow.status === 'COMPLETED') {
        setNotice(
          `${flow.account?.displayName ?? flow.account?.email ?? 'Google account'} connected.`,
        );
        void refreshCore();
      } else if (flow.status === 'FAILED' || flow.status === 'EXPIRED') {
        setError(flow.safeMessage ?? 'Google authorization did not complete.');
      }
    },
    onError: (caught) => setError(safeMessage(caught)),
  });

  const activeSyncJobs = useMemo(
    () =>
      Object.values(syncJobs).filter((job) =>
        ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(job.status),
      ),
    [syncJobs],
  );
  useSourceSyncController<SourceSyncJobDto[]>({
    enabled: activeSyncJobs.length > 0,
    request: () => Promise.all(activeSyncJobs.map((job) => window.ytbm.getSyncStatus(job.id))),
    onSuccess: (jobs) => {
      setSyncJobs((current) => ({
        ...current,
        ...Object.fromEntries(jobs.map((job) => [job.channelId, job])),
      }));
      if (jobs.some((job) => job.status === 'COMPLETED')) void refreshCore();
    },
    onError: (caught) => setError(safeMessage(caught)),
  });

  useLibraryController<LibraryQueryResult>({
    enabled: section === 'library',
    queryKey: JSON.stringify([
      librarySearch,
      libraryChannel,
      libraryType,
      libraryStatus,
      libraryPage,
    ]),
    request: () =>
      window.ytbm.queryLibrary({
        search: librarySearch,
        channelId: libraryChannel,
        mediaType: libraryType,
        sourceStatus: libraryStatus,
        page: libraryPage,
        pageSize: 40,
      }),
    onSuccess: setLibrary,
    onError: (caught) => setError(safeMessage(caught)),
  });

  usePlaylistsController<typeof playlists>({
    enabled: section === 'playlists',
    queryKey: JSON.stringify([playlistChannel, playlistSearch, playlistPage]),
    request: () =>
      window.ytbm.queryPlaylists({
        channelId: playlistChannel,
        search: playlistSearch,
        page: playlistPage,
        pageSize: 30,
      }),
    onSuccess: setPlaylists,
    onError: (caught) => setError(safeMessage(caught)),
  });

  const backupChannelIds = useMemo(
    () => channels.filter((channel) => channel.backupEnabled).map((channel) => channel.id),
    [channels],
  );
  const backupController = useBackupController<{
    runs: BackupRunDto[];
    settings: ChannelBackupSettingsDto[];
  }>({
    enabled: section === 'backup',
    queryKey: JSON.stringify(backupChannelIds),
    request: async () => {
      const [runs, settings] = await Promise.all([
        window.ytbm.listBackupRuns(),
        Promise.all(
          backupChannelIds.map((channelId) => window.ytbm.getChannelBackupSettings(channelId)),
        ),
      ]);
      return { runs, settings };
    },
    onSuccess: ({ runs, settings }) => {
      setBackupRuns(runs);
      setBackupSettings(
        Object.fromEntries(settings.map((setting) => [setting.channelId, setting])),
      );
    },
    onError: (caught) => setError(safeMessage(caught)),
  });

  const activityController = useActivityController<QueueSnapshot>({
    enabled: route.area === 'activity',
    queryKey: `${queueSection}:${queuePage}`,
    request: () =>
      window.ytbm.getQueueSnapshot({
        section: queueSection,
        page: queuePage,
        pageSize: QUEUE_PAGE_SIZE,
      }),
    onSuccess: (snapshot) => {
      const lastPage = Math.max(1, Math.ceil(snapshot.totalItems / snapshot.pageSize));
      if (snapshot.page > lastPage) setQueuePage(lastPage);
      else setQueue(snapshot);
    },
    onError: (caught) => setError(safeMessage(caught)),
  });

  useRecoveryController<RecoverySessionDto>({
    enabled:
      section === 'recovery' &&
      recovery !== null &&
      ['SCANNING', 'IMPORTING'].includes(recovery.status),
    queryKey: recovery?.id ?? '',
    request: async () => {
      if (recovery === null) throw new Error('No recovery session is active.');
      return window.ytbm.getRecoverySession(recovery.id);
    },
    onSuccess: (session) => {
      setRecovery(session);
      if (['COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(session.status)) {
        void refreshCore();
        setNotice('Backup catalog restored. Existing verified copies are ready for planning.');
      }
    },
    onError: (caught) => setError(safeMessage(caught)),
  });

  const settingsController = useSettingsController<ScheduleDto[]>({
    enabled: section === 'settings',
    request: () => window.ytbm.listSchedules(),
    onSuccess: setSchedules,
    onError: (caught) => setError(safeMessage(caught)),
  });

  useIntegrityController<IntegrityOverview>({
    enabled: section === 'integrity',
    request: () => window.ytbm.getIntegrityOverview(),
    onSuccess: setIntegrity,
    onError: (caught) => setError(safeMessage(caught)),
  });

  const selectedChannels = useMemo(
    () => channels.filter((channel) => channel.backupEnabled),
    [channels],
  );

  const connectGoogle = async (
    accountId: string | null = null,
    capability: GoogleOAuthCapability = 'YOUTUBE',
  ): Promise<void> => {
    const operation = `${capability}:${accountId ?? 'connect'}`;
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    setNotice(null);
    try {
      const result = await window.ytbm.beginGoogleOAuth(accountId, capability);
      if (result.status === 'UNAVAILABLE') {
        setError(result.safeMessage);
        return;
      }
      setOAuthFlow({
        flowId: result.flowId,
        capability,
        status: 'PENDING',
        expiresAt: result.expiresAt,
        account: null,
        errorCode: null,
        safeMessage: null,
      });
      setNotice(
        capability === 'GOOGLE_DRIVE'
          ? 'Google sign-in opened for Drive app-file access. Confirm the same Google identity, then return here.'
          : 'Google sign-in opened in your system browser. Finish there, then return here.',
      );
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const connectDrive = async (accountId: string): Promise<void> => {
    const confirmed = window.confirm(
      'Enable Google Drive backup for this account? Google will request access only to Drive files created by this app. You must choose the same Google identity.',
    );
    if (!confirmed) return;
    await connectGoogle(accountId, 'GOOGLE_DRIVE');
  };

  const openLogFolder = async (): Promise<void> => {
    setError(null);
    try {
      await window.ytbm.openLogFolder();
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const discoverChannels = async (accountId: string): Promise<void> => {
    const operation = `discover:${accountId}`;
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      const discovered = await window.ytbm.discoverChannels(accountId);
      setChannels(await window.ytbm.listChannels());
      setNotice(
        `Discovered ${discovered.length} accessible YouTube channel${discovered.length === 1 ? '' : 's'}.`,
      );
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const disconnectAccount = async (accountId: string): Promise<void> => {
    const operation = `disconnect:${accountId}`;
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      await window.ytbm.disconnectAccount(accountId);
      await refreshCore();
      setNotice('Local Google credentials were removed. Catalog records were preserved.');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const toggleChannel = async (channelId: string, enabled: boolean): Promise<void> => {
    const operation = `channel:${channelId}`;
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      const updated = await window.ytbm.setChannelEnabled(channelId, enabled);
      setChannels((current) =>
        current.map((channel) => (channel.id === channelId ? updated : channel)),
      );
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const startSync = async (channelId: string): Promise<void> => {
    setError(null);
    try {
      const job = await window.ytbm.startChannelSync(channelId);
      setSyncJobs((current) => ({ ...current, [channelId]: job }));
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const openPlaylist = async (playlist: PlaylistDto): Promise<void> => {
    setSelectedPlaylist(playlist);
    setPlaylistMembers(null);
    try {
      setPlaylistMembers(
        await window.ytbm.queryPlaylistMembers({ playlistId: playlist.id, page: 1, pageSize: 50 }),
      );
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const addDestination = async (): Promise<void> => {
    const operation = 'add-destination';
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      const destination = await window.ytbm.addFilesystemDestination();
      if (destination === null) return;
      setDestinations(await window.ytbm.listDestinations());
      setNotice('Local backup destination added and probed successfully.');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const addDriveDestination = async (accountId: string): Promise<void> => {
    const operation = `add-drive:${accountId}`;
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      await window.ytbm.addGoogleDriveDestination(accountId);
      await refreshCore();
      setNotice('Google Drive destination added and probed successfully.');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const openDriveDestination = async (destinationId: string): Promise<void> => {
    setError(null);
    try {
      const result = await window.ytbm.openGoogleDriveObject({ destinationId });
      if (result.status !== 'OPENED') setError(result.safeMessage);
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const saveBackupSettings = async (
    channelId: string,
    qualityProfileOverride: QualityProfile | null,
    destinationIds: string[],
  ): Promise<void> => {
    const previous = backupSettings[channelId];
    if (previous === undefined) return;
    const operation = `backup-settings:${channelId}`;
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      await window.ytbm.updateChannelBackupSettings({
        channelId,
        qualityProfileOverride,
        destinationIds,
      });
      await backupController.refresh();
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const startBackup = async (channelId: string): Promise<void> => {
    const operation = `backup:${channelId}`;
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      const result = await window.ytbm.startBackup(channelId);
      setNotice(
        `Backup started for ${result.run.discoveredCount} media. ${result.skippedVerifiedMedia} already verified; ${result.plannedJobs} recoverable processing steps will run automatically.`,
      );
      await backupController.refresh();
      setQueueSection('ACTIVE');
      setQueuePage(1);
      setSection('queue');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const controlBackupRun = async (
    runId: string,
    action: Parameters<typeof window.ytbm.controlBackupRun>[1],
  ): Promise<void> => {
    const endOperation = pendingOperations.beginOperation(`backup-run:${runId}`);
    setError(null);
    try {
      await window.ytbm.controlBackupRun(runId, action);
      await backupController.refresh();
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const showMediaDetails = async (mediaItemId: string): Promise<void> => {
    try {
      setMediaDetails(await window.ytbm.getMediaBackupDetails(mediaItemId));
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const openVerifiedCopyFolder = async (
    mediaCopyId: string,
    mediaItemId: string,
  ): Promise<void> => {
    setError(null);
    try {
      const result = await window.ytbm.openVerifiedCopyFolder(mediaCopyId);
      if (result.status === 'OPENED') return;
      setError(result.safeMessage);
      setMediaDetails(await window.ytbm.getMediaBackupDetails(mediaItemId));
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const openGoogleDriveCopy = async (mediaCopyId: string, mediaItemId: string): Promise<void> => {
    setError(null);
    try {
      const result = await window.ytbm.openGoogleDriveObject({ mediaCopyId });
      if (result.status === 'OPENED') return;
      setError(result.safeMessage);
      setMediaDetails(await window.ytbm.getMediaBackupDetails(mediaItemId));
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const selectQueueSection = (nextSection: QueueSection): void => {
    setQueue(null);
    setQueueSection(nextSection);
    setQueuePage(1);
    onNavigate(queueSectionToAppRoute(nextSection));
  };

  const controlQueueJob = async (
    jobId: string,
    action: Parameters<typeof window.ytbm.controlJob>[1],
  ): Promise<void> => {
    setError(null);
    try {
      await window.ytbm.controlJob(jobId, action);
      await activityController.refresh();
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const openRecovery = async (startFresh = false): Promise<void> => {
    const operation = 'recovery-open';
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      const session = startFresh
        ? await window.ytbm.createRecoverySession()
        : ((await window.ytbm.getLatestRecoverySession()) ??
          (await window.ytbm.createRecoverySession()));
      setRecovery(session);
      setSection('recovery');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const addRecoveryLocalSource = async (): Promise<void> => {
    if (recovery === null) return;
    const operation = 'recovery-local';
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      const session = await window.ytbm.addRecoveryLocalSource(recovery.id);
      if (session !== null) setRecovery(session);
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const addRecoveryDriveSource = async (accountId: string): Promise<void> => {
    if (recovery === null) return;
    const operation = `recovery-drive:${accountId}`;
    const endOperation = pendingOperations.beginOperation(operation);
    setError(null);
    try {
      setRecovery(await window.ytbm.addRecoveryDriveSource(recovery.id, accountId));
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      endOperation();
    }
  };

  const scanRecovery = async (): Promise<void> => {
    if (recovery === null) return;
    setError(null);
    try {
      setRecovery(await window.ytbm.startRecoveryScan(recovery.id));
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const importRecovery = async (): Promise<void> => {
    if (recovery === null) return;
    const confirmed = window.confirm(
      `Restore ${recovery.counts.media} media records and ${recovery.counts.copies} copy records into the local catalog? Backup files will not be changed.`,
    );
    if (!confirmed) return;
    setError(null);
    try {
      setRecovery(await window.ytbm.startRecoveryImport(recovery.id));
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const saveApplicationSettings = async (
    patch: Parameters<typeof window.ytbm.updateSettings>[0],
  ): Promise<void> => {
    setError(null);
    try {
      const settings = await window.ytbm.updateSettings(patch);
      setFoundation((current) => (current === null ? current : { ...current, settings }));
      setNotice('Settings saved.');
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const saveSchedule = async (): Promise<void> => {
    setError(null);
    const channelId = scheduleScope === 'GLOBAL' ? null : scheduleScope;
    const existing = schedules.find((schedule) => schedule.channelId === channelId) ?? null;
    try {
      await window.ytbm.upsertSchedule({
        id: existing?.id ?? null,
        channelId,
        enabled: scheduleEnabled,
        frequency: scheduleFrequency,
        localTime: scheduleTime,
        weekday: scheduleFrequency === 'WEEKLY' ? scheduleWeekday : null,
        everyHours: scheduleFrequency === 'EVERY_N_HOURS' ? scheduleEveryHours : null,
        catchUp: scheduleCatchUp,
        backupOnStartup: scheduleStartup,
      });
      await settingsController.refresh();
      setNotice('Automatic backup schedule reconciled.');
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const removeSchedule = async (scheduleId: string): Promise<void> => {
    setError(null);
    try {
      await window.ytbm.removeSchedule(scheduleId);
      await settingsController.refresh();
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const editScheduleScope = (value: string): void => {
    setScheduleScope(value);
    const channelId = value === 'GLOBAL' ? null : value;
    const schedule = schedules.find((item) => item.channelId === channelId);
    if (schedule === undefined) return;
    setScheduleFrequency(schedule.frequency);
    setScheduleTime(schedule.localTime);
    setScheduleWeekday(schedule.weekday ?? 1);
    setScheduleEveryHours(schedule.everyHours ?? 6);
    setScheduleCatchUp(schedule.catchUp);
    setScheduleStartup(schedule.backupOnStartup);
    setScheduleEnabled(schedule.enabled);
  };

  const startIntegrity = async (
    driveMode: 'PROVIDER_METADATA_SIZE' | 'DOWNLOADED_SHA256' = 'PROVIDER_METADATA_SIZE',
    scopeOverride?: IntegrityScope,
  ): Promise<void> => {
    setError(null);
    try {
      const [kind, id] = integrityScope.split(':', 2);
      const scope: IntegrityScope =
        scopeOverride ??
        (kind === 'CHANNEL' && id !== undefined
          ? { kind: 'CHANNEL', id }
          : kind === 'DESTINATION' && id !== undefined
            ? { kind: 'DESTINATION', id }
            : { kind: 'ALL' });
      const result = await window.ytbm.startIntegrity({ scope, driveMode });
      setNotice(`Integrity verification queued for ${result.plannedChecks} copies.`);
      if (scopeOverride !== undefined) setMediaDetails(null);
      setSection('queue');
      setQueueSection('ACTIVE');
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  const repairCopy = async (copyId: string, youtubeFallbackAvailable: boolean): Promise<void> => {
    setError(null);
    try {
      const issue = integrity?.issues.find((item) => item.copyId === copyId);
      const needsYoutube = (issue?.repairSources.length ?? 0) === 0;
      const allowYoutubeFallback =
        needsYoutube && youtubeFallbackAvailable
          ? window.confirm(
              'No healthy archived copy is available. Download this media from YouTube as the last repair source?',
            )
          : false;
      if (needsYoutube && !allowYoutubeFallback) return;
      const result = await window.ytbm.startRepair(copyId, allowYoutubeFallback);
      setNotice(
        result.source === 'ALREADY_HEALTHY'
          ? 'The copy is already healthy.'
          : `Repair queued from ${result.source === 'GOOGLE_DRIVE' ? 'Google Drive' : result.source.toLowerCase()}.`,
      );
      setSection('queue');
      setQueueSection('ACTIVE');
    } catch (caught) {
      setError(safeMessage(caught));
    }
  };

  return (
    <div className="content legacy-route-outlet">
      <header className="legacy-page-header">
        <div>
          <h1>{routeTitle(route)}</h1>
          {route.area === 'settings' && route.category !== 'general' ? (
            <p>{route.category.charAt(0).toUpperCase() + route.category.slice(1)}</p>
          ) : null}
        </div>
        <RouteLocalNavigation route={route} onNavigate={onNavigate} />
      </header>

      {notice !== null ? (
        <div className="notice notice--success" role="status">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">
            ×
          </button>
        </div>
      ) : null}
      {error !== null ? (
        <div className="notice notice--error" role="alert">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      ) : null}

      {busy === 'startup' ? (
        <div className="loading-panel">Connecting to the backup worker…</div>
      ) : null}

      {busy !== 'startup' && section === 'dashboard' ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>Backup health</h2>
              <p>Verified coverage across every intended local and Google Drive destination.</p>
            </div>
          </div>
          {dashboard === null ? (
            <div className="loading-panel">Loading backup health…</div>
          ) : dashboard.mediaCount === 0 && destinations.length === 0 ? (
            <div className="welcome-panel">
              <p className="eyebrow">Get started</p>
              <h2>Set up a new archive or restore an existing one</h2>
              <p>
                Recovery scans only app-created manifests and sidecars. It does not download from
                YouTube or modify backup files.
              </p>
              <div className="section-actions">
                <button className="button button--primary" onClick={() => setSection('accounts')}>
                  Set up new backup
                </button>
                <button className="button button--secondary" onClick={() => void openRecovery()}>
                  Restore existing backup
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="dashboard-grid">
                <article>
                  <small>Selected channels</small>
                  <strong>{dashboard.selectedChannelCount}</strong>
                </article>
                <article>
                  <small>Catalog media</small>
                  <strong>{dashboard.mediaCount}</strong>
                </article>
                <article>
                  <small>Verified copies</small>
                  <strong>
                    {dashboard.verifiedCopyCount} / {dashboard.intendedCopyCount}
                  </strong>
                </article>
                <article>
                  <small>Verified bytes</small>
                  <strong>{formatBytes(dashboard.verifiedBytes)}</strong>
                </article>
                <article>
                  <small>Local verified</small>
                  <strong>{dashboard.localVerifiedCount}</strong>
                </article>
                <article>
                  <small>Drive verified</small>
                  <strong>{dashboard.driveVerifiedCount}</strong>
                </article>
                <article>
                  <small>Pending</small>
                  <strong>{dashboard.pendingCopyCount}</strong>
                </article>
                <article>
                  <small>Failed</small>
                  <strong>{dashboard.failedCopyCount}</strong>
                </article>
              </div>
              <p className="dashboard-last-run">
                Last completed backup activity: {formatDate(dashboard.lastBackupAt)}
              </p>
            </>
          )}
        </section>
      ) : null}

      {busy !== 'startup' && section === 'accounts' ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>Connected Google accounts</h2>
              <p>Credentials are encrypted outside SQLite and never sent to this screen.</p>
            </div>
            <div className="section-actions">
              <button className="button button--secondary" onClick={() => void openLogFolder()}>
                Open logs
              </button>
              <button
                className="button button--primary"
                disabled={busy !== null || oauthFlow?.status === 'PENDING'}
                onClick={() => void connectGoogle()}
              >
                Connect Google
              </button>
            </div>
          </div>
          {oauthFlow?.status === 'PENDING' ? (
            <div className="oauth-wait">
              <span className="spinner" />
              Waiting for Google authorization in your browser…
            </div>
          ) : null}
          <div className="account-list">
            {accounts.length === 0 ? (
              <EmptyState
                title="No Google accounts connected"
                detail="Connect Google to discover YouTube channels you can access."
              />
            ) : (
              accounts.map((account) => (
                <article className="account-card" key={account.id}>
                  <div className="account-identity">
                    {account.avatarUrl === null ? (
                      <div className="avatar">G</div>
                    ) : (
                      <img
                        className="avatar"
                        src={account.avatarUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div>
                      <h3>{account.displayName ?? account.email ?? 'Google account'}</h3>
                      <p>{account.email ?? 'Email unavailable'}</p>
                    </div>
                  </div>
                  <div className="account-capabilities">
                    <StatePill
                      tone={
                        account.connectionState === 'CONNECTED'
                          ? 'success'
                          : account.connectionState === 'REAUTH_REQUIRED'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      YouTube{' '}
                      {account.capabilities.youtubeReadonly
                        ? account.connectionState.replaceAll('_', ' ')
                        : 'NOT CONNECTED'}
                    </StatePill>
                    <StatePill
                      tone={
                        account.capabilities.driveConnectionState === 'CONNECTED'
                          ? 'success'
                          : account.capabilities.driveConnectionState === 'REAUTH_REQUIRED'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      Drive {account.capabilities.driveConnectionState.replaceAll('_', ' ')}
                    </StatePill>
                  </div>
                  <div className="account-actions">
                    {account.connectionState === 'CONNECTED' &&
                    account.capabilities.youtubeReadonly ? (
                      <button
                        className="button button--secondary"
                        disabled={busy !== null}
                        onClick={() => void discoverChannels(account.id)}
                      >
                        Refresh channels
                      </button>
                    ) : (
                      <button
                        className="button button--secondary"
                        disabled={busy !== null}
                        onClick={() => void connectGoogle(account.id)}
                      >
                        Reconnect
                      </button>
                    )}
                    <button
                      className="button button--secondary"
                      disabled={busy !== null}
                      onClick={() => void connectDrive(account.id)}
                    >
                      {account.capabilities.driveConnectionState === 'CONNECTED'
                        ? 'Reconnect Drive'
                        : 'Enable Drive'}
                    </button>
                    <button
                      className="button button--danger"
                      disabled={
                        busy !== null ||
                        (account.connectionState === 'DISCONNECTED' &&
                          account.capabilities.driveConnectionState !== 'CONNECTED')
                      }
                      onClick={() => void disconnectAccount(account.id)}
                    >
                      Disconnect
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="section-heading section-heading--spaced">
            <div>
              <h2>Accessible channels</h2>
              <p>A logical channel is shared when more than one connected account can access it.</p>
            </div>
          </div>
          {channels.length === 0 ? (
            <EmptyState
              title="No channels discovered"
              detail="Connect an account or refresh channel discovery."
            />
          ) : (
            <div className="selection-list">
              {channels.map((channel) => (
                <label className="selection-row" key={channel.id}>
                  <div className="channel-identity">
                    <Thumbnail url={channel.thumbnailUrl} alt={channel.title} />
                    <div>
                      <strong>{channel.title}</strong>
                      <small>{channel.handle ?? channel.providerChannelId}</small>
                    </div>
                  </div>
                  <span>
                    {channel.accessibleAccountIds.length} account
                    {channel.accessibleAccountIds.length === 1 ? '' : 's'}
                  </span>
                  <input
                    type="checkbox"
                    checked={channel.backupEnabled}
                    disabled={busy !== null}
                    onChange={(event) =>
                      void toggleChannel(channel.id, event.currentTarget.checked)
                    }
                    aria-label={`Manage ${channel.title}`}
                  />
                </label>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {busy !== 'startup' && section === 'channels' ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>Managed channels</h2>
              <p>
                Synchronize metadata, playlists, and the local search catalog. No media is
                downloaded in Phase 2.
              </p>
            </div>
          </div>
          {selectedChannels.length === 0 ? (
            <EmptyState
              title="No managed channels"
              detail="Enable channels from Accounts to include them in synchronization."
            />
          ) : (
            <div className="channel-grid">
              {selectedChannels.map((channel) => {
                const job = syncJobs[channel.id];
                const displayedStatus = job?.status ?? channel.syncStatus;
                return (
                  <article className="channel-card" key={channel.id}>
                    <div className="channel-card-head">
                      <div className="channel-identity">
                        <Thumbnail url={channel.thumbnailUrl} alt={channel.title} />
                        <div>
                          <h3>{channel.title}</h3>
                          <p>{channel.handle ?? channel.providerChannelId}</p>
                        </div>
                      </div>
                      <StatePill
                        tone={
                          displayedStatus === 'COMPLETED'
                            ? 'success'
                            : displayedStatus === 'FAILED'
                              ? 'danger'
                              : displayedStatus === 'RUNNING'
                                ? 'warning'
                                : 'neutral'
                        }
                      >
                        {displayedStatus ?? 'NOT SYNCED'}
                      </StatePill>
                    </div>
                    <div className="count-grid">
                      <div>
                        <strong>{channel.videosCount}</strong>
                        <span>Videos</span>
                      </div>
                      <div>
                        <strong>{channel.shortsCount}</strong>
                        <span>Shorts</span>
                      </div>
                      <div>
                        <strong>{channel.liveCount}</strong>
                        <span>Live</span>
                      </div>
                    </div>
                    {job?.progressRatio !== null && job !== undefined ? (
                      <div className="progress">
                        <span style={{ width: `${Math.round(job.progressRatio * 100)}%` }} />
                      </div>
                    ) : null}
                    {job?.safeMessage !== null && job?.safeMessage !== undefined ? (
                      <p className="card-error">{job.safeMessage}</p>
                    ) : null}
                    <div className="channel-card-footer">
                      <span>Last sync: {formatDate(channel.lastSyncAt)}</span>
                      <div className="section-actions">
                        <button
                          className="button button--secondary"
                          disabled={displayedStatus === 'RUNNING' || displayedStatus === 'QUEUED'}
                          onClick={() => void startSync(channel.id)}
                        >
                          Sync channel
                        </button>
                        <button
                          className="button button--primary"
                          disabled={busy !== null}
                          onClick={() => {
                            setSection('backup');
                          }}
                        >
                          Backup now
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {busy !== 'startup' && section === 'library' ? (
        <section {...routeTabPanelProps}>
          <div className="toolbar">
            <input
              className="search-input"
              type="search"
              value={librarySearch}
              onChange={(event) => {
                setLibrarySearch(event.currentTarget.value);
                setLibraryPage(1);
              }}
              placeholder="Search media, channels, playlists…"
              aria-label="Search library"
            />
            <select
              value={libraryChannel ?? ''}
              onChange={(event) => {
                setLibraryChannel(event.currentTarget.value || null);
                setLibraryPage(1);
              }}
              aria-label="Filter by channel"
            >
              <option value="">All channels</option>
              {selectedChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.title}
                </option>
              ))}
            </select>
            <select
              value={libraryType ?? ''}
              onChange={(event) => {
                setLibraryType((event.currentTarget.value || null) as MediaType | null);
                setLibraryPage(1);
              }}
              aria-label="Filter by media type"
            >
              <option value="">All types</option>
              <option value="VIDEO">Videos</option>
              <option value="SHORT">Shorts</option>
              <option value="LIVE">Live</option>
            </select>
            <select
              value={libraryStatus ?? ''}
              onChange={(event) => {
                setLibraryStatus((event.currentTarget.value || null) as SourceStatus | null);
                setLibraryPage(1);
              }}
              aria-label="Filter by source status"
            >
              <option value="">All source states</option>
              {['AVAILABLE', 'PRIVATE', 'UNLISTED', 'REMOVED', 'UNAVAILABLE', 'UNKNOWN'].map(
                (status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ),
              )}
            </select>
            <div className="view-toggle">
              <button
                className={libraryView === 'grid' ? 'active' : ''}
                onClick={() => setLibraryView('grid')}
              >
                Grid
              </button>
              <button
                className={libraryView === 'list' ? 'active' : ''}
                onClick={() => setLibraryView('list')}
              >
                List
              </button>
            </div>
          </div>
          <p className="result-count">{library.total.toLocaleString()} catalog items</p>
          {library.items.length === 0 ? (
            <EmptyState
              title="No catalog items"
              detail="Synchronize a managed channel or adjust the current filters."
            />
          ) : libraryView === 'grid' ? (
            <div className="media-grid">
              {library.items.map((media) => (
                <article
                  className="media-card"
                  key={media.id}
                  onClick={() => void showMediaDetails(media.id)}
                >
                  <div className="media-thumbnail">
                    <Thumbnail url={media.thumbnailUrl} alt={media.title} />
                    <StatePill>{media.mediaType}</StatePill>
                  </div>
                  <div className="media-card-body">
                    <h3 title={media.title}>{media.title}</h3>
                    <p>{media.channelTitle}</p>
                    <div>
                      <span>{formatDuration(media.durationSeconds)}</span>
                      <StatePill
                        tone={
                          media.sourceStatus === 'AVAILABLE'
                            ? 'success'
                            : media.sourceStatus === 'REMOVED'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {media.sourceStatus}
                      </StatePill>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="media-table" role="table">
              <div className="media-row media-row--head" role="row">
                <span>Media</span>
                <span>Channel</span>
                <span>Type</span>
                <span>Published</span>
                <span>Source</span>
              </div>
              {library.items.map((media) => (
                <button
                  className="media-row media-row--button"
                  role="row"
                  key={media.id}
                  onClick={() => void showMediaDetails(media.id)}
                >
                  <div className="media-row-title">
                    <Thumbnail url={media.thumbnailUrl} alt={media.title} />
                    <span>
                      <strong>{media.title}</strong>
                      <small>{formatDuration(media.durationSeconds)}</small>
                    </span>
                  </div>
                  <span>{media.channelTitle}</span>
                  <span>{media.mediaType}</span>
                  <span>{formatDate(media.publishedAt)}</span>
                  <StatePill tone={media.sourceStatus === 'AVAILABLE' ? 'success' : 'neutral'}>
                    {media.sourceStatus}
                  </StatePill>
                </button>
              ))}
            </div>
          )}
          <Pager
            page={library.page}
            pageSize={library.pageSize}
            total={library.total}
            onPage={setLibraryPage}
          />
        </section>
      ) : null}

      {busy !== 'startup' && section === 'playlists' ? (
        <section {...routeTabPanelProps}>
          <div className="toolbar toolbar--compact">
            <input
              className="search-input"
              type="search"
              value={playlistSearch}
              onChange={(event) => {
                setPlaylistSearch(event.currentTarget.value);
                setPlaylistPage(1);
              }}
              placeholder="Search playlists…"
              aria-label="Search playlists"
            />
            <select
              value={playlistChannel ?? ''}
              onChange={(event) => {
                setPlaylistChannel(event.currentTarget.value || null);
                setPlaylistPage(1);
              }}
              aria-label="Filter playlists by channel"
            >
              <option value="">All channels</option>
              {selectedChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.title}
                </option>
              ))}
            </select>
          </div>
          <div className="playlist-layout">
            <div className="playlist-list">
              {playlists.items.length === 0 ? (
                <EmptyState
                  title="No playlists"
                  detail="Synchronize a channel to catalog its playlists."
                />
              ) : (
                playlists.items.map((playlist) => (
                  <button
                    key={playlist.id}
                    className={
                      selectedPlaylist?.id === playlist.id
                        ? 'playlist-row playlist-row--active'
                        : 'playlist-row'
                    }
                    onClick={() => void openPlaylist(playlist)}
                  >
                    <span>
                      <strong>{playlist.title}</strong>
                      <small>{playlist.channelTitle}</small>
                    </span>
                    <span>{playlist.mediaCount} items</span>
                  </button>
                ))
              )}
              <Pager
                page={playlists.page}
                pageSize={playlists.pageSize}
                total={playlists.total}
                onPage={setPlaylistPage}
              />
            </div>
            <aside className="playlist-detail">
              {selectedPlaylist === null ? (
                <EmptyState
                  title="Select a playlist"
                  detail="Its ordered current catalog membership will appear here."
                />
              ) : (
                <>
                  <div className="playlist-detail-head">
                    <div>
                      <p className="eyebrow">{selectedPlaylist.channelTitle}</p>
                      <h2>{selectedPlaylist.title}</h2>
                    </div>
                    <StatePill>{selectedPlaylist.sourceStatus}</StatePill>
                  </div>
                  {playlistMembers === null ? (
                    <div className="loading-panel">Loading membership…</div>
                  ) : playlistMembers.items.length === 0 ? (
                    <EmptyState
                      title="Playlist is empty"
                      detail="No managed-channel media currently belongs to this playlist."
                    />
                  ) : (
                    <ol className="membership-list">
                      {playlistMembers.items.map((member) => (
                        <li key={member.media.id}>
                          <Thumbnail url={member.media.thumbnailUrl} alt={member.media.title} />
                          <span>
                            <strong>{member.media.title}</strong>
                            <small>
                              {member.media.mediaType} ·{' '}
                              {formatDuration(member.media.durationSeconds)}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </aside>
          </div>
        </section>
      ) : null}

      {busy !== 'startup' && section === 'integrity' ? (
        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Integrity / Repair Center</p>
              <h2>Backup health and repair</h2>
              <p>
                Health describes actual copies across configured destinations. It is not a
                protection policy.
              </p>
            </div>
            <div className="section-actions">
              <select
                value={integrityScope}
                onChange={(event) => setIntegrityScope(event.target.value)}
                aria-label="Integrity verification scope"
              >
                <option value="ALL">All configured copies</option>
                {selectedChannels.map((channel) => (
                  <option key={channel.id} value={`CHANNEL:${channel.id}`}>
                    Channel: {channel.title}
                  </option>
                ))}
                {destinations.map((destination) => (
                  <option key={destination.id} value={`DESTINATION:${destination.id}`}>
                    Destination: {destinationLabel(destination)}
                  </option>
                ))}
              </select>
              <button
                className="button button--secondary"
                onClick={() => void startIntegrity('PROVIDER_METADATA_SIZE')}
              >
                Verify selected scope
              </button>
              <button
                className="button button--primary"
                onClick={() => void startIntegrity('DOWNLOADED_SHA256')}
              >
                Full Drive SHA-256
              </button>
            </div>
          </div>
          {integrity === null ? (
            <div className="loading-panel">Loading integrity state…</div>
          ) : (
            <>
              <div className="stats-grid">
                <article>
                  <strong>{integrity.health.complete}</strong>
                  <span>Complete</span>
                </article>
                <article>
                  <strong>{integrity.health.partial}</strong>
                  <span>Partial</span>
                </article>
                <article>
                  <strong>{integrity.health.pending}</strong>
                  <span>Pending</span>
                </article>
                <article>
                  <strong>{integrity.health.missing}</strong>
                  <span>Missing</span>
                </article>
                <article>
                  <strong>{integrity.health.corrupt}</strong>
                  <span>Corrupt</span>
                </article>
                <article>
                  <strong>{integrity.health.unavailable + integrity.health.authRequired}</strong>
                  <span>Unavailable / auth</span>
                </article>
              </div>
              <article className="panel">
                <div className="section-heading">
                  <div>
                    <h3>Channel health</h3>
                    <p>Media counts are grouped by their current descriptive health.</p>
                  </div>
                </div>
                {integrity.channels.length === 0 ? (
                  <EmptyState
                    title="No configured backup coverage"
                    detail="Choose destinations for a managed channel to establish intended copies."
                  />
                ) : (
                  <div className="history-list">
                    {integrity.channels.map((channel) => (
                      <div className="history-row" key={channel.channelId}>
                        <strong>{channel.channelTitle}</strong>
                        <span>
                          <strong>{channel.health.complete}</strong>
                          <small>complete</small>
                        </span>
                        <span>
                          <strong>
                            {channel.health.partial +
                              channel.health.pending +
                              channel.health.missing +
                              channel.health.corrupt +
                              channel.health.unavailable +
                              channel.health.authRequired}
                          </strong>
                          <small>need attention or pending</small>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
              <article className="panel">
                <div className="section-heading">
                  <div>
                    <h3>Issues</h3>
                    <p>Only catalog-authorized copy IDs are accepted for repair.</p>
                  </div>
                </div>
                {integrity.issues.length === 0 ? (
                  <EmptyState
                    title="No integrity issues"
                    detail="Run verification to refresh current copy health."
                  />
                ) : (
                  <div className="issue-list">
                    {integrity.issues.map((issue) => (
                      <div className="issue-row" key={issue.copyId}>
                        <span>
                          <strong>{issue.mediaTitle}</strong>
                          <small>
                            {issue.channelTitle} · {issue.destinationType.replace('_', ' ')}
                          </small>
                          <small>{issue.safeMessage}</small>
                        </span>
                        <StatePill
                          tone={
                            issue.health === 'CORRUPT' || issue.health === 'MISSING'
                              ? 'danger'
                              : 'warning'
                          }
                        >
                          {issue.health.replace('_', ' ')}
                        </StatePill>
                        <span>
                          <small>
                            {issue.repairSources.length > 0
                              ? `${issue.repairSources.length} healthy archive source(s)`
                              : issue.youtubeFallbackAvailable
                                ? 'YouTube fallback only'
                                : 'No repair source'}
                          </small>
                        </span>
                        <div className="queue-actions">
                          <button
                            className="button button--secondary"
                            onClick={() =>
                              void window.ytbm
                                .startIntegrity({
                                  scope: { kind: 'COPY', id: issue.copyId },
                                  driveMode: 'PROVIDER_METADATA_SIZE',
                                })
                                .then(() => setNotice('Verification queued.'))
                                .catch((caught: unknown) => setError(safeMessage(caught)))
                            }
                          >
                            Verify again
                          </button>
                          <button
                            className="button button--primary"
                            disabled={
                              issue.health === 'AUTH_REQUIRED' ||
                              issue.health === 'UNAVAILABLE' ||
                              (issue.repairSources.length === 0 && !issue.youtubeFallbackAvailable)
                            }
                            onClick={() =>
                              void repairCopy(issue.copyId, issue.youtubeFallbackAvailable)
                            }
                          >
                            Repair
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
              <article className="panel">
                <div className="section-heading">
                  <div>
                    <h3>Verification history</h3>
                    <p>
                      Drive metadata checks and downloaded SHA-256 checks are labeled separately.
                    </p>
                  </div>
                </div>
                {integrity.history.length === 0 ? (
                  <EmptyState
                    title="No verification history"
                    detail="Choose Verify all or verify an individual copy."
                  />
                ) : (
                  <div className="history-list">
                    {integrity.history.map((check) => (
                      <div className="history-row" key={check.id}>
                        <span>
                          <strong>{check.mediaTitle}</strong>
                          <small>{check.destinationType.replace('_', ' ')}</small>
                        </span>
                        <StatePill
                          tone={
                            check.result === 'VERIFIED'
                              ? 'success'
                              : check.result === 'PENDING'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {check.result}
                        </StatePill>
                        <span>
                          <strong>{check.verificationStrength.replaceAll('_', ' ')}</strong>
                          <small>{formatDate(check.completedAt ?? check.startedAt)}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </>
          )}
        </section>
      ) : null}

      {busy !== 'startup' && section === 'settings' ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>Settings</h2>
              <p>Application behavior, diagnostics, and catalog recovery.</p>
            </div>
          </div>
          <div className="settings-grid">
            <article className="settings-card settings-card--wide">
              <p className="eyebrow">Windows and tray</p>
              <h3>Background application behavior</h3>
              <div className="settings-options">
                <label>
                  <input
                    type="checkbox"
                    checked={foundation?.settings.startWithWindows ?? false}
                    onChange={(event) =>
                      void saveApplicationSettings({ startWithWindows: event.target.checked })
                    }
                  />
                  Start YouTube Backup Manager with Windows
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={foundation?.settings.startMinimized ?? false}
                    onChange={(event) =>
                      void saveApplicationSettings({ startMinimized: event.target.checked })
                    }
                  />
                  Start minimized to tray
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={foundation?.settings.keepRunningInTray ?? true}
                    onChange={(event) =>
                      void saveApplicationSettings({ keepRunningInTray: event.target.checked })
                    }
                  />
                  Keep running in tray when the window closes
                </label>
              </div>
            </article>
            <article className="settings-card settings-card--wide">
              <p className="eyebrow">Backup schedule</p>
              <h3>Automatic backup</h3>
              <p>
                Times preserve local wall-clock intent. Windows applies timezone and DST rules; a
                skipped clock time follows Task Scheduler's Start when available behavior.
              </p>
              <div className="settings-form-grid">
                <label>
                  Scope
                  <select
                    value={scheduleScope}
                    onChange={(event) => editScheduleScope(event.target.value)}
                  >
                    <option value="GLOBAL">Global default</option>
                    {selectedChannels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.title} override
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Frequency
                  <select
                    value={scheduleFrequency}
                    onChange={(event) =>
                      setScheduleFrequency(event.target.value as ScheduleFrequency)
                    }
                  >
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="EVERY_N_HOURS">Every N hours</option>
                  </select>
                </label>
                <label>
                  Local time
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                  />
                </label>
                {scheduleFrequency === 'WEEKLY' ? (
                  <label>
                    Weekday
                    <select
                      value={scheduleWeekday}
                      onChange={(event) => setScheduleWeekday(Number(event.target.value))}
                    >
                      {[
                        'Sunday',
                        'Monday',
                        'Tuesday',
                        'Wednesday',
                        'Thursday',
                        'Friday',
                        'Saturday',
                      ].map((day, index) => (
                        <option key={day} value={index}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {scheduleFrequency === 'EVERY_N_HOURS' ? (
                  <label>
                    Hours
                    <input
                      type="number"
                      min="1"
                      max="168"
                      value={scheduleEveryHours}
                      onChange={(event) => setScheduleEveryHours(Number(event.target.value))}
                    />
                  </label>
                ) : null}
              </div>
              <div className="settings-options">
                <label>
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(event) => setScheduleEnabled(event.target.checked)}
                  />
                  Automatic backup enabled
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={scheduleCatchUp}
                    onChange={(event) => setScheduleCatchUp(event.target.checked)}
                  />
                  Run one catch-up backup when the PC becomes available
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={scheduleStartup}
                    onChange={(event) => setScheduleStartup(event.target.checked)}
                  />
                  Backup on application startup
                </label>
              </div>
              <button className="button button--primary" onClick={() => void saveSchedule()}>
                Save schedule
              </button>
              <div className="schedule-list">
                {schedules.map((schedule) => (
                  <div key={schedule.id} className="schedule-row">
                    <span>
                      <strong>{schedule.channelTitle ?? 'Global default'}</strong>
                      <small>
                        {schedule.frequency.replaceAll('_', ' ')} · {schedule.localTime} ·{' '}
                        {schedule.timezone}
                      </small>
                      <small>Next expected: {formatDate(schedule.nextExpectedAt)}</small>
                      {schedule.lastErrorSafe === null ? null : (
                        <small className="card-error">{schedule.lastErrorSafe}</small>
                      )}
                    </span>
                    <StatePill
                      tone={
                        schedule.taskStatus === 'SYNCED'
                          ? 'success'
                          : schedule.taskStatus === 'ERROR'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {schedule.taskStatus}
                    </StatePill>
                    <button
                      className="button button--danger"
                      onClick={() => void removeSchedule(schedule.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </article>
            <article className="settings-card settings-card--wide">
              <p className="eyebrow">Integrity</p>
              <h3>Periodic verification</h3>
              {foundation !== null ? (
                <div className="settings-form-grid">
                  <label>
                    Frequency
                    <select
                      value={foundation.settings.periodicIntegrity.frequency}
                      onChange={(event) =>
                        void saveApplicationSettings({
                          periodicIntegrity: {
                            ...foundation.settings.periodicIntegrity,
                            frequency: event.target.value as 'WEEKLY' | 'MONTHLY' | 'CUSTOM',
                          },
                        })
                      }
                    >
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                      <option value="CUSTOM">Custom</option>
                    </select>
                  </label>
                  <label>
                    Local start time
                    <input
                      type="time"
                      value={foundation.settings.periodicIntegrity.localTime}
                      onChange={(event) =>
                        void saveApplicationSettings({
                          periodicIntegrity: {
                            ...foundation.settings.periodicIntegrity,
                            localTime: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Scope
                    <select
                      value={
                        foundation.settings.periodicIntegrity.scope.kind === 'ALL'
                          ? 'ALL'
                          : `${foundation.settings.periodicIntegrity.scope.kind}:${foundation.settings.periodicIntegrity.scope.id}`
                      }
                      onChange={(event) => {
                        const [kind, id] = event.target.value.split(':', 2);
                        const scope: IntegrityScope =
                          kind === 'CHANNEL' && id !== undefined
                            ? { kind: 'CHANNEL', id }
                            : kind === 'DESTINATION' && id !== undefined
                              ? { kind: 'DESTINATION', id }
                              : { kind: 'ALL' };
                        void saveApplicationSettings({
                          periodicIntegrity: {
                            ...foundation.settings.periodicIntegrity,
                            scope,
                          },
                        });
                      }}
                    >
                      <option value="ALL">All configured copies</option>
                      {selectedChannels.map((channel) => (
                        <option key={channel.id} value={`CHANNEL:${channel.id}`}>
                          Channel: {channel.title}
                        </option>
                      ))}
                      {destinations.map((destination) => (
                        <option key={destination.id} value={`DESTINATION:${destination.id}`}>
                          Destination: {destinationLabel(destination)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {foundation.settings.periodicIntegrity.frequency === 'CUSTOM' ? (
                    <label>
                      Days
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={foundation.settings.periodicIntegrity.customIntervalDays}
                        onChange={(event) =>
                          void saveApplicationSettings({
                            periodicIntegrity: {
                              ...foundation.settings.periodicIntegrity,
                              customIntervalDays: Number(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
              <div className="settings-options">
                <label>
                  <input
                    type="checkbox"
                    checked={foundation?.settings.periodicIntegrity.enabled ?? false}
                    onChange={(event) =>
                      foundation !== null &&
                      void saveApplicationSettings({
                        periodicIntegrity: {
                          ...foundation.settings.periodicIntegrity,
                          enabled: event.target.checked,
                        },
                      })
                    }
                  />
                  Enable lower-priority periodic integrity checks
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={
                      foundation?.settings.periodicIntegrity.driveMode === 'DOWNLOADED_SHA256'
                    }
                    onChange={(event) =>
                      foundation !== null &&
                      void saveApplicationSettings({
                        periodicIntegrity: {
                          ...foundation.settings.periodicIntegrity,
                          driveMode: event.target.checked
                            ? 'DOWNLOADED_SHA256'
                            : 'PROVIDER_METADATA_SIZE',
                        },
                      })
                    }
                  />
                  Download full Drive content for SHA-256 (uses bandwidth and temporary disk)
                </label>
              </div>
              <button className="button button--secondary" onClick={() => setSection('integrity')}>
                Open Integrity / Repair Center
              </button>
            </article>
            <article className="settings-card settings-card--wide">
              <p className="eyebrow">Windows notifications</p>
              <h3>Notification categories</h3>
              <p>Messages contain safe summaries and open a fixed in-app destination.</p>
              <div className="settings-options">
                {foundation === null
                  ? null
                  : NOTIFICATION_OPTIONS.map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={foundation.settings.notifications[key]}
                          onChange={(event) =>
                            void saveApplicationSettings({
                              notifications: {
                                ...foundation.settings.notifications,
                                [key]: event.target.checked,
                              },
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
              </div>
            </article>
            <article className="settings-card">
              <p className="eyebrow">Disaster recovery</p>
              <h3>Restore a lost catalog</h3>
              <p>
                Rebuild channels, media, playlists, destinations, and verified copy history from
                local backups, Google Drive, or both.
              </p>
              <button className="button button--primary" onClick={() => void openRecovery()}>
                Open recovery
              </button>
            </article>
            <article className="settings-card">
              <p className="eyebrow">Privacy boundary</p>
              <h3>Read-only source access</h3>
              <p>
                Recovery never invokes yt-dlp, requests YouTube write access, imports credentials,
                or changes backup files.
              </p>
              <button className="button button--secondary" onClick={() => void openLogFolder()}>
                Open diagnostic logs
              </button>
            </article>
          </div>
        </section>
      ) : null}

      {busy !== 'startup' && section === 'recovery' ? (
        <section>
          <div className="section-heading">
            <div>
              <p className="eyebrow">Settings / Disaster recovery</p>
              <h2>Restore backup catalog</h2>
              <p>
                Fast scanning reads manifests, sidecars, filesystem metadata, and app-owned Drive
                metadata only. Media bytes are not downloaded or rehashed during discovery.
              </p>
            </div>
            <button className="button button--secondary" onClick={() => setSection('settings')}>
              Back to settings
            </button>
          </div>
          {recovery === null ? (
            <div className="loading-panel">Preparing a recovery session…</div>
          ) : (
            <div className="recovery-layout">
              <article className="recovery-panel">
                <div className="recovery-panel__head">
                  <div>
                    <p className="eyebrow">1. Sources</p>
                    <h3>Select backup locations</h3>
                  </div>
                  <StatePill
                    tone={
                      ['COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(recovery.status)
                        ? 'success'
                        : recovery.status === 'FAILED'
                          ? 'danger'
                          : ['SCANNING', 'IMPORTING'].includes(recovery.status)
                            ? 'warning'
                            : 'neutral'
                    }
                  >
                    {recovery.status.replaceAll('_', ' ')}
                  </StatePill>
                </div>
                <div className="recovery-actions">
                  <button
                    className="button button--primary"
                    disabled={busy !== null || ['SCANNING', 'IMPORTING'].includes(recovery.status)}
                    onClick={() => void addRecoveryLocalSource()}
                  >
                    Add local backup folder…
                  </button>
                  {accounts
                    .filter(
                      (account) =>
                        account.capabilities.driveConnectionState === 'CONNECTED' &&
                        !recovery.sources.some(
                          (source) =>
                            source.sourceType === 'GOOGLE_DRIVE' && source.accountId === account.id,
                        ),
                    )
                    .map((account) => (
                      <button
                        className="button button--secondary"
                        disabled={
                          busy !== null || ['SCANNING', 'IMPORTING'].includes(recovery.status)
                        }
                        key={account.id}
                        onClick={() => void addRecoveryDriveSource(account.id)}
                      >
                        Add Drive · {account.email ?? account.displayName ?? 'Google account'}
                      </button>
                    ))}
                  <button
                    className="button button--secondary"
                    disabled={busy !== null || oauthFlow?.status === 'PENDING'}
                    onClick={() => void connectGoogle(null, 'GOOGLE_DRIVE')}
                  >
                    Authorize another Drive account
                  </button>
                </div>
                {recovery.sources.length === 0 ? (
                  <EmptyState
                    title="No recovery sources"
                    detail="Choose one or more local backup roots, Google Drive accounts, or both."
                  />
                ) : (
                  <div className="recovery-sources">
                    {recovery.sources.map((source) => (
                      <div key={source.id}>
                        <span>
                          <strong>{source.label}</strong>
                          <small>
                            {source.sourceType === 'FILESYSTEM'
                              ? 'Local filesystem'
                              : 'Google Drive'}
                            {source.discoveredRootCount > 0
                              ? ` · ${source.discoveredRootCount} backup root${source.discoveredRootCount === 1 ? '' : 's'}`
                              : ''}
                          </small>
                        </span>
                        <StatePill
                          tone={
                            source.status === 'FAILED'
                              ? 'danger'
                              : source.status === 'SCANNED'
                                ? 'success'
                                : 'neutral'
                          }
                        >
                          {source.status}
                        </StatePill>
                        {source.driveRoots.length === 0 ? null : (
                          <div className="recovery-roots">
                            {source.driveRoots.map((root) => (
                              <label key={root.providerRootId}>
                                <input
                                  type="checkbox"
                                  checked={root.selected}
                                  disabled={['SCANNING', 'IMPORTING'].includes(recovery.status)}
                                  onChange={(event) => {
                                    void window.ytbm
                                      .setRecoveryDriveRootSelected({
                                        sessionId: recovery.id,
                                        sourceId: source.id,
                                        providerRootId: root.providerRootId,
                                        selected: event.currentTarget.checked,
                                      })
                                      .then((session) => {
                                        setRecovery(session);
                                        setNotice(
                                          'Drive root selection changed. Scan again to refresh the preview.',
                                        );
                                      })
                                      .catch((caught: unknown) => setError(safeMessage(caught)));
                                  }}
                                />
                                <span>
                                  <strong>{root.name}</strong>
                                  <small>{root.providerRootId}</small>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                        {source.safeMessage === null ? null : <small>{source.safeMessage}</small>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="recovery-actions recovery-actions--footer">
                  <button
                    className="button button--primary"
                    disabled={
                      recovery.sources.length === 0 ||
                      ['SCANNING', 'IMPORTING'].includes(recovery.status)
                    }
                    onClick={() => void scanRecovery()}
                  >
                    {recovery.status === 'READY_FOR_REVIEW' ? 'Scan again' : 'Scan sources'}
                  </button>
                  {['SCANNING', 'IMPORTING'].includes(recovery.status) ? (
                    <button
                      className="button button--danger"
                      onClick={() => void window.ytbm.cancelRecovery(recovery.id)}
                    >
                      Cancel safely
                    </button>
                  ) : null}
                </div>
                {recovery.progress === null ? null : (
                  <div className="recovery-progress">
                    <div className="progress">
                      <span
                        style={{
                          width:
                            recovery.progress.total === null || recovery.progress.total === 0
                              ? '20%'
                              : `${Math.min(100, Math.round((recovery.progress.processed / recovery.progress.total) * 100))}%`,
                        }}
                      />
                    </div>
                    <small>
                      {recovery.progress.phase.replaceAll('_', ' ')} ·{' '}
                      {recovery.progress.processed.toLocaleString()}
                      {recovery.progress.total === null
                        ? ' processed'
                        : ` / ${recovery.progress.total.toLocaleString()}`}
                    </small>
                  </div>
                )}
              </article>

              <article className="recovery-panel">
                <p className="eyebrow">2. Preview and restore</p>
                <h3>Recovered catalog preview</h3>
                <div className="recovery-counts">
                  <div>
                    <strong>{recovery.counts.channels}</strong>
                    <span>Channels</span>
                  </div>
                  <div>
                    <strong>{recovery.counts.media}</strong>
                    <span>Media</span>
                  </div>
                  <div>
                    <strong>{recovery.counts.playlists}</strong>
                    <span>Playlists</span>
                  </div>
                  <div>
                    <strong>{recovery.counts.localCopies}</strong>
                    <span>Local copies</span>
                  </div>
                  <div>
                    <strong>{recovery.counts.driveCopies}</strong>
                    <span>Drive copies</span>
                  </div>
                  <div>
                    <strong>{recovery.counts.warnings}</strong>
                    <span>Warnings</span>
                  </div>
                </div>
                {recovery.safeMessage === null ? null : (
                  <p className="card-error">{recovery.safeMessage}</p>
                )}
                {recovery.warnings.length > 0 ? (
                  <details
                    className="recovery-warnings"
                    open={recovery.status === 'READY_FOR_REVIEW'}
                  >
                    <summary>Review {recovery.counts.warnings} recovery warnings</summary>
                    <ul>
                      {recovery.warnings.map((warning) => (
                        <li key={warning.id}>
                          <strong>{warning.code.replaceAll('_', ' ')}</strong>
                          <span>{warning.safeMessage}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {recovery.status === 'READY_FOR_REVIEW' ? (
                  <button className="button button--primary" onClick={() => void importRecovery()}>
                    Confirm and restore catalog
                  </button>
                ) : null}
                {['COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(recovery.status) ? (
                  <div className="recovery-complete">
                    <strong>Catalog restore complete</strong>
                    <p>
                      Stable provider identities were merged and the search index was rebuilt.
                      Backup files and YouTube were not changed.
                    </p>
                    <div className="section-actions">
                      <button
                        className="button button--primary"
                        onClick={() => setSection('library')}
                      >
                        Open library
                      </button>
                      <button
                        className="button button--secondary"
                        onClick={() => void openRecovery(true)}
                      >
                        Start another recovery
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            </div>
          )}
        </section>
      ) : null}

      {busy !== 'startup' && section === 'storage' ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>Backup destinations</h2>
              <p>Independent local filesystem and app-owned Google Drive copies.</p>
            </div>
          </div>
          <div className="storage-add">
            <button
              className="button button--primary"
              disabled={busy !== null}
              onClick={() => void addDestination()}
            >
              Add local folder…
            </button>
            {accounts
              .filter((account) => account.capabilities.driveConnectionState === 'CONNECTED')
              .map((account) => (
                <button
                  className="button button--secondary"
                  disabled={
                    busy !== null ||
                    destinations.some(
                      (destination) =>
                        destination.destinationType === 'GOOGLE_DRIVE' &&
                        destination.accountId === account.id &&
                        destination.enabled,
                    )
                  }
                  key={account.id}
                  onClick={() => void addDriveDestination(account.id)}
                >
                  Add Drive · {account.email ?? account.displayName ?? 'Google account'}
                </button>
              ))}
          </div>
          {foundation === null ? null : (
            <div className="storage-add storage-add--settings">
              <label>
                Global default quality
                <select
                  value={foundation.settings.defaultQualityProfile}
                  onChange={(event) => {
                    void window.ytbm
                      .updateDefaultQuality(event.currentTarget.value as QualityProfile)
                      .then((settings) => {
                        setFoundation((current) =>
                          current === null ? current : { ...current, settings },
                        );
                      })
                      .catch((caught: unknown) => setError(safeMessage(caught)));
                  }}
                >
                  {QUALITY_OPTIONS.map((profile) => (
                    <option key={profile.value} value={profile.value}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
              <small>Channels without an override use this profile.</small>
            </div>
          )}
          {toolDiagnostics === null ? null : (
            <div className="tool-diagnostics" aria-label="Managed tool diagnostics">
              <div>
                <strong>yt-dlp</strong>
                <small>{toolDiagnostics.ytDlp.version ?? 'Unavailable'}</small>
                <StatePill tone={toolDiagnostics.ytDlp.available ? 'success' : 'danger'}>
                  {toolDiagnostics.ytDlp.available ? 'Ready' : 'Unavailable'}
                </StatePill>
              </div>
              <div>
                <strong>FFmpeg</strong>
                <small>{toolDiagnostics.ffmpeg.version ?? 'Unavailable'}</small>
                <StatePill tone={toolDiagnostics.ffmpeg.available ? 'success' : 'danger'}>
                  {toolDiagnostics.ffmpeg.available ? 'Ready' : 'Unavailable'}
                </StatePill>
              </div>
              <div>
                <strong>Google Drive</strong>
                <small>
                  {toolDiagnostics.googleDrive.availableDestinations} of{' '}
                  {toolDiagnostics.googleDrive.configuredDestinations} destinations available
                </small>
                <StatePill
                  tone={
                    toolDiagnostics.googleDrive.lastSafeErrorCode === null ? 'success' : 'warning'
                  }
                >
                  {toolDiagnostics.googleDrive.activeUploads} active uploads
                </StatePill>
              </div>
            </div>
          )}
          <div className="destination-list">
            {destinations.length === 0 ? (
              <EmptyState
                title="No backup destinations"
                detail="Add a writable local folder or authorize Google Drive before starting a backup."
              />
            ) : (
              destinations.map((destination) => (
                <article
                  className={`destination-card destination-card--${destination.destinationType.toLowerCase()}`}
                  key={destination.id}
                >
                  <div>
                    <h3>{destinationLabel(destination)}</h3>
                    {destination.destinationType === 'FILESYSTEM' ? (
                      <>
                        <p>
                          {destination.filesystemType ?? 'Filesystem'} ·{' '}
                          {formatBytes(destination.availableBytes)} available
                        </p>
                        {destination.volumeSerial !== null ? (
                          <small>Volume {destination.volumeSerial}</small>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <p>Google Drive · {formatBytes(destination.availableBytes)} available</p>
                        <small>
                          App-owned My Drive root ·{' '}
                          {destination.providerRootId === null ? 'pending creation' : 'ready'}
                        </small>
                      </>
                    )}
                  </div>
                  <StatePill
                    tone={destination.availabilityStatus === 'AVAILABLE' ? 'success' : 'warning'}
                  >
                    {destination.availabilityStatus}
                  </StatePill>
                  <div className="destination-actions">
                    {destination.destinationType === 'GOOGLE_DRIVE' &&
                    destination.providerRootId !== null ? (
                      <button
                        className="button button--secondary"
                        onClick={() => void openDriveDestination(destination.id)}
                      >
                        Open in Drive
                      </button>
                    ) : null}
                    <button
                      className="button button--danger"
                      onClick={() => {
                        void window.ytbm
                          .disableDestination(destination.id)
                          .then(async () => {
                            setDestinations(await window.ytbm.listDestinations());
                          })
                          .catch((caught: unknown) => setError(safeMessage(caught)));
                      }}
                    >
                      Disable
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      {busy !== 'startup' && section === 'backup' ? (
        <section {...routeTabPanelProps}>
          {route.area !== 'activity' ? (
            <>
              <div className="section-heading">
                <div>
                  <h2>Channel backup</h2>
                  <p>Choose local, Google Drive, or both, then plan one durable backup run.</p>
                </div>
              </div>
              <div className="backup-channel-list">
                {selectedChannels.map((channel) => {
                  const setting = backupSettings[channel.id];
                  if (setting === undefined) {
                    return (
                      <div className="loading-panel" key={channel.id}>
                        Loading {channel.title} settings…
                      </div>
                    );
                  }
                  return (
                    <article className="backup-channel-card" key={channel.id}>
                      <div className="channel-identity">
                        <Thumbnail url={channel.thumbnailUrl} alt={channel.title} />
                        <div>
                          <h3>{channel.title}</h3>
                          <p>
                            {channel.videosCount + channel.shortsCount + channel.liveCount} catalog
                            media
                          </p>
                        </div>
                      </div>
                      <label>
                        Quality
                        <select
                          disabled={busy !== null}
                          value={setting.qualityProfileOverride ?? ''}
                          onChange={(event) => {
                            const profile = (event.currentTarget.value ||
                              null) as QualityProfile | null;
                            void saveBackupSettings(channel.id, profile, setting.destinationIds);
                          }}
                        >
                          <option value="">Use global default</option>
                          {QUALITY_OPTIONS.map((profile) => (
                            <option key={profile.value} value={profile.value}>
                              {profile.label}
                            </option>
                          ))}
                        </select>
                        <small>
                          Effective:{' '}
                          {
                            QUALITY_OPTIONS.find(
                              (profile) => profile.value === setting.effectiveQualityProfile,
                            )?.label
                          }
                        </small>
                      </label>
                      <fieldset className="destination-picker">
                        <legend>Destinations</legend>
                        {destinations.filter((destination) => destination.enabled).length === 0 ? (
                          <div className="destination-picker__empty">
                            <span>
                              Add a local or Google Drive destination before starting a backup.
                            </span>
                            <button
                              className="button button--secondary"
                              onClick={() => setSection('storage')}
                            >
                              Go to Storage
                            </button>
                          </div>
                        ) : null}
                        {destinations
                          .filter((destination) => destination.enabled)
                          .map((destination) => (
                            <label key={destination.id}>
                              <input
                                type="checkbox"
                                disabled={busy !== null}
                                checked={setting.destinationIds.includes(destination.id)}
                                onChange={(event) => {
                                  const next = event.currentTarget.checked
                                    ? [...setting.destinationIds, destination.id]
                                    : setting.destinationIds.filter((id) => id !== destination.id);
                                  void saveBackupSettings(
                                    channel.id,
                                    setting.qualityProfileOverride,
                                    next,
                                  );
                                }}
                              />
                              <span>{destinationLabel(destination)}</span>
                              <StatePill
                                tone={
                                  destination.availabilityStatus === 'AVAILABLE'
                                    ? 'success'
                                    : 'warning'
                                }
                              >
                                {destination.availabilityStatus}
                              </StatePill>
                            </label>
                          ))}
                      </fieldset>
                      {busy === `backup-settings:${channel.id}` ? (
                        <small className="backup-settings-status" aria-live="polite">
                          Saving destination settings…
                        </small>
                      ) : null}
                      <button
                        className="button button--primary"
                        disabled={setting.destinationIds.length === 0 || busy !== null}
                        onClick={() => void startBackup(channel.id)}
                      >
                        Backup now
                      </button>
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}
          <div
            className={`section-heading${route.area === 'activity' ? '' : ' section-heading--spaced'}`}
          >
            <div>
              <h2>Backup history</h2>
              <p>Durable summaries remain separate from current queue details.</p>
            </div>
          </div>
          <div className="run-list">
            {backupRuns.length === 0 ? (
              <EmptyState
                title="No backup history"
                detail="Start a backup to create the first run."
              />
            ) : (
              backupRuns.map((run) => (
                <article className="run-row" key={run.id}>
                  <div>
                    <strong>{run.channelTitle}</strong>
                    <small>{formatDate(run.createdAt)}</small>
                  </div>
                  <StatePill
                    tone={
                      run.status === 'COMPLETED'
                        ? 'success'
                        : run.status === 'COMPLETED_WITH_ERRORS'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {run.status.replaceAll('_', ' ')}
                  </StatePill>
                  <span>{run.downloadedCount} downloaded</span>
                  <span>{run.localCopyCount} verified copies</span>
                  <span>{formatBytes(run.bytesTransferred)}</span>
                  {['RUNNING', 'PAUSED'].includes(run.status) ? (
                    <button
                      className="button button--secondary"
                      onClick={() =>
                        void controlBackupRun(run.id, run.status === 'PAUSED' ? 'RESUME' : 'PAUSE')
                      }
                    >
                      {run.status === 'PAUSED' ? 'Resume' : 'Pause'}
                    </button>
                  ) : null}
                </article>
              ))
            )}
          </div>
          {route.area === 'activity' && route.view === 'history' ? (
            <>
              <div className="section-heading section-heading--spaced">
                <div>
                  <h2>Backed up media</h2>
                  <p>Recently completed media from the durable queue.</p>
                </div>
              </div>
              {queue === null ? (
                <div className="loading-panel">Loading backed-up media…</div>
              ) : (
                <>
                  <div className="queue-list">
                    {queue.completedMedia.length === 0 ? (
                      <EmptyState
                        title="No backed-up media"
                        detail="Completed media will appear here after verification succeeds."
                      />
                    ) : (
                      <CompletedMediaRows
                        items={queue.completedMedia}
                        onShowDetails={(mediaItemId) => void showMediaDetails(mediaItemId)}
                      />
                    )}
                  </div>
                  <Pager
                    page={queue.page}
                    pageSize={queue.pageSize}
                    total={queue.totalItems}
                    onPage={(page) => {
                      setQueue(null);
                      setQueuePage(page);
                    }}
                  />
                </>
              )}
            </>
          ) : null}
        </section>
      ) : null}

      {busy !== 'startup' && section === 'queue' ? (
        <section {...routeTabPanelProps}>
          <div className="section-heading">
            <div>
              <h2>Backup activity</h2>
              <p>
                Follow videos here. The advanced view exposes the smaller recoverable steps that
                make each backup resumable.
              </p>
            </div>
          </div>
          {queue === null ? (
            <div className="loading-panel">Loading queue…</div>
          ) : (
            <>
              <div className="queue-summary" aria-label="Queue filters">
                <button
                  className={
                    queueSection === 'ACTIVE' ? 'queue-filter queue-filter--active' : 'queue-filter'
                  }
                  aria-pressed={queueSection === 'ACTIVE'}
                  onClick={() => selectQueueSection('ACTIVE')}
                >
                  <strong>{queue.activeCount}</strong>
                  <span>Active now</span>
                </button>
                <button
                  className={
                    queueSection === 'WAITING_DOWNLOADS'
                      ? 'queue-filter queue-filter--active'
                      : 'queue-filter'
                  }
                  aria-pressed={queueSection === 'WAITING_DOWNLOADS'}
                  onClick={() => selectQueueSection('WAITING_DOWNLOADS')}
                >
                  <strong>{queue.waitingDownloadCount}</strong>
                  <span>Waiting to download</span>
                </button>
                <button
                  className={
                    queueSection === 'RETRYING'
                      ? 'queue-filter queue-filter--active'
                      : 'queue-filter'
                  }
                  aria-pressed={queueSection === 'RETRYING'}
                  onClick={() => selectQueueSection('RETRYING')}
                >
                  <strong>{queue.retryWaitingCount}</strong>
                  <span>Retrying</span>
                </button>
                <button
                  className={
                    queueSection === 'PAUSED' ? 'queue-filter queue-filter--active' : 'queue-filter'
                  }
                  aria-pressed={queueSection === 'PAUSED'}
                  onClick={() => selectQueueSection('PAUSED')}
                >
                  <strong>{queue.pausedCount}</strong>
                  <span>Paused</span>
                </button>
                <button
                  className={
                    queueSection === 'ATTENTION'
                      ? 'queue-filter queue-filter--active'
                      : 'queue-filter'
                  }
                  aria-pressed={queueSection === 'ATTENTION'}
                  onClick={() => selectQueueSection('ATTENTION')}
                >
                  <strong>{queue.failedCount + queue.blockedCount}</strong>
                  <span>Needs attention</span>
                </button>
                <button
                  className={
                    queueSection === 'COMPLETED'
                      ? 'queue-filter queue-filter--active'
                      : 'queue-filter'
                  }
                  aria-pressed={queueSection === 'COMPLETED'}
                  onClick={() => selectQueueSection('COMPLETED')}
                >
                  <strong>{queue.completedMediaCount}</strong>
                  <span>Backed up</span>
                </button>
                <button
                  className={
                    queueSection === 'ALL' ? 'queue-filter queue-filter--active' : 'queue-filter'
                  }
                  aria-pressed={queueSection === 'ALL'}
                  title="Show every internal recovery step"
                  onClick={() => selectQueueSection('ALL')}
                >
                  <strong>{queue.totalJobCount}</strong>
                  <span>All recovery steps</span>
                </button>
              </div>
              {queueSection === 'ALL' ? (
                <p className="queue-explanation">
                  These are processing steps, not videos. A single video normally uses separate
                  probe, download, processing, hash, verification, copy, metadata, thumbnail,
                  manifest, and cleanup steps so interrupted work can resume safely.
                </p>
              ) : null}
              <div className="queue-list">
                {queue.jobs.length === 0 && queue.completedMedia.length === 0 ? (
                  <EmptyState
                    title={queue.totalJobCount === 0 ? 'Queue is empty' : 'Nothing in this view'}
                    detail={
                      queue.totalJobCount === 0
                        ? 'Configure a channel and choose Backup now.'
                        : 'Choose another filter to see the rest of the backup.'
                    }
                  />
                ) : queueSection === 'COMPLETED' ? (
                  queue.completedMedia.map((media) => (
                    <article className="queue-row queue-row--completed" key={media.mediaItemId}>
                      <div>
                        <strong>{media.mediaTitle}</strong>
                        <small>
                          Verified {formatDate(media.verifiedAt)} · {formatBytes(media.bytes)}
                        </small>
                        <small className="queue-destinations">
                          {media.destinationPaths.join(' · ')}
                        </small>
                      </div>
                      <StatePill tone="success">Backed up</StatePill>
                      <div className="queue-completed-summary">
                        <strong>
                          {media.verifiedCopyCount} verified{' '}
                          {media.verifiedCopyCount === 1 ? 'copy' : 'copies'}
                        </strong>
                        <small>Integrity check passed</small>
                      </div>
                      <div className="queue-actions">
                        <button onClick={() => void showMediaDetails(media.mediaItemId)}>
                          View details
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  queue.jobs.map((job) => (
                    <article className="queue-row" key={job.id}>
                      <div>
                        <strong>{job.mediaTitle ?? job.jobType.replaceAll('_', ' ')}</strong>
                        <small>
                          {job.operationType === null
                            ? ''
                            : `${job.operationType.replaceAll('_', ' ')} · `}
                          {job.jobType.replaceAll('_', ' ')}
                          {job.destinationPath === null ? '' : ` · ${job.destinationPath}`}
                        </small>
                      </div>
                      <StatePill
                        tone={
                          job.status === 'FAILED'
                            ? 'danger'
                            : job.status === 'BLOCKED' || job.status === 'RETRY_WAIT'
                              ? 'warning'
                              : job.status === 'COMPLETED'
                                ? 'success'
                                : 'neutral'
                        }
                      >
                        {queueStatusLabel(job.status)}
                      </StatePill>
                      <div className="queue-progress">
                        <div className="progress">
                          <span
                            style={{ width: `${Math.round((job.progressRatio ?? 0) * 100)}%` }}
                          />
                        </div>
                        <small>
                          {formatBytes(job.bytesProcessed)} / {formatBytes(job.bytesTotal)}
                          {job.speedBytesPerSec === null
                            ? ''
                            : ` · ${formatBytes(job.speedBytesPerSec)}/s`}
                          {job.etaSeconds === null ? '' : ` · ${job.etaSeconds}s ETA`}
                        </small>
                        {job.safeMessage === null ? null : (
                          <small className="card-error">{job.safeMessage}</small>
                        )}
                      </div>
                      <div className="queue-actions">
                        {['RUNNING', 'READY', 'PENDING'].includes(job.status) ? (
                          <button onClick={() => void controlQueueJob(job.id, 'PAUSE')}>
                            Pause
                          </button>
                        ) : null}
                        {job.status === 'PAUSED' ? (
                          <button onClick={() => void controlQueueJob(job.id, 'RESUME')}>
                            Resume
                          </button>
                        ) : null}
                        {[
                          'PENDING',
                          'READY',
                          'RUNNING',
                          'PAUSED',
                          'RETRY_WAIT',
                          'BLOCKED',
                        ].includes(job.status) ? (
                          <button
                            onClick={() => {
                              const removePartial = window.confirm(
                                'Remove resumable partial data? Choose Cancel to preserve it.',
                              );
                              void controlQueueJob(
                                job.id,
                                removePartial ? 'CANCEL_REMOVE_PARTIAL' : 'CANCEL_KEEP_PARTIAL',
                              );
                            }}
                          >
                            Cancel
                          </button>
                        ) : null}
                        {['PENDING', 'READY', 'PAUSED'].includes(job.status) ? (
                          <button onClick={() => void controlQueueJob(job.id, 'MOVE_TOP')}>
                            Move to top
                          </button>
                        ) : null}
                        {['PENDING', 'READY', 'PAUSED'].includes(job.status) ? (
                          <>
                            <button onClick={() => void controlQueueJob(job.id, 'PRIORITY_UP')}>
                              Priority +
                            </button>
                            <button onClick={() => void controlQueueJob(job.id, 'PRIORITY_DOWN')}>
                              Priority −
                            </button>
                          </>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
              <Pager
                page={queue.page}
                pageSize={queue.pageSize}
                total={queue.totalItems}
                onPage={(page) => {
                  setQueue(null);
                  setQueuePage(page);
                }}
              />
            </>
          )}
        </section>
      ) : null}

      {mediaDetails !== null ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setMediaDetails(null)}>
          <section
            className="media-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Backup details"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setMediaDetails(null)}
              aria-label="Close backup details"
            >
              ×
            </button>
            <p className="eyebrow">Backup details</p>
            <h2>{mediaDetails.title}</h2>
            <button
              className="button button--secondary"
              onClick={() =>
                void startIntegrity('PROVIDER_METADATA_SIZE', {
                  kind: 'MEDIA',
                  id: mediaDetails.mediaItemId,
                })
              }
            >
              Verify all copies of this media
            </button>
            {mediaDetails.copies.length === 0 ? (
              <EmptyState
                title="No destination copies"
                detail="No local or Google Drive copy has been planned for this media yet."
              />
            ) : (
              mediaDetails.copies.map((copy) => (
                <article className="copy-detail" key={copy.id}>
                  <div>
                    <strong>
                      {copy.destinationType === 'FILESYSTEM' ? 'Local' : 'Google Drive'}:{' '}
                      {copy.availabilityStatus === 'DISCONNECTED' && copy.status === 'VERIFIED'
                        ? 'Disconnected'
                        : copy.status}
                    </strong>
                    <p>
                      {copy.destinationPath}
                      {copy.destinationType === 'FILESYSTEM' && copy.relativePath !== null
                        ? `\\${copy.relativePath}`
                        : ''}
                    </p>
                    <small>
                      {formatBytes(copy.bytes)} ·{' '}
                      {copy.height === null ? 'Resolution unknown' : `${copy.height}p`} ·{' '}
                      {copy.qualityProfile ?? 'Quality pending'} ·{' '}
                      {copy.verificationStrength ?? 'Verification pending'}
                    </small>
                    {copy.destinationAccountEmail === null ? null : (
                      <small>{copy.destinationAccountEmail}</small>
                    )}
                    {copy.sha256 === null ? null : <code>{copy.sha256.slice(0, 16)}…</code>}
                  </div>
                  <button
                    className="button button--secondary"
                    onClick={() =>
                      void startIntegrity('PROVIDER_METADATA_SIZE', {
                        kind: 'COPY',
                        id: copy.id,
                      })
                    }
                  >
                    Verify copy
                  </button>
                  {copy.destinationType === 'FILESYSTEM' &&
                  copy.status === 'VERIFIED' &&
                  copy.availabilityStatus === 'AVAILABLE' ? (
                    <button
                      className="button button--secondary"
                      onClick={() => void openVerifiedCopyFolder(copy.id, mediaDetails.mediaItemId)}
                    >
                      Open folder
                    </button>
                  ) : null}
                  {copy.destinationType === 'GOOGLE_DRIVE' &&
                  copy.providerFileIdAvailable &&
                  copy.availabilityStatus === 'AVAILABLE' ? (
                    <button
                      className="button button--secondary"
                      onClick={() => void openGoogleDriveCopy(copy.id, mediaDetails.mediaItemId)}
                    >
                      Open in Drive
                    </button>
                  ) : null}
                </article>
              ))
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
