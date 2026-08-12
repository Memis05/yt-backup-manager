import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';
import { WorkerRpcClient, createUserScopedEndpoints } from '@ytbm/ipc';
import { RpcAuthTokenStore } from '@ytbm/security';

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

test('packaged desktop renders the Phase 4 destination-aware backup shell', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-electron-e2e-'));
  const userData = join(directory, 'user-data');
  const localData = join(directory, 'local-data');
  const backupRoot = join(directory, 'backup-destination');
  const executablePath = resolve(
    import.meta.dirname,
    '../release/win-unpacked/YouTube Backup Manager.exe',
  );
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.CHROME_CRASHPAD_PIPE_NAME;
  const applicationEnvironment = {
    ...environment,
    YTBM_ENVIRONMENT: 'test',
    YTBM_USER_DATA_PATH: userData,
    YTBM_LOCAL_DATA_PATH: localData,
    YTBM_DATABASE_PATH: join(userData, 'app.db'),
  };
  const electronApp = await electron.launch({
    executablePath,
    args: ['--disable-gpu'],
    env: applicationEnvironment,
  });
  let processOutput = '';
  const applicationProcess = electronApp.process();
  applicationProcess.stdout?.on('data', (chunk) => {
    processOutput += String(chunk);
  });
  applicationProcess.stderr?.on('data', (chunk) => {
    processOutput += String(chunk);
  });

  let workerStopped = false;
  try {
    const page = await electronApp.firstWindow({ timeout: 15_000 }).catch(async (error) => {
      const desktopLog = await readFile(
        join(localData, 'logs', 'desktop-main.jsonl'),
        'utf8',
      ).catch(() => '(none)');
      const workerLog = await readFile(join(localData, 'logs', 'worker.jsonl'), 'utf8').catch(
        () => '(none)',
      );
      throw new Error(
        `Packaged desktop exited before creating a window. Process: ${processOutput || '(none)'}. Desktop log: ${desktopLog}. Worker log: ${workerLog}`,
        { cause: error },
      );
    });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backup health' })).toBeVisible();
    await page.getByRole('button', { name: 'Accounts' }).click();
    await expect(page.getByRole('button', { name: 'Connect Google' })).toBeVisible();
    await expect(page.getByText('Worker ready')).toBeVisible();
    await page.getByRole('button', { name: 'Library' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search library' })).toBeVisible();
    await page.getByRole('button', { name: 'Storage' }).click();
    await expect(page.getByRole('heading', { name: 'Backup destinations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add local folder…' })).toBeVisible();
    await electronApp.evaluate(({ dialog }, selectedPath) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedPath] }),
      });
    }, backupRoot);
    await page.getByRole('button', { name: 'Add local folder…' }).click();
    await expect(page.getByRole('heading', { name: backupRoot })).toBeVisible();
    await expect(page.getByText('AVAILABLE', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Global default quality')).toHaveValue('MAX_1080P');
    await expect(page.getByLabel('Managed tool diagnostics').getByText('Ready')).toHaveCount(2);
    await expect(
      page.getByLabel('Managed tool diagnostics').getByText('Google Drive'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Backup' }).click();
    await expect(page.getByRole('heading', { name: 'Channel backup' })).toBeVisible();
    await expect(page.getByText('No backup history')).toBeVisible();
    await page.getByRole('button', { name: 'Queue' }).click();
    await expect(page.getByRole('heading', { name: 'Backup activity' })).toBeVisible();
    await expect(page.getByRole('button', { name: '0 Active now' })).toBeVisible();
    await expect(page.getByRole('button', { name: '0 Waiting to download' })).toBeVisible();
    await expect(page.getByRole('button', { name: '0 Backed up' })).toBeVisible();
    await expect(page.getByText('Queue is empty')).toBeVisible();
    await stopWorker(userData, localData);
    workerStopped = true;
  } finally {
    if (!workerStopped) await stopWorker(userData, localData).catch(() => undefined);
    await electronApp.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
