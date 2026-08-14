import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AppRoute } from '../../src/renderer/src/app/routes';
import { ChannelsScreen } from '../../src/renderer/src/features/channels';
import { AccountsSettingsScreen } from '../../src/renderer/src/features/settings/accounts';
import {
  channelSettingsFixture,
  completedRunFixture,
  destinationFixture,
  emptyIntegrityFixture,
  FIXTURE_IDS,
  foundationFixture,
  scheduleFixture,
} from './home-test-fixtures';
import {
  installStage6Api,
  sharedChannelFixture,
  youtubeOnlyAccountFixture,
} from './stage6-test-fixtures';

function ChannelsHarness({
  initialRoute = { area: 'channels' },
}: {
  initialRoute?: Extract<AppRoute, { area: 'channels' }>;
}) {
  const [route, setRoute] = useState(initialRoute);
  return (
    <ChannelsScreen
      route={route}
      onNavigate={(next) => {
        if (next.area === 'channels') setRoute(next);
      }}
      notice={null}
      onNotice={() => undefined}
    />
  );
}

describe('Phase 7B.4 Channels', () => {
  it('shows route-owned loading and empty-channel states', async () => {
    const api = installStage6Api({ channels: [] });
    let resolveFoundation!: (value: Awaited<ReturnType<typeof api.getFoundationStatus>>) => void;
    api.getFoundationStatus.mockImplementationOnce(
      () => new Promise((resolve) => (resolveFoundation = resolve)),
    );
    render(<ChannelsHarness />);
    expect(screen.getByText('Loading channel backup policy and health.')).toBeVisible();
    await waitFor(() => expect(resolveFoundation).toBeTypeOf('function'));
    resolveFoundation(foundationFixture);
    expect(await screen.findByText('No YouTube channels found')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open Accounts' })).toBeVisible();
  });

  it('renders one compact logical-channel row and opens route-like details', async () => {
    const user = userEvent.setup();
    installStage6Api();
    render(<ChannelsHarness />);

    expect(await screen.findByRole('heading', { name: 'Channels' })).toBeVisible();
    expect(screen.getAllByText('Studio North')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeEnabled();
    expect(screen.getAllByText('Studio North')).toHaveLength(1);

    await user.click(screen.getByText('Studio North'));
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Source' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Channels' }));
    expect(await screen.findByRole('heading', { name: 'Channels' })).toBeVisible();
  });

  it.each([
    ['complete', 'Backed up'],
    ['partial', 'Backup incomplete'],
    ['pending', 'Backup incomplete'],
    ['unavailable', 'Backup incomplete'],
    ['missing', 'Needs attention'],
    ['corrupt', 'Needs attention'],
    ['authRequired', 'Needs attention'],
  ] as const)('renders worker-backed %s health as %s', async (field, label) => {
    const api = installStage6Api();
    api.getIntegrityOverview.mockResolvedValue({
      ...emptyIntegrityFixture,
      channels: [
        {
          channelId: sharedChannelFixture.id,
          channelTitle: sharedChannelFixture.title,
          health: {
            ...emptyIntegrityFixture.health,
            complete: 0,
            [field]: 1,
          },
        },
      ],
    });
    render(<ChannelsHarness />);
    expect(await screen.findByText(label)).toBeVisible();
  });

  it.each([
    ['DISCONNECTED', 'Unavailable'],
    ['FULL', 'Not enough space'],
    ['READ_ONLY', 'Read-only destination'],
    ['AUTH_REQUIRED', 'Needs sign-in'],
  ] as const)('keeps a selected %s destination visible with safe copy', async (status, label) => {
    const api = installStage6Api();
    api.listDestinations.mockResolvedValue([{ ...destinationFixture, availabilityStatus: status }]);
    render(
      <ChannelsHarness
        initialRoute={{ area: 'channels', entityId: FIXTURE_IDS.channel, panel: 'backup' }}
      />,
    );
    expect(await screen.findByRole('checkbox', { name: /D:\\/i })).toBeChecked();
    expect(screen.getByText(new RegExp(label, 'i'))).toBeVisible();
  });

  it('autosaves destination changes and preserves unavailable selections in copy', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    render(
      <ChannelsHarness
        initialRoute={{ area: 'channels', entityId: FIXTURE_IDS.channel, panel: 'backup' }}
      />,
    );

    const destination = await screen.findByRole('checkbox', { name: /D:\\/i });
    await user.click(destination);
    await waitFor(() =>
      expect(api.updateChannelBackupSettings).toHaveBeenCalledWith(
        expect.objectContaining({ destinationIds: [] }),
      ),
    );
    expect(screen.getByText('Destination changes save automatically.')).toBeVisible();
  });

  it('shows the worker-owned quality decision without a misleading upgrade action', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    render(
      <ChannelsHarness
        initialRoute={{ area: 'channels', entityId: FIXTURE_IDS.channel, panel: 'backup' }}
      />,
    );

    await user.click(await screen.findByRole('combobox', { name: 'Quality for future copies' }));
    await user.click(screen.getByRole('option', { name: 'Up to 4K' }));
    expect(await screen.findByRole('dialog', { name: 'Apply channel quality' })).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Apply channel quality' })).toHaveTextContent(
      '8 media items and 8 verified copies are known to use a lower profile.',
    );
    expect(screen.getByText('Existing-copy upgrade is not available')).toBeVisible();
    expect(screen.queryByRole('button', { name: /upgrade existing/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply to new media' }));
    await waitFor(() =>
      expect(api.applyChannelQualityChange).toHaveBeenCalledWith({
        channelId: FIXTURE_IDS.channel,
        qualityProfileOverride: 'MAX_4K',
        policy: 'NEW_MEDIA_ONLY',
      }),
    );
  });

  it('shows inherited quality and a zero-eligible quality increase truthfully', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    api.previewChannelQualityChange.mockResolvedValue({
      channelId: FIXTURE_IDS.channel,
      previousEffectiveQualityProfile: 'MAX_1080P',
      targetEffectiveQualityProfile: 'MAX_4K',
      isQualityIncrease: true,
      eligibleMediaCount: 0,
      eligibleCopyCount: 0,
      upgradeExistingSupported: false,
      unsupportedReason: 'Existing-copy upgrade is not implemented.',
    });
    render(
      <ChannelsHarness
        initialRoute={{ area: 'channels', entityId: FIXTURE_IDS.channel, panel: 'backup' }}
      />,
    );
    expect(
      await screen.findByRole('combobox', { name: 'Quality for future copies' }),
    ).toHaveTextContent('Use global default');
    expect(screen.getByText('Effective quality: Up to 1080p')).toBeVisible();
    await user.click(screen.getByRole('combobox', { name: 'Quality for future copies' }));
    await user.click(screen.getByRole('option', { name: 'Up to 4K' }));
    expect(await screen.findByRole('dialog', { name: 'Apply channel quality' })).toHaveTextContent(
      '0 media items and 0 verified copies',
    );
  });

  it('announces a quality eligibility error without opening a stale decision', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    api.previewChannelQualityChange.mockRejectedValueOnce(new Error('Eligibility is unavailable.'));
    render(
      <ChannelsHarness
        initialRoute={{ area: 'channels', entityId: FIXTURE_IDS.channel, panel: 'backup' }}
      />,
    );
    await user.click(await screen.findByRole('combobox', { name: 'Quality for future copies' }));
    await user.click(screen.getByRole('option', { name: 'Up to 4K' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Eligibility is unavailable.');
    expect(screen.queryByRole('dialog', { name: 'Apply channel quality' })).not.toBeInTheDocument();
  });

  it('requires storage before backup and exposes manual scheduling when disabled', async () => {
    const api = installStage6Api();
    api.listDestinations.mockResolvedValue([]);
    api.getChannelBackupSettings.mockResolvedValue({
      ...channelSettingsFixture,
      destinationIds: [],
    });
    api.listSchedules.mockResolvedValue([scheduleFixture({ enabled: false })]);
    render(<ChannelsHarness />);
    expect(await screen.findByRole('button', { name: 'Back up now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose storage' })).toBeVisible();
    expect(screen.getByText('Manual backups only')).toBeVisible();
  });

  it('distinguishes inherited and per-channel schedule state', async () => {
    const api = installStage6Api();
    api.listSchedules.mockResolvedValue([
      scheduleFixture({ channelId: null, channelTitle: null, localTime: '02:00' }),
    ]);
    const { unmount } = render(
      <ChannelsHarness
        initialRoute={{ area: 'channels', entityId: FIXTURE_IDS.channel, panel: 'schedule' }}
      />,
    );
    expect(
      await screen.findByText('This channel inherits the enabled global schedule.'),
    ).toBeVisible();
    unmount();

    installStage6Api();
    render(
      <ChannelsHarness
        initialRoute={{ area: 'channels', entityId: FIXTURE_IDS.channel, panel: 'schedule' }}
      />,
    );
    expect(await screen.findByText('Channel schedule')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Remove override' })).toBeVisible();
  });

  it.each([
    ['QUEUED', 'QUEUED', 'Source refresh queued'],
    ['RUNNING', 'MEDIA', 'Refreshing media'],
    ['RETRY_WAIT', 'MEDIA', 'Trying source refresh again'],
    ['COMPLETED', 'COMPLETE', 'Source refresh completed'],
    ['FAILED', 'FAILED', 'Source refresh failed'],
  ] as const)('presents source refresh %s in user-facing language', async (status, phase, copy) => {
    const user = userEvent.setup();
    const api = installStage6Api();
    api.startChannelSync.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000023',
      channelId: FIXTURE_IDS.channel,
      status,
      phase,
      progressRatio: status === 'RUNNING' ? 0.5 : null,
      errorCode: status === 'FAILED' ? 'NETWORK_UNAVAILABLE' : null,
      safeMessage: status === 'FAILED' || status === 'RETRY_WAIT' ? 'Network unavailable.' : null,
      nextRetryAt: status === 'RETRY_WAIT' ? Date.now() + 60_000 : null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    api.getSyncStatus.mockImplementation(async () => api.startChannelSync.mock.results[0]!.value);
    render(
      <ChannelsHarness
        initialRoute={{ area: 'channels', entityId: FIXTURE_IDS.channel, panel: 'source' }}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Refresh source' }));
    expect(await screen.findByText(new RegExp(copy, 'i'))).toBeVisible();
  });

  it('confirms disablement and states that existing data is retained', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    render(<ChannelsHarness />);
    await screen.findByRole('heading', { name: 'Channels' });

    await user.click(screen.getByRole('switch', { name: 'Back up Studio North' }));
    const dialog = screen.getByRole('dialog', { name: 'Disable channel backup?' });
    expect(
      within(dialog).getByText(/Existing backup files and catalog history are kept/),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Disable backup' }));
    await waitFor(() =>
      expect(api.setChannelEnabled).toHaveBeenCalledWith(FIXTURE_IDS.channel, false),
    );
  });

  it('reconciles persisted state before routing after an ambiguous backup start', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    const onNavigate = vi.fn<(route: AppRoute) => void>();
    render(
      <ChannelsScreen
        route={{ area: 'channels' }}
        onNavigate={onNavigate}
        notice={null}
        onNotice={() => undefined}
      />,
    );
    await screen.findByRole('heading', { name: 'Channels' });
    api.startBackup.mockRejectedValueOnce(new Error('Worker RPC request timed out'));
    api.listBackupRuns.mockResolvedValue([
      {
        ...completedRunFixture,
        id: '00000000-0000-4000-8000-000000000099',
        status: 'PENDING',
        completedAt: null,
        createdAt: Date.now(),
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'Back up now' }));
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith({
        area: 'activity',
        view: 'active',
        entityId: '00000000-0000-4000-8000-000000000099',
      }),
    );
  });

  it('locks a repeated backup start when persisted state cannot be confirmed', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    render(<ChannelsHarness />);
    await screen.findByRole('heading', { name: 'Channels' });
    api.startBackup.mockRejectedValueOnce(new Error('Worker RPC request timed out'));

    await user.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(
      await screen.findByText(
        /Starting again is disabled until Activity confirms the result/i,
        {
          exact: false,
        },
        { timeout: 3_000 },
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check Activity' })).toBeVisible();
    expect(api.startBackup).toHaveBeenCalledTimes(1);
  }, 5_000);

  it('has no automated accessibility violations on Channel Details', async () => {
    installStage6Api();
    const { container } = render(
      <ChannelsHarness
        initialRoute={{ area: 'channels', entityId: FIXTURE_IDS.channel, panel: 'overview' }}
      />,
    );
    await screen.findByRole('tab', { name: 'Overview' });
    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe('Phase 7B.4 Settings Accounts', () => {
  it('handles zero and multiple accounts without duplicating a shared logical channel', async () => {
    installStage6Api({ accounts: [], channels: [] });
    const { unmount } = render(<AccountsSettingsScreen onNavigate={() => undefined} />);
    expect(await screen.findByText('No Google accounts connected')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Connect Google account' })).toHaveLength(1);
    unmount();

    installStage6Api();
    render(<AccountsSettingsScreen onNavigate={() => undefined} />);
    expect(await screen.findAllByText('1 accessible channel')).toHaveLength(2);
    expect(screen.getAllByText('Studio North')).toHaveLength(2);
  });

  it('keeps Accounts in Settings and shows capability-specific status and one primary repair action', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    const onNavigate = vi.fn<(route: AppRoute) => void>();
    render(<AccountsSettingsScreen onNavigate={onNavigate} />);

    expect(await screen.findByRole('heading', { name: 'Accounts' })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Settings categories' })).toBeVisible();
    const editor = screen
      .getByRole('heading', { name: 'Studio Editor' })
      .closest('[role="listitem"]')!;
    expect(within(editor).getByText('YouTube read-only')).toBeVisible();
    expect(within(editor).getByText('Drive not connected')).toBeVisible();
    await user.click(within(editor).getByRole('button', { name: 'Connect Drive' }));
    expect(api.beginGoogleOAuth).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000021',
      'GOOGLE_DRIVE',
    );
  });

  it('uses an accessible destructive dialog with explicit persistence consequences', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    render(<AccountsSettingsScreen onNavigate={() => undefined} />);
    await screen.findByRole('heading', { name: 'Accounts' });

    await user.click(screen.getByRole('button', { name: 'More actions for Archive Owner' }));
    await user.click(screen.getByRole('menuitem', { name: 'Disconnect account' }));
    const dialog = screen.getByRole('dialog', { name: 'Disconnect Google account?' });
    expect(
      within(dialog).getByText(/backup history, schedules, and verified backup files are kept/i),
    ).toBeVisible();
    expect(within(dialog).getByText(/Google Drive objects.*are not deleted/i)).toBeVisible();
    expect(document.body).not.toHaveTextContent('provider-account-1');
    expect(screen.queryByText('Open logs')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect account' }));
    await waitFor(() => expect(api.disconnectAccount).toHaveBeenCalledWith(FIXTURE_IDS.account));
  });

  it('shows YouTube and Drive authorization as independent capability states', async () => {
    installStage6Api({
      accounts: [
        {
          ...youtubeOnlyAccountFixture,
          connectionState: 'REAUTH_REQUIRED',
          capabilities: {
            ...youtubeOnlyAccountFixture.capabilities,
            youtubeReadonly: false,
            driveFile: true,
            driveConnectionState: 'REAUTH_REQUIRED',
          },
        },
      ],
    });
    render(<AccountsSettingsScreen onNavigate={() => undefined} />);
    expect(await screen.findByText('YouTube sign-in required')).toBeVisible();
    expect(screen.getByText('Drive sign-in required')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeVisible();
  });

  it.each([
    ['UNAVAILABLE', 'OAuth is not configured.'],
    ['OFFLINE', 'Network unavailable.'],
  ] as const)('announces %s OAuth start failures safely', async (kind, message) => {
    const user = userEvent.setup();
    const api = installStage6Api();
    if (kind === 'UNAVAILABLE') {
      api.beginGoogleOAuth.mockResolvedValueOnce({ status: 'UNAVAILABLE', safeMessage: message });
    } else {
      api.beginGoogleOAuth.mockRejectedValueOnce(new Error(message));
    }
    render(<AccountsSettingsScreen onNavigate={() => undefined} />);
    await user.click(await screen.findByRole('button', { name: 'Connect Google account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it.each([
    ['COMPLETED', 'Google authorization completed'],
    ['FAILED', 'Google sign-in failed.'],
    ['EXPIRED', 'Google sign-in expired.'],
  ] as const)('polls and presents OAuth %s without credential details', async (status, copy) => {
    const user = userEvent.setup();
    const api = installStage6Api();
    api.getOAuthStatus.mockResolvedValue({
      flowId: '00000000-0000-4000-8000-000000000022',
      capability: 'YOUTUBE',
      status,
      expiresAt: Date.now() + 60_000,
      account: status === 'COMPLETED' ? youtubeOnlyAccountFixture : null,
      errorCode: null,
      safeMessage:
        status === 'FAILED'
          ? 'Google sign-in failed.'
          : status === 'EXPIRED'
            ? 'Google sign-in expired.'
            : null,
    });
    render(<AccountsSettingsScreen onNavigate={() => undefined} />);
    await user.click(await screen.findByRole('button', { name: 'Connect Google account' }));
    expect(screen.getByText(/Waiting for YouTube sign-in/i)).toBeVisible();
    expect(await screen.findByText(copy, {}, { timeout: 2_500 })).toBeVisible();
  });

  it('announces accessible-channel discovery failure and keeps account state intact', async () => {
    const user = userEvent.setup();
    const api = installStage6Api();
    api.discoverChannels.mockRejectedValueOnce(new Error('Channel discovery is unavailable.'));
    render(<AccountsSettingsScreen onNavigate={() => undefined} />);
    await screen.findByRole('heading', { name: 'Accounts' });
    await user.click(screen.getByRole('button', { name: 'More actions for Archive Owner' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh accessible channels' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Channel discovery is unavailable.');
    expect(screen.getByText('owner@example.test')).toBeVisible();
  });

  it('has no automated accessibility violations', async () => {
    installStage6Api();
    const { container } = render(<AccountsSettingsScreen onNavigate={() => undefined} />);
    await screen.findByRole('heading', { name: 'Accounts' });
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
