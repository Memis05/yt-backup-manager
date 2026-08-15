import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  CloudArrowUp,
  FolderOpen,
  ImageSquare,
  ListBullets,
  SquaresFour,
  Wrench,
} from '@phosphor-icons/react';
import type {
  ChannelDto,
  IntegrityIssueDto,
  MediaCopyDto,
  MediaLibraryItemDto,
  PlaylistDto,
  PlaylistMembersResult,
  PlaylistQueryResult,
} from '@ytbm/core';

import type { AppRoute } from '../../app/routes';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  Status,
  Toolbar,
} from '../../ui';
import { useLibraryFeatureController, type MediaDetailsSnapshot } from './library-controller';
import {
  availabilityLabel,
  copyStatusLabel,
  copySummaryLabel,
  formatLibraryBytes,
  formatLibraryDate,
  formatLibraryDuration,
  isWorkerConnectionError,
  mediaDetailsBackupLabel,
  mediaException,
  safeLibraryMessage,
  sourceStatusLabel,
  type LibrarySessionViewState,
} from './library-model';
import {
  clearLibraryOrigins,
  consumeLibraryOrigin,
  peekLibraryOrigin,
  readLibrarySession,
  rememberLibraryOrigin,
  writeLibrarySession,
} from './library-session';

import './library.css';

interface LibraryScreenProps {
  route: Extract<AppRoute, { area: 'library' }>;
  onNavigate(route: AppRoute): void;
  notice?: string | null;
  onNotice?(message: string | null): void;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function routeMatches(
  route: Extract<AppRoute, { area: 'library' }>,
  candidate: Extract<AppRoute, { area: 'library' }>,
): boolean {
  return route.view === candidate.view && route.entityId === candidate.entityId;
}

function currentOutlet(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.app-route-outlet');
}

function LibraryTabs({
  value,
  onChange,
}: {
  value: 'media' | 'playlists';
  onChange(value: 'media' | 'playlists'): void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const next =
      event.key === 'ArrowRight' || event.key === 'End'
        ? 'playlists'
        : ('media' as 'media' | 'playlists');
    event.preventDefault();
    onChange(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-library-tab="${next}"]`)
      ?.focus();
  };
  return (
    <div className="library-tabs" role="tablist" aria-label="Library views">
      {(['media', 'playlists'] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          data-library-tab={tab}
          aria-selected={value === tab}
          aria-controls={`library-panel-${tab}`}
          tabIndex={value === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={handleKeyDown}
        >
          {tab === 'media' ? 'Media' : 'Playlists'}
        </button>
      ))}
    </div>
  );
}

function LibraryNotice({ message, onDismiss }: { message: string; onDismiss(): void }) {
  return (
    <div className="library-notice" role="status">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss message">
        Close
      </button>
    </div>
  );
}

function MediaThumbnail({ source, title }: { source: string | null; title: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(
    source === null ? 'failed' : 'loading',
  );
  return (
    <span className="library-thumbnail" data-state={state}>
      {source !== null && state !== 'failed' ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      ) : null}
      {state === 'loading' ? (
        <span className="library-thumbnail__skeleton" aria-hidden="true" />
      ) : null}
      {state === 'failed' ? (
        <span
          className="library-thumbnail__fallback"
          role="img"
          aria-label={`No thumbnail for ${title}`}
        >
          <ImageSquare size={28} weight="regular" aria-hidden="true" />
        </span>
      ) : null}
    </span>
  );
}

function ExceptionLabel({ item }: { item: MediaLibraryItemDto }) {
  const exception = mediaException(item);
  return exception === null ? null : (
    <span className="library-exception" data-tone={exception.tone}>
      {exception.label}
    </span>
  );
}

function MediaGrid({
  items,
  onOpen,
}: {
  items: MediaLibraryItemDto[];
  onOpen(item: MediaLibraryItemDto): void;
}) {
  return (
    <div className="library-media-grid" role="list" aria-label="Media results">
      {items.map((item) => (
        <div key={item.id} role="listitem" className="library-media-grid__item">
          <button
            id={`library-media-${item.id}`}
            type="button"
            className="library-media-card"
            onClick={() => onOpen(item)}
            aria-label={`Open details for ${item.title}`}
          >
            <MediaThumbnail key={item.thumbnailUrl} source={item.thumbnailUrl} title={item.title} />
            <span className="library-media-card__body">
              <span className="library-media-card__title">{item.title}</span>
              <span className="library-media-card__meta">
                <span>{item.channelTitle}</span>
                <span aria-hidden="true">·</span>
                <span>{formatLibraryDate(item.publishedAt)}</span>
              </span>
              <ExceptionLabel item={item} />
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

function MediaList({
  items,
  onOpen,
}: {
  items: MediaLibraryItemDto[];
  onOpen(item: MediaLibraryItemDto): void;
}) {
  return (
    <div className="media-list" role="list" aria-label="Media results">
      <div className="media-list__header" aria-hidden="true">
        <span>Media</span>
        <span>Channel</span>
        <span>Published</span>
        <span>Duration</span>
        <span>Backup</span>
      </div>
      {items.map((item) => (
        <div key={item.id} role="listitem" className="media-list__item">
          <button
            id={`library-media-${item.id}`}
            type="button"
            className="media-list__row"
            onClick={() => onOpen(item)}
            aria-label={`Open details for ${item.title}`}
          >
            <span className="media-list__identity">
              <MediaThumbnail
                key={item.thumbnailUrl}
                source={item.thumbnailUrl}
                title={item.title}
              />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.mediaType === 'LIVE'
                    ? 'Live stream'
                    : item.mediaType === 'SHORT'
                      ? 'Short'
                      : 'Video'}
                </small>
              </span>
            </span>
            <span className="media-list__channel">{item.channelTitle}</span>
            <span className="media-list__published">{formatLibraryDate(item.publishedAt)}</span>
            <span className="media-list__duration">
              {formatLibraryDuration(item.durationSeconds)}
            </span>
            <span className="media-list__backup">
              <ExceptionLabel item={item} />
              {mediaException(item) === null ? copySummaryLabel(item) : null}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

function Pager({
  page,
  pageSize,
  total,
  onPage,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage(page: number): void;
  label: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="library-pager" aria-label={label}>
      <Button
        size="compact"
        variant="ghost"
        leadingIcon={<CaretLeft size={16} />}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <span>
        Page {page} of {pages}
      </span>
      <Button
        size="compact"
        variant="ghost"
        trailingIcon={<CaretRight size={16} />}
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

function ResultSkeleton({ label, cards = 8 }: { label: string; cards?: number }) {
  return (
    <div className="library-skeleton-grid" aria-label={label} role="status">
      <span className="ui-visually-hidden">{label}</span>
      {Array.from({ length: cards }, (_, index) => (
        <Skeleton key={index} announce={false} lines={2} />
      ))}
    </div>
  );
}

function QueryError({ message, onRetry }: { message: string; onRetry(): void }) {
  const disconnected = isWorkerConnectionError(message);
  return (
    <ErrorState
      title={disconnected ? 'Backup worker unavailable' : 'Library could not be loaded'}
      description={
        disconnected
          ? 'The local catalog is temporarily disconnected. Restart the app if retrying does not reconnect it.'
          : message
      }
      retry={{ label: 'Retry', onClick: onRetry }}
    />
  );
}

function MediaBrowser({
  channels,
  data,
  pending,
  error,
  viewState,
  updateViewState,
  onOpen,
  onRetry,
}: {
  channels: ChannelDto[];
  data: ReturnType<typeof useLibraryFeatureController>['media'];
  pending: boolean;
  error: string | null;
  viewState: LibrarySessionViewState;
  updateViewState(patch: Partial<LibrarySessionViewState>): void;
  onOpen(item: MediaLibraryItemDto): void;
  onRetry(): void;
}) {
  const filtered =
    viewState.mediaSearch !== '' ||
    viewState.mediaChannelId !== null ||
    viewState.mediaType !== null ||
    viewState.mediaSourceStatus !== null;
  const reset = () =>
    updateViewState({
      mediaSearch: '',
      mediaChannelId: null,
      mediaType: null,
      mediaSourceStatus: null,
      mediaPage: 1,
    });
  return (
    <section id="library-panel-media" role="tabpanel" aria-label="Media">
      <Toolbar
        className="library-toolbar"
        ariaLabel="Media search and filters"
        primary={
          <SearchInput
            label="Search media"
            placeholder="Search media"
            value={viewState.mediaSearch}
            pending={pending}
            onValueChange={(mediaSearch) => updateViewState({ mediaSearch, mediaPage: 1 })}
          />
        }
        filters={
          <>
            <Select
              className="library-filter"
              label="Channel"
              value={viewState.mediaChannelId ?? 'all'}
              onValueChange={(value) =>
                updateViewState({ mediaChannelId: value === 'all' ? null : value, mediaPage: 1 })
              }
              options={[
                { value: 'all', label: 'All channels' },
                ...channels.map((channel) => ({ value: channel.id, label: channel.title })),
              ]}
            />
            <Select
              className="library-filter library-filter--compact"
              label="Type"
              value={viewState.mediaType ?? 'all'}
              onValueChange={(value) =>
                updateViewState({
                  mediaType:
                    value === 'all' ? null : (value as LibrarySessionViewState['mediaType']),
                  mediaPage: 1,
                })
              }
              options={[
                { value: 'all', label: 'All types' },
                { value: 'VIDEO', label: 'Videos' },
                { value: 'SHORT', label: 'Shorts' },
                { value: 'LIVE', label: 'Live streams' },
              ]}
            />
            <Select
              className="library-filter"
              label="Source"
              value={viewState.mediaSourceStatus ?? 'all'}
              onValueChange={(value) =>
                updateViewState({
                  mediaSourceStatus:
                    value === 'all'
                      ? null
                      : (value as LibrarySessionViewState['mediaSourceStatus']),
                  mediaPage: 1,
                })
              }
              options={[
                { value: 'all', label: 'All source states' },
                { value: 'AVAILABLE', label: 'Available' },
                { value: 'UNLISTED', label: 'Unlisted' },
                { value: 'PRIVATE', label: 'Private' },
                { value: 'REMOVED', label: 'Removed' },
                { value: 'UNAVAILABLE', label: 'Unavailable' },
                { value: 'UNKNOWN', label: 'Unknown' },
              ]}
            />
          </>
        }
        actions={
          <SegmentedControl
            ariaLabel="Media layout"
            value={viewState.mediaPresentation}
            onValueChange={(value) =>
              updateViewState({ mediaPresentation: value === 'list' ? 'list' : 'grid' })
            }
            options={[
              { value: 'grid', label: 'Grid', icon: SquaresFour },
              { value: 'list', label: 'List', icon: ListBullets },
            ]}
          />
        }
      />
      {data !== null ? (
        <div className="library-result-summary" aria-live="polite">
          <span>{data.total} media items</span>
          {pending ? <span>Updating results</span> : null}
        </div>
      ) : null}
      {data === null && pending ? <ResultSkeleton label="Loading media" /> : null}
      {data === null && error !== null ? <QueryError message={error} onRetry={onRetry} /> : null}
      {data !== null && data.items.length === 0 ? (
        <EmptyState
          title={filtered ? 'No media matches these filters' : 'Your media catalog is empty'}
          description={
            filtered
              ? 'Change or reset the search and filters to see more of the local catalog.'
              : 'Connect a YouTube account and sync a selected channel to build the local catalog.'
          }
          action={filtered ? <Button onClick={reset}>Reset filters</Button> : null}
        />
      ) : null}
      {data !== null && data.items.length > 0 ? (
        <div
          className="library-results"
          data-pending={pending ? '' : undefined}
          aria-busy={pending}
        >
          {viewState.mediaPresentation === 'grid' ? (
            <MediaGrid items={data.items} onOpen={onOpen} />
          ) : (
            <MediaList items={data.items} onOpen={onOpen} />
          )}
          <Pager
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            label="Media pages"
            onPage={(mediaPage) => updateViewState({ mediaPage })}
          />
        </div>
      ) : null}
    </section>
  );
}

function PlaylistMaster({
  channels,
  data,
  pending,
  error,
  selectedId,
  viewState,
  updateViewState,
  onSelect,
  onRetry,
}: {
  channels: ChannelDto[];
  data: PlaylistQueryResult | null;
  pending: boolean;
  error: string | null;
  selectedId: string | undefined;
  viewState: LibrarySessionViewState;
  updateViewState(patch: Partial<LibrarySessionViewState>): void;
  onSelect(playlist: PlaylistDto): void;
  onRetry(): void;
}) {
  const filtered = viewState.playlistSearch !== '' || viewState.playlistChannelId !== null;
  return (
    <section className="playlist-master" aria-label="Playlists">
      <div className="playlist-master__toolbar">
        <SearchInput
          label="Search playlists"
          placeholder="Search playlists"
          value={viewState.playlistSearch}
          pending={pending}
          onValueChange={(playlistSearch) => updateViewState({ playlistSearch, playlistPage: 1 })}
        />
        <Select
          label="Channel"
          value={viewState.playlistChannelId ?? 'all'}
          onValueChange={(value) =>
            updateViewState({
              playlistChannelId: value === 'all' ? null : value,
              playlistPage: 1,
            })
          }
          options={[
            { value: 'all', label: 'All channels' },
            ...channels.map((channel) => ({ value: channel.id, label: channel.title })),
          ]}
        />
      </div>
      {data === null && pending ? <ResultSkeleton label="Loading playlists" cards={6} /> : null}
      {data === null && error !== null ? <QueryError message={error} onRetry={onRetry} /> : null}
      {data !== null && data.items.length === 0 ? (
        <EmptyState
          title={filtered ? 'No playlists match' : 'No playlists in the catalog'}
          description={
            filtered
              ? 'Change the search or channel filter to see more playlists.'
              : 'Synced YouTube playlists will appear here.'
          }
          action={
            filtered ? (
              <Button
                onClick={() =>
                  updateViewState({ playlistSearch: '', playlistChannelId: null, playlistPage: 1 })
                }
              >
                Reset filters
              </Button>
            ) : null
          }
        />
      ) : null}
      {data !== null && data.items.length > 0 ? (
        <>
          <div className="library-playlist-list" role="list" aria-busy={pending}>
            {data.items.map((playlist) => (
              <div key={playlist.id} role="listitem">
                <button
                  id={`library-playlist-${playlist.id}`}
                  type="button"
                  className="library-playlist-row"
                  aria-current={selectedId === playlist.id ? 'true' : undefined}
                  onClick={() => onSelect(playlist)}
                >
                  <span>
                    <strong>{playlist.title}</strong>
                    <small>{playlist.channelTitle}</small>
                  </span>
                  <span className="library-playlist-row__count">{playlist.mediaCount}</span>
                  {playlist.sourceStatus !== 'AVAILABLE' ? (
                    <span className="library-exception" data-tone="warning">
                      {sourceStatusLabel(playlist.sourceStatus)}
                    </span>
                  ) : null}
                </button>
              </div>
            ))}
          </div>
          <Pager
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            label="Playlist pages"
            onPage={(playlistPage) => updateViewState({ playlistPage })}
          />
        </>
      ) : null}
    </section>
  );
}

function PlaylistDetail({
  playlist,
  members,
  pending,
  error,
  memberPage,
  onMemberPage,
  onOpenMedia,
  onBack,
  onRetry,
}: {
  playlist: PlaylistDto | null;
  members: PlaylistMembersResult | null;
  pending: boolean;
  error: string | null;
  memberPage: number;
  onMemberPage(page: number): void;
  onOpenMedia(item: MediaLibraryItemDto): void;
  onBack(): void;
  onRetry(): void;
}) {
  if (playlist === null) {
    return (
      <section
        className="library-playlist-detail library-playlist-detail--placeholder"
        aria-label="Playlist details"
      >
        <EmptyState
          title="Select a playlist"
          description="Choose a playlist to browse its ordered media without leaving Library."
        />
      </section>
    );
  }
  return (
    <section className="library-playlist-detail" aria-label={`${playlist.title} playlist details`}>
      <Button
        className="playlist-detail__back"
        variant="ghost"
        size="compact"
        leadingIcon={<ArrowLeft size={16} />}
        onClick={onBack}
      >
        Back to playlists
      </Button>
      <header className="playlist-detail__header">
        <div>
          <p>{playlist.channelTitle}</p>
          <h2 tabIndex={-1}>{playlist.title}</h2>
        </div>
        <span>{playlist.mediaCount} items</span>
      </header>
      {playlist.sourceStatus !== 'AVAILABLE' ? (
        <Status
          appearance="callout"
          kind="warning"
          label={sourceStatusLabel(playlist.sourceStatus)}
          description="Archived membership remains available in the local catalog."
        />
      ) : null}
      {members === null && pending ? (
        <ResultSkeleton label="Loading playlist media" cards={6} />
      ) : null}
      {members === null && error !== null ? <QueryError message={error} onRetry={onRetry} /> : null}
      {members !== null && members.items.length === 0 ? (
        <EmptyState
          title="This playlist is empty"
          description="No synced media belongs to this playlist."
        />
      ) : null}
      {members !== null && members.items.length > 0 ? (
        <>
          <ol className="playlist-members" start={(memberPage - 1) * members.pageSize + 1}>
            {members.items.map(({ media, position }, index) => (
              <li key={media.id}>
                <button type="button" onClick={() => onOpenMedia(media)}>
                  <span className="playlist-member__position">
                    {position === null
                      ? (memberPage - 1) * members.pageSize + index + 1
                      : position + 1}
                  </span>
                  <MediaThumbnail
                    key={media.thumbnailUrl}
                    source={media.thumbnailUrl}
                    title={media.title}
                  />
                  <span className="playlist-member__copy">
                    <strong>{media.title}</strong>
                    <small>
                      {formatLibraryDuration(media.durationSeconds)} · {copySummaryLabel(media)}
                    </small>
                  </span>
                  <ExceptionLabel item={media} />
                </button>
              </li>
            ))}
          </ol>
          <Pager
            page={members.page}
            pageSize={members.pageSize}
            total={members.total}
            label="Playlist media pages"
            onPage={onMemberPage}
          />
        </>
      ) : null}
    </section>
  );
}

function PlaylistsBrowser({
  channels,
  data,
  dataPending,
  dataError,
  members,
  membersPending,
  membersError,
  selectedId,
  viewState,
  updateViewState,
  onSelect,
  onBack,
  onOpenMedia,
  onRetry,
  onRetryMembers,
}: {
  channels: ChannelDto[];
  data: PlaylistQueryResult | null;
  dataPending: boolean;
  dataError: string | null;
  members: PlaylistMembersResult | null;
  membersPending: boolean;
  membersError: string | null;
  selectedId: string | undefined;
  viewState: LibrarySessionViewState;
  updateViewState(patch: Partial<LibrarySessionViewState>): void;
  onSelect(playlist: PlaylistDto): void;
  onBack(): void;
  onOpenMedia(item: MediaLibraryItemDto): void;
  onRetry(): void;
  onRetryMembers(): void;
}) {
  const selected = data?.items.find((playlist) => playlist.id === selectedId) ?? null;
  return (
    <section
      id="library-panel-playlists"
      role="tabpanel"
      aria-label="Playlists"
      className="playlist-browser"
      data-has-selection={selectedId !== undefined ? '' : undefined}
    >
      <PlaylistMaster
        channels={channels}
        data={data}
        pending={dataPending}
        error={dataError}
        selectedId={selectedId}
        viewState={viewState}
        updateViewState={updateViewState}
        onSelect={onSelect}
        onRetry={onRetry}
      />
      <PlaylistDetail
        playlist={selected}
        members={members}
        pending={membersPending}
        error={membersError}
        memberPage={viewState.playlistMemberPage}
        onMemberPage={(playlistMemberPage) => updateViewState({ playlistMemberPage })}
        onOpenMedia={onOpenMedia}
        onBack={onBack}
        onRetry={onRetryMembers}
      />
    </section>
  );
}

function detailStatusKind(
  status: string,
): 'verified' | 'pending' | 'failed' | 'corrupt' | 'unavailable' | 'warning' {
  if (
    status === 'AVAILABLE' ||
    status === 'VERIFIED' ||
    status.startsWith('Available') ||
    status.includes('verified')
  )
    return 'verified';
  if (status === 'CORRUPT' || status === 'Needs attention') return 'corrupt';
  if (status === 'FAILED') return 'failed';
  if (status === 'MISSING' || status === 'UNAVAILABLE' || status === 'Unavailable')
    return 'unavailable';
  if (
    status === 'PENDING' ||
    status === 'TRANSFERRING' ||
    status === 'VERIFYING' ||
    status === 'In progress'
  )
    return 'pending';
  return 'warning';
}

function Definition({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function CopyActions({
  copy,
  issue,
  pendingAction,
  onOpen,
  onVerify,
  onRepair,
}: {
  copy: MediaCopyDto;
  issue: IntegrityIssueDto | undefined;
  pendingAction: string | null;
  onOpen(copy: MediaCopyDto): void;
  onVerify(copy: MediaCopyDto): void;
  onRepair(copy: MediaCopyDto): void;
}) {
  const openable =
    copy.status === 'VERIFIED' &&
    copy.availabilityStatus === 'AVAILABLE' &&
    (copy.destinationType === 'FILESYSTEM'
      ? copy.relativePath !== null
      : copy.providerFileIdAvailable);
  const repairable =
    issue !== undefined &&
    issue.repairSources.length > 0 &&
    ['MISSING', 'CORRUPT', 'FAILED'].includes(copy.status);
  return (
    <div className="media-copy__actions">
      {openable ? (
        <Button
          size="compact"
          variant="secondary"
          leadingIcon={
            copy.destinationType === 'FILESYSTEM' ? (
              <FolderOpen size={16} />
            ) : (
              <CloudArrowUp size={16} />
            )
          }
          loading={pendingAction === `open:${copy.id}`}
          onClick={() => onOpen(copy)}
        >
          {copy.destinationType === 'FILESYSTEM' ? 'Open folder' : 'Open in Drive'}
        </Button>
      ) : null}
      <Button
        size="compact"
        variant="ghost"
        loading={pendingAction === `verify:${copy.id}`}
        onClick={() => onVerify(copy)}
      >
        Verify copy
      </Button>
      {repairable ? (
        <Button
          size="compact"
          variant="secondary"
          leadingIcon={<Wrench size={16} />}
          loading={pendingAction === `repair:${copy.id}`}
          onClick={() => onRepair(copy)}
        >
          Repair from archive
        </Button>
      ) : null}
    </div>
  );
}

function MediaDetails({
  snapshot,
  pending,
  error,
  onBack,
  onNavigate,
  onRetry,
  onNotice,
}: {
  snapshot: MediaDetailsSnapshot | null;
  pending: boolean;
  error: string | null;
  onBack(): void;
  onNavigate(route: AppRoute): void;
  onRetry(): void;
  onNotice(message: string): void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const perform = async (key: string, action: () => Promise<void>) => {
    setPendingAction(key);
    setActionError(null);
    try {
      await action();
    } catch (caught) {
      setActionError(safeLibraryMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  if (pending && snapshot === null) {
    return (
      <section className="media-details media-details--loading">
        <Skeleton label="Loading media details" lines={5} />
      </section>
    );
  }
  if (error !== null && snapshot === null) {
    return (
      <section className="media-details media-details--error">
        <Button variant="ghost" leadingIcon={<ArrowLeft size={17} />} onClick={onBack}>
          Back to Library
        </Button>
        <QueryError message={error} onRetry={onRetry} />
      </section>
    );
  }
  if (snapshot === null) return null;
  const { details, issues } = snapshot;
  const openCopy = (copy: MediaCopyDto) =>
    perform(`open:${copy.id}`, async () => {
      const result =
        copy.destinationType === 'FILESYSTEM'
          ? await window.ytbm.openVerifiedCopyFolder(copy.id)
          : await window.ytbm.openGoogleDriveObject({ mediaCopyId: copy.id });
      if (result.status !== 'OPENED') {
        throw new Error(result.safeMessage);
      }
    });
  const verifyCopy = (copy: MediaCopyDto) =>
    perform(`verify:${copy.id}`, async () => {
      await window.ytbm.startIntegrity({
        scope: { kind: 'COPY', id: copy.id },
        driveMode: 'PROVIDER_METADATA_SIZE',
      });
      onNotice('Copy verification started. Progress is available in Activity.');
    });
  const repairCopy = (copy: MediaCopyDto) =>
    perform(`repair:${copy.id}`, async () => {
      await window.ytbm.startRepair(copy.id, false);
      onNotice('Archive repair started. Progress is available in Activity.');
    });
  const verifyAll = () =>
    perform('verify:all', async () => {
      await window.ytbm.startIntegrity({
        scope: { kind: 'MEDIA', id: details.mediaItemId },
        driveMode: 'PROVIDER_METADATA_SIZE',
      });
      onNotice('Media verification started. Progress is available in Activity.');
    });

  return (
    <article className="media-details">
      <Button
        className="media-details__back"
        variant="ghost"
        size="compact"
        leadingIcon={<ArrowLeft size={17} />}
        onClick={onBack}
      >
        {peekLibraryOrigin()?.route.view === 'playlists' ? 'Back to playlist' : 'Back to Library'}
      </Button>
      <div className="media-details__hero">
        <MediaThumbnail
          key={details.thumbnailUrl}
          source={details.thumbnailUrl}
          title={details.title}
        />
        <div className="media-details__heading">
          <p>{details.channelTitle}</p>
          <h1 tabIndex={-1}>{details.title}</h1>
          <div className="media-details__meta">
            <span>
              {details.mediaType === 'LIVE'
                ? 'Live stream'
                : details.mediaType === 'SHORT'
                  ? 'Short'
                  : 'Video'}
            </span>
            <span>{formatLibraryDate(details.publishedAt)}</span>
            <span>{formatLibraryDuration(details.durationSeconds)}</span>
          </div>
        </div>
      </div>
      <section className="media-details__status" aria-label="Media status">
        <div>
          <span>Source</span>
          <Status
            appearance="chip"
            kind={detailStatusKind(details.sourceStatus)}
            label={sourceStatusLabel(details.sourceStatus)}
          />
        </div>
        <div>
          <span>Backup</span>
          <Status
            appearance="chip"
            kind={detailStatusKind(mediaDetailsBackupLabel(details))}
            label={mediaDetailsBackupLabel(details)}
          />
        </div>
      </section>
      {actionError !== null ? (
        <Status
          appearance="callout"
          kind="failed"
          label="Action could not be completed"
          description={actionError}
        />
      ) : null}
      <section className="media-details__section">
        <div className="media-details__section-heading">
          <div>
            <h2>Backup copies</h2>
            <p>Copy integrity and destination availability are reported separately.</p>
          </div>
          {details.copies.length > 1 ? (
            <Button loading={pendingAction === 'verify:all'} onClick={verifyAll}>
              Verify all copies
            </Button>
          ) : null}
        </div>
        {details.copies.length === 0 ? (
          <EmptyState
            title="No backup copies"
            description="This media item is indexed, but no destination copy is recorded yet."
          />
        ) : (
          <div className="media-copy-list">
            {details.copies.map((copy) => {
              const issue = issues.find((entry) => entry.copyId === copy.id);
              return (
                <article key={copy.id} className="media-copy">
                  <header>
                    <div>
                      <h3>{copy.destinationPath}</h3>
                      <p>
                        {copy.destinationType === 'FILESYSTEM'
                          ? 'Local filesystem'
                          : 'Google Drive'}
                      </p>
                    </div>
                    <div className="media-copy__statuses">
                      <Status
                        appearance="chip"
                        kind={detailStatusKind(copy.status)}
                        label={copyStatusLabel(copy.status)}
                      />
                      <Status
                        appearance="chip"
                        kind={detailStatusKind(availabilityLabel(copy.availabilityStatus))}
                        label={availabilityLabel(copy.availabilityStatus)}
                      />
                    </div>
                  </header>
                  {issue !== undefined ? (
                    <p className="media-copy__issue">{issue.safeMessage}</p>
                  ) : null}
                  <dl className="media-copy__facts">
                    <Definition label="Quality">
                      {copy.qualityProfile?.replaceAll('_', ' ') ?? 'Unknown'}
                    </Definition>
                    <Definition label="Size">{formatLibraryBytes(copy.bytes)}</Definition>
                    <Definition label="Verified">{formatLibraryDate(copy.verifiedAt)}</Definition>
                  </dl>
                  <CopyActions
                    copy={copy}
                    issue={issue}
                    pendingAction={pendingAction}
                    onOpen={openCopy}
                    onVerify={verifyCopy}
                    onRepair={repairCopy}
                  />
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="media-details__section media-details__playlists">
        <h2>Playlists</h2>
        {details.playlists.length === 0 ? (
          <p>This media item is not in a synced playlist.</p>
        ) : (
          <div>
            {details.playlists.map((playlist) => (
              <Button
                key={playlist.id}
                variant="link"
                onClick={() => {
                  clearLibraryOrigins();
                  onNavigate({ area: 'library', view: 'playlists', entityId: playlist.id });
                }}
              >
                {playlist.title}
              </Button>
            ))}
          </div>
        )}
      </section>
      <details className="media-details__technical">
        <summary>Technical details</summary>
        <dl>
          <Definition label="Media ID">{details.providerMediaId}</Definition>
          <Definition label="Catalog ID">{details.mediaItemId}</Definition>
          <Definition label="Channel ID">{details.channelId}</Definition>
          {details.copies.map((copy) => (
            <Definition
              key={copy.id}
              label={`${copy.destinationType === 'FILESYSTEM' ? 'Local' : 'Drive'} copy`}
            >
              {[
                copy.container,
                copy.videoCodec,
                copy.audioCodec,
                copy.width && copy.height ? `${copy.width}×${copy.height}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Technical metadata unavailable'}
            </Definition>
          ))}
        </dl>
      </details>
    </article>
  );
}

export function LibraryScreen({ route, onNavigate, notice = null, onNotice }: LibraryScreenProps) {
  const [viewState, setViewState] = useState(readLibrarySession);
  const online = useOnlineStatus();
  const snapshot = useLibraryFeatureController(route, viewState);
  const previousRoute = useRef(route);

  const updateViewState = useCallback((patch: Partial<LibrarySessionViewState>) => {
    setViewState((current) => {
      const next = { ...current, ...patch };
      writeLibrarySession(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const origin = peekLibraryOrigin();
    if (origin === null || !routeMatches(route, origin.route)) return;
    consumeLibraryOrigin();
    const timer = window.setTimeout(() => {
      const outlet = currentOutlet();
      if (outlet !== null) outlet.scrollTop = origin.scrollTop;
      document.getElementById(origin.focusId)?.focus({ preventScroll: true });
    });
    return () => window.clearTimeout(timer);
  }, [route]);

  useEffect(() => {
    const prior = previousRoute.current;
    previousRoute.current = route;
    if (
      route.view === 'playlists' &&
      route.entityId !== undefined &&
      prior.entityId !== route.entityId &&
      prior.view === 'playlists' &&
      prior.entityId !== undefined
    ) {
      updateViewState({ playlistMemberPage: 1 });
    }
  }, [route, updateViewState]);

  useEffect(() => {
    if (
      route.view !== 'playlists' ||
      route.entityId === undefined ||
      snapshot.playlists === null ||
      snapshot.playlistsPending ||
      snapshot.playlistsError !== null
    ) {
      return;
    }
    if (!snapshot.playlists.items.some((playlist) => playlist.id === route.entityId)) {
      onNavigate({ area: 'library', view: 'playlists' });
      onNotice?.('The selected playlist is no longer in these results.');
    }
  }, [
    onNavigate,
    onNotice,
    route,
    snapshot.playlists,
    snapshot.playlistsError,
    snapshot.playlistsPending,
  ]);

  const remember = (originRoute: Extract<AppRoute, { area: 'library' }>, focusId: string) => {
    rememberLibraryOrigin({
      route: originRoute,
      focusId,
      scrollTop: currentOutlet()?.scrollTop ?? 0,
    });
  };
  const openMedia = (item: MediaLibraryItemDto) => {
    remember(route, `library-media-${item.id}`);
    onNavigate({ area: 'library', view: 'media', entityId: item.id });
  };
  const selectPlaylist = (playlist: PlaylistDto) => {
    if (route.entityId === undefined) remember(route, `library-playlist-${playlist.id}`);
    updateViewState({ playlistMemberPage: 1 });
    onNavigate({ area: 'library', view: 'playlists', entityId: playlist.id });
  };
  const back = (fallback: Extract<AppRoute, { area: 'library' }>) => {
    const origin = peekLibraryOrigin();
    if (origin !== null && origin.route.view === fallback.view) {
      onNavigate(origin.route);
      return;
    }
    clearLibraryOrigins();
    onNavigate(fallback);
  };

  if (route.view === 'media' && route.entityId !== undefined) {
    return (
      <MediaDetails
        snapshot={snapshot.mediaDetails}
        pending={snapshot.mediaDetailsPending}
        error={snapshot.mediaDetailsError}
        onBack={() => back({ area: 'library', view: 'media' })}
        onNavigate={onNavigate}
        onRetry={() => void snapshot.refreshMediaDetails()}
        onNotice={(message) => onNotice?.(message)}
      />
    );
  }

  const channels = snapshot.channels ?? [];
  return (
    <div className="library-screen" data-view={route.view}>
      <PageHeader
        title="Library"
        description="Browse the media and playlists saved in your local catalog."
      />
      {notice !== null && onNotice !== undefined ? (
        <LibraryNotice message={notice} onDismiss={() => onNotice(null)} />
      ) : null}
      {!online ? (
        <Status
          className="library-offline"
          appearance="callout"
          kind="unavailable"
          label="Offline"
          description="The local catalog remains available. YouTube and Drive actions may be unavailable."
        />
      ) : null}
      {snapshot.channelsError !== null ? (
        <Status
          appearance="callout"
          kind="warning"
          label="Channel filters unavailable"
          description={snapshot.channelsError}
        />
      ) : null}
      <LibraryTabs
        value={route.view}
        onChange={(view) => {
          clearLibraryOrigins();
          onNavigate({ area: 'library', view });
        }}
      />
      {route.view === 'media' ? (
        <MediaBrowser
          channels={channels}
          data={snapshot.media}
          pending={snapshot.mediaPending}
          error={snapshot.mediaError}
          viewState={viewState}
          updateViewState={updateViewState}
          onOpen={openMedia}
          onRetry={() => void snapshot.refreshMedia()}
        />
      ) : (
        <PlaylistsBrowser
          channels={channels}
          data={snapshot.playlists}
          dataPending={snapshot.playlistsPending}
          dataError={snapshot.playlistsError}
          members={snapshot.playlistMembers}
          membersPending={snapshot.playlistMembersPending}
          membersError={snapshot.playlistMembersError}
          selectedId={route.entityId}
          viewState={viewState}
          updateViewState={updateViewState}
          onSelect={selectPlaylist}
          onBack={() => back({ area: 'library', view: 'playlists' })}
          onOpenMedia={openMedia}
          onRetry={() => void snapshot.refreshPlaylists()}
          onRetryMembers={() => void snapshot.refreshPlaylistMembers()}
        />
      )}
    </div>
  );
}
