import { spawn } from 'node:child_process';
import { link, lstat, realpath, stat, unlink, rename } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import { BackupOperationError } from '@ytbm/core';

export interface FfmpegProcessInput {
  executable: string;
  args: readonly string[];
  signal?: AbortSignal;
}

export interface FfmpegProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface FfmpegProcessRunner {
  run(input: FfmpegProcessInput): Promise<FfmpegProcessResult>;
}

function managedToolEnvironment(): NodeJS.ProcessEnv {
  return {
    ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
    ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }),
    ...(process.env.TEMP === undefined ? {} : { TEMP: process.env.TEMP }),
    ...(process.env.TMP === undefined ? {} : { TMP: process.env.TMP }),
  };
}

class SpawnFfmpegProcessRunner implements FfmpegProcessRunner {
  public async run(input: FfmpegProcessInput): Promise<FfmpegProcessResult> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(input.executable, [...input.args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: managedToolEnvironment(),
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        const remaining = 64 * 1024 - stdout.length;
        if (remaining > 0) stdout += chunk.slice(0, remaining);
      });
      child.stderr.on('data', (chunk: string) => {
        const remaining = 256 * 1024 - stderr.length;
        if (remaining > 0) stderr += chunk.slice(0, remaining);
      });
      let forceKillTimer: NodeJS.Timeout | null = null;
      const abort = (): void => {
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
        forceKillTimer.unref();
      };
      input.signal?.addEventListener('abort', abort, { once: true });
      child.once('error', reject);
      child.once('close', (code) => {
        if (forceKillTimer !== null) clearTimeout(forceKillTimer);
        input.signal?.removeEventListener('abort', abort);
        resolveResult({ exitCode: code ?? -1, stdout, stderr });
      });
    });
  }
}

export interface FfmpegPostProcessInput {
  stagingRoot: string;
  videoPath: string;
  audioPath: string | null;
  signal?: AbortSignal;
}

export interface FfmpegPostProcessResult {
  path: string;
  container: 'mp4' | 'webm' | 'mkv';
  merged: boolean;
}

function assertInside(rootPath: string, candidatePath: string): string {
  const root = resolve(rootPath);
  const candidate = resolve(candidatePath);
  const relationship = relative(root, candidate);
  if (
    relationship === '' ||
    relationship === '..' ||
    relationship.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relationship)
  ) {
    throw new BackupOperationError('FFMPEG_FAILED', 'FFmpeg input escaped the staging directory.', {
      disposition: 'FAIL',
    });
  }
  return candidate;
}

async function assertPhysicalFileInside(rootPath: string, candidatePath: string): Promise<string> {
  const candidate = assertInside(rootPath, candidatePath);
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new BackupOperationError('FFMPEG_FAILED', 'FFmpeg input was not a physical file.', {
      disposition: 'FAIL',
    });
  }
  assertInside(rootPath, await realpath(candidate));
  return candidate;
}

function chooseContainer(videoPath: string, audioPath: string): 'mp4' | 'webm' | 'mkv' {
  const video = extname(videoPath).toLowerCase();
  const audio = extname(audioPath).toLowerCase();
  if (video === '.webm' && (audio === '.webm' || audio === '.opus')) return 'webm';
  if ((video === '.mp4' || video === '.m4v') && (audio === '.m4a' || audio === '.mp4'))
    return 'mp4';
  return 'mkv';
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export class FfmpegAdapter {
  public constructor(
    private readonly executable: string,
    private readonly runner: FfmpegProcessRunner = new SpawnFfmpegProcessRunner(),
  ) {}

  public async version(): Promise<string> {
    const result = await this.runner.run({ executable: this.executable, args: ['-version'] });
    if (result.exitCode !== 0) {
      throw new BackupOperationError('FFMPEG_FAILED', 'FFmpeg version detection failed.', {
        disposition: 'FAIL',
      });
    }
    const firstLine = result.stdout.trim().split(/\r?\n/)[0];
    return firstLine?.replace(/^ffmpeg version\s+/i, '').split(/\s+/)[0] ?? 'unknown';
  }

  public async postProcess(input: FfmpegPostProcessInput): Promise<FfmpegPostProcessResult> {
    const videoPath = await assertPhysicalFileInside(input.stagingRoot, input.videoPath);
    if (input.audioPath === null) {
      const container = extname(videoPath).slice(1).toLowerCase();
      return {
        path: videoPath,
        container: container === 'mp4' || container === 'webm' ? container : 'mkv',
        merged: false,
      };
    }
    const audioPath = await assertPhysicalFileInside(input.stagingRoot, input.audioPath);
    const container = chooseContainer(videoPath, audioPath);
    const finalPath = join(resolve(input.stagingRoot), `merged.${container}`);
    if (await exists(finalPath)) {
      await rename(
        finalPath,
        join(resolve(input.stagingRoot), `.ytbm-orphan.${crypto.randomUUID()}.merged.${container}`),
      );
    }
    const temporaryPath = join(
      resolve(input.stagingRoot),
      `.merged.${crypto.randomUUID()}.ytbm-tmp.${container}`,
    );
    const result = await this.runner.run({
      executable: this.executable,
      args: [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        videoPath,
        '-i',
        audioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c',
        'copy',
        temporaryPath,
      ],
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (result.exitCode !== 0 || !(await exists(temporaryPath))) {
      await unlink(temporaryPath).catch(() => undefined);
      if (input.signal?.aborted === true) throw input.signal.reason;
      throw new BackupOperationError(
        'FFMPEG_FAILED',
        'FFmpeg could not merge the selected media streams.',
        {
          disposition: 'RETRY',
        },
      );
    }
    try {
      await link(temporaryPath, finalPath);
      await unlink(temporaryPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new BackupOperationError(
        'FFMPEG_FAILED',
        'FFmpeg output could not be promoted without overwriting an existing file.',
        { disposition: 'RETRY', cause: error },
      );
    }
    await assertPhysicalFileInside(input.stagingRoot, finalPath);
    return { path: finalPath, container, merged: true };
  }
}
