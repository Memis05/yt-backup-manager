import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

import { z } from 'zod';

const EnvironmentSchema = z.enum(['development', 'production', 'test']);

export interface RuntimePaths {
  userData: string;
  localData: string;
  runtime: string;
  database: string;
  logs: string;
  credentials: string;
  rpcToken: string;
  staging: string;
}

export interface RuntimeConfig {
  environment: z.infer<typeof EnvironmentSchema>;
  paths: RuntimePaths;
  googleOAuthClientId: string | null;
  googleOAuthClientSecret: string | null;
  ytDlpExecutableOverride: string | null;
  ffmpegExecutableOverride: string | null;
}

export interface RuntimePathDefaults {
  userData: string;
  localData: string;
}

export interface DevelopmentEnvironmentOptions {
  isPackaged: boolean;
  appPath: string;
  workingDirectory?: string;
}

export function loadDevelopmentEnvironment({
  isPackaged,
  appPath,
  workingDirectory = process.cwd(),
}: DevelopmentEnvironmentOptions): string | null {
  if (isPackaged) return null;

  const candidates = [
    resolve(workingDirectory, '.env'),
    resolve(appPath, '.env'),
    resolve(appPath, '..', '..', '.env'),
  ];
  const environmentFile = candidates.find((candidate) => existsSync(candidate));
  if (environmentFile === undefined) return null;

  loadEnvFile(environmentFile);
  return environmentFile;
}

function optionalPath(value: string | undefined, fallback: string): string {
  return value === undefined || value.trim() === '' ? resolve(fallback) : resolve(value);
}

export function loadRuntimeConfig(defaults: RuntimePathDefaults): RuntimeConfig {
  const environment = EnvironmentSchema.parse(
    process.env.YTBM_ENVIRONMENT ??
      (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
  );
  const userData = optionalPath(process.env.YTBM_USER_DATA_PATH, defaults.userData);
  const localData = optionalPath(process.env.YTBM_LOCAL_DATA_PATH, defaults.localData);
  const configuredGoogleClientId = process.env.YTBM_GOOGLE_OAUTH_CLIENT_ID?.trim();
  const configuredGoogleClientSecret = process.env.YTBM_GOOGLE_OAUTH_CLIENT_SECRET?.trim();

  return {
    environment,
    googleOAuthClientId:
      configuredGoogleClientId === undefined || configuredGoogleClientId === ''
        ? null
        : z.string().min(1).max(300).parse(configuredGoogleClientId),
    googleOAuthClientSecret:
      configuredGoogleClientSecret === undefined || configuredGoogleClientSecret === ''
        ? null
        : z.string().min(1).max(300).parse(configuredGoogleClientSecret),
    paths: {
      userData,
      localData,
      runtime: join(localData, 'runtime'),
      database: optionalPath(process.env.YTBM_DATABASE_PATH, join(userData, 'app.db')),
      logs: join(localData, 'logs'),
      credentials: join(userData, 'credentials'),
      rpcToken: join(userData, 'worker-rpc.token'),
      staging: optionalPath(process.env.YTBM_STAGING_PATH, join(localData, 'staging')),
    },
    ytDlpExecutableOverride:
      process.env.YTBM_YTDLP_PATH === undefined || process.env.YTBM_YTDLP_PATH.trim() === ''
        ? null
        : resolve(process.env.YTBM_YTDLP_PATH),
    ffmpegExecutableOverride:
      process.env.YTBM_FFMPEG_PATH === undefined || process.env.YTBM_FFMPEG_PATH.trim() === ''
        ? null
        : resolve(process.env.YTBM_FFMPEG_PATH),
  };
}
