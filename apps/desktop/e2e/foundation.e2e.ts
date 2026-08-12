import { mkdtemp, rm } from 'node:fs/promises';
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

test('packaged desktop renders the Phase 2 source catalog shell', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ytbm-electron-e2e-'));
  const userData = join(directory, 'user-data');
  const localData = join(directory, 'local-data');
  const executablePath = resolve(
    import.meta.dirname,
    '../release/win-unpacked/YouTube Backup Manager.exe',
  );
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({
    executablePath,
    env: {
      ...environment,
      YTBM_ENVIRONMENT: 'test',
      YTBM_USER_DATA_PATH: userData,
      YTBM_LOCAL_DATA_PATH: localData,
      YTBM_DATABASE_PATH: join(userData, 'app.db'),
    },
  });

  let workerStopped = false;
  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Google' })).toBeVisible();
    await expect(page.getByText('Worker ready')).toBeVisible();
    await page.getByRole('button', { name: 'Library' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search library' })).toBeVisible();
    await stopWorker(userData, localData);
    workerStopped = true;
  } finally {
    if (!workerStopped) {
      await stopWorker(userData, localData).catch(() => undefined);
    }
    await electronApp.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
