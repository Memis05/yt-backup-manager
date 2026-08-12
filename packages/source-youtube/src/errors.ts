import type { SourceErrorCode } from '@ytbm/core';

export class SourceProviderError extends Error {
  public constructor(
    public readonly code: SourceErrorCode,
    public readonly safeMessage: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(safeMessage);
    this.name = 'SourceProviderError';
  }
}

interface GoogleErrorBody {
  error?: {
    status?: unknown;
    errors?: Array<{ reason?: unknown }>;
  };
}

interface GoogleOAuthErrorBody {
  error?: unknown;
  error_description?: unknown;
}

export type GoogleOAuthProviderReason =
  | 'CLIENT_SECRET_REJECTED'
  | 'CLIENT_ID_REJECTED'
  | 'PKCE_REJECTED'
  | 'REDIRECT_URI_REJECTED'
  | 'AUTHORIZATION_CODE_REJECTED'
  | 'GRANT_TYPE_REJECTED';

const SAFE_GOOGLE_OAUTH_ERRORS = new Set([
  'access_denied',
  'invalid_client',
  'invalid_grant',
  'invalid_request',
  'redirect_uri_mismatch',
  'temporarily_unavailable',
  'unauthorized_client',
]);

export function safeGoogleOAuthProviderError(body: unknown): string | null {
  const providerError = (body as GoogleOAuthErrorBody).error;
  return typeof providerError === 'string' && SAFE_GOOGLE_OAUTH_ERRORS.has(providerError)
    ? providerError
    : null;
}

export function safeGoogleOAuthProviderReason(body: unknown): GoogleOAuthProviderReason | null {
  const description = (body as GoogleOAuthErrorBody).error_description;
  if (typeof description !== 'string') return null;
  if (/client[_\s-]*secret/i.test(description)) return 'CLIENT_SECRET_REJECTED';
  if (/client[_\s-]*id/i.test(description)) return 'CLIENT_ID_REJECTED';
  if (/code[_\s-]*verifier|pkce/i.test(description)) return 'PKCE_REJECTED';
  if (/redirect[_\s-]*uri/i.test(description)) return 'REDIRECT_URI_REJECTED';
  if (/authorization[_\s-]*code|auth[_\s-]*code|malformed auth/i.test(description)) {
    return 'AUTHORIZATION_CODE_REJECTED';
  }
  if (/grant[_\s-]*type/i.test(description)) return 'GRANT_TYPE_REJECTED';
  return null;
}

export function classifyGoogleOAuthError(
  status: number,
  body: unknown,
  operation: 'TOKEN_EXCHANGE' | 'IDENTITY_LOOKUP',
): SourceProviderError {
  const providerError = safeGoogleOAuthProviderError(body);
  const providerReason = safeGoogleOAuthProviderReason(body);

  if (status === 429) {
    return new SourceProviderError(
      'RATE_LIMITED',
      'Google temporarily rate-limited authorization. Wait briefly and try again.',
      true,
    );
  }
  if (status >= 500 || providerError === 'temporarily_unavailable') {
    return new SourceProviderError(
      'PROVIDER_5XX',
      'Google authorization is temporarily unavailable. Try again shortly.',
      true,
    );
  }
  if (
    providerError === 'invalid_client' ||
    providerError === 'unauthorized_client' ||
    providerError === 'redirect_uri_mismatch' ||
    providerReason === 'CLIENT_SECRET_REJECTED' ||
    providerReason === 'CLIENT_ID_REJECTED' ||
    providerReason === 'REDIRECT_URI_REJECTED'
  ) {
    return new SourceProviderError(
      'OAUTH_CONFIGURATION_REQUIRED',
      'Google rejected the OAuth client configuration. Use a Google OAuth client of type Desktop app and verify the configured client ID and client secret.',
      false,
    );
  }
  if (providerError === 'invalid_grant') {
    return new SourceProviderError(
      'OAUTH_CALLBACK_FAILED',
      'Google rejected the one-time authorization. Start Connect Google again and complete the newest browser window only.',
      false,
    );
  }
  if (providerError === 'access_denied') {
    return new SourceProviderError(
      'OAUTH_CALLBACK_FAILED',
      'Google authorization was denied. Start Connect Google again and grant the read-only permission.',
      false,
    );
  }
  if (operation === 'IDENTITY_LOOKUP' && status === 401) {
    return new SourceProviderError(
      'OAUTH_CALLBACK_FAILED',
      'Google issued an authorization that could not verify the account identity. Start Connect Google again.',
      false,
    );
  }
  return new SourceProviderError(
    'OAUTH_CALLBACK_FAILED',
    operation === 'TOKEN_EXCHANGE'
      ? 'Google rejected the authorization-code exchange. Start Connect Google again.'
      : 'Google account identity could not be retrieved. Start Connect Google again.',
    false,
  );
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

export function classifyGoogleApiError(
  status: number,
  body: unknown,
  retryAfter: string | null = null,
): SourceProviderError {
  const parsed = body as GoogleErrorBody;
  const reasons = new Set(
    parsed.error?.errors
      ?.map((entry) => (typeof entry.reason === 'string' ? entry.reason : null))
      .filter((entry): entry is string => entry !== null) ?? [],
  );
  const limited =
    status === 429 ||
    (status === 403 &&
      ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'].some(
        (reason) => reasons.has(reason),
      ));

  if (limited) {
    return new SourceProviderError(
      'RATE_LIMITED',
      'YouTube API quota or rate limit was reached. Synchronization will retry later.',
      true,
      retryAfterMilliseconds(retryAfter),
    );
  }
  if (status >= 500) {
    return new SourceProviderError(
      'PROVIDER_5XX',
      'YouTube is temporarily unavailable. Synchronization will retry later.',
      true,
    );
  }
  if (status === 401) {
    return new SourceProviderError(
      'AUTH_EXPIRED',
      'Google authorization expired and must be refreshed.',
      true,
    );
  }
  return new SourceProviderError(
    'SOURCE_UNAVAILABLE',
    'YouTube could not complete the requested read-only operation.',
    false,
  );
}

export function classifyNetworkError(): SourceProviderError {
  return new SourceProviderError(
    'NETWORK_UNAVAILABLE',
    'The network is unavailable. Synchronization will retry when connectivity returns.',
    true,
  );
}
