import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  ActivityAttentionPage,
  ActivityOperationDetails,
  ActivityOperationsPage,
  ActivityRunDetails,
  BackupRunHistoryPage,
} from '@ytbm/core';

import type { AppRoute } from '../../src/renderer/src/app/routes';
import { ActivityScreen } from '../../src/renderer/src/features/activity';
import { completedRunFixture, FIXTURE_IDS } from './home-test-fixtures';
import { installStage6Api } from './stage6-test-fixtures';

const OPERATION_ID = `operation:${FIXTURE_IDS.run}:${FIXTURE_IDS.job}`;
const NOW = 1_787_097_600_000;

const operation = {
  id: OPERATION_ID,
  runId: FIXTURE_IDS.run,
  mediaItemId: FIXTURE_IDS.job,
  channelId: FIXTURE_IDS.channel,
  channelTitle: 'Studio North',
  title: 'How to preserve an archive',
  triggerType: 'MANUAL' as const,
  status: 'RUNNING' as const,
  phase: 'UPLOADING_DRIVE' as const,
  progressRatio: 0.6,
  completedSteps: 3,
  totalSteps: 5,
  bytesProcessed: 60,
  bytesTotal: 100,
  speedBytesPerSec: 10,
  etaSeconds: 40,
  nextRetryAt: null,
  safeMessage: 'The Google Drive branch will retry without affecting the verified local copy.',
  issueCount: 1,
  destinationBranches: [
    {
      destinationId: FIXTURE_IDS.destination,
      destinationType: 'FILESYSTEM' as const,
      label: 'D:\\Archive',
      status: 'COMPLETED' as const,
      completedSteps: 2,
      totalSteps: 2,
      safeMessage: null,
    },
    {
      destinationId: '00000000-0000-4000-8000-000000000031',
      destinationType: 'GOOGLE_DRIVE' as const,
      label: 'Google Drive - owner@example.test',
      status: 'FAILED' as const,
      completedSteps: 1,
      totalSteps: 3,
      safeMessage: 'Upload failed.',
    },
  ],
  availableActions: ['PAUSE', 'CANCEL_KEEP_PARTIAL'] as const,
  sourceJobIds: [FIXTURE_IDS.job],
  createdAt: NOW - 60_000,
  updatedAt: NOW,
};

const livePage: ActivityOperationsPage = {
  operations: [operation],
  page: 1,
  pageSize: 25,
  totalItems: 1,
  activeCount: 1,
  pausedCount: 0,
  retryingCount: 0,
  attentionCount: 1,
};

const attentionPage: ActivityAttentionPage = {
  issues: [
    {
      id: 'attention:destination',
      kind: 'AUTHORIZATION',
      title: 'Google Drive - owner@example.test',
      summary: 'Google Drive authorization is required.',
      count: 1,
      createdAt: NOW,
      resolutionLabel: 'Manage accounts',
      resolutionRoute: { area: 'settings', category: 'accounts' },
    },
  ],
  page: 1,
  pageSize: 25,
  totalItems: 1,
};

const historyPage: BackupRunHistoryPage = {
  runs: [completedRunFixture],
  page: 1,
  pageSize: 25,
  totalItems: 1,
};

const technicalJob = {
  id: FIXTURE_IDS.job,
  jobType: 'DOWNLOAD_MEDIA' as const,
  status: 'RUNNING' as const,
  destinationId: FIXTURE_IDS.destination,
  destinationLabel: 'D:\\Archive',
  priority: 10,
  attemptCount: 1,
  maxAttempts: 5,
  progressRatio: 0.6,
  bytesProcessed: 60,
  bytesTotal: 100,
  errorCode: null,
  safeMessage: null,
  nextRetryAt: null,
  dependsOnJobIds: [],
  availableActions: ['PAUSE', 'CANCEL_KEEP_PARTIAL', 'CANCEL_REMOVE_PARTIAL'] as const,
  createdAt: NOW - 60_000,
  updatedAt: NOW,
};

const operationDetails: ActivityOperationDetails = {
  operation,
  run: completedRunFixture,
  technicalJobs: [technicalJob],
  page: 1,
  pageSize: 25,
  totalJobs: 1,
};

const runDetails: ActivityRunDetails = {
  run: completedRunFixture,
  technicalJobs: [technicalJob],
  page: 1,
  pageSize: 25,
  totalJobs: 1,
};

function installActivityApi() {
  const api = installStage6Api();
  return Object.assign(api, {
    listActivityOperations: vi.fn(async () => livePage),
    listActivityAttention: vi.fn(async () => attentionPage),
    listBackupRunHistory: vi.fn(async () => historyPage),
    listActivityLog: vi.fn(async () => ({
      events: [
        {
          id: '00000000-0000-4000-8000-000000000041',
          category: 'ARCHIVE_CHANGES' as const,
          severity: 'INFO' as const,
          title: 'Title changed',
          summary: 'A saved title was updated from YouTube.',
          accountId: null,
          channelId: FIXTURE_IDS.channel,
          channelTitle: 'Studio North',
          mediaItemId: FIXTURE_IDS.job,
          mediaTitle: 'How to preserve an archive',
          destinationId: null,
          destinationLabel: null,
          runId: null,
          createdAt: NOW,
        },
      ],
      page: 1,
      pageSize: 25,
      totalItems: 1,
    })),
    getActivityOperationDetails: vi.fn(async () => operationDetails),
    getActivityRunDetails: vi.fn(async () => runDetails),
    controlActivityOperation: vi.fn(async () => undefined),
    controlJob: vi.fn(async () => technicalJob),
    resolveActivityEntity: vi.fn(),
  });
}

function ActivityHarness({
  initialRoute = { area: 'activity', view: 'active' },
  onExternalNavigate,
}: {
  initialRoute?: Extract<AppRoute, { area: 'activity' }>;
  onExternalNavigate?(route: AppRoute): void;
}) {
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  if (route.area !== 'activity') return <p>External route: {route.area}</p>;
  return (
    <ActivityScreen
      route={route}
      onNavigate={(next) => {
        onExternalNavigate?.(next);
        setRoute(next);
      }}
      notice={null}
      onNotice={() => undefined}
    />
  );
}

describe('Phase 7B.5 Activity', () => {
  it('renders one user operation with truthful independent destination outcomes', async () => {
    installActivityApi();
    const { container } = render(<ActivityHarness />);

    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Active operations' })).toBeVisible();
    expect(screen.getByText('How to preserve an archive')).toBeVisible();
    expect(screen.getByText('Uploading to Google Drive')).toBeVisible();
    expect(screen.getByText('10 B/s · About 40 seconds remaining')).toBeVisible();
    expect(screen.getByText('D:\\Archive')).toBeVisible();
    expect(screen.getByText('Google Drive - owner@example.test')).toBeVisible();
    expect(screen.queryByText('UPLOAD_TO_GOOGLE_DRIVE')).not.toBeInTheDocument();
    expect(screen.queryByText('RUNNING')).not.toBeInTheDocument();
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('uses a focus-managed confirmation for run-safe cancellation', async () => {
    const user = userEvent.setup();
    const api = installActivityApi();
    render(<ActivityHarness />);

    await user.click(
      await screen.findByRole('button', { name: /More actions for How to preserve/i }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Cancel and keep partial files' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this work?' });
    expect(dialog).toHaveTextContent('Completed and partial files will be kept');
    await user.click(screen.getByRole('button', { name: 'Cancel and keep files' }));
    await waitFor(() =>
      expect(api.controlActivityOperation).toHaveBeenCalledWith(
        OPERATION_ID,
        'CANCEL_KEEP_PARTIAL',
      ),
    );
  });

  it('loads technical jobs only after details open and protects partial-file removal', async () => {
    const user = userEvent.setup();
    const api = installActivityApi();
    render(<ActivityHarness />);

    await user.click(await screen.findByRole('button', { name: /^How to preserve an archive/i }));
    expect(await screen.findByRole('dialog', { name: 'How to preserve an archive' })).toBeVisible();
    expect(api.getActivityOperationDetails).toHaveBeenCalledTimes(1);
    await user.click(screen.getByText('Technical details'));
    expect(screen.getByText('Download media')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Actions for Download media' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cancel and remove partial files' }));
    expect(
      screen.getByRole('dialog', { name: 'Cancel and remove partial files?' }),
    ).toHaveTextContent('Verified backup data is not affected');
  });

  it('loads paged history without the one-second live controller and resolves attention once', async () => {
    const user = userEvent.setup();
    const api = installActivityApi();
    const onNavigate = vi.fn();
    render(
      <ActivityHarness
        initialRoute={{ area: 'activity', view: 'history' }}
        onExternalNavigate={onNavigate}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Backup and archive history' }),
    ).toBeVisible();
    expect(screen.getByText('Backup runs')).toBeVisible();
    expect(screen.getByText('Archive events')).toBeVisible();
    expect(api.listActivityOperations).not.toHaveBeenCalled();
    expect(api.listBackupRunHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 25,
        triggerType: null,
        destinationId: null,
        from: null,
        to: null,
      }),
    );

    const historyTab = screen.getByRole('tab', { name: 'History' });
    historyTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Needs attention/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('Account authorization')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Manage accounts' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ area: 'settings', category: 'accounts' });
  });
});
