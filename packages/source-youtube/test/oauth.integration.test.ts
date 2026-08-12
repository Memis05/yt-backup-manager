import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AccountConnectionState,
  AccountDto,
  DriveCapabilityState,
  SourceErrorCode,
} from '@ytbm/core';
import { EncryptedFileCredentialStore, type EncryptionAdapter } from '@ytbm/security';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GOOGLE_OAUTH_SCOPES,
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_OAUTH_SCOPES,
  GoogleAccountService,
  YOUTUBE_READONLY_SCOPE,
  type ConnectedGoogleAccountInput,
  type GoogleAccountPersistence,
  type GoogleAccountRecord,
} from '../src';

const directories: string[] = [];
const services: GoogleAccountService[] = [];
const encryption: EncryptionAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext) => Buffer.from(plaintext, 'utf8').map((byte) => byte ^ 0xa7),
  decryptString: (ciphertext) =>
    Buffer.from(Uint8Array.from(ciphertext, (byte) => byte ^ 0xa7)).toString('utf8'),
};

class MemoryAccounts implements GoogleAccountPersistence {
  public readonly records = new Map<
    string,
    AccountDto & { credentialRef: string; driveCredentialRef: string | null }
  >();

  public async listAccounts(): Promise<AccountDto[]> {
    return [...this.records.values()].map((account) => this.toDto(account));
  }

  public async findByProviderAccountId(
    providerAccountId: string,
  ): Promise<GoogleAccountRecord | null> {
    const account = [...this.records.values()].find(
      (record) => record.providerAccountId === providerAccountId,
    );
    return account === undefined
      ? null
      : {
          id: account.id,
          providerAccountId: account.providerAccountId,
          credentialRef: account.credentialRef,
          driveCredentialRef: account.driveCredentialRef,
          connectionState: account.connectionState,
          driveConnectionState: account.capabilities.driveConnectionState,
        };
  }

  public async getAccountRecord(accountId: string): Promise<GoogleAccountRecord | null> {
    const account = this.records.get(accountId);
    return account === undefined
      ? null
      : {
          id: account.id,
          providerAccountId: account.providerAccountId,
          credentialRef: account.credentialRef,
          driveCredentialRef: account.driveCredentialRef,
          connectionState: account.connectionState,
          driveConnectionState: account.capabilities.driveConnectionState,
        };
  }

  public async upsertConnectedAccount(input: ConnectedGoogleAccountInput): Promise<AccountDto> {
    const existing = await this.findByProviderAccountId(input.providerAccountId);
    const id = existing?.id ?? randomUUID();
    if (input.capability === 'GOOGLE_DRIVE' && existing === null) {
      throw new Error('Drive authorization requires an existing Google account');
    }
    const previous = this.records.get(id);
    const account: AccountDto & { credentialRef: string; driveCredentialRef: string | null } = {
      id,
      provider: 'GOOGLE',
      providerAccountId: input.providerAccountId,
      email: input.email,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      connectionState: 'CONNECTED',
      capabilities: {
        youtubeReadonly: true,
        driveFile: input.capability === 'GOOGLE_DRIVE' || previous?.capabilities.driveFile === true,
        driveConnectionState:
          input.capability === 'GOOGLE_DRIVE'
            ? 'CONNECTED'
            : (previous?.capabilities.driveConnectionState ?? 'AUTHORIZATION_REQUIRED'),
        grantedScopes: [
          ...new Set([...(previous?.capabilities.grantedScopes ?? []), ...input.grantedScopes]),
        ],
      },
      credentialRef:
        input.capability === 'YOUTUBE' ? input.credentialRef : (previous?.credentialRef ?? ''),
      driveCredentialRef:
        input.capability === 'GOOGLE_DRIVE'
          ? input.credentialRef
          : (previous?.driveCredentialRef ?? null),
      connectedAt: previous?.connectedAt ?? input.connectedAt,
      lastAuthAt: input.connectedAt,
      lastErrorCode: null,
    };
    this.records.set(id, account);
    return this.toDto(account);
  }

  public async setAccountConnectionState(
    accountId: string,
    state: AccountConnectionState,
    errorCode: SourceErrorCode | null,
  ): Promise<AccountDto> {
    const account = this.records.get(accountId);
    if (account === undefined) throw new Error('Account not found');
    const updated = { ...account, connectionState: state, lastErrorCode: errorCode };
    this.records.set(accountId, updated);
    return this.toDto(updated);
  }

  public async setDriveCapabilityState(
    accountId: string,
    state: DriveCapabilityState,
    errorCode: SourceErrorCode | null,
  ): Promise<AccountDto> {
    const account = this.records.get(accountId);
    if (account === undefined) throw new Error('Account not found');
    const updated = {
      ...account,
      capabilities: {
        ...account.capabilities,
        driveConnectionState: state,
        driveFile: state === 'CONNECTED' && account.driveCredentialRef !== null,
      },
      lastErrorCode: errorCode,
    };
    this.records.set(accountId, updated);
    return this.toDto(updated);
  }

  private toDto(
    account: AccountDto & { credentialRef: string; driveCredentialRef: string | null },
  ): AccountDto {
    return {
      id: account.id,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      email: account.email,
      displayName: account.displayName,
      avatarUrl: account.avatarUrl,
      connectionState: account.connectionState,
      capabilities: account.capabilities,
      connectedAt: account.connectedAt,
      lastAuthAt: account.lastAuthAt,
      lastErrorCode: account.lastErrorCode,
    };
  }
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function callback(result: { authorizationUrl: string }, state: string): Promise<Response> {
  const authorization = new URL(result.authorizationUrl);
  const redirect = new URL(authorization.searchParams.get('redirect_uri')!);
  redirect.searchParams.set('code', 'authorization-code-secret');
  redirect.searchParams.set('state', state);
  return fetch(redirect);
}

describe('Google installed-application OAuth', () => {
  it('uses a separate Drive-only grant and refreshes it without replacing YouTube', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-drive-test-'));
    directories.push(directory);
    const store = new EncryptedFileCredentialStore(directory, encryption);
    const accounts = new MemoryAccounts();
    const account = await accounts.upsertConnectedAccount({
      providerAccountId: 'google-drive-subject',
      email: 'drive@example.test',
      displayName: 'Drive Owner',
      avatarUrl: null,
      credentialRef: 'google-oauth:youtube-existing',
      grantedScopes: [...GOOGLE_OAUTH_SCOPES],
      capability: 'YOUTUBE',
      connectedAt: 1,
    });
    await store.set('google-oauth:youtube-existing', 'existing-youtube-credential');
    let tokenCalls = 0;
    const service = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
      },
      accounts,
      store,
      async (input) => {
        const url = new URL(input.toString());
        if (url.pathname === '/token') {
          tokenCalls += 1;
          return Response.json({
            access_token:
              tokenCalls === 1 ? 'drive-access-secret' : 'drive-refreshed-access-secret',
            ...(tokenCalls === 1 ? { refresh_token: 'drive-refresh-secret' } : {}),
            expires_in: 3_600,
            token_type: 'Bearer',
            scope: GOOGLE_DRIVE_OAUTH_SCOPES.join(' '),
          });
        }
        return Response.json({
          sub: 'google-drive-subject',
          email: 'drive@example.test',
          name: 'Drive Owner',
        });
      },
    );
    services.push(service);

    const started = await service.beginConnection(account.id, 'GOOGLE_DRIVE');
    if (started.status !== 'STARTED') throw new Error('Drive OAuth did not start');
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.searchParams.get('scope')?.split(' ')).toEqual(GOOGLE_DRIVE_OAUTH_SCOPES);
    expect(authorization.searchParams.get('scope')).toContain(GOOGLE_DRIVE_FILE_SCOPE);
    expect(authorization.searchParams.get('scope')).not.toContain(YOUTUBE_READONLY_SCOPE);
    expect(authorization.searchParams.has('include_granted_scopes')).toBe(false);
    await expect(
      callback(started, authorization.searchParams.get('state')!),
    ).resolves.toMatchObject({ status: 200 });

    expect(service.getFlowStatus(started.flowId)).toMatchObject({
      capability: 'GOOGLE_DRIVE',
      status: 'COMPLETED',
      account: {
        id: account.id,
        capabilities: { driveFile: true, driveConnectionState: 'CONNECTED' },
      },
    });
    await expect(store.get('google-oauth:youtube-existing')).resolves.toBe(
      'existing-youtube-credential',
    );
    await expect(service.getAccessToken(account.id, true, 'GOOGLE_DRIVE')).resolves.toBe(
      'drive-refreshed-access-secret',
    );
    expect(tokenCalls).toBe(2);
    const driveCredential = JSON.parse((await store.get(`google-oauth:${account.id}:drive`))!);
    expect(driveCredential).toMatchObject({
      accessToken: 'drive-refreshed-access-secret',
      refreshToken: 'drive-refresh-secret',
      grantedScopes: [...GOOGLE_DRIVE_OAUTH_SCOPES],
    });
    await expect(store.get('google-oauth:youtube-existing')).resolves.toBe(
      'existing-youtube-credential',
    );
  });

  it('rejects a mismatched Drive identity without replacing working credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-drive-mismatch-test-'));
    directories.push(directory);
    const store = new EncryptedFileCredentialStore(directory, encryption);
    const accounts = new MemoryAccounts();
    const account = await accounts.upsertConnectedAccount({
      providerAccountId: 'expected-subject',
      email: 'expected@example.test',
      displayName: null,
      avatarUrl: null,
      credentialRef: 'google-oauth:expected',
      grantedScopes: [...GOOGLE_OAUTH_SCOPES],
      capability: 'YOUTUBE',
      connectedAt: 1,
    });
    await store.set('google-oauth:expected', 'working-youtube-credential');
    const service = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
      },
      accounts,
      store,
      async (input) => {
        const url = new URL(input.toString());
        return url.pathname === '/token'
          ? Response.json({
              access_token: 'mismatched-access',
              refresh_token: 'mismatched-refresh',
              expires_in: 3_600,
              token_type: 'Bearer',
              scope: GOOGLE_DRIVE_OAUTH_SCOPES.join(' '),
            })
          : Response.json({ sub: 'different-subject', email: 'other@example.test' });
      },
    );
    services.push(service);

    const started = await service.beginConnection(account.id, 'GOOGLE_DRIVE');
    if (started.status !== 'STARTED') throw new Error('Drive OAuth did not start');
    const authorization = new URL(started.authorizationUrl);
    const response = await callback(started, authorization.searchParams.get('state')!);

    expect(response.status).toBe(500);
    expect(service.getFlowStatus(started.flowId)).toMatchObject({
      status: 'FAILED',
      safeMessage: expect.stringContaining('does not match'),
    });
    await expect(store.get('google-oauth:expected')).resolves.toBe('working-youtube-credential');
    await expect(store.get(`google-oauth:${account.id}:drive`)).resolves.toBeNull();
    await expect(accounts.listAccounts()).resolves.toEqual([
      expect.objectContaining({
        connectionState: 'CONNECTED',
        capabilities: expect.objectContaining({ driveFile: false }),
      }),
    ]);
  });

  it('preserves the working YouTube credential when Drive consent is cancelled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-drive-cancel-test-'));
    directories.push(directory);
    const store = new EncryptedFileCredentialStore(directory, encryption);
    const accounts = new MemoryAccounts();
    const account = await accounts.upsertConnectedAccount({
      providerAccountId: 'cancel-subject',
      email: 'cancel@example.test',
      displayName: null,
      avatarUrl: null,
      credentialRef: 'google-oauth:cancel-existing',
      grantedScopes: [...GOOGLE_OAUTH_SCOPES],
      capability: 'YOUTUBE',
      connectedAt: 1,
    });
    await store.set('google-oauth:cancel-existing', 'working-youtube-credential');
    let providerCalls = 0;
    const service = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
      },
      accounts,
      store,
      async () => {
        providerCalls += 1;
        return new Response('{}', { status: 500 });
      },
    );
    services.push(service);

    const started = await service.beginConnection(account.id, 'GOOGLE_DRIVE');
    if (started.status !== 'STARTED') throw new Error('Drive OAuth did not start');
    const authorization = new URL(started.authorizationUrl);
    const redirect = new URL(authorization.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('state', authorization.searchParams.get('state')!);
    redirect.searchParams.set('error', 'access_denied');
    await expect(fetch(redirect)).resolves.toMatchObject({ status: 400 });

    expect(providerCalls).toBe(0);
    await expect(store.get('google-oauth:cancel-existing')).resolves.toBe(
      'working-youtube-credential',
    );
    await expect(store.get(`google-oauth:${account.id}:drive`)).resolves.toBeNull();
  });

  it('does not open a callback listener when the client secret is missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-config-test-'));
    directories.push(directory);
    const service = new GoogleAccountService(
      { clientId: 'desktop-client.apps.googleusercontent.com', clientSecret: null },
      new MemoryAccounts(),
      new EncryptedFileCredentialStore(directory, encryption),
    );
    services.push(service);

    await expect(service.beginConnection(null)).resolves.toMatchObject({
      status: 'UNAVAILABLE',
      errorCode: 'OAUTH_CONFIGURATION_REQUIRED',
      safeMessage: expect.stringContaining('client ID and client secret'),
    });
    expect(service.isIdle()).toBe(true);
  });

  it('uses PKCE/state, persists tokens only through the encrypted store, and refreshes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-test-'));
    directories.push(directory);
    const credentialStore = new EncryptedFileCredentialStore(directory, encryption);
    const accounts = new MemoryAccounts();
    let now = 1_000;
    let refreshCalls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input.toString());
      if (url.pathname === '/token') {
        const body = new URLSearchParams(String(init?.body));
        if (body.get('grant_type') === 'authorization_code') {
          expect(body.get('code')).toBe('authorization-code-secret');
          expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{80,}$/);
          expect(body.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
          expect(body.get('client_secret')).toBe('desktop-client-secret');
          return new Response(
            JSON.stringify({
              access_token: 'access-token-secret',
              refresh_token: 'refresh-token-secret',
              expires_in: 1,
              token_type: 'Bearer',
              scope: GOOGLE_OAUTH_SCOPES.join(' '),
            }),
            { status: 200 },
          );
        }
        refreshCalls += 1;
        expect(body.get('refresh_token')).toBe('refresh-token-secret');
        expect(body.get('client_secret')).toBe('desktop-client-secret');
        return new Response(
          JSON.stringify({ access_token: 'refreshed-access-secret', expires_in: 3_600 }),
          { status: 200 },
        );
      }
      if (url.pathname === '/userinfo') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-token-secret');
        return new Response(
          JSON.stringify({
            sub: 'google-subject-1',
            email: 'owner@example.test',
            name: 'Channel Owner',
            picture: 'https://example.test/avatar.png',
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected request ${url.toString()}`);
    };
    const service = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
        tokenEndpoint: 'https://oauth.test/token',
        userInfoEndpoint: 'https://oauth.test/userinfo',
      },
      accounts,
      credentialStore,
      fetcher,
      () => now,
    );
    services.push(service);

    const started = await service.beginConnection(null);
    expect(started.status).toBe('STARTED');
    if (started.status !== 'STARTED') throw new Error('OAuth did not start');
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.hostname).toBe('accounts.google.com');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(authorization.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(authorization.searchParams.get('scope')?.split(' ')).toEqual(GOOGLE_OAUTH_SCOPES);
    expect(authorization.searchParams.get('scope')).toContain(YOUTUBE_READONLY_SCOPE);
    expect(authorization.searchParams.get('scope')).not.toContain(GOOGLE_DRIVE_FILE_SCOPE);
    expect(authorization.searchParams.has('include_granted_scopes')).toBe(false);
    expect(authorization.searchParams.has('client_secret')).toBe(false);

    const state = authorization.searchParams.get('state')!;
    await expect(callback(started, state)).resolves.toMatchObject({ status: 200 });
    const flow = service.getFlowStatus(started.flowId);
    expect(flow).toMatchObject({ status: 'COMPLETED', account: { email: 'owner@example.test' } });

    const [file] = await readdir(directory);
    const encrypted = await readFile(join(directory, file!));
    expect(encrypted.toString('utf8')).not.toContain('access-token-secret');
    expect(encrypted.toString('utf8')).not.toContain('refresh-token-secret');

    await service.stop();
    const restartedService = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
        tokenEndpoint: 'https://oauth.test/token',
        userInfoEndpoint: 'https://oauth.test/userinfo',
      },
      accounts,
      credentialStore,
      fetcher,
      () => now,
    );
    services.push(restartedService);
    now += 2_000;
    await expect(restartedService.getAccessToken(flow.account!.id)).resolves.toBe(
      'refreshed-access-secret',
    );
    expect(refreshCalls).toBe(1);
    await expect(restartedService.disconnect(flow.account!.id)).resolves.toMatchObject({
      connectionState: 'DISCONNECTED',
    });
    await expect(credentialStore.get(`google-oauth:${flow.account!.id}`)).resolves.toBeNull();
  });

  it('rejects an invalid callback state before exchanging an authorization code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-state-test-'));
    directories.push(directory);
    let tokenRequests = 0;
    const service = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
      },
      new MemoryAccounts(),
      new EncryptedFileCredentialStore(directory, encryption),
      async () => {
        tokenRequests += 1;
        return new Response('{}', { status: 500 });
      },
    );
    services.push(service);
    const started = await service.beginConnection(null);
    if (started.status !== 'STARTED') throw new Error('OAuth did not start');

    await expect(callback(started, 'wrong-state')).resolves.toMatchObject({ status: 400 });
    expect(service.getFlowStatus(started.flowId)).toMatchObject({
      status: 'FAILED',
      errorCode: 'OAUTH_STATE_INVALID',
    });
    expect(service.isIdle()).toBe(true);
    expect(tokenRequests).toBe(0);
  });

  it('turns a revoked refresh token into an actionable reconnect state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-revoke-test-'));
    directories.push(directory);
    const store = new EncryptedFileCredentialStore(directory, encryption);
    const accounts = new MemoryAccounts();
    const account = await accounts.upsertConnectedAccount({
      providerAccountId: 'google-subject-revoked',
      email: 'revoked@example.test',
      displayName: null,
      avatarUrl: null,
      credentialRef: 'google-oauth:revoked',
      grantedScopes: [...GOOGLE_OAUTH_SCOPES],
      capability: 'YOUTUBE',
      connectedAt: 1,
    });
    await store.set(
      'google-oauth:revoked',
      JSON.stringify({
        accessToken: 'expired-access',
        refreshToken: 'revoked-refresh',
        expiresAt: 0,
        tokenType: 'Bearer',
        grantedScopes: [...GOOGLE_OAUTH_SCOPES],
      }),
    );
    const service = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
      },
      accounts,
      store,
      async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      () => 10_000,
    );
    services.push(service);

    await expect(service.getAccessToken(account.id)).rejects.toMatchObject({
      code: 'AUTH_REVOKED',
      retryable: false,
    });
    await expect(accounts.listAccounts()).resolves.toEqual([
      expect.objectContaining({
        connectionState: 'REAUTH_REQUIRED',
        lastErrorCode: 'AUTH_REVOKED',
      }),
    ]);
  });

  it('reports a safe token-exchange stage and provider code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-diagnostic-test-'));
    directories.push(directory);
    const diagnostics: Array<{
      flowId: string;
      stage: string;
      errorCode: string;
      httpStatus: number | null;
      providerError: string | null;
      providerReason: string | null;
      exceptionType: string;
    }> = [];
    const service = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      },
      new MemoryAccounts(),
      new EncryptedFileCredentialStore(directory, encryption),
      async (input) => {
        const url = new URL(input.toString());
        if (url.pathname === '/token') {
          return new Response(
            JSON.stringify({
              error: 'invalid_client',
              error_description: 'secret provider detail must not be surfaced',
            }),
            { status: 400 },
          );
        }
        throw new Error('Identity lookup must not run after a failed token exchange');
      },
    );
    services.push(service);
    const started = await service.beginConnection(null);
    if (started.status !== 'STARTED') throw new Error('OAuth did not start');
    const authorization = new URL(started.authorizationUrl);

    const response = await callback(started, authorization.searchParams.get('state')!);
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).toContain('Use a Google OAuth client of type Desktop app');
    expect(responseText).not.toContain('secret provider detail');
    expect(service.getFlowStatus(started.flowId)).toMatchObject({
      status: 'FAILED',
      errorCode: 'OAUTH_CONFIGURATION_REQUIRED',
    });
    expect(diagnostics).toEqual([
      {
        flowId: started.flowId,
        stage: 'TOKEN_EXCHANGE',
        errorCode: 'OAUTH_CONFIGURATION_REQUIRED',
        httpStatus: 400,
        providerError: 'invalid_client',
        providerReason: null,
        exceptionType: 'SourceProviderError',
      },
    ]);
  });

  it('logs an unexpected callback stage without exposing the raw exception', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-oauth-unexpected-test-'));
    directories.push(directory);
    const diagnostics: Array<{
      flowId: string;
      stage: string;
      errorCode: string;
      httpStatus: number | null;
      providerError: string | null;
      providerReason: string | null;
      exceptionType: string;
    }> = [];
    const accounts = new MemoryAccounts();
    accounts.findByProviderAccountId = async () => {
      throw new Error('sensitive implementation detail');
    };
    const service = new GoogleAccountService(
      {
        clientId: 'desktop-client.apps.googleusercontent.com',
        clientSecret: 'desktop-client-secret',
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      },
      accounts,
      new EncryptedFileCredentialStore(directory, encryption),
      async (input) => {
        const url = new URL(input.toString());
        if (url.pathname === '/token') {
          return new Response(
            JSON.stringify({
              access_token: 'access-token-secret',
              refresh_token: 'refresh-token-secret',
              expires_in: 3_600,
              token_type: 'Bearer',
              scope: GOOGLE_OAUTH_SCOPES.join(' '),
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ sub: 'google-subject-1', email: 'owner@example.test' }),
          { status: 200 },
        );
      },
    );
    services.push(service);
    const started = await service.beginConnection(null);
    if (started.status !== 'STARTED') throw new Error('OAuth did not start');
    const authorization = new URL(started.authorizationUrl);

    const response = await callback(started, authorization.searchParams.get('state')!);
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).toContain('Google authorization could not be completed.');
    expect(responseText).not.toContain('sensitive implementation detail');
    expect(diagnostics).toEqual([
      {
        flowId: started.flowId,
        stage: 'ACCOUNT_LOOKUP',
        errorCode: 'OAUTH_CALLBACK_FAILED',
        httpStatus: null,
        providerError: null,
        providerReason: null,
        exceptionType: 'Error',
      },
    ]);
  });
});
