import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadDevelopmentEnvironment, loadRuntimeConfig } from '../src/config/runtime';

const directories: string[] = [];
const originalClientId = process.env.YTBM_GOOGLE_OAUTH_CLIENT_ID;
const originalClientSecret = process.env.YTBM_GOOGLE_OAUTH_CLIENT_SECRET;

afterEach(async () => {
  if (originalClientId === undefined) delete process.env.YTBM_GOOGLE_OAUTH_CLIENT_ID;
  else process.env.YTBM_GOOGLE_OAUTH_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.YTBM_GOOGLE_OAUTH_CLIENT_SECRET;
  else process.env.YTBM_GOOGLE_OAUTH_CLIENT_SECRET = originalClientSecret;
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('development environment configuration', () => {
  it('loads the repository .env when Electron runs from apps/desktop', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'ytbm-runtime-config-'));
    directories.push(repository);
    const appPath = join(repository, 'apps', 'desktop');
    await mkdir(appPath, { recursive: true });
    await writeFile(
      join(repository, '.env'),
      [
        'YTBM_GOOGLE_OAUTH_CLIENT_ID=test-client.apps.googleusercontent.com',
        'YTBM_GOOGLE_OAUTH_CLIENT_SECRET=test-client-secret',
        '',
      ].join('\n'),
      'utf8',
    );
    delete process.env.YTBM_GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.YTBM_GOOGLE_OAUTH_CLIENT_SECRET;

    const loadedPath = loadDevelopmentEnvironment({
      isPackaged: false,
      appPath,
      workingDirectory: join(repository, 'unrelated-working-directory'),
    });
    const config = loadRuntimeConfig({
      userData: join(repository, 'user-data'),
      localData: join(repository, 'local-data'),
    });

    expect(loadedPath).toBe(join(repository, '.env'));
    expect(config.googleOAuthClientId).toBe('test-client.apps.googleusercontent.com');
    expect(config.googleOAuthClientSecret).toBe('test-client-secret');
  });

  it('does not load a development .env in a packaged application', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'ytbm-runtime-config-packaged-'));
    directories.push(repository);
    await writeFile(
      join(repository, '.env'),
      [
        'YTBM_GOOGLE_OAUTH_CLIENT_ID=should-not-load.apps.googleusercontent.com',
        'YTBM_GOOGLE_OAUTH_CLIENT_SECRET=should-not-load',
        '',
      ].join('\n'),
      'utf8',
    );
    delete process.env.YTBM_GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.YTBM_GOOGLE_OAUTH_CLIENT_SECRET;

    expect(
      loadDevelopmentEnvironment({
        isPackaged: true,
        appPath: join(repository, 'apps', 'desktop'),
        workingDirectory: repository,
      }),
    ).toBeNull();
    expect(process.env.YTBM_GOOGLE_OAUTH_CLIENT_ID).toBeUndefined();
    expect(process.env.YTBM_GOOGLE_OAUTH_CLIENT_SECRET).toBeUndefined();
  });
});
