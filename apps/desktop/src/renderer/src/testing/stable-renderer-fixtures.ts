export const STABLE_RENDERER_FIXTURE_KINDS = [
  'loading',
  'empty',
  'healthy',
  'partial',
  'error',
  'disconnected',
  'authorization-required',
  'active',
  'paused',
  'retrying',
  'blocked',
  'cancelled',
  'completed-with-issues',
  'recovery-preview',
] as const;

export type StableRendererFixtureKind = (typeof STABLE_RENDERER_FIXTURE_KINDS)[number];

interface StableFixtureBase<Kind extends StableRendererFixtureKind> {
  kind: Kind;
  title: string;
  description: string;
}

export type StableRendererFixture =
  | (StableFixtureBase<'loading'> & {
      operation: 'library-query';
    })
  | (StableFixtureBase<'empty'> & {
      resource: 'library';
      totalItems: 0;
    })
  | (StableFixtureBase<'healthy'> & {
      intendedCopies: number;
      verifiedCopies: number;
      issueCount: 0;
    })
  | (StableFixtureBase<'partial'> & {
      intendedCopies: number;
      verifiedCopies: number;
      pendingCopies: number;
    })
  | (StableFixtureBase<'error'> & {
      safeMessage: string;
      retryable: boolean;
    })
  | (StableFixtureBase<'disconnected'> & {
      destinationName: string;
      lastKnownCopyCount: number;
    })
  | (StableFixtureBase<'authorization-required'> & {
      provider: 'GOOGLE_DRIVE';
      accountLabel: string;
      reconnectAction: true;
    })
  | (StableFixtureBase<'active'> & {
      completedItems: number;
      totalItems: number;
      canPause: true;
      canCancel: true;
    })
  | (StableFixtureBase<'paused'> & {
      completedItems: number;
      totalItems: number;
      partialDataRetained: true;
    })
  | (StableFixtureBase<'retrying'> & {
      attempt: number;
      maximumAttempts: number;
      nextRetryAt: number;
    })
  | (StableFixtureBase<'blocked'> & {
      safeMessage: string;
      resolution: string;
    })
  | (StableFixtureBase<'cancelled'> & {
      completedItems: number;
      partialDataRetained: true;
    })
  | (StableFixtureBase<'completed-with-issues'> & {
      completedItems: number;
      failedItems: number;
      blockedItems: number;
    })
  | (StableFixtureBase<'recovery-preview'> & {
      discoveredChannels: number;
      discoveredMedia: number;
      discoveredCopies: number;
      warnings: readonly string[];
      explicitConfirmationRequired: true;
      canonicalCatalogMutated: false;
      credentialImports: 0;
    });

/**
 * Deterministic inputs for renderer interaction and visual-regression tests.
 * They deliberately use fixed labels/counts/timestamps and contain no secrets,
 * paths, provider tokens, or live environment data.
 */
export const stableRendererFixtures = {
  loading: {
    kind: 'loading',
    title: 'Loading your library',
    description: 'Retrieving the current local catalog.',
    operation: 'library-query',
  },
  empty: {
    kind: 'empty',
    title: 'No media yet',
    description: 'Connect a YouTube account and sync a channel to build the local catalog.',
    resource: 'library',
    totalItems: 0,
  },
  healthy: {
    kind: 'healthy',
    title: 'Your archive is healthy',
    description: 'Every intended copy has completed verification.',
    intendedCopies: 240,
    verifiedCopies: 240,
    issueCount: 0,
  },
  partial: {
    kind: 'partial',
    title: 'Archive coverage is partial',
    description: 'Some intended copies have not completed verification.',
    intendedCopies: 240,
    verifiedCopies: 221,
    pendingCopies: 19,
  },
  error: {
    kind: 'error',
    title: 'The library could not be loaded',
    description: 'Existing backup data was not changed.',
    safeMessage: 'The worker is temporarily unavailable.',
    retryable: true,
  },
  disconnected: {
    kind: 'disconnected',
    title: 'Backup destination disconnected',
    description: 'Reconnect the destination before new copies can be written.',
    destinationName: 'Archive drive',
    lastKnownCopyCount: 184,
  },
  authorizationRequired: {
    kind: 'authorization-required',
    title: 'Google Drive authorization required',
    description: 'Reconnect this account to resume Drive operations.',
    provider: 'GOOGLE_DRIVE',
    accountLabel: 'Archive account',
    reconnectAction: true,
  },
  active: {
    kind: 'active',
    title: 'Backup in progress',
    description: 'Verified work is retained as the operation advances.',
    completedItems: 18,
    totalItems: 40,
    canPause: true,
    canCancel: true,
  },
  paused: {
    kind: 'paused',
    title: 'Backup paused',
    description: 'Resume when the destination is available.',
    completedItems: 18,
    totalItems: 40,
    partialDataRetained: true,
  },
  retrying: {
    kind: 'retrying',
    title: 'Waiting to retry',
    description: 'The operation will resume automatically after its retry delay.',
    attempt: 2,
    maximumAttempts: 5,
    nextRetryAt: 1_800_000_000_000,
  },
  blocked: {
    kind: 'blocked',
    title: 'Backup needs attention',
    description: 'The operation is waiting for a recoverable dependency.',
    safeMessage: 'The destination is not currently available.',
    resolution: 'Reconnect the destination, then resume this backup.',
  },
  cancelled: {
    kind: 'cancelled',
    title: 'Backup cancelled',
    description: 'Verified copies completed before cancellation were kept.',
    completedItems: 18,
    partialDataRetained: true,
  },
  completedWithIssues: {
    kind: 'completed-with-issues',
    title: 'Backup completed with issues',
    description: 'Most items completed, but some need attention.',
    completedItems: 36,
    failedItems: 3,
    blockedItems: 1,
  },
  recoveryPreview: {
    kind: 'recovery-preview',
    title: 'Recovery preview ready',
    description: 'Review discovered metadata before explicitly confirming an import.',
    discoveredChannels: 3,
    discoveredMedia: 420,
    discoveredCopies: 702,
    warnings: ['Two sidecars are older than their corresponding manifests.'],
    explicitConfirmationRequired: true,
    canonicalCatalogMutated: false,
    credentialImports: 0,
  },
} as const satisfies Record<string, StableRendererFixture>;
