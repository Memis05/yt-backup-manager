import { safeStorage } from 'electron';

import type { EncryptionAdapter } from '@ytbm/security';

export class ElectronSafeStorageAdapter implements EncryptionAdapter {
  public isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  public encryptString(plaintext: string): Uint8Array {
    return safeStorage.encryptString(plaintext);
  }

  public decryptString(ciphertext: Uint8Array): string {
    return safeStorage.decryptString(Buffer.from(ciphertext));
  }
}
