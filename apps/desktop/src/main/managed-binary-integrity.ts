import { hashFileSha256 } from '@ytbm/integrity';

export interface ManagedBinaryIntegrityInput {
  name: string;
  path: string;
  expectedSha256: string;
}

export async function verifyManagedBinaryIntegrity(
  binaries: readonly ManagedBinaryIntegrityInput[],
): Promise<void> {
  for (const binary of binaries) {
    const actual = await hashFileSha256(binary.path);
    if (actual.sha256 !== binary.expectedSha256.toLowerCase()) {
      throw new Error(`${binary.name} failed the packaged executable integrity check`);
    }
  }
}
