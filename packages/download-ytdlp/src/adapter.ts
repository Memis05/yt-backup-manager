import { lstat, readdir, realpath, rename } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { BackupOperationError, QualityProfileSchema, type QualityProfile } from '@ytbm/core';

import type { ManagedProcessRunner } from './process-runner';
import { SpawnProcessRunner } from './process-runner';
import { selectYtDlpFormats, type SelectedFormat, type YtDlpFormat } from './quality';

export interface DownloadProgress {
  bytesProcessed: number;
  bytesTotal: number | null;
  speedBytesPerSec: number | null;
  etaSeconds: number | null;
}

export interface YtDlpProbeResult extends SelectedFormat {
  providerMediaId: string;
  qualityProfile: QualityProfile;
}

export interface YtDlpDownloadResult {
  videoPath: string;
  audioPath: string | null;
  resumed: boolean;
}

function validateYouTubeUrl(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    !['youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com'].includes(hostname)
  ) {
    throw new BackupOperationError(
      'SOURCE_UNAVAILABLE',
      'The catalog contains an invalid YouTube source URL.',
      {
        disposition: 'FAIL',
      },
    );
  }
  return url.toString();
}

async function assertPhysicalStagingFile(rootPath: string, filePath: string): Promise<string> {
  const root = resolve(rootPath);
  const file = resolve(filePath);
  const relationship = relative(root, file);
  if (
    relationship === '' ||
    relationship === '..' ||
    relationship.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relationship)
  ) {
    throw new BackupOperationError('DOWNLOAD_FAILED', 'yt-dlp output escaped staging.', {
      disposition: 'FAIL',
    });
  }
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new BackupOperationError('DOWNLOAD_FAILED', 'yt-dlp output was not a physical file.', {
      disposition: 'FAIL',
    });
  }
  const physical = await realpath(file);
  const physicalRelationship = relative(await realpath(root), physical);
  if (
    physicalRelationship === '' ||
    physicalRelationship === '..' ||
    physicalRelationship.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(physicalRelationship)
  ) {
    throw new BackupOperationError('DOWNLOAD_FAILED', 'yt-dlp output escaped staging.', {
      disposition: 'FAIL',
    });
  }
  return file;
}

function classifyFailure(stderr: string): BackupOperationError {
  const lower = stderr.toLowerCase();
  if (lower.includes('sign in') || lower.includes('cookies')) {
    return new BackupOperationError(
      'YOUTUBE_SESSION_REQUIRED',
      'This media requires an authenticated YouTube download session.',
      { disposition: 'BLOCK' },
    );
  }
  if (lower.includes('no space left')) {
    return new BackupOperationError(
      'STAGING_UNAVAILABLE',
      'The staging disk does not have enough free space.',
      {
        disposition: 'FAIL',
      },
    );
  }
  if (lower.includes('unavailable') || lower.includes('private video')) {
    return new BackupOperationError(
      'SOURCE_UNAVAILABLE',
      'YouTube reports that this media is unavailable.',
      {
        disposition: 'FAIL',
      },
    );
  }
  if (
    lower.includes('timed out') ||
    lower.includes('temporary failure') ||
    lower.includes('http error 5')
  ) {
    return new BackupOperationError('NETWORK_TIMEOUT', 'The YouTube download failed temporarily.', {
      disposition: 'RETRY',
    });
  }
  return new BackupOperationError('DOWNLOAD_FAILED', 'yt-dlp could not acquire this media.', {
    disposition: 'RETRY',
  });
}

function parseProgress(line: string): DownloadProgress | null {
  if (!line.startsWith('ytbm:')) return null;
  const [processed, total, speed, eta] = line.slice(5).split('|');
  const parse = (value: string | undefined): number | null => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  };
  const bytesProcessed = parse(processed);
  if (bytesProcessed === null) return null;
  return {
    bytesProcessed,
    bytesTotal: parse(total),
    speedBytesPerSec: parse(speed),
    etaSeconds: parse(eta),
  };
}

export class YtDlpAdapter {
  public constructor(
    private readonly executable: string,
    private readonly runner: ManagedProcessRunner = new SpawnProcessRunner(),
  ) {}

  public async version(): Promise<string> {
    const result = await this.runner.run({
      executable: this.executable,
      args: ['--ignore-config', '--version'],
    });
    if (result.exitCode !== 0) throw classifyFailure(result.stderr);
    const version = result.stdout.trim().split(/\r?\n/)[0];
    if (version === undefined || version === '') throw new Error('yt-dlp returned no version');
    return version;
  }

  public async probe(
    providerMediaId: string,
    sourceUrl: string,
    profileInput: QualityProfile,
    signal?: AbortSignal,
  ): Promise<YtDlpProbeResult> {
    const profile = QualityProfileSchema.parse(profileInput);
    const url = validateYouTubeUrl(sourceUrl);
    const result = await this.runner.run({
      executable: this.executable,
      args: [
        '--ignore-config',
        '--dump-single-json',
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--',
        url,
      ],
      ...(signal === undefined ? {} : { signal }),
    });
    if (result.exitCode !== 0) throw classifyFailure(result.stderr);
    let parsed: { formats?: YtDlpFormat[] };
    try {
      parsed = JSON.parse(result.stdout) as { formats?: YtDlpFormat[] };
    } catch (error) {
      throw new BackupOperationError(
        'FORMAT_UNAVAILABLE',
        'yt-dlp returned invalid format metadata.',
        {
          disposition: 'FAIL',
          cause: error,
        },
      );
    }
    const selected = selectYtDlpFormats(parsed.formats ?? [], profile);
    if (selected === null) {
      throw new BackupOperationError(
        'FORMAT_UNAVAILABLE',
        'No eligible YouTube media format was found.',
        {
          disposition: 'FAIL',
        },
      );
    }
    return { providerMediaId, qualityProfile: profile, ...selected };
  }

  public async download(
    sourceUrl: string,
    selection: SelectedFormat,
    stagingDirectory: string,
    options: { signal?: AbortSignal; onProgress?(progress: DownloadProgress): void } = {},
  ): Promise<YtDlpDownloadResult> {
    const url = validateYouTubeUrl(sourceUrl);
    const before = await readdir(stagingDirectory);
    const hadPartial = before.some((name) => name.endsWith('.part'));
    const specs = [
      { formatId: selection.videoFormatId, prefix: 'video.source' },
      ...(selection.audioFormatId === null
        ? []
        : [{ formatId: selection.audioFormatId, prefix: 'audio.source' }]),
    ];
    const results: string[] = [];
    for (const spec of specs) {
      const unexpectedCompleted = (await readdir(stagingDirectory)).filter(
        (name) => name.startsWith(`${spec.prefix}.`) && !name.endsWith('.part'),
      );
      for (const name of unexpectedCompleted) {
        await rename(
          join(stagingDirectory, name),
          join(stagingDirectory, `.ytbm-orphan.${crypto.randomUUID()}.${name}`),
        );
      }
      const result = await this.runner.run({
        executable: this.executable,
        args: [
          '--ignore-config',
          '--no-playlist',
          '--continue',
          '--part',
          '--no-overwrites',
          '--newline',
          '--progress-template',
          'download:ytbm:%(progress.downloaded_bytes)s|%(progress.total_bytes,progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
          '--format',
          spec.formatId,
          '--output',
          join(stagingDirectory, `${spec.prefix}.%(ext)s`),
          '--',
          url,
        ],
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        onStdoutLine: (line) => {
          const progress = parseProgress(line);
          if (progress !== null) options.onProgress?.(progress);
        },
      });
      if (result.exitCode !== 0) {
        if (options.signal?.aborted === true) throw options.signal.reason;
        throw classifyFailure(result.stderr);
      }
      const files = (await readdir(stagingDirectory)).filter(
        (name) => name.startsWith(`${spec.prefix}.`) && !name.endsWith('.part'),
      );
      if (files.length !== 1) {
        throw new BackupOperationError(
          'DOWNLOAD_FAILED',
          'yt-dlp did not produce one expected staging file.',
          {
            disposition: 'RETRY',
          },
        );
      }
      results.push(
        await assertPhysicalStagingFile(stagingDirectory, join(stagingDirectory, files[0]!)),
      );
    }
    return { videoPath: results[0]!, audioPath: results[1] ?? null, resumed: hadPartial };
  }
}
