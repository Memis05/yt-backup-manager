import { classifyGoogleApiError, classifyNetworkError, SourceProviderError } from './errors';
import type { FetchLike } from './oauth';

export interface GoogleAccessTokenProvider {
  getAccessToken(accountId: string, forceRefresh?: boolean): Promise<string>;
  markAuthorizationInvalid?(accountId: string): Promise<void>;
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return {};
  }
}

export class YouTubeApiClient {
  public constructor(
    private readonly tokens: GoogleAccessTokenProvider,
    private readonly fetcher: FetchLike = fetch,
    private readonly endpoint = 'https://www.googleapis.com/youtube/v3',
  ) {}

  public async get(
    accountId: string,
    resource: string,
    parameters: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    return this.request(accountId, resource, parameters, false);
  }

  private async request(
    accountId: string,
    resource: string,
    parameters: Readonly<Record<string, string>>,
    refreshed: boolean,
  ): Promise<unknown> {
    const token = await this.tokens.getAccessToken(accountId, refreshed);
    const url = new URL(`${this.endpoint}/${resource}`);
    url.search = new URLSearchParams(parameters).toString();
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw classifyNetworkError();
    }
    const body = await responseJson(response);
    if (response.ok) return body;
    if (response.status === 401 && !refreshed) {
      return this.request(accountId, resource, parameters, true);
    }
    const error = classifyGoogleApiError(
      response.status,
      body,
      response.headers.get('Retry-After'),
    );
    if (error.code === 'AUTH_EXPIRED') {
      await this.tokens.markAuthorizationInvalid?.(accountId);
      throw new SourceProviderError(
        'AUTH_REVOKED',
        'Google authorization is no longer valid. Reconnect this account.',
        false,
      );
    }
    throw error;
  }
}
