import { describe, expect, it } from 'vitest';

import { MemoryLogSink, StructuredLogger, redactValue } from '../src';

describe('central log redaction', () => {
  it('redacts structured secrets and secret-bearing strings', () => {
    const output = redactValue({
      accessToken: 'secret-access',
      nested: { refresh_token: 'secret-refresh' },
      credential_ref: 'google-oauth:01',
      url: 'https://example.test/callback?code=abc123&state=ok',
      header: 'Bearer abc.def-123',
      errorCode: 'AUTH_REVOKED',
      code: 'authorization-code-secret',
      codeVerifier: 'pkce-verifier-secret',
      id_token: 'identity-token-secret',
      sessionUri:
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=secret-session',
    });

    expect(JSON.stringify(output)).not.toContain('secret-access');
    expect(JSON.stringify(output)).not.toContain('secret-refresh');
    expect(JSON.stringify(output)).not.toContain('abc123');
    expect(JSON.stringify(output)).not.toContain('abc.def-123');
    expect(JSON.stringify(output)).not.toContain('authorization-code-secret');
    expect(JSON.stringify(output)).not.toContain('pkce-verifier-secret');
    expect(JSON.stringify(output)).not.toContain('identity-token-secret');
    expect(JSON.stringify(output)).not.toContain('secret-session');
    expect(output).toMatchObject({
      accessToken: '[REDACTED]',
      credential_ref: 'google-oauth:01',
      errorCode: 'AUTH_REVOKED',
    });
  });

  it('always applies redaction before writing structured logs', () => {
    const sink = new MemoryLogSink();
    const logger = new StructuredLogger(
      'worker',
      sink,
      { workerInstanceId: 'worker-1' },
      () => new Date('2026-08-11T00:00:00.000Z'),
    );

    logger.error('Request failed with Bearer raw-token', {
      jobId: 'job-1',
      authorization: 'Bearer another-token',
    });

    expect(sink.records).toHaveLength(1);
    expect(JSON.stringify(sink.records[0])).not.toContain('raw-token');
    expect(JSON.stringify(sink.records[0])).not.toContain('another-token');
    expect(sink.records[0]).toMatchObject({
      component: 'worker',
      workerInstanceId: 'worker-1',
      jobId: 'job-1',
    });
  });
});
