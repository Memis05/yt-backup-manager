import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { expect, test, type ElectronApplication } from '@playwright/test';

import { launchPackagedDesktop, type PackagedDesktopSeedContext } from './packaged-desktop';

const IDS = {
  channel: '00000000-0000-4000-8000-000000000201',
  playlist: '00000000-0000-4000-8000-000000000202',
  destination: '00000000-0000-4000-8000-000000000203',
  copy: '00000000-0000-4000-8000-000000000204',
} as const;

const MEDIA = [
  'Designing a durable archive',
  'Worker-owned catalog tour',
  'Restoring from a manifest',
  'Verifying local media',
  'Google Drive copy strategy',
  'Resumable backup planning',
  'Handling removed sources',
  'Inside the job engine',
] as const;

function mediaId(index: number): string {
  return `00000000-0000-4000-8000-${String(300 + index).padStart(12, '0')}`;
}

async function setWindowSize(
  electronApp: ElectronApplication,
  width: number,
  height: number,
): Promise<void> {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('Expected the desktop window to exist.');
      window.setSize(size.width, size.height);
    },
    { width, height },
  );
}

async function seedLibrary({ database, directory }: PackagedDesktopSeedContext): Promise<void> {
  const now = Date.now();
  const backupRoot = join(directory, 'Archive drive');
  const relativePath = join('Archive Studio', 'designing-a-durable-archive.webm');
  const bytes = Buffer.from('deterministic packaged Library fixture', 'utf8');
  await mkdir(join(backupRoot, 'Archive Studio'), { recursive: true });
  await writeFile(join(backupRoot, relativePath), bytes);

  database.sqlite.transaction(() => {
    database.sqlite
      .prepare(
        `insert into channels (
          id, source_provider, provider_channel_id, title, backup_enabled, source_status,
          first_seen_at, last_seen_at, last_sync_at, created_at, updated_at
        ) values (?, 'YOUTUBE', 'UClibrarye2e', 'Archive Studio', 1, 'AVAILABLE', ?, ?, ?, ?, ?)`,
      )
      .run(IDS.channel, now, now, now, now, now);
    database.sqlite
      .prepare(
        `insert into playlists (
          id, channel_id, source_provider, provider_playlist_id, title, source_status,
          first_seen_at, last_seen_at, created_at, updated_at
        ) values (?, ?, 'YOUTUBE', 'PLlibrarye2e', 'Research collection', 'AVAILABLE', ?, ?, ?, ?)`,
      )
      .run(IDS.playlist, IDS.channel, now, now, now, now);
    database.sqlite
      .prepare(
        `insert into destinations (
          id, destination_type, root_path, last_known_mount_path, enabled,
          availability_status, last_probe_at, created_at, updated_at
        ) values (?, 'FILESYSTEM', ?, ?, 1, 'AVAILABLE', ?, ?, ?)`,
      )
      .run(IDS.destination, backupRoot, backupRoot, now, now, now);

    const insertMedia = database.sqlite.prepare(
      `insert into media_items (
        id, channel_id, source_provider, provider_media_id, media_type, title, original_title,
        source_url, source_status, published_at, duration_seconds, first_seen_at, last_seen_at,
        metadata_version, created_at, updated_at
      ) values (?, ?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    );
    const insertMembership = database.sqlite.prepare(
      `insert into playlist_items (
        playlist_id, media_item_id, position, last_seen_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?)`,
    );
    for (const [index, title] of MEDIA.entries()) {
      const id = mediaId(index);
      const providerId = `library-e2e-${index + 1}`;
      insertMedia.run(
        id,
        IDS.channel,
        providerId,
        index === 6 ? 'SHORT' : 'VIDEO',
        title,
        title,
        `https://www.youtube.com/watch?v=${providerId}`,
        index === 6 ? 'REMOVED' : 'AVAILABLE',
        now - index * 86_400_000,
        420 + index * 35,
        now,
        now,
        now,
        now,
      );
      insertMembership.run(IDS.playlist, id, index, now, now, now);
    }

    database.sqlite
      .prepare(
        `insert into media_copies (
          id, media_item_id, destination_id, relative_path, container, video_codec, audio_codec,
          width, height, fps, bytes, sha256, quality_profile, content_generation,
          verification_strength, status, verified_at, last_checked_at, created_at, updated_at
        ) values (?, ?, ?, ?, 'webm', 'vp9', 'opus', 1920, 1080, 30, ?, ?, 'MAX_1080P',
          'library-e2e-generation', 'LOCAL_SHA256', 'VERIFIED', ?, ?, ?, ?)`,
      )
      .run(
        IDS.copy,
        mediaId(0),
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
}

test('packaged Library supports responsive media, playlist, and details journeys', async () => {
  test.setTimeout(60_000);
  const desktop = await launchPackagedDesktop({ prepareDatabase: seedLibrary });
  const screenshotDirectory = resolve('output/playwright/library-phase7b3');
  await mkdir(screenshotDirectory, { recursive: true });
  try {
    const { electronApp, page } = desktop;
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('button', {
        name: 'Library',
        exact: true,
      })
      .click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Library', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search media' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Open details for Designing a durable archive' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('.library-media-grid')
          .evaluate(
            (element) =>
              getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
          ),
      )
      .toBe(3);
    await page.screenshot({
      path: join(screenshotDirectory, 'library-media-1120x760.png'),
      animations: 'disabled',
    });

    await setWindowSize(electronApp, 1440, 900);
    await expect
      .poll(() =>
        page
          .locator('.library-media-grid')
          .evaluate(
            (element) =>
              getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
          ),
      )
      .toBe(4);
    await page.screenshot({
      path: join(screenshotDirectory, 'library-media-1440x900.png'),
      animations: 'disabled',
    });
    await setWindowSize(electronApp, 1120, 760);

    await page.getByRole('radio', { name: 'List' }).click();
    await expect(page.locator('.media-list')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const outlet = document.querySelector<HTMLElement>('.app-route-outlet');
          return outlet !== null && outlet.scrollWidth <= outlet.clientWidth;
        }),
      )
      .toBe(true);
    const search = page.getByRole('searchbox', { name: 'Search media' });
    await search.fill('manifest');
    await expect(
      page.getByRole('button', { name: 'Open details for Restoring from a manifest' }),
    ).toBeVisible();
    await search.fill('');
    await page.getByRole('radio', { name: 'Grid' }).click();

    const origin = page.getByRole('button', {
      name: 'Open details for Designing a durable archive',
    });
    await origin.click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Designing a durable archive' }),
    ).toBeVisible();
    await expect(page.getByText('1 verified copy', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open folder' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open YouTube/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Play media/i })).toHaveCount(0);
    await page.screenshot({
      path: join(screenshotDirectory, 'media-details-1120x760.png'),
      animations: 'disabled',
    });
    await page.getByText('Technical details', { exact: true }).click();
    await expect(page.getByText('library-e2e-1', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Library' }).click();
    await expect(origin).toBeFocused();

    await page.getByRole('tab', { name: 'Playlists', exact: true }).click();
    await page.getByRole('button', { name: /Research collection/ }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Research collection' }),
    ).toBeVisible();
    await expect(page.locator('.playlist-master')).toBeVisible();
    await expect(page.locator('.library-playlist-detail')).toBeVisible();

    await setWindowSize(electronApp, 880, 620);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1040);
    await expect(page.locator('.playlist-master')).toBeHidden();
    await expect(page.locator('.library-playlist-detail')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to playlists' })).toBeVisible();
    await page.screenshot({
      path: join(screenshotDirectory, 'playlist-detail-880x620.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Back to playlists' }).click();
    await expect(page.locator('.playlist-master')).toBeVisible();
    await expect(page.locator('.library-playlist-detail')).toBeHidden();
  } finally {
    await desktop.close();
  }
});
