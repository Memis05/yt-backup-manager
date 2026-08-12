import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { WorkerRpcClient, createUserScopedEndpoints } from '@ytbm/ipc';
import { JsonLinesFileSink, RpcAuthTokenStore, StructuredLogger } from '@ytbm/security';

import { loadDevelopmentEnvironment, loadRuntimeConfig } from '../config/runtime';
import { WorkerRuntime } from '../worker-bootstrap/runtime';
import { registerDesktopIpcHandlers } from './desktop-ipc';
import { secureWebContentsNavigation } from './external-navigation';
import { ElectronSafeStorageAdapter } from './safe-storage-adapter';
import { DesktopWorkerManager } from './worker-manager';
import { createWindowOptions } from './window-options';

function runtimeConfig() {
  const localData = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'YouTubeBackupManager')
    : app.getPath('userData');
  return loadRuntimeConfig({ userData: app.getPath('userData'), localData });
}

async function signalExistingScheduledWorker(): Promise<void> {
  const config = runtimeConfig();
  const endpoints = createUserScopedEndpoints(config.paths.runtime);
  const token = await new RpcAuthTokenStore(config.paths.rpcToken).loadOrCreate();
  const client = new WorkerRpcClient(endpoints.rpc, token);
  try {
    await client.waitUntilConnected(2_000);
    await client.request('worker.scheduledWake', { requestedAt: new Date().toISOString() });
  } finally {
    client.close();
  }
}

async function runWorker(): Promise<void> {
  await app.whenReady();
  const mode = process.argv.includes('--scheduled')
    ? 'SCHEDULED'
    : process.argv.includes('--spawned-by-desktop')
      ? 'DESKTOP_SPAWNED'
      : 'DIRECT';
  const runtime = new WorkerRuntime({
    config: runtimeConfig(),
    version: app.getVersion(),
    mode,
    encryption: new ElectronSafeStorageAdapter(),
    onShutdownRequested: () => app.quit(),
  });
  const started = await runtime.start();
  if (!started) {
    if (mode === 'SCHEDULED') await signalExistingScheduledWorker();
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
  const worker = await workerManager.connect();
  const unregisterIpc = registerDesktopIpcHandlers(
    ipcMain,
    worker,
    async (url) => {
      await shell.openExternal(url);
    },
    async () => {
      const failure = await shell.openPath(config.paths.logs);
      if (failure !== '') throw new Error('The application log folder could not be opened.');
    },
  );

  const window = new BrowserWindow(
    createWindowOptions(join(import.meta.dirname, '../preload/index.cjs')),
  );
  secureWebContentsNavigation(window.webContents);
  window.once('ready-to-show', () => window.show());

  const developmentUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentUrl !== undefined) {
    await window.loadURL(developmentUrl);
  } else {
    await window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }

  app.on('second-instance', () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('before-quit', () => {
    unregisterIpc();
    workerManager.disconnect();
  });
  app.on('window-all-closed', () => app.quit());
}

loadDevelopmentEnvironment({ isPackaged: app.isPackaged, appPath: app.getAppPath() });

const configuredUserData = process.env.YTBM_USER_DATA_PATH;
if (configuredUserData !== undefined && configuredUserData.trim() !== '') {
  app.setPath('userData', configuredUserData);
}

const workerMode = process.argv.includes('--worker');
if (workerMode) {
  app.disableHardwareAcceleration();
  void runWorker();
} else {
  void runDesktop();
}
