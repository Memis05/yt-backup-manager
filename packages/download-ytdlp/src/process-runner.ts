import { spawn } from 'node:child_process';

export interface ManagedProcessInput {
  executable: string;
  args: readonly string[];
  signal?: AbortSignal;
  onStdoutLine?(line: string): void;
  onStderrLine?(line: string): void;
}

export interface ManagedProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ManagedProcessRunner {
  run(input: ManagedProcessInput): Promise<ManagedProcessResult>;
}

function managedToolEnvironment(): NodeJS.ProcessEnv {
  return {
    ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
    ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }),
    ...(process.env.TEMP === undefined ? {} : { TEMP: process.env.TEMP }),
    ...(process.env.TMP === undefined ? {} : { TMP: process.env.TMP }),
  };
}

function collectLines(
  stream: NodeJS.ReadableStream,
  onLine: ((line: string) => void) | undefined,
  append: (chunk: string) => void,
): void {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    append(chunk);
    pending = (pending + chunk).slice(-64 * 1024);
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      onLine?.(pending.slice(0, newline).trimEnd());
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  });
  stream.on('end', () => {
    if (pending !== '') onLine?.(pending.trimEnd());
  });
}

export class SpawnProcessRunner implements ManagedProcessRunner {
  public async run(input: ManagedProcessInput): Promise<ManagedProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.executable, [...input.args], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: managedToolEnvironment(),
      });
      let stdout = '';
      let stderr = '';
      const appendStdout = (chunk: string): void => {
        const remaining = 4 * 1024 * 1024 - stdout.length;
        if (remaining > 0) stdout += chunk.slice(0, remaining);
      };
      const appendStderr = (chunk: string): void => {
        const remaining = 256 * 1024 - stderr.length;
        if (remaining > 0) stderr += chunk.slice(0, remaining);
      };
      collectLines(child.stdout, input.onStdoutLine, appendStdout);
      collectLines(child.stderr, input.onStderrLine, appendStderr);
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
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });
    });
  }
}
