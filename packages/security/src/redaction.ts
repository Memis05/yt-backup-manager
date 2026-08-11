const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'refreshtoken',
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'clientsecret',
  'oauthsecret',
  'authcode',
  'password',
  'passphrase',
  'sessiontoken',
  'sessioncookie',
  'browsercookies',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('clientsecret')
  );
}

export function redactString(value: string): string {
  return value
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replaceAll(
      /([?&](?:access_token|refresh_token|code|client_secret|x-goog-signature)=)[^&#\s]+/gi,
      `$1${REDACTED}`,
    )
    .replaceAll(/\b(?:eyJ[A-Za-z0-9_-]+)\.(?:[A-Za-z0-9_-]+)\.(?:[A-Za-z0-9_-]+)\b/g, REDACTED);
}

function redactInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return redactString(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactInternal(entry, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED : redactInternal(entry, seen);
  }
  return redacted;
}

export function redactValue(value: unknown): unknown {
  return redactInternal(value, new WeakSet<object>());
}
