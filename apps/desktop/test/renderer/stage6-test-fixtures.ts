import type { AccountDto, ChannelDto, OAuthFlowDto } from '@ytbm/core';
import { vi } from 'vitest';

import {
  channelFixture,
  channelSettingsFixture,
  completedRunFixture,
  connectedAccountFixture,
  destinationFixture,
  emptyIntegrityFixture,
  foundationFixture,
  queueFixture,
  scheduleFixture,
} from './home-test-fixtures';

export const SECOND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000021';

export const youtubeOnlyAccountFixture: AccountDto = {
  ...connectedAccountFixture,
  id: SECOND_ACCOUNT_ID,
  providerAccountId: 'provider-account-2',
  email: 'editor@example.test',
  displayName: 'Studio Editor',
  capabilities: {
    youtubeReadonly: true,
    driveFile: false,
    driveConnectionState: 'AUTHORIZATION_REQUIRED',
    grantedScopes: ['youtube.readonly'],
  },
};

export const sharedChannelFixture: ChannelDto = {
  ...channelFixture,
  accessibleAccountIds: [connectedAccountFixture.id, youtubeOnlyAccountFixture.id],
};

export function installStage6Api({
  accounts = [connectedAccountFixture, youtubeOnlyAccountFixture],
  channels = [sharedChannelFixture],
}: {
  accounts?: AccountDto[];
  channels?: ChannelDto[];
} = {}) {
  const pendingFlow: OAuthFlowDto = {
    flowId: '00000000-0000-4000-8000-000000000022',
    capability: 'YOUTUBE',
    status: 'PENDING',
    expiresAt: Date.now() + 60_000,
    account: null,
    errorCode: null,
    safeMessage: null,
  };
  const api = {
    getFoundationStatus: vi.fn(async () => foundationFixture),
    listAccounts: vi.fn(async () => accounts),
    listChannels: vi.fn(async () => channels),
    listDestinations: vi.fn(async () => [destinationFixture]),
    listBackupRuns: vi.fn(async () => [completedRunFixture]),
    getQueueSnapshot: vi.fn(async () => queueFixture()),
    getIntegrityOverview: vi.fn(async () => ({
      ...emptyIntegrityFixture,
      channels: [
        {
          channelId: sharedChannelFixture.id,
          channelTitle: sharedChannelFixture.title,
          health: { ...emptyIntegrityFixture.health },
        },
      ],
    })),
    listSchedules: vi.fn(async () => [scheduleFixture()]),
    getChannelBackupSettings: vi.fn(async () => channelSettingsFixture),
    updateChannelBackupSettings: vi.fn(async (input: typeof channelSettingsFixture) => ({
      ...channelSettingsFixture,
      ...input,
    })),
    previewChannelQualityChange: vi.fn(async () => ({
      channelId: sharedChannelFixture.id,
      previousEffectiveQualityProfile: 'MAX_1080P' as const,
      targetEffectiveQualityProfile: 'MAX_4K' as const,
      isQualityIncrease: true,
      eligibleMediaCount: 8,
      eligibleCopyCount: 8,
      upgradeExistingSupported: false as const,
      unsupportedReason:
        'Existing verified copies cannot be replaced by the current durable backup planner.',
    })),
    applyChannelQualityChange: vi.fn(async () => ({
      settings: { ...channelSettingsFixture, qualityProfileOverride: 'MAX_4K' as const },
      preview: {
        channelId: sharedChannelFixture.id,
        previousEffectiveQualityProfile: 'MAX_1080P' as const,
        targetEffectiveQualityProfile: 'MAX_4K' as const,
        isQualityIncrease: true,
        eligibleMediaCount: 8,
        eligibleCopyCount: 8,
        upgradeExistingSupported: false as const,
        unsupportedReason:
          'Existing verified copies cannot be replaced by the current durable backup planner.',
      },
      appliedPolicy: 'NEW_MEDIA_ONLY' as const,
    })),
    setChannelEnabled: vi.fn(async (_id: string, enabled: boolean) => ({
      ...sharedChannelFixture,
      backupEnabled: enabled,
    })),
    startBackup: vi.fn(async () => ({
      run: { ...completedRunFixture, status: 'PENDING' as const, completedAt: null },
      plannedJobs: 1,
      skippedVerifiedMedia: 0,
    })),
    startChannelSync: vi.fn(async () => ({
      id: '00000000-0000-4000-8000-000000000023',
      channelId: sharedChannelFixture.id,
      status: 'COMPLETED' as const,
      phase: 'COMPLETE' as const,
      progressRatio: 1,
      errorCode: null,
      safeMessage: null,
      nextRetryAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })),
    getSyncStatus: vi.fn(),
    upsertSchedule: vi.fn(async () => scheduleFixture()),
    removeSchedule: vi.fn(async () => undefined),
    beginGoogleOAuth: vi.fn(
      async (_accountId: string | null, capability: 'YOUTUBE' | 'GOOGLE_DRIVE') => ({
        status: 'STARTED' as const,
        flowId: pendingFlow.flowId,
        capability,
        expiresAt: pendingFlow.expiresAt,
      }),
    ),
    getOAuthStatus: vi.fn(async () => ({ ...pendingFlow, status: 'COMPLETED' as const })),
    discoverChannels: vi.fn(async () => channels),
    disconnectAccount: vi.fn(async (accountId: string) => ({
      ...accounts.find((account) => account.id === accountId)!,
      connectionState: 'DISCONNECTED' as const,
    })),
  };
  Object.defineProperty(window, 'ytbm', {
    configurable: true,
    value: api as unknown as Window['ytbm'],
  });
  return api;
}
