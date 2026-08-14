import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import {
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '@ytbm/database/worker';

export interface PackagedDesktop {
  electronApp: ElectronApplication;
  page: Page;
  userData: string;
  localData: string;
  directory: string;
  close(): Promise<void>;
}

export interface PackagedDesktopSeedContext {
  database: WorkerDatabase;
  directory: string;
  userData: string;
  localData: string;
}

export interface PackagedDesktopOptions {
  prepareDatabase?(context: PackagedDesktopSeedContext): Promise<void> | void;
}

async function diagnosticLog(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '(none)');
}

async function closeElectronApplication(
  electronApp: ElectronApplication,
  timeoutMs = 3_000,
): Promise<void> {
  let applicationProcess: ReturnType<ElectronApplication['process']>;
  try {
    applicationProcess = electronApp.process();
  } catch {
    return;
  }
  if (process.platform === 'win32') {
    if (applicationProcess.exitCode === null) {
      const exited = new Promise<void>((resolve) => {
        applicationProcess.once('exit', () => resolve());
      });
      await electronApp
        .evaluate(({ app }) => {
          app.quit();
        })
        .catch(() => undefined);
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
      if (applicationProcess.exitCode === null) applicationProcess.kill();
    }
    return;
  }
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

  applicationProcess.kill('SIGKILL');
}

export async function launchPackagedDesktop(
  options: PackagedDesktopOptions = {},
): Promise<PackagedDesktop> {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-electron-e2e-'));
  const userData = join(directory, 'user-data');
  const localData = join(directory, 'local-data');
  if (options.prepareDatabase !== undefined) {
    const database = openWorkerDatabase({
      databasePath: join(userData, 'app.db'),
      ownership: acquireWorkerDatabaseOwnership(),
      migrationsFolder: resolve(import.meta.dirname, '../../../packages/database/drizzle'),
    });
    try {
      await options.prepareDatabase({ database, directory, userData, localData });
    } catch (error) {
      database.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      throw error;
    }
    database.close();
  }
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
      args: ['--disable-gpu', '--in-process-gpu', '--no-sandbox'],
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
      await closeElectronApplication(electronApp);
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
