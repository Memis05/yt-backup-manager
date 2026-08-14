import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/renderer/src/App';
import type { AppRoute } from '../../src/renderer/src/app/routes';
import { HomeScreen } from '../../src/renderer/src/features/home/HomeScreen';
import {
  channelFixture,
  channelSettingsFixture,
  completedRunFixture,
  connectedAccountFixture,
  dashboardFixture,
  destinationFixture,
  emptyHomeSnapshot,
  emptyIntegrityFixture,
  FIXTURE_IDS,
  healthyHomeSnapshot,
  installHomeApi,
  jobFixture,
  queueFixture,
  scheduleFixture,
} from './home-test-fixtures';

function renderHome() {
  const onNavigate = vi.fn<(route: AppRoute) => void>();
  const onOpenRecovery = vi.fn<() => void>();
  const result = render(<HomeScreen onNavigate={onNavigate} onOpenRecovery={onOpenRecovery} />);
  return { ...result, onNavigate, onOpenRecovery };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Home screen state composition', () => {
  it('shows a stable skeleton while the first worker snapshot is pending', () => {
    const snapshot = emptyHomeSnapshot();
    installHomeApi(snapshot, {
      getFoundationStatus: vi.fn(() => new Promise(() => undefined)),
    });

    renderHome();

    expect(screen.getByRole('heading', { name: 'Home' })).toBeVisible();
    expect(screen.getByLabelText('Loading Home')).toBeVisible();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByText('Create or recover your backup archive')).not.toBeInTheDocument();
  });

  it('offers explicit new-archive and recovery choices for a truly empty profile', async () => {
    const user = userEvent.setup();
    installHomeApi(emptyHomeSnapshot());
    const { onNavigate, onOpenRecovery } = renderHome();

    expect(await screen.findByText('Create or recover your backup archive')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Set up a new backup' }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      area: 'settings',
      category: 'accounts',
    });

    await user.click(screen.getByRole('button', { name: 'Restore an existing backup' }));
    expect(onOpenRecovery).toHaveBeenCalledOnce();
  });

  it('continues partial setup at the first missing owner instead of claiming health', async () => {
    const user = userEvent.setup();
    installHomeApi(
      emptyHomeSnapshot({
        accounts: [connectedAccountFixture],
      }),
    );
    const { onNavigate } = renderHome();

    expect(await screen.findByText('Choose channels to protect')).toBeVisible();
    expect(screen.queryByText('All intended copies are verified')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue setup' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ area: 'channels' });
  });

  it('keeps an established archive visible when its YouTube account needs sign-in', async () => {
    installHomeApi(
      healthyHomeSnapshot({
        accounts: [
          {
            ...connectedAccountFixture,
            connectionState: 'REAUTH_REQUIRED',
          },
        ],
      }),
    );
    renderHome();

    expect(await screen.findByRole('heading', { name: 'Archive' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'YouTube connection: Sign in again' })).toBeVisible();
    expect(screen.queryByText('Continue setting up your backup')).not.toBeInTheDocument();
  });

  it('states only confirmed healthy coverage and passes an automated accessibility check', async () => {
    installHomeApi(healthyHomeSnapshot());
    const { container } = renderHome();

    expect(await screen.findByText('All intended copies are verified')).toBeVisible();
    const archive = screen.getByRole('heading', { name: 'Archive' }).closest('section');
    expect(archive).not.toBeNull();
    expect(within(archive!).getAllByText('12', { selector: 'dd' })).toHaveLength(2);
    expect(within(archive!).getByText('24.0 GB')).toBeVisible();
    expect(screen.getAllByText('Studio North')).toHaveLength(2);
    expect(screen.getByText('Backup completed')).toBeVisible();
    expect(screen.queryByText('Backup health')).not.toBeInTheDocument();
    expect(container.querySelector('.dashboard-grid')).not.toBeInTheDocument();

    const results = await axe.run(container, {
      rules: {
        'color-contrast': { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });

  it('translates an active durable job into plain-language progress and controls', async () => {
    const activeJob = jobFixture();
    installHomeApi(
      healthyHomeSnapshot({
        queue: queueFixture([activeJob]),
        runs: [{ ...completedRunFixture, status: 'RUNNING', completedAt: null }],
      }),
    );
    renderHome();

    expect(await screen.findByText('Backup is still in progress')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Backing up Studio North' })).toBeVisible();
    expect(screen.getByText('Copying to local backup')).toBeVisible();
    expect(screen.getByText('1.00 KB of 2.00 KB')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();

    const visibleCopy = document.body.textContent ?? '';
    for (const rawValue of ['COPY_TO_FILESYSTEM', 'FILESYSTEM', 'RUNNING', 'MANUAL']) {
      expect(visibleCopy).not.toContain(rawValue);
    }
  });

  it('does not invent a determinate percentage for blocked work with unknown progress', async () => {
    installHomeApi(
      healthyHomeSnapshot({
        queue: queueFixture([jobFixture({ status: 'BLOCKED', progressRatio: null })]),
        attentionQueue: queueFixture([jobFixture({ status: 'BLOCKED', progressRatio: null })], {
          section: 'ATTENTION',
        }),
        runs: [{ ...completedRunFixture, status: 'RUNNING', completedAt: null }],
      }),
    );
    renderHome();

    expect(await screen.findByText('Backup is waiting for attention')).toBeVisible();
    expect(screen.getByText('Progress unavailable')).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('routes each attention owner to the safe repair surface without duplicate provider noise', async () => {
    const user = userEvent.setup();
    const authAccount = {
      ...connectedAccountFixture,
      id: '00000000-0000-4000-8000-000000000010',
      providerAccountId: 'provider-account-needs-auth',
      email: null,
      displayName: null,
      connectionState: 'REAUTH_REQUIRED' as const,
      capabilities: {
        ...connectedAccountFixture.capabilities,
        driveConnectionState: 'REAUTH_REQUIRED' as const,
      },
    };
    const fullDestination = {
      ...destinationFixture,
      availabilityStatus: 'FULL' as const,
      safeMessage: 'Not enough free space.',
    };
    const failedJob = jobFixture({
      status: 'FAILED',
      errorCode: 'NETWORK_TIMEOUT',
      safeMessage: 'The network request timed out.',
    });
    const authDriveDestination = {
      id: '00000000-0000-4000-8000-000000000011',
      destinationType: 'GOOGLE_DRIVE' as const,
      accountId: authAccount.id,
      accountEmail: null,
      accountDisplayName: null,
      providerRootId: 'drive-root-test',
      rootName: 'YouTube Backup Manager',
      enabled: true,
      availabilityStatus: 'AUTH_REQUIRED' as const,
      availableBytes: null,
      totalBytes: null,
      lastProbeAt: null,
      safeMessage: 'Sign in again.',
    };
    installHomeApi(
      healthyHomeSnapshot({
        dashboard: { ...dashboardFixture, failedCopyCount: 2 },
        accounts: [connectedAccountFixture, authAccount],
        destinations: [fullDestination, authDriveDestination],
        attentionQueue: queueFixture([failedJob], {
          section: 'ATTENTION',
          totalItems: 1,
          failedCount: 1,
        }),
        integrity: {
          ...emptyIntegrityFixture,
          health: { ...emptyIntegrityFixture.health, complete: 10, corrupt: 1, missing: 1 },
        },
        schedules: [scheduleFixture({ taskStatus: 'ERROR', lastErrorSafe: 'Task unavailable.' })],
      }),
    );
    const { onNavigate } = renderHome();

    const routes: Array<[string, AppRoute]> = [
      ['Google Drive: Sign in again', { area: 'settings', category: 'accounts' }],
      ['D:\\Archive: Review storage', { area: 'storage', entityId: FIXTURE_IDS.destination }],
      ['Backup integrity: Review integrity', { area: 'integrity', view: 'issues' }],
      ['1 backup operation: Open Activity', { area: 'activity', view: 'attention' }],
      ['Automatic backup: Review scheduling', { area: 'settings', category: 'scheduling' }],
    ];

    await screen.findByRole('heading', { name: 'Resolve backup issues' });
    for (const [name, route] of routes) {
      await user.click(screen.getByRole('button', { name }));
      expect(onNavigate).toHaveBeenLastCalledWith(route);
    }
    expect(
      screen.getByRole('button', { name: 'D:\\Archive: Review storage' }),
    ).toHaveAccessibleDescription('Not enough space');
    expect(screen.getAllByRole('button', { name: /Google Drive: Sign in again/ })).toHaveLength(1);
  });

  it('retains confirmed content, disables backup controls, and explains a later request failure', async () => {
    const snapshot = healthyHomeSnapshot();
    const api = installHomeApi(snapshot);
    api.getFoundationStatus
      .mockResolvedValueOnce(snapshot.foundation)
      .mockRejectedValueOnce(new Error('Worker unavailable'))
      .mockResolvedValue(snapshot.foundation);
    renderHome();

    expect(await screen.findByText('All intended copies are verified')).toBeVisible();
    expect(await screen.findByText('Home could not refresh', {}, { timeout: 3_500 })).toBeVisible();
    expect(screen.getByText('All intended copies are verified')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Diagnostics' })).toBeVisible();
  });
});

describe('Home backup chooser', () => {
  it('lists only eligible managed channels, focuses the choice, and navigates after acceptance', async () => {
    const user = userEvent.setup();
    const ineligibleChannel = {
      ...channelFixture,
      id: FIXTURE_IDS.secondChannel,
      providerChannelId: 'UC_TEST_GUEST',
      title: 'Guest archive',
      accessibleAccountIds: [],
    };
    const snapshot = healthyHomeSnapshot({
      dashboard: { ...dashboardFixture, selectedChannelCount: 2 },
      channels: [channelFixture, ineligibleChannel],
      channelSettings: [
        channelSettingsFixture,
        {
          ...channelSettingsFixture,
          channelId: FIXTURE_IDS.secondChannel,
          destinationIds: [FIXTURE_IDS.destination],
        },
      ],
    });
    const api = installHomeApi(snapshot);
    const { onNavigate } = renderHome();

    await user.click(await screen.findByRole('button', { name: 'Back up now' }));
    const dialog = screen.getByRole('dialog', { name: 'Back up now' });
    const primaryChoice = within(dialog).getByRole('radio', { name: 'Studio North' });
    expect(primaryChoice).toBeChecked();
    await waitFor(() => expect(primaryChoice).toHaveFocus());
    expect(within(dialog).queryByText('Guest archive')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Start backup' }));
    await waitFor(() => expect(api.startBackup).toHaveBeenCalledWith(FIXTURE_IDS.channel));
    await waitFor(() =>
      expect(onNavigate).toHaveBeenLastCalledWith({ area: 'activity', view: 'active' }),
    );
    expect(screen.queryByRole('dialog', { name: 'Back up now' })).not.toBeInTheDocument();
  });

  it('clears a selected channel when polling makes it ineligible', async () => {
    vi.useFakeTimers();
    const snapshot = healthyHomeSnapshot();
    const api = installHomeApi(snapshot);
    renderHome();

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(screen.getByRole('radio', { name: 'Studio North' })).toBeChecked();

    api.listChannels.mockResolvedValue([{ ...channelFixture, backupEnabled: false }]);
    api.getDashboardSummary.mockResolvedValue({ ...dashboardFixture, selectedChannelCount: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    const dialog = screen.getByRole('dialog', { name: 'Back up now' });
    expect(within(dialog).queryByRole('radio', { name: 'Studio North' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Start backup' })).toBeDisabled();
    expect(api.startBackup).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/No channels are currently eligible/)).toHaveFocus();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByRole('heading', { name: 'Home' })).toHaveFocus();
  });
});

describe('Home App integration', () => {
  it('mounts only the new Home owner and never the legacy Dashboard body', async () => {
    const api = installHomeApi(healthyHomeSnapshot());
    render(<App />);

    expect(await screen.findByText('All intended copies are verified')).toBeVisible();
    await act(async () => Promise.resolve());
    expect(document.querySelector('.dashboard-grid')).not.toBeInTheDocument();
    expect(screen.queryByText('Backup health')).not.toBeInTheDocument();
    expect(api.getToolDiagnostics).not.toHaveBeenCalled();
    expect(api.listAccounts).toHaveBeenCalledTimes(1);
  });
});
