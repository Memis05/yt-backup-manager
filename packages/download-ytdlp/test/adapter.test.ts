import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { YtDlpAdapter, resolveYtDlpExecutable, type ManagedProcessRunner } from '../src';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('YtDlpAdapter', () => {
  it('passes hostile URL metacharacters as one non-shell argument', async () => {
    const run = vi.fn<ManagedProcessRunner['run']>(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        formats: [{ format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'aac', height: 720 }],
      }),
      stderr: '',
    }));
    const adapter = new YtDlpAdapter('C:\\managed\\yt-dlp.exe', { run });

    await adapter.probe('abc', 'https://www.youtube.com/watch?v=abc%26calc.exe', 'MAX_1080P');

    const input = run.mock.calls[0]![0];
    expect(input.args.at(-1)).toBe('https://www.youtube.com/watch?v=abc%26calc.exe');
    expect(input.args).toContain('--');
    expect(input.args).toContain('--ignore-config');
    expect(input).not.toHaveProperty('shell');
  });

  it('rejects non-YouTube and credential-bearing URLs before process execution', async () => {
    const runner: ManagedProcessRunner = { run: vi.fn() };
    const adapter = new YtDlpAdapter('yt-dlp.exe', runner);

    await expect(
      adapter.probe('abc', 'https://example.com/video', 'MAX_720P'),
    ).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    });
    await expect(
      adapter.probe('abc', 'https://user:secret@youtube.com/watch?v=abc', 'MAX_720P'),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('retains and recognizes resumable partial state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-ytdlp-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'video.source.webm.part'), 'partial');
    const runner: ManagedProcessRunner = {
      run: vi.fn(async (input) => {
        const outputIndex = input.args.indexOf('--output');
        const template = input.args[outputIndex + 1]!;
        await writeFile(template.replace('%(ext)s', 'webm'), 'complete');
        input.onStdoutLine?.('ytbm:8|10|2|1');
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    };
    const progress = vi.fn();
    const adapter = new YtDlpAdapter('yt-dlp.exe', runner);

    const result = await adapter.download(
      'https://www.youtube.com/watch?v=abc',
      {
        videoFormatId: '137',
        audioFormatId: null,
        container: 'webm',
        videoCodec: 'vp9',
        audioCodec: 'opus',
        width: 1920,
        height: 1080,
        fps: 30,
        expectedBytes: 10,
      },
      directory,
      { onProgress: progress },
    );

    expect(result.resumed).toBe(true);
    expect(result.videoPath.endsWith('video.source.webm')).toBe(true);
    expect(progress).toHaveBeenCalledWith({
      bytesProcessed: 8,
      bytesTotal: 10,
      speedBytesPerSec: 2,
      etaSeconds: 1,
    });
    expect((runner.run as ReturnType<typeof vi.fn>).mock.calls[0]![0].args).toContain('--continue');
  });

  it('quarantines a pre-existing completed output instead of adopting it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-ytdlp-untrusted-'));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, 'video.source.webm'), 'untrusted');
    const runner: ManagedProcessRunner = {
      run: vi.fn(async (input) => {
        const outputIndex = input.args.indexOf('--output');
        await writeFile(input.args[outputIndex + 1]!.replace('%(ext)s', 'webm'), 'downloaded');
        return { exitCode: 0, stdout: '', stderr: '' };
      }),
    };
    const adapter = new YtDlpAdapter('yt-dlp.exe', runner);

    await expect(
      adapter.download(
        'https://www.youtube.com/watch?v=abc',
        {
          videoFormatId: '248',
          audioFormatId: null,
          container: 'webm',
          videoCodec: 'vp9',
          audioCodec: null,
          width: 1920,
          height: 1080,
          fps: 30,
          expectedBytes: null,
        },
        directory,
      ),
    ).resolves.toMatchObject({ videoPath: join(directory, 'video.source.webm') });
    expect((await readdir(directory)).some((name) => name.startsWith('.ytbm-orphan.'))).toBe(true);
  });

  it.each([10, 50, 90])('preserves a partial file when cancelled at %i%%', async (percent) => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-ytdlp-cancel-'));
    temporaryDirectories.push(directory);
    const controller = new AbortController();
    const runner: ManagedProcessRunner = {
      run: vi.fn(async (input) => {
        const outputIndex = input.args.indexOf('--output');
        const template = input.args[outputIndex + 1]!;
        await writeFile(
          `${template.replace('%(ext)s', 'webm')}.part`,
          Buffer.alloc(percent * 10, 0x2a),
        );
        controller.abort(new Error('cancel fixture'));
        return { exitCode: -1, stdout: '', stderr: '' };
      }),
    };
    const adapter = new YtDlpAdapter('yt-dlp.exe', runner);

    await expect(
      adapter.download(
        'https://www.youtube.com/watch?v=abc',
        {
          videoFormatId: '248',
          audioFormatId: null,
          container: 'webm',
          videoCodec: 'vp9',
          audioCodec: null,
          width: 1920,
          height: 1080,
          fps: 30,
          expectedBytes: null,
        },
        directory,
        { signal: controller.signal },
      ),
    ).rejects.toThrow('cancel fixture');
    await expect(stat(join(directory, 'video.source.webm.part'))).resolves.toMatchObject({
      size: percent * 10,
    });
  });

  it('classifies a transient process failure as retryable', async () => {
    const runner: ManagedProcessRunner = {
      run: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'HTTP Error 503: timed out' })),
    };
    const adapter = new YtDlpAdapter('yt-dlp.exe', runner);

    await expect(adapter.probe('abc', 'https://youtu.be/abc', 'MAX_720P')).rejects.toMatchObject({
      code: 'NETWORK_TIMEOUT',
      disposition: 'RETRY',
    });
  });
});

describe('managed yt-dlp location', () => {
  it('uses deterministic unpacked and packaged resource paths', () => {
    expect(
      resolveYtDlpExecutable({
        isPackaged: true,
        resourcesPath: 'C:\\app\\resources',
        appPath: 'C:\\repo\\apps\\desktop',
        platform: 'win32',
      }),
    ).toBe('C:\\app\\resources\\yt-dlp\\yt-dlp.exe');
    expect(
      resolveYtDlpExecutable({
        isPackaged: false,
        resourcesPath: 'unused',
        appPath: 'C:\\repo\\apps\\desktop',
        platform: 'win32',
      }),
    ).toBe('C:\\repo\\resources\\yt-dlp\\yt-dlp.exe');
  });

  it('requires an absolute privileged development override', () => {
    expect(() =>
      resolveYtDlpExecutable({
        isPackaged: false,
        resourcesPath: 'unused',
        appPath: 'C:\\repo\\apps\\desktop',
        developmentOverride: '.\\yt-dlp.exe',
        platform: 'win32',
      }),
    ).toThrow(/absolute/);
  });

  it('ignores executable overrides in packaged builds', () => {
    expect(
      resolveYtDlpExecutable({
        isPackaged: true,
        resourcesPath: 'C:\\app\\resources',
        appPath: 'C:\\repo\\apps\\desktop',
        developmentOverride: 'C:\\attacker\\yt-dlp.exe',
        platform: 'win32',
      }),
    ).toBe('C:\\app\\resources\\yt-dlp\\yt-dlp.exe');
  });
});
