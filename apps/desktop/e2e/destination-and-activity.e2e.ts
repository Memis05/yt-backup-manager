import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { launchPackagedDesktop } from './packaged-desktop';

test('packaged desktop preserves setup, destination, library, and activity journeys', async () => {
  const desktop = await launchPackagedDesktop();
  const backupRoot = join(desktop.directory, 'backup-destination');
  try {
    const { electronApp, page } = desktop;
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });

    await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backup health', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Set up new backup', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Settings', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Accounts', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Google', exact: true })).toBeVisible();
    await expect(page.getByText('Worker ready', { exact: true })).toHaveCount(0);

    await navigation.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search library' })).toBeVisible();
    await page.getByRole('tab', { name: 'Playlists', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search playlists' })).toBeVisible();
    await page.getByRole('tab', { name: 'Media', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search library' })).toBeVisible();

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
