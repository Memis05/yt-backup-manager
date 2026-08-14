import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { DrizzleGoogleAccountRepository } from '@ytbm/database/worker';
import { channelRelativeDirectory, mediaRelativeDirectory } from '@ytbm/storage-filesystem';

import { launchPackagedDesktop, type PackagedDesktopSeedContext } from './packaged-desktop';

const POPULATED_CHANNEL_TITLE = 'Desktop Archive Channel';

async function captureActivityQa(page: Page, name: string): Promise<void> {
  if (process.env.YTBM_CAPTURE_ACTIVITY_QA !== '1') return;
  const directory = resolve(process.cwd(), 'output/playwright/activity-qa');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${name}.png`) });
}

async function seedPopulatedHome({
  database,
  directory,
}: PackagedDesktopSeedContext): Promise<void> {
  const channelId = '00000000-0000-4000-8000-000000000101';
  const destinationId = '00000000-0000-4000-8000-000000000102';
  const mediaId = '00000000-0000-4000-8000-000000000103';
  const copyId = '00000000-0000-4000-8000-000000000104';
  const artifactId = '00000000-0000-4000-8000-000000000105';
  const backupRoot = join(directory, 'populated-backup');
  const mediaDirectory = join(
    channelRelativeDirectory(POPULATED_CHANNEL_TITLE, 'UCpackagedhome'),
    mediaRelativeDirectory('VIDEO', 'Desktop Archive Video', 'packaged-home-video'),
  );
  const relativeMediaPath = join(mediaDirectory, 'video.webm');
  const relativeMetadataPath = join(mediaDirectory, 'metadata.json');
  const media = Buffer.from('worker-backed packaged Home fixture', 'utf8');
  const metadata = Buffer.from('{"fixture":"packaged-home"}', 'utf8');
  const now = Date.now();

  await mkdir(join(backupRoot, mediaDirectory), { recursive: true });
  await Promise.all([
    writeFile(join(backupRoot, relativeMediaPath), media),
    writeFile(join(backupRoot, relativeMetadataPath), metadata),
  ]);

  const account = await new DrizzleGoogleAccountRepository(database).upsertConnectedAccount({
    providerAccountId: 'packaged-home-account',
    email: 'packaged-home@example.test',
    displayName: 'Packaged Home',
    avatarUrl: null,
    credentialRef: 'google-oauth:packaged-home-youtube',
    grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    capability: 'YOUTUBE',
    connectedAt: now,
  });

  database.sqlite.transaction(() => {
    database.sqlite
      .prepare(
        `insert into channels (
          id, source_provider, provider_channel_id, title, backup_enabled, source_status,
          first_seen_at, last_seen_at, last_sync_at, created_at, updated_at
        ) values (?, 'YOUTUBE', 'UCpackagedhome', ?, 1, 'AVAILABLE', ?, ?, ?, ?, ?)`,
      )
      .run(channelId, POPULATED_CHANNEL_TITLE, now, now, now, now, now);
    database.sqlite
      .prepare(
        `insert into account_channels (account_id, channel_id, relationship_metadata_json, created_at)
         values (?, ?, '{}', ?)`,
      )
      .run(account.id, channelId, now);
    database.sqlite
      .prepare(
        `insert into destinations (
          id, destination_type, root_path, last_known_mount_path, enabled,
          availability_status, last_probe_at, created_at, updated_at
        ) values (?, 'FILESYSTEM', ?, ?, 1, 'AVAILABLE', ?, ?, ?)`,
      )
      .run(destinationId, backupRoot, backupRoot, now, now, now);
    database.sqlite
      .prepare(
        `insert into channel_destinations (
          channel_id, destination_id, enabled, created_at, updated_at
        ) values (?, ?, 1, ?, ?)`,
      )
      .run(channelId, destinationId, now, now);
    database.sqlite
      .prepare(
        `insert into media_items (
          id, channel_id, source_provider, provider_media_id, media_type, title,
          original_title, source_url, source_status, first_seen_at, last_seen_at,
          metadata_version, created_at, updated_at
        ) values (?, ?, 'YOUTUBE', 'packaged-home-video', 'VIDEO', 'Desktop Archive Video',
          'Desktop Archive Video', 'https://www.youtube.com/watch?v=packagedhome',
          'AVAILABLE', ?, ?, 1, ?, ?)`,
      )
      .run(mediaId, channelId, now, now, now, now);
    database.sqlite
      .prepare(
        `insert into media_copies (
          id, media_item_id, destination_id, relative_path, container, bytes, sha256,
          quality_profile, content_generation, verification_strength, status,
          verified_at, last_checked_at, created_at, updated_at
        ) values (?, ?, ?, ?, 'webm', ?, ?, 'MAX_1080P', 'q1:MAX_1080P',
          'STRONG', 'VERIFIED', ?, ?, ?, ?)`,
      )
      .run(
        copyId,
        mediaId,
        destinationId,
        relativeMediaPath,
        media.byteLength,
        createHash('sha256').update(media).digest('hex'),
        now,
        now,
        now,
        now,
      );
    database.sqlite
      .prepare(
        `insert into media_artifacts (
          id, media_item_id, destination_id, artifact_type, relative_path, bytes, sha256,
          content_generation, status, verified_at, last_checked_at, created_at, updated_at
        ) values (?, ?, ?, 'METADATA', ?, ?, ?, 'metadata:1:q1:MAX_1080P',
          'VERIFIED', ?, ?, ?, ?)`,
      )
      .run(
        artifactId,
        mediaId,
        destinationId,
        relativeMetadataPath,
        metadata.byteLength,
        createHash('sha256').update(metadata).digest('hex'),
        now,
        now,
        now,
        now,
      );
  })();
}

async function seedActivityAttention(context: PackagedDesktopSeedContext): Promise<void> {
  await seedPopulatedHome(context);
  const { database } = context;
  const channelId = '00000000-0000-4000-8000-000000000101';
  const mediaId = '00000000-0000-4000-8000-000000000103';
  const driveId = '00000000-0000-4000-8000-000000000106';
  const runId = '00000000-0000-4000-8000-000000000107';
  const jobId = '00000000-0000-4000-8000-000000000108';
  const retryJobId = '00000000-0000-4000-8000-000000000109';
  const account = database.sqlite.prepare('select id from accounts limit 1').get() as {
    id: string;
  };
  const now = Date.now();
  database.sqlite.transaction(() => {
    database.sqlite
      .prepare(
        `insert into destinations (
          id, destination_type, account_id, enabled, availability_status,
          last_error_code, last_error_at, created_at, updated_at
        ) values (?, 'GOOGLE_DRIVE', ?, 1, 'AUTH_REQUIRED', 'AUTH_REVOKED', ?, ?, ?)`,
      )
      .run(driveId, account.id, now, now, now);
    database.sqlite
      .prepare(
        `insert into backup_runs (
          id, channel_id, trigger_type, status, effective_config_json,
          failed_count, started_at, created_at, updated_at
        ) values (?, ?, 'MANUAL', 'RUNNING', ?, 1, ?, ?, ?)`,
      )
      .run(
        runId,
        channelId,
        JSON.stringify({ qualityProfile: 'MAX_1080P', destinationIds: [driveId] }),
        now - 2_000,
        now - 3_000,
        now - 1_000,
      );
    database.sqlite
      .prepare(
        `insert into jobs (
          id, backup_run_id, channel_id, media_item_id, destination_id, job_type,
          status, priority, attempt_count, max_attempts, bytes_processed, payload_json,
          idempotency_key, error_code, error_message_safe, created_at, completed_at, updated_at
        ) values (?, ?, ?, ?, ?, 'UPLOAD_TO_GOOGLE_DRIVE', 'FAILED', 0, 1, 5, 0,
          '{}', ?, 'AUTH_REVOKED', 'Reconnect Google Drive to continue this backup.', ?, ?, ?)`,
      )
      .run(
        jobId,
        runId,
        channelId,
        mediaId,
        driveId,
        `e2e:${jobId}`,
        now - 2_000,
        now - 1_000,
        now - 1_000,
      );
    database.sqlite
      .prepare(
        `insert into jobs (
          id, backup_run_id, channel_id, media_item_id, destination_id, job_type,
          status, priority, attempt_count, max_attempts, bytes_processed, payload_json,
          idempotency_key, error_code, error_message_safe, next_retry_at, created_at, updated_at
        ) values (?, ?, ?, ?, ?, 'VERIFY_FILESYSTEM_COPY', 'RETRY_WAIT', 0, 1, 5, 0,
          '{}', ?, 'VERIFY_FAILED', 'Verification will retry automatically.', ?, ?, ?)`,
      )
      .run(
        retryJobId,
        runId,
        channelId,
        mediaId,
        '00000000-0000-4000-8000-000000000102',
        `e2e:${retryJobId}`,
        now + 60 * 60_000,
        now - 1_500,
        now - 1_000,
      );
  })();
}

test('packaged desktop preserves setup, destination, library, and activity journeys', async () => {
  const desktop = await launchPackagedDesktop();
  const backupRoot = join(desktop.directory, 'backup-destination');
  try {
    const { electronApp, page } = desktop;
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });

    await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Create or recover your backup archive', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Set up a new backup', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Restore an existing backup', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Settings', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Restore backup catalog', exact: true }),
    ).toBeVisible();

    await navigation.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'Set up a new backup', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Accounts', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Connect Google account', exact: true }),
    ).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Accounts', exact: true })).toHaveCount(0);
    await expect(page.getByText('Worker ready', { exact: true })).toHaveCount(0);

    await navigation.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search media' })).toBeVisible();
    await page.getByRole('tab', { name: 'Playlists', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search playlists' })).toBeVisible();
    await page.getByRole('tab', { name: 'Media', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search media' })).toBeVisible();

    await navigation.getByRole('button', { name: 'Storage', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Backup destinations', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add local folder…', exact: true }),
    ).toBeVisible();
    await electronApp.evaluate(({ dialog }, selectedPath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedPath] }),
      });
    }, backupRoot);
    await page.getByRole('button', { name: 'Add local folder…', exact: true }).click();
    await expect(page.getByRole('heading', { name: backupRoot, exact: true })).toBeVisible();
    await expect(page.getByText('AVAILABLE', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Global default quality')).toHaveValue('MAX_1080P');
    await expect(page.getByLabel('Managed tool diagnostics').getByText('Ready')).toHaveCount(2);
    await expect(
      page.getByLabel('Managed tool diagnostics').getByText('Google Drive'),
    ).toBeVisible();

    await navigation.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Activity', exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Backup and archive history', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('No backup runs match this view.', { exact: true })).toBeVisible();
    await expect(
      page.getByText('No archive events match this view.', { exact: true }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Active', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Active operations', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('No active operations', { exact: true })).toBeVisible();
    await captureActivityQa(page, 'active-empty-1120x760');
  } finally {
    await desktop.close();
  }
});

test('packaged Home starts a worker-backed backup and refreshes from the accepted run', async () => {
  const desktop = await launchPackagedDesktop({ prepareDatabase: seedPopulatedHome });
  try {
    const { page } = desktop;
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });

    await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'All intended copies are verified', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent backup outcomes' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Back up now', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Back up now' });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole('group', { name: 'Choose a channel' })).toBeVisible();
    await expect(chooser.getByRole('radio', { name: POPULATED_CHANNEL_TITLE })).toBeChecked();
    await chooser.getByRole('button', { name: 'Start backup', exact: true }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Activity', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Active', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const runs = await window.ytbm.listBackupRuns();
          return runs.map((run) => run.status);
        }),
      )
      .toEqual(['COMPLETED']);

    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.locator('.activity-history-row')).toHaveCount(1);
    await expect(page.locator('.activity-history-row').first()).toContainText(
      POPULATED_CHANNEL_TITLE,
    );
    await expect(page.locator('.activity-history-row').first()).toContainText('Completed');
    await captureActivityQa(page, 'history-1120x760');
    await page.locator('.activity-history-row').first().click();
    await expect(page.getByRole('dialog', { name: POPULATED_CHANNEL_TITLE })).toBeVisible();
    await captureActivityQa(page, 'run-details-overview-1120x760');
    await page.getByText('Technical details', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Run summary', exact: true })).toBeVisible();
    await captureActivityQa(page, 'run-details-technical-1120x760');
    await page.getByRole('button', { name: 'Close dialog' }).click();

    await navigation.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'All intended copies are verified', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Recent backup outcomes', exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('[aria-labelledby="home-recent-title"] .home-action-row'),
    ).toHaveCount(1);
    await expect(
      page.locator('[aria-labelledby="home-recent-title"] .home-action-row').first(),
    ).toContainText('Backup completed');
  } finally {
    await desktop.close();
  }
});

test('packaged Activity groups attention and opens fresh worker-backed operation details', async () => {
  const desktop = await launchPackagedDesktop({ prepareDatabase: seedActivityAttention });
  try {
    const { electronApp, page } = desktop;
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
    await navigation.getByRole('button', { name: 'Activity', exact: true }).click();
    await page.getByRole('tab', { name: /Needs attention/ }).click();

    await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible();
    await expect(page.getByText('Account authorization', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'This Google account must be reconnected before its archive work can continue.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('.activity-attention-group')).toHaveCount(1);
    await captureActivityQa(page, 'attention-1120x760');

    await page.getByRole('button', { name: 'Manage accounts', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
    await navigation.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Active', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.locator('.activity-operation__body').click();
    const details = page.getByRole('dialog', { name: 'Desktop Archive Video' });
    await expect(details).toBeVisible();
    await captureActivityQa(page, 'operation-details-overview-1120x760');
    await details.getByText('Technical details', { exact: true }).click();
    const failedUpload = details.getByRole('article').filter({ hasText: 'Upload to Google Drive' });
    await expect(failedUpload).toContainText('Failed');
    await captureActivityQa(page, 'operation-details-technical-1120x760');

    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('tab', { name: 'Active', exact: true }).click();
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(880, 620);
    });
    await expect
      .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
      .toEqual([880, 620]);
    await expect(
      page.getByRole('heading', { name: 'Active operations', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.activity-operation')).toContainText('Retry scheduled');
    await expect(page.locator('.activity-operation')).toContainText('Failed');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const root = document.scrollingElement;
          return root === null || root.scrollWidth <= root.clientWidth;
        }),
      )
      .toBe(true);
    await captureActivityQa(page, 'active-retrying-880x620');

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900);
    });
    await expect
      .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
      .toEqual([1440, 900]);
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.locator('.activity-history-row')).toHaveCount(1);
    await captureActivityQa(page, 'history-1440x900');
  } finally {
    await desktop.close();
  }
});
