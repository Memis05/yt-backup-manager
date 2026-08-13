import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

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
  GoogleOAuthCapability,
} from '@ytbm/core';

type Section =
  | 'dashboard'
  | 'accounts'
  | 'channels'
  | 'library'
  | 'playlists'
  | 'backup'
  | 'queue'
  | 'storage'
  | 'settings'
  | 'recovery';
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

const NAVIGATION: Array<{ id: Section; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'channels', label: 'Channels' },
  { id: 'library', label: 'Library' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'backup', label: 'Backup' },
  { id: 'queue', label: 'Queue' },
  { id: 'storage', label: 'Storage' },
  { id: 'settings', label: 'Settings' },
];

function sectionLabel(section: Section): string {
  return section === 'recovery'
    ? 'Disaster recovery'
    : (NAVIGATION.find((item) => item.id === section)?.label ?? 'YouTube Backup Manager');
}

const QUALITY_OPTIONS: Array<{ value: QualityProfile; label: string }> = [
  { value: 'BEST_AVAILABLE', label: 'Best available' },
  { value: 'MAX_4K', label: 'Up to 4K' },
  { value: 'MAX_1080P', label: 'Up to 1080p' },
  { value: 'MAX_720P', label: 'Up to 720p' },
];

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

export function App() {
  const [section, setSection] = useState<Section>('dashboard');
  const [foundation, setFoundation] = useState<FoundationStatus | null>(null);
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [busy, setBusy] = useState<string | null>('startup');
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
  const [queueSection, setQueueSection] = useState<QueueSection>('ACTIVE');
  const [queuePage, setQueuePage] = useState(1);
  const [mediaDetails, setMediaDetails] = useState<MediaBackupDetails | null>(null);
  const [toolDiagnostics, setToolDiagnostics] = useState<ToolDiagnostics | null>(null);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [recovery, setRecovery] = useState<RecoverySessionDto | null>(null);

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
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (oauthFlow?.status !== 'PENDING') return;
    const timer = window.setInterval(() => {
      void window.ytbm
        .getOAuthStatus(oauthFlow.flowId)
        .then(async (flow) => {
          setOAuthFlow(flow);
          if (flow.status === 'COMPLETED') {
            setNotice(
              `${flow.account?.displayName ?? flow.account?.email ?? 'Google account'} connected.`,
            );
            await refreshCore();
          } else if (flow.status === 'FAILED' || flow.status === 'EXPIRED') {
            setError(flow.safeMessage ?? 'Google authorization did not complete.');
          }
        })
        .catch((caught: unknown) => setError(safeMessage(caught)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [oauthFlow, refreshCore]);

  useEffect(() => {
    const active = Object.values(syncJobs).filter((job) =>
      ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(job.status),
    );
    if (active.length === 0) return;
    const timer = window.setInterval(() => {
      void Promise.all(active.map((job) => window.ytbm.getSyncStatus(job.id)))
        .then(async (jobs) => {
          setSyncJobs((current) => ({
            ...current,
            ...Object.fromEntries(jobs.map((job) => [job.channelId, job])),
          }));
          if (jobs.some((job) => job.status === 'COMPLETED')) await refreshCore();
        })
        .catch((caught: unknown) => setError(safeMessage(caught)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [syncJobs, refreshCore]);

  useEffect(() => {
    if (section !== 'library') return;
    const timer = window.setTimeout(() => {
      void window.ytbm
        .queryLibrary({
          search: librarySearch,
          channelId: libraryChannel,
          mediaType: libraryType,
          sourceStatus: libraryStatus,
          page: libraryPage,
          pageSize: 40,
        })
        .then(setLibrary)
        .catch((caught: unknown) => setError(safeMessage(caught)));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [section, librarySearch, libraryChannel, libraryType, libraryStatus, libraryPage]);

  useEffect(() => {
    if (section !== 'playlists') return;
    const timer = window.setTimeout(() => {
      void window.ytbm
        .queryPlaylists({
          channelId: playlistChannel,
          search: playlistSearch,
          page: playlistPage,
          pageSize: 30,
        })
        .then(setPlaylists)
        .catch((caught: unknown) => setError(safeMessage(caught)));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [section, playlistChannel, playlistSearch, playlistPage]);

  useEffect(() => {
    if (section !== 'backup') return;
    let active = true;
    const enabledChannels = channels.filter((channel) => channel.backupEnabled);
    void Promise.all([
      window.ytbm.listBackupRuns(),
      ...enabledChannels.map((channel) => window.ytbm.getChannelBackupSettings(channel.id)),
    ])
      .then(([runs, ...settings]) => {
        if (!active) return;
        setBackupRuns(runs);
        setBackupSettings(
          Object.fromEntries(settings.map((setting) => [setting.channelId, setting])),
        );
      })
      .catch((caught: unknown) => {
        if (active) setError(safeMessage(caught));
      });
    return () => {
      active = false;
    };
  }, [section, channels]);

  useEffect(() => {
    if (section !== 'queue') return;
    let active = true;
    const refresh = (): void => {
      void window.ytbm
        .getQueueSnapshot({ section: queueSection, page: queuePage, pageSize: QUEUE_PAGE_SIZE })
        .then((snapshot) => {
          if (!active) return;
          const lastPage = Math.max(1, Math.ceil(snapshot.totalItems / snapshot.pageSize));
          if (snapshot.page > lastPage) setQueuePage(lastPage);
          else setQueue(snapshot);
        })
        .catch((caught: unknown) => {
          if (active) setError(safeMessage(caught));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [section, queueSection, queuePage]);

  useEffect(() => {
    if (
      section !== 'recovery' ||
      recovery === null ||
      !['SCANNING', 'IMPORTING'].includes(recovery.status)
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void window.ytbm
        .getRecoverySession(recovery.id)
        .then(async (session) => {
          setRecovery(session);
          if (['COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(session.status)) {
            await refreshCore();
            setNotice('Backup catalog restored. Existing verified copies are ready for planning.');
          }
        })
        .catch((caught: unknown) => setError(safeMessage(caught)));
    }, 750);
    return () => window.clearInterval(timer);
  }, [section, recovery, refreshCore]);

  const selectedChannels = useMemo(
    () => channels.filter((channel) => channel.backupEnabled),
    [channels],
  );

  const connectGoogle = async (
    accountId: string | null = null,
    capability: GoogleOAuthCapability = 'YOUTUBE',
  ): Promise<void> => {
    setBusy(`${capability}:${accountId ?? 'connect'}`);
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
      setBusy(null);
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
    setBusy(`discover:${accountId}`);
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
      setBusy(null);
    }
  };

  const disconnectAccount = async (accountId: string): Promise<void> => {
    setBusy(`disconnect:${accountId}`);
    setError(null);
    try {
      await window.ytbm.disconnectAccount(accountId);
      await refreshCore();
      setNotice('Local Google credentials were removed. Catalog records were preserved.');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const toggleChannel = async (channelId: string, enabled: boolean): Promise<void> => {
    setBusy(`channel:${channelId}`);
    setError(null);
    try {
      const updated = await window.ytbm.setChannelEnabled(channelId, enabled);
      setChannels((current) =>
        current.map((channel) => (channel.id === channelId ? updated : channel)),
      );
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(null);
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
    setBusy('add-destination');
    setError(null);
    try {
      const destination = await window.ytbm.addFilesystemDestination();
      if (destination === null) return;
      setDestinations(await window.ytbm.listDestinations());
      setNotice('Local backup destination added and probed successfully.');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const addDriveDestination = async (accountId: string): Promise<void> => {
    setBusy(`add-drive:${accountId}`);
    setError(null);
    try {
      await window.ytbm.addGoogleDriveDestination(accountId);
      await refreshCore();
      setNotice('Google Drive destination added and probed successfully.');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(null);
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
    setBackupSettings((current) => ({
      ...current,
      [channelId]: {
        ...previous,
        qualityProfileOverride,
        effectiveQualityProfile:
          qualityProfileOverride ??
          foundation?.settings.defaultQualityProfile ??
          previous.effectiveQualityProfile,
        destinationIds,
      },
    }));
    setBusy(`backup-settings:${channelId}`);
    setError(null);
    try {
      const updated = await window.ytbm.updateChannelBackupSettings({
        channelId,
        qualityProfileOverride,
        destinationIds,
      });
      setBackupSettings((current) => ({ ...current, [channelId]: updated }));
    } catch (caught) {
      setBackupSettings((current) => ({ ...current, [channelId]: previous }));
      setError(safeMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const startBackup = async (channelId: string): Promise<void> => {
    setBusy(`backup:${channelId}`);
    setError(null);
    try {
      const result = await window.ytbm.startBackup(channelId);
      setNotice(
        `Backup started for ${result.run.discoveredCount} media. ${result.skippedVerifiedMedia} already verified; ${result.plannedJobs} recoverable processing steps will run automatically.`,
      );
      setBackupRuns(await window.ytbm.listBackupRuns());
      setQueueSection('ACTIVE');
      setQueuePage(1);
      setSection('queue');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(null);
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
  };

  const openRecovery = async (startFresh = false): Promise<void> => {
    setBusy('recovery-open');
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
      setBusy(null);
    }
  };

  const addRecoveryLocalSource = async (): Promise<void> => {
    if (recovery === null) return;
    setBusy('recovery-local');
    setError(null);
    try {
      const session = await window.ytbm.addRecoveryLocalSource(recovery.id);
      if (session !== null) setRecovery(session);
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const addRecoveryDriveSource = async (accountId: string): Promise<void> => {
    if (recovery === null) return;
    setBusy(`recovery-drive:${accountId}`);
    setError(null);
    try {
      setRecovery(await window.ytbm.addRecoveryDriveSource(recovery.id, accountId));
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(null);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">YT</span>
          <div>
            <strong>Backup Manager</strong>
            <small>Durable local archive</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {NAVIGATION.map((item) => (
            <button
              key={item.id}
              className={section === item.id ? 'nav-item nav-item--active' : 'nav-item'}
              onClick={() => setSection(item.id)}
            >
              {item.label}
              {item.id === 'channels' && selectedChannels.length > 0 ? (
                <span>{selectedChannels.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <StatePill tone={foundation === null ? 'warning' : 'success'}>
            {foundation === null ? 'Connecting' : 'Worker ready'}
          </StatePill>
          <small>YouTube access is permanently read only.</small>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">YouTube Backup Manager</p>
            <h1>{sectionLabel(section)}</h1>
          </div>
          <div className="topbar-meta">
            <span>
              {
                accounts.filter(
                  (account) =>
                    account.connectionState === 'CONNECTED' ||
                    account.capabilities.driveConnectionState === 'CONNECTED',
                ).length
              }{' '}
              accounts
            </span>
            <span>{library.total} media indexed</span>
          </div>
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
                <p>
                  A logical channel is shared when more than one connected account can access it.
                </p>
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
          <section>
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
          <section>
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

        {busy !== 'startup' && section === 'settings' ? (
          <section>
            <div className="section-heading">
              <div>
                <h2>Settings</h2>
                <p>Application behavior, diagnostics, and catalog recovery.</p>
              </div>
            </div>
            <div className="settings-grid">
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
                      disabled={
                        busy !== null || ['SCANNING', 'IMPORTING'].includes(recovery.status)
                      }
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
                              source.sourceType === 'GOOGLE_DRIVE' &&
                              source.accountId === account.id,
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
                    <button
                      className="button button--primary"
                      onClick={() => void importRecovery()}
                    >
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
          <section>
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
            <div className="section-heading section-heading--spaced">
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
                          void window.ytbm.controlBackupRun(
                            run.id,
                            run.status === 'PAUSED' ? 'RESUME' : 'PAUSE',
                          )
                        }
                      >
                        {run.status === 'PAUSED' ? 'Resume' : 'Pause'}
                      </button>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        ) : null}

        {busy !== 'startup' && section === 'queue' ? (
          <section>
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
                      queueSection === 'ACTIVE'
                        ? 'queue-filter queue-filter--active'
                        : 'queue-filter'
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
                      queueSection === 'PAUSED'
                        ? 'queue-filter queue-filter--active'
                        : 'queue-filter'
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
                            <button onClick={() => void window.ytbm.controlJob(job.id, 'PAUSE')}>
                              Pause
                            </button>
                          ) : null}
                          {job.status === 'PAUSED' ? (
                            <button onClick={() => void window.ytbm.controlJob(job.id, 'RESUME')}>
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
                                void window.ytbm.controlJob(
                                  job.id,
                                  removePartial ? 'CANCEL_REMOVE_PARTIAL' : 'CANCEL_KEEP_PARTIAL',
                                );
                              }}
                            >
                              Cancel
                            </button>
                          ) : null}
                          {['PENDING', 'READY', 'PAUSED'].includes(job.status) ? (
                            <button onClick={() => void window.ytbm.controlJob(job.id, 'MOVE_TOP')}>
                              Move to top
                            </button>
                          ) : null}
                          {['PENDING', 'READY', 'PAUSED'].includes(job.status) ? (
                            <>
                              <button
                                onClick={() => void window.ytbm.controlJob(job.id, 'PRIORITY_UP')}
                              >
                                Priority +
                              </button>
                              <button
                                onClick={() => void window.ytbm.controlJob(job.id, 'PRIORITY_DOWN')}
                              >
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
                    {copy.destinationType === 'FILESYSTEM' &&
                    copy.status === 'VERIFIED' &&
                    copy.availabilityStatus === 'AVAILABLE' ? (
                      <button
                        className="button button--secondary"
                        onClick={() =>
                          void openVerifiedCopyFolder(copy.id, mediaDetails.mediaItemId)
                        }
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
      </main>
    </div>
  );
}
