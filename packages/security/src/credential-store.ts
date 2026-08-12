import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface CredentialStore {
  get(reference: string): Promise<string | null>;
  set(reference: string, plaintext: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export interface EncryptionAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Uint8Array;
  decryptString(ciphertext: Uint8Array): string;
}

function validateReference(reference: string): void {
  if (!/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(reference)) {
    throw new Error('Credential reference is invalid');
  }
}

export class EncryptedFileCredentialStore implements CredentialStore {
  public constructor(
    private readonly directory: string,
    private readonly encryption: EncryptionAdapter,
  ) {}

  public async get(reference: string): Promise<string | null> {
    const filePath = this.filePath(reference);
    try {
      const encrypted = await readFile(filePath);
      return this.encryption.decryptString(encrypted);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      throw error;
    }
  }

  public async set(reference: string, plaintext: string): Promise<void> {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('Secure operating-system encryption is unavailable');
    }

    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const filePath = this.filePath(reference);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    const encrypted = this.encryption.encryptString(plaintext);
    await writeFile(temporaryPath, encrypted, { mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, filePath);
  }

  public async delete(reference: string): Promise<void> {
    await rm(this.filePath(reference), { force: true });
  }

  private filePath(reference: string): string {
    validateReference(reference);
    const name = createHash('sha256').update(reference).digest('hex');
    return join(this.directory, `${name}.credential`);
  }
}
