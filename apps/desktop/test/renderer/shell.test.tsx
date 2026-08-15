import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '../../src/renderer/src/shell/AppShell';
import { AppTitleBar } from '../../src/renderer/src/shell/AppTitleBar';
import { Sidebar } from '../../src/renderer/src/shell/Sidebar';
import { RouteLocalNavigation } from '../../src/renderer/src/App';
import type { AppRoute } from '../../src/renderer/src/app/routes';

const PRIMARY_DESTINATIONS = [
  'Home',
  'Library',
  'Channels',
  'Activity',
  'Storage',
  'Integrity',
  'Settings',
] as const;

describe('application titlebar', () => {
  it('renders the local identity, drag canvas, and only no-drag interactive status', () => {
    render(<AppTitleBar status={{ label: 'Backup paused', onActivate: vi.fn() }} />);

    const titlebar = screen.getByTestId('app-titlebar');
    expect(within(titlebar).getByLabelText('YouTube Backup Manager')).toBeVisible();
    expect(titlebar.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/png;base64,/),
    );
    expect(within(titlebar).getByRole('button', { name: 'Backup paused' })).toHaveClass(
      'app-no-drag',
    );
    expect(titlebar.querySelector('.app-titlebar__drag-space')).toBeInTheDocument();
    expect(
      within(titlebar).queryByRole('button', {
        name: /^(back|forward|refresh|minimize|maximize|close)$/i,
      }),
    ).not.toBeInTheDocument();
  });
});

describe('primary sidebar', () => {
  it('exposes exactly the target IA in stable keyboard order', async () => {
    const user = userEvent.setup();
    render(
      <TooltipPrimitive.Provider>
        <Sidebar route={{ area: 'home' }} onNavigate={vi.fn()} />
      </TooltipPrimitive.Provider>,
    );
    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });

    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(PRIMARY_DESTINATIONS);
    expect(within(navigation).getByRole('group', { name: 'Archive' })).toBeVisible();
    expect(within(navigation).getByRole('group', { name: 'Operations' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    for (const label of PRIMARY_DESTINATIONS) {
      await user.tab();
      expect(screen.getByRole('button', { name: label })).toHaveFocus();
    }
  });

  it('routes one active destination and keeps Settings at the bottom', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn<(route: AppRoute) => void>();
    render(
      <TooltipPrimitive.Provider>
        <Sidebar route={{ area: 'activity', view: 'attention' }} onNavigate={onNavigate} />
      </TooltipPrimitive.Provider>,
    );

    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ area: 'settings', category: 'general' });

    const navigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(navigation).getAllByRole('button').at(-1)).toHaveAccessibleName('Settings');
  });

  it('defines full, compact, and explicit temporary expansion states in shell CSS', async () => {
    const css = await readFile(
      resolve(process.cwd(), 'apps/desktop/src/renderer/src/shell/shell.css'),
      'utf8',
    );

    expect(css).toContain('grid-template-columns: var(--sidebar-width)');
    expect(css).toContain('@media (max-width: 1039px)');
    expect(css).toContain('grid-template-columns: var(--sidebar-rail-width)');
    expect(css).toContain(".app-sidebar[data-user-expanded='true']");
    expect(css).toContain(".app-sidebar:not([data-user-expanded='true']) .app-nav-item__label");
    expect(css).not.toContain('transition: width');
  });

  it('shows accessible help for the compact navigation expansion control', async () => {
    const user = userEvent.setup();
    render(
      <TooltipPrimitive.Provider delayDuration={0}>
        <Sidebar route={{ area: 'home' }} onNavigate={vi.fn()} />
      </TooltipPrimitive.Provider>,
    );

    const expand = screen.getByRole('button', { name: 'Expand navigation' });
    expand.focus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Expand navigation');

    await user.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('application shell route outlet', () => {
  it('resets scroll and moves focus to the route heading after navigation', async () => {
    const { rerender } = render(
      <AppShell route={{ area: 'home' }} onNavigate={vi.fn()}>
        <h1>Home content</h1>
      </AppShell>,
    );
    const outlet = document.querySelector<HTMLElement>('.app-route-outlet');
    expect(outlet).not.toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Home content' })).toHaveFocus(),
    );

    outlet!.scrollTop = 480;
    screen.getByRole('button', { name: 'Home' }).focus();
    rerender(
      <AppShell route={{ area: 'library', view: 'media' }} onNavigate={vi.fn()}>
        <h1>Library content</h1>
      </AppShell>,
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Library content' })).toHaveFocus(),
    );
    expect(outlet).toHaveProperty('scrollTop', 0);
    expect(screen.queryByRole('heading', { name: 'Home content' })).not.toBeInTheDocument();
  });

  it('does not steal focus from a route-local tab after keyboard activation', async () => {
    const user = userEvent.setup();

    function LibraryHarness() {
      const [route, setRoute] = useState<AppRoute>({ area: 'library', view: 'media' });
      return (
        <AppShell route={route} onNavigate={setRoute}>
          <h1>Library</h1>
          <RouteLocalNavigation route={route} onNavigate={setRoute} />
          <section role="tabpanel">{route.view}</section>
        </AppShell>
      );
    }

    render(<LibraryHarness />);
    const media = screen.getByRole('tab', { name: 'Media' });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Library' })).toHaveFocus());
    media.focus();
    await user.keyboard('{ArrowRight}');

    const playlists = screen.getByRole('tab', { name: 'Playlists' });
    await waitFor(() => expect(playlists).toHaveFocus());
    expect(playlists).toHaveAttribute('aria-selected', 'true');
  });
});
