import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  AccountDto,
  ChannelDto,
  FoundationStatus,
  LibraryQueryResult,
  MediaType,
  OAuthFlowDto,
  PlaylistDto,
  PlaylistMembersResult,
  SourceStatus,
  SourceSyncJobDto,
} from '@ytbm/core';

type Section = 'accounts' | 'channels' | 'library' | 'playlists';
type LibraryView = 'grid' | 'list';

const NAVIGATION: Array<{ id: Section; label: string }> = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'channels', label: 'Channels' },
  { id: 'library', label: 'Library' },
  { id: 'playlists', label: 'Playlists' },
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
  const [section, setSection] = useState<Section>('accounts');
  const [foundation, setFoundation] = useState<FoundationStatus | null>(null);
  const [accounts, setAccounts] = useState<AccountDto[]>([]);
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [busy, setBusy] = useState<string | null>('startup');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oauthFlow, setOAuthFlow] = useState<OAuthFlowDto | null>(null);
  const [syncJobs, setSyncJobs] = useState<Record<string, SourceSyncJobDto>>({});

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
    const [foundationStatus, accountItems, channelItems] = await Promise.all([
      window.ytbm.getFoundationStatus(),
      window.ytbm.listAccounts(),
      window.ytbm.listChannels(),
    ]);
    setFoundation(foundationStatus);
    setAccounts(accountItems);
    setChannels(channelItems);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.ytbm.getFoundationStatus(),
      window.ytbm.listAccounts(),
      window.ytbm.listChannels(),
    ])
      .then(([foundationStatus, accountItems, channelItems]) => {
        if (!active) return;
        setFoundation(foundationStatus);
        setAccounts(accountItems);
        setChannels(channelItems);
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

  const selectedChannels = useMemo(
    () => channels.filter((channel) => channel.backupEnabled),
    [channels],
  );

  const connectGoogle = async (accountId: string | null = null): Promise<void> => {
    setBusy(accountId ?? 'connect');
    setError(null);
    setNotice(null);
    try {
      const result = await window.ytbm.beginGoogleOAuth(accountId);
      if (result.status === 'UNAVAILABLE') {
        setError(result.safeMessage);
        return;
      }
      setOAuthFlow({
        flowId: result.flowId,
        status: 'PENDING',
        expiresAt: result.expiresAt,
        account: null,
        errorCode: null,
        safeMessage: null,
      });
      setNotice('Google sign-in opened in your system browser. Finish there, then return here.');
    } catch (caught) {
      setError(safeMessage(caught));
    } finally {
      setBusy(null);
    }
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">YT</span>
          <div>
            <strong>Backup Manager</strong>
            <small>Read-only source catalog</small>
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
            <p className="eyebrow">Source catalog</p>
            <h1>{NAVIGATION.find((item) => item.id === section)?.label}</h1>
          </div>
          <div className="topbar-meta">
            <span>
              {accounts.filter((account) => account.connectionState === 'CONNECTED').length}{' '}
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
                    <StatePill
                      tone={
                        account.connectionState === 'CONNECTED'
                          ? 'success'
                          : account.connectionState === 'REAUTH_REQUIRED'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {account.connectionState.replaceAll('_', ' ')}
                    </StatePill>
                    <div className="account-actions">
                      {account.connectionState === 'CONNECTED' ? (
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
                        className="button button--danger"
                        disabled={busy !== null || account.connectionState === 'DISCONNECTED'}
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
                        <button
                          className="button button--primary"
                          disabled={displayedStatus === 'RUNNING' || displayedStatus === 'QUEUED'}
                          onClick={() => void startSync(channel.id)}
                        >
                          Sync channel
                        </button>
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
                  <article className="media-card" key={media.id}>
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
                  <div className="media-row" role="row" key={media.id}>
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
                  </div>
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
      </main>
    </div>
  );
}
