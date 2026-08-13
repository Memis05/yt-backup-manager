import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { launchPackagedDesktop } from './packaged-desktop';

const PRIMARY_DESTINATIONS = [
  'Home',
  'Library',
  'Channels',
  'Activity',
  'Storage',
  'Integrity',
  'Settings',
] as const;

const FORMER_PRIMARY_DESTINATIONS = [
  'Dashboard',
  'Accounts',
  'Playlists',
  'Backup',
  'Queue',
  'Recovery',
] as const;

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

async function sidebarWidth(page: Page): Promise<number> {
  return page.locator('.app-sidebar').evaluate((element) => element.getBoundingClientRect().width);
}

test('packaged desktop exposes the native window chrome and exact application shell', async () => {
  const desktop = await launchPackagedDesktop();
  try {
    const { electronApp, page } = desktop;
    const titlebar = page.getByTestId('app-titlebar');
    const navigation = page.getByRole('navigation', { name: 'Primary navigation' });

    await expect(titlebar).toBeVisible();
    await expect(titlebar).toContainText('YouTube Backup Manager');
    await expect(titlebar).toHaveCSS('height', '40px');
    await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible();

    await expect(navigation.getByRole('button')).toHaveCount(PRIMARY_DESTINATIONS.length);
    await expect(
      navigation
        .locator('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
    ).resolves.toEqual(PRIMARY_DESTINATIONS);
    await expect(navigation.getByRole('group', { name: 'Archive' })).toBeVisible();
    await expect(navigation.getByRole('group', { name: 'Operations' })).toBeVisible();
    for (const label of FORMER_PRIMARY_DESTINATIONS) {
      await expect(navigation.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }

    await expect(
      electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu() === null),
    ).resolves.toBe(true);
    await page.keyboard.press('Alt');
    await expect(page.getByText('File', { exact: true })).toHaveCount(0);
    await expect(
      electronApp.evaluate(({ Menu }) => Menu.getApplicationMenu() === null),
    ).resolves.toBe(true);
    const windowState = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error('Expected the desktop window to exist.');
      return {
        size: window.getSize(),
        minimumSize: window.getMinimumSize(),
        resizable: window.isResizable(),
        maximizable: window.isMaximizable(),
      };
    });
    expect(windowState).toEqual({
      size: [1120, 760],
      minimumSize: [880, 620],
      resizable: true,
      maximizable: true,
    });
    const rendererBoundary = await page.evaluate(() => {
      const rendererGlobal = globalThis as typeof globalThis & {
        ipcRenderer?: unknown;
        process?: unknown;
        require?: unknown;
      };
      return {
        ipcRendererExposed: rendererGlobal.ipcRenderer !== undefined,
        processExposed: rendererGlobal.process !== undefined,
        requireExposed: rendererGlobal.require !== undefined,
        narrowApiExposed: typeof window.ytbm.getFoundationStatus === 'function',
      };
    });
    expect(rendererBoundary).toEqual({
      ipcRendererExposed: false,
      processExposed: false,
      requireExposed: false,
      narrowApiExposed: true,
    });

    const overlayState = await page.evaluate(() => {
      interface WindowControlsOverlayLike {
        visible: boolean;
        getTitlebarAreaRect(): DOMRect;
      }
      const overlay = (
        navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }
      ).windowControlsOverlay;
      if (overlay === undefined) return { supported: false, visible: false, height: 0 };
      return {
        supported: true,
        visible: overlay.visible,
        height: overlay.getTitlebarAreaRect().height,
      };
    });
    expect(overlayState).toEqual({ supported: true, visible: true, height: 40 });

    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.maximize());
    await expect
      .poll(() =>
        electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false,
        ),
      )
      .toBe(true);
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore());
    await expect
      .poll(() =>
        electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false,
        ),
      )
      .toBe(false);

    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize());
    await expect
      .poll(() =>
        electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized() ?? false,
        ),
      )
      .toBe(true);
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.restore();
      window?.show();
      window?.focus();
    });
    await expect(titlebar).toBeVisible();

    expect(await sidebarWidth(page)).toBe(208);
    await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeHidden();

    await setWindowSize(electronApp, 880, 620);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1040);
    await expect.poll(() => sidebarWidth(page)).toBe(64);
    await expect(navigation.locator('.app-nav-item__label').first()).toBeHidden();
    const expandNavigation = page.getByRole('button', { name: 'Expand navigation' });
    await expect(expandNavigation).toBeVisible();
    await expandNavigation.click();
    await expect.poll(() => sidebarWidth(page)).toBe(208);
    await expect(navigation.locator('.app-nav-item__label').first()).toBeVisible();
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect.poll(() => sidebarWidth(page)).toBe(64);

    await setWindowSize(electronApp, 1120, 760);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1040);
    await expect.poll(() => sidebarWidth(page)).toBe(208);
    await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeHidden();

    for (const label of PRIMARY_DESTINATIONS) {
      const destination = navigation.getByRole('button', { name: label, exact: true });
      await destination.click();
      await expect(destination).toHaveAttribute('aria-current', 'page');
      await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible();
    }

    await navigation.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Media', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Playlists', exact: true })).toBeVisible();
    await navigation.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Active', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'History', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Needs attention', exact: true })).toBeVisible();

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          return window === undefined
            ? { exists: false, visible: false }
            : { exists: !window.isDestroyed(), visible: window.isVisible() };
        }),
      )
      .toEqual({ exists: true, visible: false });
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.show();
      window?.focus();
    });
    await expect
      .poll(() =>
        electronApp.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false,
        ),
      )
      .toBe(true);
    await expect(titlebar).toBeVisible();
  } finally {
    await desktop.close();
  }
});
