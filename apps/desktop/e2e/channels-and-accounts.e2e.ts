import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';
import { DrizzleGoogleAccountRepository, SchedulingRepository } from '@ytbm/database/worker';

import { launchPackagedDesktop, type PackagedDesktopSeedContext } from './packaged-desktop';

const IDS = {
  channel: '00000000-0000-4000-8000-000000000401',
  destination: '00000000-0000-4000-8000-000000000402',
  media: '00000000-0000-4000-8000-000000000403',
  copy: '00000000-0000-4000-8000-000000000404',
} as const;

async function setWindowSize(
  electronApp: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error('Expected the desktop window to exist.');
      window.setSize(size.width, size.height);
    },
    { width, height },
  );
}

async function seedChannelsAndAccounts({
  database,
  directory,
}: PackagedDesktopSeedContext): Promise<void> {
  const now = Date.now();
  const backupRoot = join(directory, 'stage-6-archive');
  const relativePath = join('Archive Studio', 'existing-1080p-copy.webm');
  const bytes = Buffer.from('deterministic Stage 6 verified copy', 'utf8');
  await mkdir(join(backupRoot, 'Archive Studio'), { recursive: true });
  await writeFile(join(backupRoot, relativePath), bytes);

  const accounts = new DrizzleGoogleAccountRepository(database);
  const owner = await accounts.upsertConnectedAccount({
    providerAccountId: 'stage-6-owner',
    email: 'owner@example.test',
    displayName: 'Archive Owner',
    avatarUrl: null,
    credentialRef: 'google-oauth:stage-6-owner-youtube',
    grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    capability: 'YOUTUBE',
    connectedAt: now,
  });
  await accounts.upsertConnectedAccount({
    providerAccountId: 'stage-6-owner',
    email: 'owner@example.test',
    displayName: 'Archive Owner',
    avatarUrl: null,
    credentialRef: 'google-oauth:stage-6-owner-drive',
    grantedScopes: ['https://www.googleapis.com/auth/drive.file'],
    capability: 'GOOGLE_DRIVE',
    connectedAt: now,
  });
  const editor = await accounts.upsertConnectedAccount({
    providerAccountId: 'stage-6-editor',
    email: 'editor@example.test',
    displayName: 'Studio Editor',
    avatarUrl: null,
    credentialRef: 'google-oauth:stage-6-editor-youtube',
    grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    capability: 'YOUTUBE',
    connectedAt: now + 1,
  });

  database.sqlite.transaction(() => {
    database.sqlite
      .prepare(
        `insert into channels (
          id, source_provider, provider_channel_id, title, handle, backup_enabled, source_status,
          first_seen_at, last_seen_at, last_sync_at, created_at, updated_at
        ) values (?, 'YOUTUBE', 'UCstage6shared', 'Archive Studio', '@archivestudio', 1,
          'AVAILABLE', ?, ?, ?, ?, ?)`,
      )
      .run(IDS.channel, now, now, now, now, now);
    database.sqlite
      .prepare(
        `insert into account_channels (account_id, channel_id, relationship_metadata_json, created_at)
         values (?, ?, '{}', ?), (?, ?, '{}', ?)`,
      )
      .run(owner.id, IDS.channel, now, editor.id, IDS.channel, now);
    database.sqlite
      .prepare(
        `insert into destinations (
          id, destination_type, root_path, last_known_mount_path, enabled,
          availability_status, last_probe_at, created_at, updated_at
        ) values (?, 'FILESYSTEM', ?, ?, 1, 'AVAILABLE', ?, ?, ?)`,
      )
      .run(IDS.destination, backupRoot, backupRoot, now, now, now);
    database.sqlite
      .prepare(
        `insert into channel_destinations (
          channel_id, destination_id, enabled, created_at, updated_at
        ) values (?, ?, 1, ?, ?)`,
      )
      .run(IDS.channel, IDS.destination, now, now);
    database.sqlite
      .prepare(
        `insert into channel_settings (
          channel_id, quality_profile_override, created_at, updated_at
        ) values (?, 'MAX_1080P', ?, ?)`,
      )
      .run(IDS.channel, now, now);
    database.sqlite
      .prepare(
        `insert into media_items (
          id, channel_id, source_provider, provider_media_id, media_type, title, original_title,
          source_url, source_status, published_at, duration_seconds, first_seen_at, last_seen_at,
          metadata_version, created_at, updated_at
        ) values (?, ?, 'YOUTUBE', 'stage-6-media', 'VIDEO', 'Existing 1080p copy',
          'Existing 1080p copy', 'https://www.youtube.com/watch?v=stage6media', 'AVAILABLE',
          ?, 600, ?, ?, 1, ?, ?)`,
      )
      .run(IDS.media, IDS.channel, now - 86_400_000, now, now, now, now);
    database.sqlite
      .prepare(
        `insert into media_copies (
          id, media_item_id, destination_id, relative_path, container, video_codec, audio_codec,
          width, height, fps, bytes, sha256, quality_profile, content_generation,
          verification_strength, status, verified_at, last_checked_at, created_at, updated_at
        ) values (?, ?, ?, ?, 'webm', 'vp9', 'opus', 1920, 1080, 30, ?, ?, 'MAX_1080P',
          'stage-6-generation', 'LOCAL_SHA256', 'VERIFIED', ?, ?, ?, ?)`,
      )
      .run(
        IDS.copy,
        IDS.media,
        IDS.destination,
        relativePath,
        bytes.byteLength,
        createHash('sha256').update(bytes).digest('hex'),
        now,
        now,
        now,
        now,
      );
  })();

  new SchedulingRepository(database, () => now).upsert(
    {
      id: null,
      channelId: IDS.channel,
      enabled: true,
      frequency: 'DAILY',
      localTime: '03:00',
      weekday: null,
      everyHours: null,
      catchUp: true,
      backupOnStartup: false,
    },
    'Europe/Sarajevo',
  );
}

test('packaged Channels and Settings Accounts support truthful Stage 6 journeys', async () => {
  test.setTimeout(60_000);
  const desktop = await launchPackagedDesktop({ prepareDatabase: seedChannelsAndAccounts });
  const screenshotDirectory = resolve('output/playwright/channels-accounts-phase7b4');
  await mkdir(screenshotDirectory, { recursive: true });
  try {
    const { electronApp, page } = desktop;
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Channels', exact: true })
      .click();

    await setWindowSize(electronApp, 1120, 760);
    await expect(page.getByRole('heading', { level: 1, name: 'Channels' })).toBeVisible();
    await expect(page.getByText('Archive Studio', { exact: true })).toHaveCount(1);
    await expect(page.getByText('1 destination', { exact: true })).toBeVisible();
    await expect(page.getByText('Daily at 03:00', { exact: true })).toBeVisible();
    await page.screenshot({
      path: join(screenshotDirectory, 'channels-1120x760.png'),
      animations: 'disabled',
    });

    await setWindowSize(electronApp, 880, 620);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const outlet = document.querySelector<HTMLElement>('.app-route-outlet');
          return outlet !== null && outlet.scrollWidth <= outlet.clientWidth;
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.getByRole('button', { name: 'Back up now' }).evaluate((button) => {
          const label = button.querySelector<HTMLElement>('.ui-button__label');
          return label ? getComputedStyle(label).whiteSpace : null;
        }),
      )
      .toBe('nowrap');
    await page.screenshot({
      path: join(screenshotDirectory, 'channels-880x620.png'),
      animations: 'disabled',
    });

    await setWindowSize(electronApp, 1440, 900);
    await page.screenshot({
      path: join(screenshotDirectory, 'channels-1440x900.png'),
      animations: 'disabled',
    });
    await setWindowSize(electronApp, 1120, 760);

    await page.getByText('Archive Studio', { exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.screenshot({
      path: join(screenshotDirectory, 'channel-overview-1120x760.png'),
      animations: 'disabled',
    });
    await page.getByRole('tab', { name: 'Backup' }).click();
    await page.screenshot({
      path: join(screenshotDirectory, 'channel-backup-1120x760.png'),
      animations: 'disabled',
    });
    await page.getByRole('combobox', { name: 'Quality for future copies' }).click();
    await page.getByRole('option', { name: 'Up to 4K' }).click();
    const qualityDialog = page.getByRole('dialog', { name: 'Apply channel quality' });
    await expect(qualityDialog.getByText('1 media item and 1 verified copy')).toBeVisible();
    await expect(qualityDialog.getByText('Existing-copy upgrade is not available')).toBeVisible();
    await expect(qualityDialog.getByRole('button', { name: /upgrade existing/i })).toHaveCount(0);
    await qualityDialog.getByRole('button', { name: 'Apply to new media' }).click();
    await expect
      .poll(() =>
        page.evaluate((channelId) => window.ytbm.getChannelBackupSettings(channelId), IDS.channel),
      )
      .toMatchObject({ qualityProfileOverride: 'MAX_4K' });

    await page.getByRole('tab', { name: 'Schedule' }).click();
    await expect(page.getByText('Channel schedule', { exact: true })).toBeVisible();
    await page.screenshot({
      path: join(screenshotDirectory, 'channel-schedule-1120x760.png'),
      animations: 'disabled',
    });
    await page.getByRole('tab', { name: 'Source' }).click();
    await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();
    await expect(page.getByText('editor@example.test', { exact: true })).toBeVisible();
    await page.screenshot({
      path: join(screenshotDirectory, 'channel-source-1120x760.png'),
      animations: 'disabled',
    });
    await setWindowSize(electronApp, 880, 620);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1040);
    await page.screenshot({
      path: join(screenshotDirectory, 'channel-source-880x620.png'),
      animations: 'disabled',
    });

    await page.getByRole('button', { name: 'Manage accounts' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Settings category' })).toBeVisible();
    await expect(page.getByText('YouTube read-only', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Connect Drive' })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const outlet = document.querySelector<HTMLElement>('.app-route-outlet');
          return outlet !== null && outlet.scrollWidth <= outlet.clientWidth;
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: join(screenshotDirectory, 'accounts-880x620.png'),
      animations: 'disabled',
    });

    await setWindowSize(electronApp, 1120, 760);
    await expect(page.getByRole('navigation', { name: 'Settings categories' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Settings category' })).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const outlet = document.querySelector<HTMLElement>('.app-route-outlet');
          return outlet !== null && outlet.scrollWidth <= outlet.clientWidth;
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: join(screenshotDirectory, 'accounts-1120x760.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'More actions for Archive Owner' }).click();
    await page.getByRole('menuitem', { name: 'Disconnect account' }).click();
    const disconnectDialog = page.getByRole('dialog', { name: 'Disconnect Google account?' });
    await expect(disconnectDialog.getByText(/verified backup files are kept/i)).toBeVisible();
    await expect(
      disconnectDialog.getByText(/Google Drive objects.*are not deleted/i),
    ).toBeVisible();
    await page.screenshot({
      path: join(screenshotDirectory, 'account-disconnect-1120x760.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');

    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Channels', exact: true })
      .click();
    await page.getByText('Archive Studio', { exact: true }).click();
    await page.getByRole('tab', { name: 'Source' }).click();
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('button', { name: 'Channels', exact: true })
      .click();
    await page.getByText('Archive Studio', { exact: true }).click();
    await page.getByRole('tab', { name: 'Backup' }).click();
    await expect(page.getByRole('combobox', { name: 'Quality for future copies' })).toHaveText(
      'Up to 4K',
    );
    await page.getByRole('tab', { name: 'Source' }).click();
    await page.getByRole('button', { name: 'Refresh source' }).click();
    await expect(
      page.getByText(
        /(Source refresh queued|Refreshing (media|playlists|reconciling)|Trying source refresh again)/i,
      ),
    ).toBeVisible();
  } finally {
    await desktop.close();
  }
});
