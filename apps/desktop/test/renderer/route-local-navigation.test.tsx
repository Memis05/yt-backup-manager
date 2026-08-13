import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RouteLocalNavigation } from '../../src/renderer/src/App';

describe('route-local tab navigation', () => {
  it('exposes Library views as a roving tablist and activates with arrow keys', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <RouteLocalNavigation route={{ area: 'library', view: 'media' }} onNavigate={onNavigate} />,
    );

    expect(screen.getByRole('tablist', { name: 'Library views' })).toBeInTheDocument();
    const media = screen.getByRole('tab', { name: 'Media' });
    const playlists = screen.getByRole('tab', { name: 'Playlists' });
    expect(media).toHaveAttribute('aria-selected', 'true');
    expect(media).toHaveAttribute('tabindex', '0');
    expect(playlists).toHaveAttribute('aria-selected', 'false');
    expect(playlists).toHaveAttribute('tabindex', '-1');
    expect(playlists).toHaveAttribute('aria-controls', 'legacy-route-tabpanel-library-playlists');

    media.focus();
    fireEvent.keyDown(media, { key: 'ArrowRight' });
    expect(onNavigate).toHaveBeenLastCalledWith({ area: 'library', view: 'playlists' });
    expect(playlists).toHaveFocus();

    rerender(
      <RouteLocalNavigation
        route={{ area: 'library', view: 'playlists' }}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Playlists' })).toHaveAttribute('aria-selected', 'true');
  });

  it('preserves every Activity route mapping and wraps keyboard navigation', () => {
    const onNavigate = vi.fn();
    render(
      <RouteLocalNavigation route={{ area: 'activity', view: 'active' }} onNavigate={onNavigate} />,
    );

    const active = screen.getByRole('tab', { name: 'Active' });
    const history = screen.getByRole('tab', { name: 'History' });
    const attention = screen.getByRole('tab', { name: 'Needs attention' });

    fireEvent.click(history);
    expect(onNavigate).toHaveBeenLastCalledWith({ area: 'activity', view: 'history' });

    fireEvent.keyDown(active, { key: 'ArrowLeft' });
    expect(onNavigate).toHaveBeenLastCalledWith({ area: 'activity', view: 'attention' });
    expect(attention).toHaveFocus();

    fireEvent.keyDown(attention, { key: 'Home' });
    expect(onNavigate).toHaveBeenLastCalledWith({ area: 'activity', view: 'active' });
    expect(active).toHaveFocus();
  });
});
