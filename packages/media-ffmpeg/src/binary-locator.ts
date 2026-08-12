import { isAbsolute, join, resolve } from 'node:path';

export interface FfmpegBinaryLocationOptions {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  developmentOverride?: string | null;
  platform?: NodeJS.Platform;
}

export function resolveFfmpegExecutable(options: FfmpegBinaryLocationOptions): string {
  if (
    !options.isPackaged &&
    options.developmentOverride !== undefined &&
    options.developmentOverride !== null
  ) {
    if (!isAbsolute(options.developmentOverride)) {
      throw new Error('The FFmpeg development override must be an absolute path');
    }
    return resolve(options.developmentOverride);
  }
  const executable = (options.platform ?? process.platform) === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return options.isPackaged
    ? join(options.resourcesPath, 'ffmpeg', executable)
    : resolve(options.appPath, '..', '..', 'resources', 'ffmpeg', executable);
}
