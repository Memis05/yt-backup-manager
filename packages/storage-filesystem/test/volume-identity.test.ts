import { describe, expect, it, vi } from 'vitest';

import { resolveWindowsPowerShellExecutable, WindowsVolumeIdentityProvider } from '../src';

describe('WindowsVolumeIdentityProvider', () => {
  it('rejects an inherited system root that points to an arbitrary directory', () => {
    expect(() =>
      resolveWindowsPowerShellExecutable({ SystemRoot: 'C:\\Users\\Public\\fake-windows' }),
    ).toThrow(/not trusted/);
  });
  it('recognizes the same volume after its drive letter changes', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          uniqueId: '\\\\?\\Volume{stable}\\',
          serial: '1234-ABCD',
          filesystem: 'NTFS',
          mountPath: 'E:\\',
        }),
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify([
          {
            uniqueId: '\\\\?\\Volume{other}\\',
            serial: '0000',
            filesystem: 'NTFS',
            mountPath: 'E:\\',
          },
          {
            uniqueId: '\\\\?\\Volume{stable}\\',
            serial: '1234-ABCD',
            filesystem: 'NTFS',
            mountPath: 'F:\\',
          },
        ]),
      });
    const provider = new WindowsVolumeIdentityProvider(run, 'win32');
    const identity = await provider.identify('E:\\YouTube Backup');

    expect(identity?.volumeGuid).toBe('\\\\?\\Volume{stable}\\');
    await expect(provider.findMount(identity!)).resolves.toBe('F:\\');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('falls back to serial plus filesystem when a volume GUID is unavailable', async () => {
    const run = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ serial: 'SERIAL', filesystem: 'exFAT', mountPath: 'G:\\' }),
    });
    const provider = new WindowsVolumeIdentityProvider(run, 'win32');

    await expect(
      provider.findMount({
        volumeGuid: null,
        volumeSerial: 'SERIAL',
        filesystemType: 'exFAT',
        mountPath: 'E:\\',
      }),
    ).resolves.toBe('G:\\');
  });

  it('rejects a GUID match when the remaining identity evidence conflicts', async () => {
    const run = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        uniqueId: '\\\\?\\Volume{stable}\\',
        serial: 'SPOOFED',
        filesystem: 'NTFS',
        mountPath: 'G:\\',
      }),
    });
    const provider = new WindowsVolumeIdentityProvider(run, 'win32');

    await expect(
      provider.findMount({
        volumeGuid: '\\\\?\\Volume{stable}\\',
        volumeSerial: 'ORIGINAL',
        filesystemType: 'NTFS',
        mountPath: 'E:\\',
      }),
    ).resolves.toBeNull();
  });
});
