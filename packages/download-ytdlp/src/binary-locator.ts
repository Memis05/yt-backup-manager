import { isAbsolute, join, resolve } from 'node:path';

export interface ManagedBinaryLocationOptions {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  developmentOverride?: string | null;
  platform?: NodeJS.Platform;
}

export function resolveYtDlpExecutable(options: ManagedBinaryLocationOptions): string {
  if (
    !options.isPackaged &&
    options.developmentOverride !== undefined &&
    options.developmentOverride !== null
  ) {
    if (!isAbsolute(options.developmentOverride)) {
      throw new Error('The yt-dlp development override must be an absolute path');
    }
    return resolve(options.developmentOverride);
  }
  const executable = (options.platform ?? process.platform) === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  return options.isPackaged
    ? join(options.resourcesPath, 'yt-dlp', executable)
    : resolve(options.appPath, '..', '..', 'resources', 'yt-dlp', executable);
}
