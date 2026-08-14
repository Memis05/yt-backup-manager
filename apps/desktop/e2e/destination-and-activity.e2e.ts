import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { DrizzleGoogleAccountRepository } from '@ytbm/database/worker';
import { channelRelativeDirectory, mediaRelativeDirectory } from '@ytbm/storage-filesystem';

import { launchPackagedDesktop, type PackagedDesktopSeedContext } from './packaged-desktop';

const POPULATED_CHANNEL_TITLE = 'Desktop Archive Channel';

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
    await expect(page.getByRole('heading', { name: 'Backup history', exact: true })).toBeVisible();
    await expect(page.getByText('No backup history', { exact: true })).toBeVisible();
    await expect(page.getByText('No backed-up media', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Active', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Backup activity', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '0 Active now', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: '0 Waiting to download', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '0 Backed up', exact: true })).toBeVisible();
    await expect(page.getByText('Queue is empty', { exact: true })).toBeVisible();
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
    await expect(page.locator('.run-row')).toHaveCount(1);
    await expect(page.locator('.run-row').first()).toContainText(POPULATED_CHANNEL_TITLE);
    await expect(page.locator('.run-row').first()).toContainText('COMPLETED');

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
