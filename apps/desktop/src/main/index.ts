import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from 'electron';

import { WorkerRpcClient, createUserScopedEndpoints } from '@ytbm/ipc';
import type { AppSettings, InternalRoute } from '@ytbm/core';
import { resolveYtDlpExecutable } from '@ytbm/download-ytdlp';
import { resolveFfmpegExecutable } from '@ytbm/media-ffmpeg';
import { JsonLinesFileSink, RpcAuthTokenStore, StructuredLogger } from '@ytbm/security';
import {
  UnavailableWindowsTaskScheduler,
  WindowsTaskScheduler,
  PERIODIC_INTEGRITY_TASK_ID,
  validateScheduledExecutable,
} from '@ytbm/scheduler-windows';
import managedBinaries from '../../../../resources/managed-binaries.json';

import { loadDevelopmentEnvironment, loadRuntimeConfig } from '../config/runtime';
import { WorkerRuntime } from '../worker-bootstrap/runtime';
import { registerDesktopIpcHandlers } from './desktop-ipc';
import { secureWebContentsNavigation } from './external-navigation';
import { ElectronSafeStorageAdapter } from './safe-storage-adapter';
import { DesktopWorkerManager } from './worker-manager';
import { verifyManagedBinaryIntegrity } from './managed-binary-integrity';
import { createWindowOptions } from './window-options';

function runtimeConfig() {
  const localData = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'YouTubeBackupManager')
    : app.getPath('userData');
  return loadRuntimeConfig({ userData: app.getPath('userData'), localData });
}

function packagedExecutablePath(): string | null {
  if (!app.isPackaged) return null;
  return validateScheduledExecutable(process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath);
}

function scheduledScheduleId(): string | null {
  const index = process.argv.indexOf('--scheduled');
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (
    value === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error('A scheduled worker invocation requires a valid schedule ID.');
  }
  return value.toLowerCase();
}

function scheduledIntegrityId(): string | null {
  const index = process.argv.indexOf('--scheduled-integrity');
  if (index < 0) return null;
  const value = process.argv[index + 1]?.toLowerCase();
  if (value !== PERIODIC_INTEGRITY_TASK_ID) {
    throw new Error('A scheduled integrity invocation requires the app-owned maintenance ID.');
  }
  return value;
}

async function signalExistingScheduledWorker(scheduleId: string): Promise<void> {
  const config = runtimeConfig();
  const endpoints = createUserScopedEndpoints(config.paths.runtime);
  const token = await new RpcAuthTokenStore(config.paths.rpcToken).loadOrCreate();
  const client = new WorkerRpcClient(endpoints.rpc, token);
  try {
    await client.waitUntilConnected(2_000);
    await client.request('worker.scheduledWake', {
      scheduleId,
      requestedAt: new Date().toISOString(),
    });
  } finally {
    client.close();
  }
}

async function signalExistingIntegrityWorker(scheduleId: string): Promise<void> {
  const config = runtimeConfig();
  const endpoints = createUserScopedEndpoints(config.paths.runtime);
  const token = await new RpcAuthTokenStore(config.paths.rpcToken).loadOrCreate();
  const client = new WorkerRpcClient(endpoints.rpc, token);
  try {
    await client.waitUntilConnected(2_000);
    await client.request('worker.scheduledIntegrityWake', {
      scheduleId,
      requestedAt: new Date().toISOString(),
    });
  } finally {
    client.close();
  }
}

async function runWorker(): Promise<void> {
  await app.whenReady();
  const config = runtimeConfig();
  const scheduleId = scheduledScheduleId();
  const integrityId = scheduledIntegrityId();
  const mode =
    scheduleId !== null || integrityId !== null
      ? 'SCHEDULED'
      : process.argv.includes('--spawned-by-desktop')
        ? 'DESKTOP_SPAWNED'
        : 'DIRECT';
  const ytDlpExecutable = resolveYtDlpExecutable({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    developmentOverride: config.ytDlpExecutableOverride,
  });
  const ffmpegExecutable = resolveFfmpegExecutable({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    developmentOverride: config.ffmpegExecutableOverride,
  });
  if (app.isPackaged) {
    await verifyManagedBinaryIntegrity([
      { name: 'yt-dlp', path: ytDlpExecutable, expectedSha256: managedBinaries.ytDlp.sha256 },
      { name: 'FFmpeg', path: ffmpegExecutable, expectedSha256: managedBinaries.ffmpeg.sha256 },
    ]);
  }
  const runtime = new WorkerRuntime({
    config,
    version: app.getVersion(),
    mode,
    encryption: new ElectronSafeStorageAdapter(),
    onShutdownRequested: () => app.quit(),
    ytDlpExecutable,
    ffmpegExecutable,
    schedulerAdapter:
      app.isPackaged && process.platform === 'win32'
        ? new WindowsTaskScheduler()
        : new UnavailableWindowsTaskScheduler(),
    scheduledExecutablePath: packagedExecutablePath(),
    scheduledScheduleId: scheduleId,
    scheduledIntegrityId: integrityId,
  });
  const started = await runtime.start();
  if (!started) {
    if (mode === 'SCHEDULED' && scheduleId !== null) {
      await signalExistingScheduledWorker(scheduleId).catch(() => undefined);
    } else if (mode === 'SCHEDULED' && integrityId !== null) {
      await signalExistingIntegrityWorker(integrityId).catch(() => undefined);
    }
    app.quit();
    return;
  }

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
    app.exit(0);
  };
  app.on('before-quit', (event) => {
    if (!stopping) {
      event.preventDefault();
      void stop();
    }
  });
}

async function runDesktop(): Promise<void> {
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) {
    app.quit();
    return;
  }

  await app.whenReady();
  const config = runtimeConfig();
  const logger = new StructuredLogger(
    'desktop-main',
    new JsonLinesFileSink(join(config.paths.logs, 'desktop-main.jsonl')),
  );
  const workerManager = new DesktopWorkerManager(app, config, logger);
  let worker: WorkerRpcClient;
  try {
    worker = await workerManager.connect();
  } catch (error) {
    logger.error('Desktop startup could not connect to the backup worker', {
      exceptionType: error instanceof Error ? error.name : typeof error,
    });
    dialog.showErrorBox(
      'YouTube Backup Manager could not start',
      `The background backup worker could not start. Close any existing app processes and try again. Diagnostic logs are available at:\n${config.paths.logs}`,
    );
    workerManager.disconnect();
    app.quit();
    return;
  }
  let settings = await worker.request('settings.get', {});
  let quitting = false;
  const applySystemSettings = (next: AppSettings): void => {
    settings = next;
    if (app.isPackaged && process.platform === 'win32') {
      const executablePath = packagedExecutablePath();
      if (executablePath === null) return;
      app.setLoginItemSettings({
        openAtLogin: next.startWithWindows,
        path: executablePath,
        args: ['--start-minimized'],
      });
    }
  };
  applySystemSettings(settings);
  const window = new BrowserWindow(
    createWindowOptions(join(import.meta.dirname, '../preload/index.cjs')),
  );
  const unregisterIpc = registerDesktopIpcHandlers(
    ipcMain,
    worker,
    async (url) => {
      await shell.openExternal(url);
    },
    async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Choose a local backup destination',
        buttonLabel: 'Select folder',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    async () => {
      const failure = await shell.openPath(config.paths.logs);
      if (failure !== '') throw new Error('The application log folder could not be opened.');
    },
    async (path) => {
      const failure = await shell.openPath(path);
      if (failure !== '') throw new Error('The verified backup folder could not be opened.');
    },
    (event) => {
      if (event === null || typeof event !== 'object' || !('senderFrame' in event)) return false;
      return event.senderFrame === window.webContents.mainFrame;
    },
    applySystemSettings,
  );

  secureWebContentsNavigation(window.webContents);
  const openWindow = (route?: InternalRoute): void => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    if (route !== undefined) window.webContents.send('ytbm:internal-route', route);
  };
  window.once('ready-to-show', () => {
    if (!settings.startMinimized && !process.argv.includes('--start-minimized')) window.show();
  });

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl !== undefined) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }

  const trayIcon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAJ0lEQVR42mNgGAWjYBSMglEwCkbB////D6MZGBgYGRkZGZgYGBgAAEwSAf4uJc8AAAAASUVORK5CYII=',
  );
  const tray = new Tray(trayIcon);
  tray.setToolTip('YouTube Backup Manager');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: () => openWindow() },
      {
        label: 'Backup now',
        click: () => {
          void worker
            .request('channels.list', { accountId: null, selectedOnly: true })
            .then(async ({ channels }) => {
              for (const channel of channels)
                await worker.request(
                  'backup.start',
                  { channelId: channel.id },
                  { timeoutMs: 5 * 60_000 },
                );
            })
            .catch(() => undefined);
        },
      },
      {
        label: 'Pause active work',
        click: () => {
          void worker
            .request('backup.runs', {})
            .then(async ({ runs }) => {
              for (const run of runs.filter((entry) => entry.status === 'RUNNING')) {
                await worker.request('backup.controlRun', { runId: run.id, action: 'PAUSE' });
              }
            })
            .catch(() => undefined);
        },
      },
      {
        label: 'Resume paused work',
        click: () => {
          void worker
            .request('backup.runs', {})
            .then(async ({ runs }) => {
              for (const run of runs.filter((entry) => entry.status === 'PAUSED')) {
                await worker.request('backup.controlRun', { runId: run.id, action: 'RESUME' });
              }
            })
            .catch(() => undefined);
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: async () => {
          quitting = true;
          await worker.request('worker.shutdownWhenIdle', {}).catch(() => undefined);
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => openWindow());

  window.on('close', (event) => {
    if (!quitting && settings.keepRunningInTray) {
      event.preventDefault();
      window.hide();
    }
  });

  const deliverNotifications = async (): Promise<void> => {
    if (!Notification.isSupported()) return;
    const { notifications } = await worker.request('notifications.pending', {});
    const delivered: string[] = [];
    for (const item of notifications) {
      const notification = new Notification({ title: item.title, body: item.body, silent: false });
      notification.on('click', () => openWindow(item.route));
      notification.show();
      delivered.push(item.id);
    }
    if (delivered.length > 0) {
      await worker.request('notifications.ack', { notificationIds: delivered });
    }
  };
  const notificationTimer = setInterval(
    () => void deliverNotifications().catch(() => undefined),
    5_000,
  );
  notificationTimer.unref();
  void deliverNotifications().catch(() => undefined);
  void worker
    .request('schedules.triggerStartup', { requestedAt: new Date().toISOString() })
    .catch(() => undefined);

  app.on('second-instance', () => {
    openWindow();
  });
  app.on('before-quit', () => {
    quitting = true;
    clearInterval(notificationTimer);
    tray.destroy();
    unregisterIpc();
    workerManager.disconnect();
  });
  app.on('window-all-closed', () => {
    if (!settings.keepRunningInTray) {
      quitting = true;
      void worker
        .request('worker.shutdownWhenIdle', {})
        .catch(() => undefined)
        .finally(() => app.quit());
    }
  });
}

loadDevelopmentEnvironment({ isPackaged: app.isPackaged, appPath: app.getAppPath() });

const configuredUserData = process.env.YTBM_USER_DATA_PATH;
if (configuredUserData !== undefined && configuredUserData.trim() !== '') {
  app.setPath('userData', configuredUserData);
}

const workerMode = process.argv.includes('--worker');
if (workerMode || process.env.YTBM_ENVIRONMENT === 'test') {
  app.disableHardwareAcceleration();
}
if (workerMode) {
  void runWorker();
} else {
  void runDesktop();
}
