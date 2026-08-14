import { act, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppRoute } from '../../src/renderer/src/app/routes';
import { LibraryScreen } from '../../src/renderer/src/features/library/LibraryScreen';
import { resetLibrarySessionForTests } from '../../src/renderer/src/features/library/library-session';
import {
  installLibraryApi,
  integrityFixture,
  LIBRARY_IDS,
  libraryResult,
  mediaDetailsFixture,
  mediaFixture,
  playlistResult,
} from './library-test-fixtures';

async function advance(milliseconds = 250): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
    await Promise.resolve();
  });
}

function LibraryHarness({
  initialRoute = { area: 'library', view: 'media' },
}: {
  initialRoute?: Extract<AppRoute, { area: 'library' }>;
}) {
  const [route, setRoute] = useState<Extract<AppRoute, { area: 'library' }>>(initialRoute);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <LibraryScreen
      route={route}
      onNavigate={(next) => {
        if (next.area === 'library') setRoute(next);
      }}
      notice={notice}
      onNotice={setNotice}
    />
  );
}

describe('Library Stage 5 route bodies', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLibrarySessionForTests();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows a stable initial skeleton, then a quiet keyboard-openable media grid', async () => {
    let resolveLibrary!: (value: typeof libraryResult) => void;
    installLibraryApi({
      queryLibrary: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveLibrary = resolve;
          }),
      ),
    });
    render(<LibraryHarness />);

    await advance(200);
    expect(screen.getByLabelText('Loading media')).toBeVisible();

    await act(async () => resolveLibrary(libraryResult));
    await advance(0);
    const card = screen.getByRole('button', {
      name: 'Open details for A durable local archive',
    });
    expect(card).toBeVisible();
    expect(card).not.toHaveTextContent('VIDEO');
    expect(card).not.toHaveTextContent('AVAILABLE');
    expect(card).not.toHaveTextContent('VERIFIED');
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.click(card);
    await advance(0);
    expect(screen.getByRole('heading', { name: 'A durable local archive' })).toBeVisible();
  });

  it('sends only supported server-side filters and changes between grid and list', async () => {
    const api = installLibraryApi();
    render(<LibraryHarness />);
    await advance();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search media' }), {
      target: { value: 'durable' },
    });
    await advance(199);
    expect(api.queryLibrary).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(api.queryLibrary).toHaveBeenLastCalledWith({
      search: 'durable',
      channelId: null,
      mediaType: null,
      sourceStatus: null,
      page: 1,
      pageSize: 36,
    });

    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(document.querySelector('.media-list')).toBeInTheDocument();
    expect(document.querySelector('.library-media-grid')).not.toBeInTheDocument();
    expect(screen.queryByText(/backup destination/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/quality filter/i)).not.toBeInTheDocument();
  });

  it('suppresses a stale search response after a newer debounced result wins', async () => {
    let resolveFirst!: (value: typeof libraryResult) => void;
    const api = installLibraryApi({
      queryLibrary: vi.fn(async (query) => {
        if (query.search === 'first') {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        if (query.search === 'second') {
          return {
            ...libraryResult,
            items: [mediaFixture({ title: 'Second result' })],
          };
        }
        return libraryResult;
      }),
    });
    render(<LibraryHarness />);
    await advance();
    const search = screen.getByRole('searchbox', { name: 'Search media' });

    fireEvent.change(search, { target: { value: 'first' } });
    await advance(200);
    fireEvent.change(search, { target: { value: 'second' } });
    await advance(200);
    expect(screen.getByText('Second result')).toBeVisible();

    await act(async () =>
      resolveFirst({ ...libraryResult, items: [mediaFixture({ title: 'Stale result' })] }),
    );
    expect(screen.getByText('Second result')).toBeVisible();
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
    expect(api.queryLibrary).toHaveBeenCalledTimes(3);
  });

  it('uses route selection for playlist master-detail and pages beyond 50 members', async () => {
    const api = installLibraryApi();
    render(<LibraryHarness initialRoute={{ area: 'library', view: 'playlists' }} />);
    await advance();

    fireEvent.click(screen.getByRole('button', { name: /Research/ }));
    await advance(0);
    expect(screen.getByRole('heading', { name: 'Research' })).toBeVisible();
    expect(api.queryPlaylistMembers).toHaveBeenLastCalledWith({
      playlistId: LIBRARY_IDS.playlist,
      page: 1,
      pageSize: 50,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await advance(0);
    expect(api.queryPlaylistMembers).toHaveBeenLastCalledWith({
      playlistId: LIBRARY_IDS.playlist,
      page: 2,
      pageSize: 50,
    });
  });

  it('invalidates a playlist selection that no longer belongs to filtered results', async () => {
    const onNavigate = vi.fn<(route: AppRoute) => void>();
    installLibraryApi({
      queryPlaylists: vi.fn(async () => ({ ...playlistResult, items: [], total: 0 })),
    });
    render(
      <LibraryScreen
        route={{ area: 'library', view: 'playlists', entityId: LIBRARY_IDS.playlist }}
        onNavigate={onNavigate}
        onNotice={vi.fn()}
      />,
    );
    await advance();
    expect(onNavigate).toHaveBeenCalledWith({ area: 'library', view: 'playlists' });
  });

  it('loads Media Details by ID and exposes only safe, proof-backed actions', async () => {
    const api = installLibraryApi();
    render(
      <LibraryHarness
        initialRoute={{ area: 'library', view: 'media', entityId: LIBRARY_IDS.media }}
      />,
    );
    await advance(0);

    expect(api.getMediaBackupDetails).toHaveBeenCalledWith(LIBRARY_IDS.media);
    expect(screen.getByRole('heading', { name: 'A durable local archive' })).toBeVisible();
    expect(screen.getByText('Removed from YouTube')).toBeVisible();
    expect(screen.getByText('Corrupt')).toBeVisible();
    expect(screen.getByText('Available')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Repair from archive' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Open YouTube/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Play media/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open folder/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Verify copy' }));
    await advance(0);
    expect(api.startIntegrity).toHaveBeenCalledWith({
      scope: { kind: 'COPY', id: LIBRARY_IDS.copy },
      driveMode: 'PROVIDER_METADATA_SIZE',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Repair from archive' }));
    await advance(0);
    expect(api.startRepair).toHaveBeenCalledWith(LIBRARY_IDS.copy, false);

    fireEvent.click(screen.getByText('Technical details'));
    expect(screen.getByText('video-library')).toBeVisible();
    expect(screen.getByText(LIBRARY_IDS.media)).toBeVisible();
  });

  it('opens only a verified available local copy and hides repair without integrity proof', async () => {
    const verifiedDetails = mediaDetailsFixture({
      sourceStatus: 'AVAILABLE',
      copies: [
        {
          ...mediaDetailsFixture().copies[0]!,
          status: 'VERIFIED',
        },
      ],
    });
    const api = installLibraryApi({
      getMediaBackupDetails: vi.fn(async () => verifiedDetails),
      getIntegrityOverview: vi.fn(async () => integrityFixture(false)),
    });
    render(
      <LibraryHarness
        initialRoute={{ area: 'library', view: 'media', entityId: LIBRARY_IDS.media }}
      />,
    );
    await advance(0);

    expect(screen.queryByRole('button', { name: 'Repair from archive' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await advance(0);
    expect(api.openVerifiedCopyFolder).toHaveBeenCalledWith(LIBRARY_IDS.copy);
  });

  it('restores the originating media row after leaving a details route', async () => {
    installLibraryApi();
    render(<LibraryHarness />);
    await advance();
    const card = screen.getByRole('button', { name: 'Open details for A durable local archive' });
    fireEvent.click(card);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Library' }));
    await advance();
    expect(
      screen.getByRole('button', { name: 'Open details for A durable local archive' }),
    ).toHaveFocus();
  });

  it('has no serious automated accessibility violations in the representative media view', async () => {
    installLibraryApi();
    const { container } = render(<LibraryHarness />);
    await advance();
    vi.useRealTimers();
    const result = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
