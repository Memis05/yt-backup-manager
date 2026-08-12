import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FfmpegAdapter, resolveFfmpegExecutable, type FfmpegProcessRunner } from '../src';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('FfmpegAdapter', () => {
  it('uses safe argument arrays, stream copy, a temporary output, then promotion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-ffmpeg-'));
    temporaryDirectories.push(directory);
    const videoPath = join(directory, 'video.source.webm');
    const audioPath = join(directory, 'audio.source.webm');
    await Promise.all([writeFile(videoPath, 'video'), writeFile(audioPath, 'audio')]);
    const run = vi.fn(async (input) => {
      await writeFile(input.args.at(-1)!, 'merged');
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const adapter = new FfmpegAdapter('C:\\managed\\ffmpeg.exe', { run });

    const result = await adapter.postProcess({ stagingRoot: directory, videoPath, audioPath });

    expect(result).toMatchObject({ container: 'webm', merged: true });
    await expect(stat(result.path)).resolves.toMatchObject({ size: 6 });
    const args = run.mock.calls[0]![0].args;
    expect(args).toContain('copy');
    expect(args.at(-1)).toContain('.ytbm-tmp.webm');
  });

  it('does not promote a failed FFmpeg result and retries safely', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-ffmpeg-'));
    temporaryDirectories.push(directory);
    const videoPath = join(directory, 'video.source.mp4');
    const audioPath = join(directory, 'audio.source.m4a');
    await Promise.all([writeFile(videoPath, 'video'), writeFile(audioPath, 'audio')]);
    const runner: FfmpegProcessRunner = {
      run: vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'failure' }),
    };
    const adapter = new FfmpegAdapter('ffmpeg.exe', runner);

    await expect(
      adapter.postProcess({ stagingRoot: directory, videoPath, audioPath }),
    ).rejects.toMatchObject({
      code: 'FFMPEG_FAILED',
    });
    await expect(stat(join(directory, 'merged.mp4'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(videoPath)).resolves.toBeDefined();
    await expect(stat(audioPath)).resolves.toBeDefined();

    (runner.run as ReturnType<typeof vi.fn>).mockImplementationOnce(async (input) => {
      await writeFile(input.args.at(-1)!, 'merged after retry');
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    await expect(
      adapter.postProcess({ stagingRoot: directory, videoPath, audioPath }),
    ).resolves.toMatchObject({
      container: 'mp4',
      merged: true,
    });
    await expect(stat(join(directory, 'merged.mp4'))).resolves.toMatchObject({ size: 18 });
  });

  it('quarantines a pre-existing merged output and reruns FFmpeg', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ytbm-ffmpeg-untrusted-'));
    temporaryDirectories.push(directory);
    const videoPath = join(directory, 'video.source.webm');
    const audioPath = join(directory, 'audio.source.webm');
    await Promise.all([
      writeFile(videoPath, 'video'),
      writeFile(audioPath, 'audio'),
      writeFile(join(directory, 'merged.webm'), 'untrusted'),
    ]);
    const run = vi.fn(async (input) => {
      await writeFile(input.args.at(-1)!, 'fresh');
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const adapter = new FfmpegAdapter('ffmpeg.exe', { run });

    await expect(
      adapter.postProcess({ stagingRoot: directory, videoPath, audioPath }),
    ).resolves.toMatchObject({ path: join(directory, 'merged.webm') });
    expect(run).toHaveBeenCalledTimes(1);
    expect((await readdir(directory)).some((name) => name.startsWith('.ytbm-orphan.'))).toBe(true);
  });

  it('rejects an input outside the staging root', async () => {
    const runner: FfmpegProcessRunner = { run: vi.fn() };
    const adapter = new FfmpegAdapter('ffmpeg.exe', runner);
    await expect(
      adapter.postProcess({
        stagingRoot: 'C:\\staging\\abc',
        videoPath: 'C:\\outside\\video.mp4',
        audioPath: null,
      }),
    ).rejects.toMatchObject({ code: 'FFMPEG_FAILED' });
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('managed FFmpeg location', () => {
  it('resolves packaged FFmpeg outside ASAR', () => {
    expect(
      resolveFfmpegExecutable({
        isPackaged: true,
        resourcesPath: 'C:\\app\\resources',
        appPath: 'C:\\repo\\apps\\desktop',
        platform: 'win32',
      }),
    ).toBe('C:\\app\\resources\\ffmpeg\\ffmpeg.exe');
  });

  it('ignores executable overrides in packaged builds', () => {
    expect(
      resolveFfmpegExecutable({
        isPackaged: true,
        resourcesPath: 'C:\\app\\resources',
        appPath: 'C:\\repo\\apps\\desktop',
        developmentOverride: 'C:\\attacker\\ffmpeg.exe',
        platform: 'win32',
      }),
    ).toBe('C:\\app\\resources\\ffmpeg\\ffmpeg.exe');
  });
});
