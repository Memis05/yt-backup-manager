import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { join, resolve } from 'node:path';

export interface WorkerEndpoints {
  rpc: string;
  singleton: string;
}

export function createUserScopedEndpoints(runtimeDirectory: string): WorkerEndpoints {
  const identity = createHash('sha256')
    .update(`${userInfo().username}\0${resolve(runtimeDirectory)}`)
    .digest('hex')
    .slice(0, 20);

  if (process.platform === 'win32') {
    return {
      rpc: `\\\\.\\pipe\\ytbm-${identity}-rpc`,
      singleton: `\\\\.\\pipe\\ytbm-${identity}-singleton`,
    };
  }

  return {
    rpc: join(runtimeDirectory, `ytbm-${identity}-rpc.sock`),
    singleton: join(runtimeDirectory, `ytbm-${identity}-singleton.sock`),
  };
}
