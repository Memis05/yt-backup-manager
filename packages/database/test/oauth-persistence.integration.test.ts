import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GoogleAccountService } from '@ytbm/source-youtube';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DrizzleGoogleAccountRepository,
  acquireWorkerDatabaseOwnership,
  openWorkerDatabase,
  type WorkerDatabase,
} from '../src';

const directories: string[] = [];
const databases: WorkerDatabase[] = [];
const services: GoogleAccountService[] = [];
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('OAuth persistence boundary', () => {
  it('stores credential references in SQLite while tokens remain in the credential store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-database-'));
    directories.push(directory);
    const database = openWorkerDatabase({
      databasePath: join(directory, 'app.db'),
      ownership: acquireWorkerDatabaseOwnership(),
      migrationsFolder,
    });
    databases.push(database);
    const credentialValues = new Map<string, string>();
    const service = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
        tokenEndpoint: 'https://oauth.test/token',
        userInfoEndpoint: 'https://oauth.test/userinfo',
      },
      new DrizzleGoogleAccountRepository(database),
      {
        get: async (reference) => credentialValues.get(reference) ?? null,
        set: async (reference, plaintext) => void credentialValues.set(reference, plaintext),
        delete: async (reference) => void credentialValues.delete(reference),
      },
      async (input) => {
        const url = new URL(input.toString());
        if (url.pathname === '/token') {
          return new Response(
            JSON.stringify({
              access_token: 'database-test-access-token',
              refresh_token: 'database-test-refresh-token',
              expires_in: 3_600,
              scope: 'openid email profile https://www.googleapis.com/auth/youtube.readonly',
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ sub: 'database-google-subject', email: 'database@example.test' }),
          { status: 200 },
        );
      },
      () => 1_000,
    );
    services.push(service);
    const started = await service.beginConnection(null);
    if (started.status !== 'STARTED') throw new Error('OAuth did not start');
    const authorization = new URL(started.authorizationUrl);
    const redirect = new URL(authorization.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('code', 'database-test-authorization-code');
    redirect.searchParams.set('state', authorization.searchParams.get('state')!);
    await fetch(redirect);

    expect([...credentialValues.values()].join(' ')).toContain('database-test-access-token');
    const rows = database.sqlite.prepare('select * from accounts').all();
    const serializedRows = JSON.stringify(rows);
    expect(serializedRows).toContain('google-oauth:');
    expect(serializedRows).not.toContain('database-test-access-token');
    expect(serializedRows).not.toContain('database-test-refresh-token');
    expect(serializedRows).not.toContain('database-test-authorization-code');
  });
});
