import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EncryptedFileCredentialStore, type EncryptionAdapter } from '../src';

const directories: string[] = [];
const xorKey = 0xa5;
const testEncryption: EncryptionAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext) => Buffer.from(plaintext, 'utf8').map((byte) => byte ^ xorKey),
  decryptString: (ciphertext) =>
    Buffer.from(Uint8Array.from(ciphertext, (byte) => byte ^ xorKey)).toString('utf8'),
};

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('encrypted credential-store foundation', () => {
  it('persists ciphertext outside SQLite and round-trips only through its adapter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-credentials-test-'));
    directories.push(directory);
    const store = new EncryptedFileCredentialStore(directory, testEncryption);

    await store.set('google-oauth:01', 'refresh-token-secret');
    const [file] = await readdir(directory);
    expect(file).toMatch(/^[a-f0-9]{64}\.credential$/);
    const bytes = await readFile(join(directory, file!));
    expect(bytes.toString('utf8')).not.toContain('refresh-token-secret');
    await expect(store.get('google-oauth:01')).resolves.toBe('refresh-token-secret');

    await store.delete('google-oauth:01');
    await expect(store.get('google-oauth:01')).resolves.toBeNull();
  });

  it('refuses plaintext persistence when OS encryption is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-credentials-test-'));
    directories.push(directory);
    const store = new EncryptedFileCredentialStore(directory, {
      ...testEncryption,
      isEncryptionAvailable: () => false,
    });

    await expect(store.set('google-oauth:01', 'secret')).rejects.toThrow(
      /encryption is unavailable/i,
    );
  });
});
