import { describe, expect, it } from 'vitest';

import {
  classifyGoogleApiError,
  classifyGoogleOAuthError,
  classifyYouTubeMedia,
  parseYouTubeDuration,
  safeGoogleOAuthProviderError,
  safeGoogleOAuthProviderReason,
} from '../src';

describe('YouTube media classification', () => {
  it('parses API durations and distinguishes completed live, short, and video records', () => {
    expect(parseYouTubeDuration('PT1H2M3S')).toBe(3_723);
    expect(parseYouTubeDuration('PT2M59S')).toBe(179);
    expect(parseYouTubeDuration('invalid')).toBeNull();
    expect(
      classifyYouTubeMedia({ durationSeconds: 90, actualEndTime: null, publishedAt: null }),
    ).toBe('SHORT');
    expect(
      classifyYouTubeMedia({
        durationSeconds: 90,
        actualEndTime: null,
        publishedAt: Date.parse('2024-01-01T00:00:00Z'),
      }),
    ).toBe('VIDEO');
    expect(
      classifyYouTubeMedia({ durationSeconds: 181, actualEndTime: null, publishedAt: null }),
    ).toBe('VIDEO');
    expect(
      classifyYouTubeMedia({
        durationSeconds: 60,
        actualEndTime: '2026-08-01T12:00:00.000Z',
        publishedAt: null,
      }),
    ).toBe('LIVE');
  });
});

describe('Google API error classification', () => {
  it('classifies quota/rate limits and transient provider failures as retryable', () => {
    expect(
      classifyGoogleApiError(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }),
    ).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(classifyGoogleApiError(429, {}, '12')).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfterMs: 12_000,
    });
    expect(classifyGoogleApiError(503, {})).toMatchObject({
      code: 'PROVIDER_5XX',
      retryable: true,
    });
  });

  it('returns actionable OAuth errors without exposing provider descriptions', () => {
    expect(
      classifyGoogleOAuthError(400, { error: 'invalid_client' }, 'TOKEN_EXCHANGE'),
    ).toMatchObject({
      code: 'OAUTH_CONFIGURATION_REQUIRED',
      safeMessage: expect.stringContaining('Desktop app'),
    });
    expect(
      classifyGoogleOAuthError(400, { error: 'invalid_grant' }, 'TOKEN_EXCHANGE'),
    ).toMatchObject({
      code: 'OAUTH_CALLBACK_FAILED',
      safeMessage: expect.stringContaining('newest browser window'),
    });
    expect(
      safeGoogleOAuthProviderError({
        error: 'unrecognized_provider_detail',
        error_description: 'credential-bearing detail',
      }),
    ).toBeNull();
    expect(
      safeGoogleOAuthProviderReason({
        error: 'invalid_request',
        error_description: 'The client_secret is missing.',
      }),
    ).toBe('CLIENT_SECRET_REJECTED');
    expect(
      classifyGoogleOAuthError(
        400,
        { error: 'invalid_request', error_description: 'The client_secret is missing.' },
        'TOKEN_EXCHANGE',
      ),
    ).toMatchObject({
      code: 'OAUTH_CONFIGURATION_REQUIRED',
      safeMessage: expect.stringContaining('client secret'),
    });
    expect(
      safeGoogleOAuthProviderReason({ error_description: 'credential-bearing unknown detail' }),
    ).toBeNull();
  });
});
