import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { WorkerRpcClient, createUserScopedEndpoints } from '@ytbm/ipc';
import { RpcAuthTokenStore } from '@ytbm/security';

export interface PackagedDesktop {
  electronApp: ElectronApplication;
  page: Page;
  userData: string;
  localData: string;
  directory: string;
  close(): Promise<void>;
}

async function stopWorker(userData: string, localData: string): Promise<void> {
  const endpoints = createUserScopedEndpoints(join(localData, 'runtime'));
  const token = await new RpcAuthTokenStore(join(userData, 'worker-rpc.token')).loadOrCreate();
  const client = new WorkerRpcClient(endpoints.rpc, token);
  try {
    await client.waitUntilConnected(2_000);
    await expect(client.request('worker.shutdownIfIdle', {})).resolves.toEqual({ accepted: true });
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    client.close();
  }
}

async function diagnosticLog(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '(none)');
}

async function closeElectronApplication(
  electronApp: ElectronApplication,
  timeoutMs = 3_000,
): Promise<void> {
  const applicationProcess = electronApp.process();
  let closeSettled = false;
  const closePromise = electronApp
    .close()
    .catch(() => undefined)
    .finally(() => {
      closeSettled = true;
    });

  await Promise.race([
    closePromise,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  if (closeSettled || applicationProcess.exitCode !== null) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(applicationProcess.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  applicationProcess.kill('SIGKILL');
}

export async function launchPackagedDesktop(): Promise<PackagedDesktop> {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-electron-e2e-'));
  const userData = join(directory, 'user-data');
  const localData = join(directory, 'local-data');
  const executablePath = resolve(
    import.meta.dirname,
    '../release/win-unpacked/YouTube Backup Manager.exe',
  );
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.CHROME_CRASHPAD_PIPE_NAME;

  let electronApp: ElectronApplication;
  try {
    electronApp = await electron.launch({
      executablePath,
      args: ['--disable-gpu', '--disable-software-rasterizer'],
      timeout: 15_000,
      env: {
        ...environment,
        YTBM_ENVIRONMENT: 'test',
        YTBM_USER_DATA_PATH: userData,
        YTBM_LOCAL_DATA_PATH: localData,
        YTBM_DATABASE_PATH: join(userData, 'app.db'),
      },
    });
  } catch (error) {
    const [desktopLog, workerLog] = await Promise.all([
      diagnosticLog(join(localData, 'logs', 'desktop-main.jsonl')),
      diagnosticLog(join(localData, 'logs', 'worker.jsonl')),
    ]);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw new Error(
      `Packaged desktop could not launch. Desktop log: ${desktopLog}. Worker log: ${workerLog}`,
      { cause: error },
    );
  }
  let processOutput = '';
  const applicationProcess = electronApp.process();
  applicationProcess.stdout?.on('data', (chunk) => {
    processOutput += String(chunk);
  });
  applicationProcess.stderr?.on('data', (chunk) => {
    processOutput += String(chunk);
  });

  let page: Page;
  try {
    page = await electronApp.firstWindow({ timeout: 15_000 });
  } catch (error) {
    const [desktopLog, workerLog] = await Promise.all([
      diagnosticLog(join(localData, 'logs', 'desktop-main.jsonl')),
      diagnosticLog(join(localData, 'logs', 'worker.jsonl')),
    ]);
    await closeElectronApplication(electronApp);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw new Error(
      `Packaged desktop exited before creating a window. Process: ${processOutput || '(none)'}. Desktop log: ${desktopLog}. Worker log: ${workerLog}`,
      { cause: error },
    );
  }

  let closed = false;
  return {
    electronApp,
    page,
    userData,
    localData,
    directory,
    close: async () => {
      if (closed) return;
      closed = true;
      await stopWorker(userData, localData).catch(() => undefined);
      await closeElectronApplication(electronApp);
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
