import { join, resolve } from 'node:path';

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
}

export interface RuntimeConfig {
  environment: z.infer<typeof EnvironmentSchema>;
  paths: RuntimePaths;
}

export interface RuntimePathDefaults {
  userData: string;
  localData: string;
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

  return {
    environment,
    paths: {
      userData,
      localData,
      runtime: join(localData, 'runtime'),
      database: optionalPath(process.env.YTBM_DATABASE_PATH, join(userData, 'app.db')),
      logs: join(localData, 'logs'),
      credentials: join(userData, 'credentials'),
      rpcToken: join(userData, 'worker-rpc.token'),
    },
  };
}
