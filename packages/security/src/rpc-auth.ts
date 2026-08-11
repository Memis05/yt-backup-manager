import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export class RpcAuthTokenStore {
  public constructor(private readonly tokenPath: string) {}

  public async loadOrCreate(): Promise<string> {
    try {
      return await this.readValidated();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    await mkdir(dirname(this.tokenPath), { recursive: true, mode: 0o700 });
    const token = randomBytes(32).toString('hex');
    try {
      await writeFile(this.tokenPath, token, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return this.readValidated();
    }
  }

  private async readValidated(): Promise<string> {
    const token = (await readFile(this.tokenPath, 'utf8')).trim();
    if (!TOKEN_PATTERN.test(token)) {
      throw new Error('Worker RPC authentication token is invalid');
    }
    return token;
  }
}

export function tokensMatch(expected: string, received: string): boolean {
  if (!TOKEN_PATTERN.test(expected) || !TOKEN_PATTERN.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}
