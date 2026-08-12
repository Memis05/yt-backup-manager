import { shell, type WebContents } from 'electron';

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'drive.google.com',
]);

const GOOGLE_DRIVE_PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{3,500}$/;

export function googleDriveObjectUrl(providerId: string): string {
  if (!GOOGLE_DRIVE_PROVIDER_ID_PATTERN.test(providerId)) {
    throw new Error('Google Drive object identity was rejected');
  }
  const url = new URL('https://drive.google.com/open');
  url.searchParams.set('id', providerId);
  return url.toString();
}

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isAllowedGoogleOAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'accounts.google.com' &&
      url.pathname === '/o/oauth2/v2/auth' &&
      url.searchParams.get('response_type') === 'code' &&
      url.searchParams.get('code_challenge_method') === 'S256' &&
      url.searchParams.has('state')
    );
  } catch {
    return false;
  }
}

export function secureWebContentsNavigation(webContents: WebContents): void {
  webContents.on('will-navigate', (event, url) => {
    if (url !== webContents.getURL()) event.preventDefault();
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}
