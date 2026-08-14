import type { BackupRunDto, JobType } from '@ytbm/core';
import { describe, expect, it } from 'vitest';

import {
  buildHomePresentation,
  homeJobPhase,
  homeRunOutcome,
} from '../../src/renderer/src/features/home/home-model';
import {
  HOME_FIXTURE_IDS,
  configuredHomeSnapshot,
  emptyHomeSnapshot,
  homeAccount,
  homeChannel,
  homeChannelSettings,
  homeDashboard,
  homeDestination,
  homeIntegrity,
  homeJob,
  homeQueue,
  homeRun,
  homeSchedule,
} from './home-model-fixtures';

describe('Home presentation model', () => {
  describe('setup checkpoints', () => {
    it('recognizes a truly empty installation', () => {
      const model = buildHomePresentation(emptyHomeSnapshot());

      expect(model.setup).toEqual({ kind: 'empty' });
      expect(model.health).toMatchObject({
        title: 'Your archive is ready for its next backup',
        tone: 'neutral',
      });
      expect(model.activeOperation).toBeNull();
      expect(model.attention).toEqual([]);
    });

    it.each([
      {
        checkpoint: 'account connection',
        snapshot: emptyHomeSnapshot({ channels: [homeChannel()] }),
        title: 'Continue setting up your backup',
        route: { area: 'settings', category: 'accounts' },
      },
      {
        checkpoint: 'channel selection',
        snapshot: emptyHomeSnapshot({ accounts: [homeAccount()] }),
        title: 'Choose channels to protect',
        route: { area: 'channels' },
      },
      {
        checkpoint: 'destination creation',
        snapshot: emptyHomeSnapshot({
          accounts: [homeAccount()],
          channels: [homeChannel()],
        }),
        title: 'Add a backup destination',
        route: { area: 'storage' },
      },
      {
        checkpoint: 'channel destination assignment',
        snapshot: emptyHomeSnapshot({
          accounts: [homeAccount()],
          channels: [homeChannel()],
          destinations: [homeDestination()],
        }),
        title: 'Choose where backups are stored',
        route: { area: 'channels', panel: 'backup' },
      },
      {
        checkpoint: 'first backup',
        snapshot: emptyHomeSnapshot({
          accounts: [homeAccount()],
          channels: [homeChannel()],
          destinations: [homeDestination()],
          channelSettings: [homeChannelSettings()],
        }),
        title: 'Your first backup is ready to start',
        route: { area: 'channels', panel: 'backup' },
      },
    ])('routes a partial setup to the next $checkpoint', ({ snapshot, title, route }) => {
      expect(buildHomePresentation(snapshot).setup).toEqual({
        kind: 'partial',
        title,
        description: expect.any(String),
        route,
      });
    });

    it('marks setup configured only after worker-backed progress and saved destinations exist', () => {
      expect(buildHomePresentation(configuredHomeSnapshot()).setup).toEqual({
        kind: 'configured',
      });
    });

    it('requires reconnection before a configured first backup when source access has expired', () => {
      const model = buildHomePresentation(
        emptyHomeSnapshot({
          accounts: [homeAccount({ connectionState: 'REAUTH_REQUIRED' })],
          channels: [homeChannel()],
          destinations: [homeDestination()],
          channelSettings: [homeChannelSettings()],
        }),
      );

      expect(model.setup).toEqual({
        kind: 'partial',
        title: 'Sign in to continue setup',
        description: 'Reconnect Google before choosing the YouTube channels you manage.',
        route: { area: 'settings', category: 'accounts' },
      });
    });
  });

  describe('health truth', () => {
    it('calls the archive healthy only when all intended copies are verified', () => {
      const model = buildHomePresentation(configuredHomeSnapshot());

      expect(model.health).toMatchObject({
        title: 'All intended copies are verified',
        tone: 'healthy',
      });
      expect(model.health.description).toContain('8 copies are verified across 1 channel.');
      expect(model.health.description).toContain('Last backup completed');
    });

    it('does not report healthy coverage while a copy is still pending verification', () => {
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          dashboard: homeDashboard({
            selectedChannelCount: 1,
            mediaCount: 8,
            intendedCopyCount: 8,
            verifiedCopyCount: 8,
            pendingCopyCount: 1,
            verifiedBytes: 8 * 1_024 ** 3,
            localVerifiedCount: 8,
          }),
        }),
      );

      expect(model.health).toMatchObject({
        title: '1 copy is not verified yet',
        tone: 'warning',
      });
    });

    it('does not treat optional, never-authorized Drive access as an auth failure', () => {
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          accounts: [
            homeAccount({
              capabilities: {
                youtubeReadonly: true,
                driveFile: false,
                driveConnectionState: 'AUTHORIZATION_REQUIRED',
                grantedScopes: ['youtube.readonly'],
              },
            }),
          ],
        }),
      );

      expect(model.attention).toEqual([]);
      expect(model.health.tone).toBe('healthy');
    });
  });

  describe('active work', () => {
    it('chooses the safest active job unit and translates it to user-level copy', () => {
      const pending = homeJob({
        id: HOME_FIXTURE_IDS.secondJob,
        status: 'PENDING',
        jobType: 'DOWNLOAD_MEDIA',
        updatedAt: 20,
      });
      const running = homeJob({
        status: 'RUNNING',
        jobType: 'COPY_TO_FILESYSTEM',
        progressRatio: 0.42,
        updatedAt: 10,
      });
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          queue: homeQueue([pending, running]),
          runs: [homeRun({ status: 'RUNNING', completedAt: null })],
        }),
      );

      expect(model.activeOperation).toMatchObject({
        job: running,
        title: 'Backing up Workshop Archive',
        phase: 'Copying to local backup',
        stateLabel: 'In progress',
        destinationLabel: 'E:\\YouTube Archive\\the-durable-backup.mp4',
        canPause: true,
        canResume: false,
      });
      expect(model.health).toMatchObject({
        title: 'Backup is still in progress',
        tone: 'info',
      });
    });

    it('distinguishes verification and repair work without merging independent jobs', () => {
      const verification = buildHomePresentation(
        configuredHomeSnapshot({
          queue: homeQueue([
            homeJob({
              operationType: 'VERIFY',
              jobType: 'VERIFY_EXISTING_COPY',
              mediaTitle: 'Opening titles',
            }),
          ]),
        }),
      );

      expect(verification.activeOperation).toMatchObject({
        title: 'Verifying Opening titles',
        phase: 'Verifying backup',
      });
      expect(verification.health.title).toBe('Verification is still in progress');
    });

    it('presents blocked work as a warning with a plain-language resolution state', () => {
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          queue: homeQueue([homeJob({ status: 'BLOCKED' })]),
        }),
      );

      expect(model.activeOperation).toMatchObject({ stateLabel: 'Waiting for attention' });
      expect(model.health).toEqual({
        title: 'Backup is waiting for attention',
        description: 'Coverage totals will refresh after this work is verified.',
        tone: 'warning',
      });
    });
  });

  describe('attention ownership', () => {
    it.each([
      {
        status: 'DISCONNECTED' as const,
        description: 'Filesystem unavailable',
      },
      {
        status: 'FULL' as const,
        description: 'Not enough space',
      },
      {
        status: 'READ_ONLY' as const,
        description: 'Read-only destination',
      },
    ])('maps a $status destination to Storage', ({ status, description }) => {
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          destinations: [homeDestination({ availabilityStatus: status })],
        }),
      );

      expect(model.attention).toContainEqual({
        id: `destination:${HOME_FIXTURE_IDS.destination}`,
        title: 'E:\\YouTube Archive',
        description,
        actionLabel: 'Review storage',
        route: { area: 'storage', entityId: HOME_FIXTURE_IDS.destination },
        count: 1,
        kind: 'destination',
      });
    });

    it('maps account authorization failure to Settings > Accounts', () => {
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          accounts: [homeAccount({ connectionState: 'REAUTH_REQUIRED' })],
        }),
      );

      expect(model.setup).toEqual({ kind: 'configured' });
      expect(model.attention).toContainEqual(
        expect.objectContaining({
          title: 'YouTube connection',
          description: 'Sign in again',
          actionLabel: 'Sign in again',
          route: { area: 'settings', category: 'accounts' },
          count: 1,
          kind: 'authorization',
        }),
      );
    });

    it('keeps an unrelated failed operation visible beside another destination issue', () => {
      const unrelatedDestinationId = HOME_FIXTURE_IDS.driveDestination;
      const failedJob = homeJob({
        status: 'FAILED',
        destinationId: unrelatedDestinationId,
        destinationPath: 'F:\\Second Archive\\the-durable-backup.mp4',
        errorCode: 'DESTINATION_DISCONNECTED',
        safeMessage: 'The second destination is disconnected.',
      });
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          destinations: [
            homeDestination({ availabilityStatus: 'DISCONNECTED' }),
            homeDestination({
              id: unrelatedDestinationId,
              rootPath: 'F:\\Second Archive',
            }),
          ],
          attentionQueue: homeQueue([failedJob], { section: 'ATTENTION' }),
        }),
      );

      expect(model.attention).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `destination:${HOME_FIXTURE_IDS.destination}`,
            kind: 'destination',
          }),
          expect.objectContaining({
            id: 'activity:attention',
            kind: 'operation',
            count: 1,
          }),
        ]),
      );
    });

    it('does not let one destination hide unavailable-copy attention owned elsewhere', () => {
      const unavailableDestination = homeDestination({
        id: HOME_FIXTURE_IDS.driveDestination,
        rootPath: 'F:\\Second Archive',
      });
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          destinations: [homeDestination({ availabilityStatus: 'FULL' }), unavailableDestination],
          integrity: homeIntegrity({
            health: {
              complete: 7,
              partial: 0,
              pending: 0,
              missing: 0,
              corrupt: 0,
              unavailable: 1,
              authRequired: 0,
            },
            issues: [
              {
                copyId: HOME_FIXTURE_IDS.secondRun,
                mediaItemId: HOME_FIXTURE_IDS.media,
                mediaTitle: 'The durable backup',
                channelId: HOME_FIXTURE_IDS.channel,
                channelTitle: 'Workshop Archive',
                destinationId: unavailableDestination.id,
                destinationType: 'FILESYSTEM',
                copyStatus: 'UNAVAILABLE',
                destinationAvailability: 'AVAILABLE',
                health: 'UNAVAILABLE',
                lastCheckedAt: null,
                safeMessage: 'The destination is currently unavailable.',
                repairSources: [],
                youtubeFallbackAvailable: false,
              },
            ],
          }),
        }),
      );

      expect(model.attention).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `destination:${HOME_FIXTURE_IDS.destination}`,
            kind: 'destination',
          }),
          expect.objectContaining({
            id: 'integrity:unavailable',
            kind: 'destination',
          }),
        ]),
      );
    });

    it('maps an authorization-required Drive destination to Settings > Accounts', () => {
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          destinations: [
            {
              id: HOME_FIXTURE_IDS.driveDestination,
              destinationType: 'GOOGLE_DRIVE',
              accountId: HOME_FIXTURE_IDS.account,
              accountEmail: 'owner@example.com',
              accountDisplayName: 'Archive Owner',
              providerRootId: 'provider-root',
              rootName: 'YouTube Backup Manager',
              enabled: true,
              availabilityStatus: 'AUTH_REQUIRED',
              availableBytes: null,
              totalBytes: null,
              lastProbeAt: null,
              safeMessage: 'Authorization is required.',
            },
          ],
          channelSettings: [
            homeChannelSettings({ destinationIds: [HOME_FIXTURE_IDS.driveDestination] }),
          ],
        }),
      );

      expect(model.attention).toContainEqual(
        expect.objectContaining({
          title: 'owner@example.com',
          description: 'Sign in again',
          route: { area: 'settings', category: 'accounts' },
          kind: 'authorization',
        }),
      );
    });

    it.each(['FAILED', 'BLOCKED'] as const)('maps a %s durable operation to Activity', (status) => {
      const job = homeJob({
        status,
        errorCode: 'NETWORK_UNAVAILABLE',
        safeMessage: 'The network is unavailable.',
      });
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          attentionQueue: homeQueue([job], { section: 'ATTENTION' }),
        }),
      );

      expect(model.attention).toContainEqual({
        id: 'activity:attention',
        title: '1 backup operation',
        description: 'Failed or waiting for attention',
        actionLabel: 'Open Activity',
        route: { area: 'activity', view: 'attention' },
        count: 1,
        kind: 'operation',
      });
    });

    it('maps copy and media integrity failures without combining different units', () => {
      const model = buildHomePresentation(
        configuredHomeSnapshot({
          dashboard: homeDashboard({
            selectedChannelCount: 1,
            mediaCount: 8,
            intendedCopyCount: 8,
            verifiedCopyCount: 6,
            failedCopyCount: 2,
            verifiedBytes: 6 * 1_024 ** 3,
            localVerifiedCount: 6,
          }),
          integrity: homeIntegrity({
            health: {
              complete: 6,
              partial: 0,
              pending: 0,
              missing: 1,
              corrupt: 1,
              unavailable: 0,
              authRequired: 0,
            },
          }),
        }),
      );

      expect(model.attention).toContainEqual({
        id: 'integrity:copies',
        title: 'Backup integrity',
        description:
          '2 failed copies; 2 media items have missing or corrupt copies. Review required',
        actionLabel: 'Review integrity',
        route: { area: 'integrity', view: 'issues' },
        count: 1,
        kind: 'integrity',
      });
    });

    it('maps schedule errors to Settings > Scheduling', () => {
      const model = buildHomePresentation(
        configuredHomeSnapshot({ schedules: [homeSchedule({ taskStatus: 'ERROR' })] }),
      );

      expect(model.attention).toContainEqual(
        expect.objectContaining({
          title: 'Automatic backup',
          description: 'Scheduling needs attention',
          route: { area: 'settings', category: 'scheduling' },
          count: 1,
          kind: 'schedule',
        }),
      );
    });
  });

  it('uses the exact completed-with-issues distinction and a warning tone', () => {
    const run = homeRun({
      status: 'COMPLETED_WITH_ERRORS',
      failedCount: 2,
    });
    const model = buildHomePresentation(configuredHomeSnapshot({ runs: [run] }));

    expect(model.health).toEqual({
      title: 'Backup completed with issues',
      description: '2 backup steps need attention before the archive is complete.',
      tone: 'warning',
    });
    expect(homeRunOutcome(run)).toBe('Backup completed with issues');
  });

  it('does not mix paginated provider failures into an invented Activity total', () => {
    const providerFailure = homeJob({
      status: 'FAILED',
      errorCode: 'DESTINATION_DISCONNECTED',
      safeMessage: 'The destination is disconnected.',
    });
    const independentFailure = homeJob({
      id: HOME_FIXTURE_IDS.secondJob,
      status: 'BLOCKED',
      errorCode: 'NETWORK_UNAVAILABLE',
      safeMessage: 'The network is unavailable.',
    });
    const model = buildHomePresentation(
      configuredHomeSnapshot({
        destinations: [homeDestination({ availabilityStatus: 'DISCONNECTED' })],
        attentionQueue: homeQueue([providerFailure, independentFailure], {
          section: 'ATTENTION',
          totalItems: 7,
          totalJobCount: 7,
          failedCount: 4,
          blockedCount: 3,
        }),
      }),
    );

    expect(model.attention.map(({ kind, count }) => ({ kind, count }))).toEqual([
      { kind: 'destination', count: 1 },
      { kind: 'operation', count: 1 },
    ]);
    expect(model.attention.map((item) => item.title)).not.toContain('7 backup operations');
  });

  it('keeps raw enum names and safe error details out of normal presentation copy', () => {
    const jobTypes: JobType[] = [
      'CHANNEL_SYNC',
      'FORMAT_PROBE',
      'DOWNLOAD_MEDIA',
      'DOWNLOAD_THUMBNAIL',
      'POST_PROCESS_MEDIA',
      'HASH_STAGING_MEDIA',
      'VERIFY_STAGING_MEDIA',
      'WRITE_STAGING_METADATA',
      'COPY_TO_FILESYSTEM',
      'VERIFY_FILESYSTEM_COPY',
      'WRITE_DESTINATION_METADATA',
      'UPDATE_MANIFEST',
      'ENSURE_GOOGLE_DRIVE_ROOT',
      'ENSURE_GOOGLE_DRIVE_FOLDER',
      'UPLOAD_TO_GOOGLE_DRIVE',
      'VERIFY_GOOGLE_DRIVE_COPY',
      'DOWNLOAD_FROM_GOOGLE_DRIVE',
      'RECONCILE_GOOGLE_DRIVE_OBJECT',
      'UPDATE_GOOGLE_DRIVE_METADATA',
      'UPDATE_GOOGLE_DRIVE_THUMBNAIL',
      'UPDATE_GOOGLE_DRIVE_MANIFEST',
      'CLEANUP_STAGING',
      'VERIFY_EXISTING_COPY',
    ];
    const runStatuses: BackupRunDto['status'][] = [
      'PENDING',
      'RUNNING',
      'PAUSED',
      'COMPLETED',
      'COMPLETED_WITH_ERRORS',
      'FAILED',
      'CANCELLED',
      'INTERRUPTED',
    ];
    const rawEnumPattern = /\b[A-Z]+(?:_[A-Z0-9]+)+\b/;

    for (const jobType of jobTypes) {
      expect(homeJobPhase(jobType)).not.toMatch(rawEnumPattern);
      expect(homeJobPhase(jobType)).not.toBe(jobType);
    }
    for (const status of runStatuses) {
      expect(homeRunOutcome(homeRun({ status }))).not.toMatch(rawEnumPattern);
      expect(homeRunOutcome(homeRun({ status }))).not.toBe(status);
    }

    const internalMessage = 'DESTINATION_FULL at providerRootId=raw-secret';
    const presentation = buildHomePresentation(
      configuredHomeSnapshot({
        destinations: [
          homeDestination({
            availabilityStatus: 'FULL',
            safeMessage: internalMessage,
          }),
        ],
        attentionQueue: homeQueue(
          [
            homeJob({
              status: 'FAILED',
              errorCode: 'DESTINATION_FULL',
              safeMessage: internalMessage,
            }),
          ],
          { section: 'ATTENTION' },
        ),
      }),
    );
    const displayedCopy = [
      presentation.health.title,
      presentation.health.description,
      ...presentation.attention.flatMap((item) => [item.title, item.description, item.actionLabel]),
    ].join(' ');

    expect(displayedCopy).not.toContain('DESTINATION_FULL');
    expect(displayedCopy).not.toContain('providerRootId');
  });

  it('only offers channels backed by a managed account and enabled destination assignment', () => {
    const unmanaged = homeChannel({
      id: HOME_FIXTURE_IDS.secondChannel,
      title: 'Unmanaged channel',
      accessibleAccountIds: [],
    });
    const model = buildHomePresentation(
      configuredHomeSnapshot({
        channels: [homeChannel(), unmanaged],
        channelSettings: [
          homeChannelSettings(),
          homeChannelSettings({
            channelId: HOME_FIXTURE_IDS.secondChannel,
          }),
        ],
      }),
    );

    expect(model.eligibleChannels.map((channel) => channel.id)).toEqual([HOME_FIXTURE_IDS.channel]);
  });

  it('requires an enabled destination assignment for every selected channel', () => {
    const secondChannel = homeChannel({
      id: HOME_FIXTURE_IDS.secondChannel,
      providerChannelId: 'youtube-channel-2',
      title: 'Second managed channel',
    });
    const model = buildHomePresentation(
      emptyHomeSnapshot({
        accounts: [homeAccount()],
        channels: [homeChannel(), secondChannel],
        destinations: [homeDestination()],
        channelSettings: [
          homeChannelSettings(),
          homeChannelSettings({
            channelId: HOME_FIXTURE_IDS.secondChannel,
            destinationIds: [],
          }),
        ],
      }),
    );

    expect(model.setup).toMatchObject({
      kind: 'partial',
      title: 'Choose where backups are stored',
      route: { area: 'channels', panel: 'backup' },
    });
    expect(model.eligibleChannels.map((candidate) => candidate.id)).toEqual([
      HOME_FIXTURE_IDS.channel,
    ]);
    expect(model.attention).toEqual([]);
  });
});
