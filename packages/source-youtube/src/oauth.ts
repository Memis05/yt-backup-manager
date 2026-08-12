import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import {
  AccountDtoSchema,
  OAuthFlowDtoSchema,
  type AccountConnectionState,
  type AccountDto,
  type DriveCapabilityState,
  type GoogleOAuthCapability,
  type OAuthBeginWorkerResult,
  type OAuthFlowDto,
  type SourceErrorCode,
} from '@ytbm/core';
import type { CredentialStore } from '@ytbm/security';
import { z } from 'zod';

import {
  classifyGoogleOAuthError,
  classifyNetworkError,
  safeGoogleOAuthProviderError,
  safeGoogleOAuthProviderReason,
  SourceProviderError,
  type GoogleOAuthProviderReason,
} from './errors';

export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_IDENTITY_SCOPES = Object.freeze(['openid', 'email', 'profile']);
export const GOOGLE_OAUTH_SCOPES = Object.freeze([
  ...GOOGLE_IDENTITY_SCOPES,
  YOUTUBE_READONLY_SCOPE,
]);
export const GOOGLE_DRIVE_OAUTH_SCOPES = Object.freeze([
  ...GOOGLE_IDENTITY_SCOPES,
  GOOGLE_DRIVE_FILE_SCOPE,
]);

const StoredGoogleCredentialSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).nullable(),
    expiresAt: z.number().int().nonnegative(),
    tokenType: z.literal('Bearer'),
    grantedScopes: z.array(z.string()),
  })
  .strict();

type StoredGoogleCredential = z.infer<typeof StoredGoogleCredentialSchema>;

export interface GoogleAccountRecord {
  id: string;
  providerAccountId: string;
  credentialRef: string;
  driveCredentialRef: string | null;
  connectionState: AccountConnectionState;
  driveConnectionState: DriveCapabilityState;
}

export interface ConnectedGoogleAccountInput {
  providerAccountId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  credentialRef: string;
  grantedScopes: string[];
  capability: GoogleOAuthCapability;
  connectedAt: number;
}

export interface GoogleAccountPersistence {
  listAccounts(): Promise<AccountDto[]>;
  findByProviderAccountId(providerAccountId: string): Promise<GoogleAccountRecord | null>;
  getAccountRecord(accountId: string): Promise<GoogleAccountRecord | null>;
  upsertConnectedAccount(input: ConnectedGoogleAccountInput): Promise<AccountDto>;
  setAccountConnectionState(
    accountId: string,
    state: AccountConnectionState,
    errorCode: SourceErrorCode | null,
    changedAt: number,
  ): Promise<AccountDto>;
  setDriveCapabilityState(
    accountId: string,
    state: DriveCapabilityState,
    errorCode: SourceErrorCode | null,
    changedAt: number,
  ): Promise<AccountDto>;
}

export interface GoogleOAuthConfig {
  clientId: string | null;
  clientSecret: string | null;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
  revokeEndpoint?: string;
  flowTimeoutMs?: number;
  onDiagnostic?: (diagnostic: GoogleOAuthDiagnostic) => void;
}

export type GoogleOAuthStage =
  | 'CALLBACK_VALIDATION'
  | 'TOKEN_EXCHANGE'
  | 'TOKEN_RESPONSE_VALIDATION'
  | 'IDENTITY_LOOKUP'
  | 'IDENTITY_RESPONSE_VALIDATION'
  | 'ACCOUNT_LOOKUP'
  | 'CREDENTIAL_LOAD'
  | 'CREDENTIAL_PERSISTENCE'
  | 'ACCOUNT_PERSISTENCE';

export interface GoogleOAuthDiagnostic {
  flowId: string;
  stage: GoogleOAuthStage;
  errorCode: SourceErrorCode;
  httpStatus: number | null;
  providerError: string | null;
  providerReason: GoogleOAuthProviderReason | null;
  exceptionType: string;
}

export type FetchLike = typeof fetch;

interface FlowState {
  flowId: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: number;
  expectedAccountId: string | null;
  capability: GoogleOAuthCapability;
  server: Server;
  timer: NodeJS.Timeout;
  status: OAuthFlowDto;
  stage: GoogleOAuthStage;
  diagnosticReported: boolean;
}

interface TokenEndpointResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  scope?: unknown;
  error?: unknown;
}

interface UserInfoResponse {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  picture?: unknown;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function exceptionType(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error.name)) {
    return error.name;
  }
  return typeof error;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function html(message: string, detail: string | null = null): string {
  const paragraph = detail === null ? '' : `<p style="max-width:720px">${escapeHtml(detail)}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>YouTube Backup Manager</title></head><body style="font-family:Segoe UI,sans-serif;padding:40px"><h1>${escapeHtml(message)}</h1>${paragraph}<p>You may close this browser tab and return to the application.</p></body></html>`;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return {};
  }
}

export class GoogleAccountService {
  private readonly authorizationEndpoint: string;
  private readonly tokenEndpoint: string;
  private readonly userInfoEndpoint: string;
  private readonly revokeEndpoint: string;
  private readonly flowTimeoutMs: number;
  private readonly flows = new Map<string, FlowState>();

  public constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly accounts: GoogleAccountPersistence,
    private readonly credentials: CredentialStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly now: () => number = Date.now,
    private readonly onAccountConnected?: (account: AccountDto) => Promise<void>,
  ) {
    this.authorizationEndpoint =
      config.authorizationEndpoint ?? 'https://accounts.google.com/o/oauth2/v2/auth';
    this.tokenEndpoint = config.tokenEndpoint ?? 'https://oauth2.googleapis.com/token';
    this.userInfoEndpoint =
      config.userInfoEndpoint ?? 'https://openidconnect.googleapis.com/v1/userinfo';
    this.revokeEndpoint = config.revokeEndpoint ?? 'https://oauth2.googleapis.com/revoke';
    this.flowTimeoutMs = config.flowTimeoutMs ?? 5 * 60_000;
  }

  public listAccounts(): Promise<AccountDto[]> {
    return this.accounts.listAccounts();
  }

  public configureClientCredentials(clientId: string | null, clientSecret: string | null): boolean {
    const normalizedClientId = clientId?.trim() ?? null;
    const normalizedClientSecret = clientSecret?.trim() ?? null;
    this.config.clientId = normalizedClientId === '' ? null : normalizedClientId;
    this.config.clientSecret = normalizedClientSecret === '' ? null : normalizedClientSecret;
    return this.config.clientId !== null && this.config.clientSecret !== null;
  }

  public async beginConnection(
    expectedAccountId: string | null,
    capability: GoogleOAuthCapability = 'YOUTUBE',
  ): Promise<OAuthBeginWorkerResult> {
    const clientId = this.config.clientId?.trim();
    const clientSecret = this.config.clientSecret?.trim();
    if (
      clientId === undefined ||
      clientId === '' ||
      clientSecret === undefined ||
      clientSecret === ''
    ) {
      return {
        status: 'UNAVAILABLE',
        errorCode: 'OAUTH_CONFIGURATION_REQUIRED',
        safeMessage:
          'Google OAuth is not configured in this build. Set the development client ID and client secret outside source control.',
      };
    }

    if (capability === 'GOOGLE_DRIVE' && expectedAccountId === null) {
      throw new SourceProviderError(
        'SOURCE_UNAVAILABLE',
        'Connect the Google account for YouTube before enabling Google Drive.',
        false,
      );
    }
    if (
      expectedAccountId !== null &&
      (await this.accounts.getAccountRecord(expectedAccountId)) === null
    ) {
      throw new SourceProviderError(
        'SOURCE_UNAVAILABLE',
        'The Google account to reconnect no longer exists.',
        false,
      );
    }

    const flowId = randomUUID();
    const state = base64Url(randomBytes(32));
    const codeVerifier = base64Url(randomBytes(64));
    const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      throw new SourceProviderError(
        'INTERNAL_ERROR',
        'Unable to start the secure OAuth callback.',
        false,
      );
    }

    // Google installed-app loopback redirects use the loopback origin itself. In particular,
    // the current native-app contract does not include an application callback path here.
    const redirectUri = `http://127.0.0.1:${address.port}`;
    const expiresAt = this.now() + this.flowTimeoutMs;
    const status = OAuthFlowDtoSchema.parse({
      flowId,
      capability,
      status: 'PENDING',
      expiresAt,
      account: null,
      errorCode: null,
      safeMessage: null,
    });
    const timer = setTimeout(() => this.expireFlow(flowId), this.flowTimeoutMs);
    timer.unref();
    const flow: FlowState = {
      flowId,
      state,
      codeVerifier,
      redirectUri,
      expiresAt,
      expectedAccountId,
      capability,
      server,
      timer,
      status,
      stage: 'CALLBACK_VALIDATION',
      diagnosticReported: false,
    };
    this.flows.set(flowId, flow);
    server.on('request', (request, response) => {
      void this.handleCallback(flow, request.url ?? '/', request.method ?? 'GET').then((result) => {
        response.statusCode = result.statusCode;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(html(result.message, result.detail));
      });
    });

    const authorizationUrl = new URL(this.authorizationEndpoint);
    authorizationUrl.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: (capability === 'GOOGLE_DRIVE' ? GOOGLE_DRIVE_OAUTH_SCOPES : GOOGLE_OAUTH_SCOPES).join(
        ' ',
      ),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

    return {
      status: 'STARTED',
      flowId,
      capability,
      authorizationUrl: authorizationUrl.toString(),
      expiresAt,
    };
  }

  public getFlowStatus(flowId: string): OAuthFlowDto {
    const flow = this.flows.get(flowId);
    if (flow === undefined) {
      return OAuthFlowDtoSchema.parse({
        flowId,
        capability: 'YOUTUBE',
        status: 'EXPIRED',
        expiresAt: this.now(),
        account: null,
        errorCode: 'OAUTH_FLOW_EXPIRED',
        safeMessage: 'The Google authorization flow expired. Start it again.',
      });
    }
    return flow.status;
  }

  public async disconnect(accountId: string): Promise<AccountDto> {
    const account = await this.accounts.getAccountRecord(accountId);
    if (account === null) {
      throw new SourceProviderError('SOURCE_UNAVAILABLE', 'Google account was not found.', false);
    }
    const plaintext = await this.credentials.get(account.credentialRef);
    if (plaintext !== null) {
      const stored = StoredGoogleCredentialSchema.parse(JSON.parse(plaintext) as unknown);
      const token = stored.refreshToken ?? stored.accessToken;
      try {
        await this.fetcher(this.revokeEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        // Local credential removal is authoritative even when remote revocation is unreachable.
      }
    }
    await this.credentials.delete(account.credentialRef);
    if (account.driveCredentialRef !== null) {
      await this.credentials.delete(account.driveCredentialRef);
    }
    return this.accounts.setAccountConnectionState(accountId, 'DISCONNECTED', null, this.now());
  }

  public async getAccessToken(
    accountId: string,
    forceRefresh = false,
    capability: GoogleOAuthCapability = 'YOUTUBE',
  ): Promise<string> {
    const account = await this.accounts.getAccountRecord(accountId);
    if (account === null || account.connectionState === 'DISCONNECTED') {
      throw new SourceProviderError('AUTH_REVOKED', 'Google authorization is disconnected.', false);
    }
    const credentialRef =
      capability === 'GOOGLE_DRIVE' ? account.driveCredentialRef : account.credentialRef;
    if (credentialRef === null) {
      throw new SourceProviderError(
        'AUTH_REVOKED',
        'Google Drive authorization is required for this account.',
        false,
      );
    }
    const plaintext = await this.credentials.get(credentialRef);
    if (plaintext === null) {
      if (capability === 'GOOGLE_DRIVE') {
        await this.accounts.setDriveCapabilityState(
          accountId,
          'REAUTH_REQUIRED',
          'AUTH_REVOKED',
          this.now(),
        );
      } else {
        await this.accounts.setAccountConnectionState(
          accountId,
          'REAUTH_REQUIRED',
          'AUTH_REVOKED',
          this.now(),
        );
      }
      throw new SourceProviderError(
        'AUTH_REVOKED',
        'Google authorization is missing. Reconnect this account.',
        false,
      );
    }
    const stored = StoredGoogleCredentialSchema.parse(JSON.parse(plaintext) as unknown);
    if (!forceRefresh && stored.expiresAt > this.now() + 60_000) return stored.accessToken;
    if (stored.refreshToken === null) {
      if (capability === 'GOOGLE_DRIVE') {
        await this.accounts.setDriveCapabilityState(
          accountId,
          'REAUTH_REQUIRED',
          'AUTH_REVOKED',
          this.now(),
        );
      } else {
        await this.accounts.setAccountConnectionState(
          accountId,
          'REAUTH_REQUIRED',
          'AUTH_REVOKED',
          this.now(),
        );
      }
      throw new SourceProviderError(
        'AUTH_REVOKED',
        'Google did not provide a reusable authorization. Reconnect this account.',
        false,
      );
    }

    const clientId = this.config.clientId?.trim();
    const clientSecret = this.config.clientSecret?.trim();
    if (
      clientId === undefined ||
      clientId === '' ||
      clientSecret === undefined ||
      clientSecret === ''
    ) {
      throw new SourceProviderError(
        'OAUTH_CONFIGURATION_REQUIRED',
        'Google OAuth is not configured in this build.',
        false,
      );
    }
    let response: Response;
    try {
      response = await this.fetcher(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: stored.refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw classifyNetworkError();
    }
    const body = (await responseJson(response)) as TokenEndpointResponse;
    if (!response.ok) {
      const revoked = response.status === 400 && body.error === 'invalid_grant';
      const code: SourceErrorCode = revoked ? 'AUTH_REVOKED' : 'AUTH_REFRESH_FAILED';
      if (capability === 'GOOGLE_DRIVE') {
        await this.accounts.setDriveCapabilityState(
          accountId,
          revoked ? 'REAUTH_REQUIRED' : account.driveConnectionState,
          code,
          this.now(),
        );
      } else {
        await this.accounts.setAccountConnectionState(
          accountId,
          revoked ? 'REAUTH_REQUIRED' : 'ERROR',
          code,
          this.now(),
        );
      }
      throw new SourceProviderError(
        code,
        revoked
          ? 'Google authorization was revoked. Reconnect this account.'
          : 'Google authorization could not be refreshed.',
        !revoked,
      );
    }
    const accessToken = nullableString(body.access_token);
    if (accessToken === null) {
      throw new SourceProviderError(
        'AUTH_REFRESH_FAILED',
        'Google returned an invalid token response.',
        true,
      );
    }
    const refreshed: StoredGoogleCredential = {
      ...stored,
      accessToken,
      expiresAt: this.now() + Math.max(1, Number(body.expires_in) || 3_600) * 1_000,
      grantedScopes:
        typeof body.scope === 'string'
          ? body.scope.split(/\s+/).filter(Boolean)
          : stored.grantedScopes,
    };
    await this.credentials.set(credentialRef, JSON.stringify(refreshed));
    if (capability === 'GOOGLE_DRIVE') {
      await this.accounts.setDriveCapabilityState(accountId, 'CONNECTED', null, this.now());
    } else {
      await this.accounts.setAccountConnectionState(accountId, 'CONNECTED', null, this.now());
    }
    return refreshed.accessToken;
  }

  public async markAuthorizationInvalid(accountId: string): Promise<void> {
    await this.accounts.setAccountConnectionState(
      accountId,
      'REAUTH_REQUIRED',
      'AUTH_REVOKED',
      this.now(),
    );
  }

  public async markDriveAuthorizationInvalid(accountId: string): Promise<void> {
    await this.accounts.setDriveCapabilityState(
      accountId,
      'REAUTH_REQUIRED',
      'AUTH_REVOKED',
      this.now(),
    );
  }

  public async stop(): Promise<void> {
    for (const flow of this.flows.values()) {
      clearTimeout(flow.timer);
      await new Promise<void>((resolve) => flow.server.close(() => resolve()));
    }
    this.flows.clear();
  }

  private async handleCallback(
    flow: FlowState,
    requestUrl: string,
    method: string,
  ): Promise<{ statusCode: number; message: string; detail: string | null }> {
    if (method !== 'GET')
      return { statusCode: 405, message: 'Unsupported callback method', detail: null };
    const url = new URL(requestUrl, flow.redirectUri);
    if (url.pathname !== '/')
      return { statusCode: 404, message: 'Unknown callback path', detail: null };
    if (flow.status.status !== 'PENDING') {
      return {
        statusCode: 409,
        message: 'This authorization flow is already complete',
        detail: null,
      };
    }
    if (url.searchParams.get('state') !== flow.state) {
      const error = new SourceProviderError(
        'OAUTH_STATE_INVALID',
        'Google authorization state validation failed.',
        false,
      );
      this.reportDiagnostic(flow, error);
      this.failFlow(flow, error.code, error.safeMessage);
      return { statusCode: 400, message: 'Authorization validation failed', detail: null };
    }
    const providerError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (providerError !== null || code === null || code.length === 0) {
      const error = new SourceProviderError(
        'OAUTH_CALLBACK_FAILED',
        'Google authorization was cancelled or failed.',
        false,
      );
      this.reportDiagnostic(flow, error, {
        httpStatus: null,
        providerError: safeGoogleOAuthProviderError({ error: providerError }),
        providerReason: null,
      });
      this.failFlow(flow, error.code, error.safeMessage);
      return { statusCode: 400, message: 'Authorization was not completed', detail: null };
    }

    try {
      const account = await this.completeAuthorization(flow, code);
      flow.status = OAuthFlowDtoSchema.parse({
        ...flow.status,
        status: 'COMPLETED',
        account,
        errorCode: null,
        safeMessage: null,
      });
      clearTimeout(flow.timer);
      flow.server.close();
      try {
        if (flow.capability === 'YOUTUBE') await this.onAccountConnected?.(account);
      } catch {
        // Channel discovery can be retried independently after the account is safely connected.
      }
      return { statusCode: 200, message: 'Google account connected', detail: null };
    } catch (error) {
      const sourceError =
        error instanceof SourceProviderError
          ? error
          : new SourceProviderError(
              'OAUTH_CALLBACK_FAILED',
              'Google authorization could not be completed.',
              false,
            );
      this.reportDiagnostic(flow, sourceError, undefined, exceptionType(error));
      this.failFlow(flow, sourceError.code, sourceError.safeMessage);
      return {
        statusCode: 500,
        message: 'Authorization could not be completed',
        detail: sourceError.safeMessage,
      };
    }
  }

  private async completeAuthorization(flow: FlowState, code: string): Promise<AccountDto> {
    flow.stage = 'TOKEN_EXCHANGE';
    const clientId = this.config.clientId?.trim();
    const clientSecret = this.config.clientSecret?.trim();
    if (
      clientId === undefined ||
      clientId === '' ||
      clientSecret === undefined ||
      clientSecret === ''
    ) {
      throw new SourceProviderError(
        'OAUTH_CONFIGURATION_REQUIRED',
        'Google OAuth is not configured.',
        false,
      );
    }
    let tokenResponse: Response;
    try {
      tokenResponse = await this.fetcher(this.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: flow.codeVerifier,
          redirect_uri: flow.redirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      const error = new SourceProviderError(
        'NETWORK_UNAVAILABLE',
        'The application could not reach Google to exchange the authorization code. Check firewall, proxy, VPN, or antivirus settings and try again.',
        true,
      );
      throw error;
    }
    const tokenBody = (await responseJson(tokenResponse)) as TokenEndpointResponse;
    if (!tokenResponse.ok) {
      const error = classifyGoogleOAuthError(tokenResponse.status, tokenBody, 'TOKEN_EXCHANGE');
      this.reportDiagnostic(flow, error, {
        httpStatus: tokenResponse.status,
        providerError: safeGoogleOAuthProviderError(tokenBody),
        providerReason: safeGoogleOAuthProviderReason(tokenBody),
      });
      throw error;
    }
    flow.stage = 'TOKEN_RESPONSE_VALIDATION';
    const accessToken = nullableString(tokenBody.access_token);
    if (accessToken === null) {
      throw new SourceProviderError(
        'OAUTH_CALLBACK_FAILED',
        'Google returned an invalid token response.',
        false,
      );
    }
    const grantedScopes =
      typeof tokenBody.scope === 'string'
        ? tokenBody.scope.split(/\s+/).filter(Boolean)
        : [
            ...(flow.capability === 'GOOGLE_DRIVE'
              ? GOOGLE_DRIVE_OAUTH_SCOPES
              : GOOGLE_OAUTH_SCOPES),
          ];
    if (flow.capability === 'YOUTUBE' && !grantedScopes.includes(YOUTUBE_READONLY_SCOPE)) {
      throw new SourceProviderError(
        'OAUTH_CALLBACK_FAILED',
        'The required read-only YouTube permission was not granted.',
        false,
      );
    }
    if (flow.capability === 'GOOGLE_DRIVE' && !grantedScopes.includes(GOOGLE_DRIVE_FILE_SCOPE)) {
      throw new SourceProviderError(
        'OAUTH_CALLBACK_FAILED',
        'The required Google Drive file permission was not granted.',
        false,
      );
    }

    flow.stage = 'IDENTITY_LOOKUP';
    let identityResponse: Response;
    try {
      identityResponse = await this.fetcher(this.userInfoEndpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      const error = new SourceProviderError(
        'NETWORK_UNAVAILABLE',
        'The application received authorization but could not reach Google to verify the account identity. Check firewall, proxy, VPN, or antivirus settings and try again.',
        true,
      );
      throw error;
    }
    const identity = (await responseJson(identityResponse)) as UserInfoResponse;
    if (!identityResponse.ok) {
      const error = classifyGoogleOAuthError(identityResponse.status, identity, 'IDENTITY_LOOKUP');
      this.reportDiagnostic(flow, error, {
        httpStatus: identityResponse.status,
        providerError: safeGoogleOAuthProviderError(identity),
        providerReason: safeGoogleOAuthProviderReason(identity),
      });
      throw error;
    }
    flow.stage = 'IDENTITY_RESPONSE_VALIDATION';
    const providerAccountId = nullableString(identity.sub);
    if (providerAccountId === null) {
      throw new SourceProviderError(
        'OAUTH_CALLBACK_FAILED',
        'Google account identity could not be verified.',
        false,
      );
    }
    flow.stage = 'ACCOUNT_LOOKUP';
    const expected =
      flow.expectedAccountId === null
        ? null
        : await this.accounts.getAccountRecord(flow.expectedAccountId);
    if (expected !== null && expected.providerAccountId !== providerAccountId) {
      throw new SourceProviderError(
        'OAUTH_CALLBACK_FAILED',
        'The selected Google account does not match the account being reconnected.',
        false,
      );
    }
    const existing = await this.accounts.findByProviderAccountId(providerAccountId);
    const accountId = existing?.id ?? flow.expectedAccountId ?? randomUUID();
    const credentialRef =
      flow.capability === 'GOOGLE_DRIVE'
        ? (existing?.driveCredentialRef ?? `google-oauth:${accountId}:drive`)
        : (existing?.credentialRef ?? `google-oauth:${accountId}`);
    flow.stage = 'CREDENTIAL_LOAD';
    const previousPlaintext = await this.credentials.get(credentialRef);
    const previous =
      previousPlaintext === null
        ? null
        : StoredGoogleCredentialSchema.parse(JSON.parse(previousPlaintext) as unknown);
    const stored = StoredGoogleCredentialSchema.parse({
      accessToken,
      refreshToken: nullableString(tokenBody.refresh_token) ?? previous?.refreshToken ?? null,
      expiresAt: this.now() + Math.max(1, Number(tokenBody.expires_in) || 3_600) * 1_000,
      tokenType: 'Bearer',
      grantedScopes,
    });
    flow.stage = 'CREDENTIAL_PERSISTENCE';
    try {
      await this.credentials.set(credentialRef, JSON.stringify(stored));
    } catch {
      const error = new SourceProviderError(
        'OAUTH_CALLBACK_FAILED',
        'Google authorization succeeded, but Windows secure credential storage failed. Restart the application and try again.',
        false,
      );
      throw error;
    }
    flow.stage = 'ACCOUNT_PERSISTENCE';
    try {
      return AccountDtoSchema.parse(
        await this.accounts.upsertConnectedAccount({
          providerAccountId,
          email: nullableString(identity.email),
          displayName: nullableString(identity.name),
          avatarUrl: nullableString(identity.picture),
          credentialRef,
          grantedScopes,
          capability: flow.capability,
          connectedAt: this.now(),
        }),
      );
    } catch {
      if (previousPlaintext === null) await this.credentials.delete(credentialRef);
      else await this.credentials.set(credentialRef, previousPlaintext);
      const persistenceError = new SourceProviderError(
        'OAUTH_CALLBACK_FAILED',
        'Google authorization succeeded, but the account could not be saved in the local catalog.',
        false,
      );
      throw persistenceError;
    }
  }

  private reportDiagnostic(
    flow: FlowState,
    error: SourceProviderError,
    provider: {
      httpStatus: number | null;
      providerError: string | null;
      providerReason: GoogleOAuthProviderReason | null;
    } = { httpStatus: null, providerError: null, providerReason: null },
    reportedExceptionType = exceptionType(error),
  ): void {
    if (flow.diagnosticReported) return;
    flow.diagnosticReported = true;
    try {
      this.config.onDiagnostic?.({
        flowId: flow.flowId,
        stage: flow.stage,
        errorCode: error.code,
        ...provider,
        exceptionType: reportedExceptionType,
      });
    } catch {
      // Diagnostics are best effort and must never replace the actionable OAuth failure.
    }
  }

  public isIdle(): boolean {
    return ![...this.flows.values()].some((flow) => flow.status.status === 'PENDING');
  }

  private failFlow(flow: FlowState, errorCode: SourceErrorCode, safeMessage: string): void {
    flow.status = OAuthFlowDtoSchema.parse({
      ...flow.status,
      status: 'FAILED',
      account: null,
      errorCode,
      safeMessage,
    });
    clearTimeout(flow.timer);
    flow.server.close();
  }

  private expireFlow(flowId: string): void {
    const flow = this.flows.get(flowId);
    if (flow === undefined || flow.status.status !== 'PENDING') return;
    flow.status = OAuthFlowDtoSchema.parse({
      ...flow.status,
      status: 'EXPIRED',
      errorCode: 'OAUTH_FLOW_EXPIRED',
      safeMessage: 'The Google authorization flow expired. Start it again.',
    });
    flow.server.close();
  }
}
