import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { parse, resolve, win32 } from 'node:path';

import type { VolumeIdentity, VolumeIdentityProvider } from '@ytbm/storage-core';

interface PowerShellVolume {
  uniqueId?: unknown;
  serial?: unknown;
  filesystem?: unknown;
  mountPath?: unknown;
}

export interface ControlledProcessResult {
  exitCode: number;
  stdout: string;
}

export type ControlledProcessRunner = (
  executable: string,
  args: readonly string[],
  environment?: NodeJS.ProcessEnv,
) => Promise<ControlledProcessResult>;

const VOLUME_QUERY_TIMEOUT_MS = 3_000;
const MAX_VOLUME_QUERY_OUTPUT = 64 * 1024;

export function resolveWindowsPowerShellExecutable(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const windowsRoot = environment.SystemRoot?.trim() || environment.WINDIR?.trim();
  const trustedRoot = 'C:\\Windows';
  if (
    windowsRoot !== undefined &&
    windowsRoot !== '' &&
    win32.resolve(windowsRoot).toLowerCase() !== trustedRoot.toLowerCase()
  ) {
    throw new Error('The configured Windows system root is not trusted');
  }
  return win32.join(trustedRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function minimalPowerShellEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
    ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }),
    ...(process.env.TEMP === undefined ? {} : { TEMP: process.env.TEMP }),
    ...(process.env.TMP === undefined ? {} : { TMP: process.env.TMP }),
    ...extra,
  };
}

const DEFAULT_RUNNER: ControlledProcessRunner = async (executable, args, environment) =>
  new Promise((resolveResult, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: minimalPowerShellEnvironment(environment),
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const remaining = MAX_VOLUME_QUERY_OUTPUT - stdout.length;
      if (remaining > 0) stdout += chunk.slice(0, remaining);
    });
    let settled = false;
    const settle = (result: ControlledProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      settle({ exitCode: -1, stdout: '' });
    }, VOLUME_QUERY_TIMEOUT_MS);
    timeout.unref();
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => settle({ exitCode: code ?? -1, stdout }));
  });

const IDENTIFY_SCRIPT = [
  '$target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:YTBM_VOLUME_PATH_B64))',
  '$v = Get-Volume -FilePath $target -ErrorAction Stop',
  '$p = if ($v.DriveLetter) { "$($v.DriveLetter):\\" } else { $target }',
  '[pscustomobject]@{uniqueId=$v.UniqueId;serial=$v.SerialNumber;filesystem=$v.FileSystem;mountPath=$p} | ConvertTo-Json -Compress',
].join('; ');

const LIST_SCRIPT = [
  'Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object {',
  '  [pscustomobject]@{uniqueId=$_.UniqueId;serial=$_.SerialNumber;filesystem=$_.FileSystem;mountPath="$($_.DriveLetter):\\"}',
  '} | ConvertTo-Json -Compress',
].join(' ');

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function parseVolume(value: unknown): VolumeIdentity | null {
  if (value === null || typeof value !== 'object') return null;
  const item = value as PowerShellVolume;
  const mountPath = stringOrNull(item.mountPath);
  if (mountPath === null) return null;
  return {
    volumeGuid: stringOrNull(item.uniqueId),
    volumeSerial: stringOrNull(item.serial),
    filesystemType: stringOrNull(item.filesystem),
    mountPath,
  };
}

function identityMatches(left: VolumeIdentity, right: VolumeIdentity): boolean {
  if (left.volumeGuid !== null) {
    if (right.volumeGuid !== left.volumeGuid) return false;
  } else if (right.volumeGuid !== null) {
    return false;
  }
  if (left.volumeSerial !== null) {
    if (right.volumeSerial !== left.volumeSerial) return false;
  } else if (right.volumeSerial !== null && left.volumeGuid === null) {
    return false;
  }
  if (left.filesystemType !== null && right.filesystemType !== null) {
    if (left.filesystemType.toLowerCase() !== right.filesystemType.toLowerCase()) return false;
  }
  return left.volumeGuid !== null || left.volumeSerial !== null;
}

export class WindowsVolumeIdentityProvider implements VolumeIdentityProvider {
  public constructor(
    private readonly run: ControlledProcessRunner = DEFAULT_RUNNER,
    private readonly platform = process.platform,
    private readonly powershellExecutable = resolveWindowsPowerShellExecutable(),
  ) {}

  public async identify(path: string): Promise<VolumeIdentity | null> {
    const absolutePath = resolve(path);
    if (this.platform !== 'win32' || parse(absolutePath).root.startsWith('\\\\')) return null;
    const encodedPath = Buffer.from(absolutePath, 'utf8').toString('base64');
    const result = await this.run(
      this.powershellExecutable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(IDENTIFY_SCRIPT, 'utf16le').toString('base64'),
      ],
      {
        YTBM_VOLUME_PATH_B64: encodedPath,
      },
    );
    if (result.exitCode !== 0) return null;
    try {
      return parseVolume(JSON.parse(result.stdout) as unknown);
    } catch {
      return null;
    }
  }

  public async findMount(identity: VolumeIdentity): Promise<string | null> {
    if (
      this.platform !== 'win32' ||
      (identity.volumeGuid === null && identity.volumeSerial === null)
    )
      return null;
    const result = await this.run(this.powershellExecutable, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      LIST_SCRIPT,
    ]);
    if (result.exitCode !== 0) return null;
    try {
      const raw = JSON.parse(result.stdout) as unknown;
      const entries = (Array.isArray(raw) ? raw : [raw])
        .map(parseVolume)
        .filter((entry): entry is VolumeIdentity => entry !== null);
      const matches = entries.filter((entry) => identityMatches(entry, identity));
      return matches.length === 1 ? matches[0]!.mountPath : null;
    } catch {
      return null;
    }
  }
}
