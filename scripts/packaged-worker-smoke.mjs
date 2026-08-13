import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const executable = resolve('apps/desktop/release/win-unpacked/YouTube Backup Manager.exe');
const packagedTools = [
  {
    name: 'yt-dlp',
    executable: resolve('apps/desktop/release/win-unpacked/resources/yt-dlp/yt-dlp.exe'),
    args: ['--version'],
  },
  {
    name: 'FFmpeg',
    executable: resolve('apps/desktop/release/win-unpacked/resources/ffmpeg/ffmpeg.exe'),
    args: ['-version'],
  },
];

function verifyTool(tool) {
  return new Promise((resolveTool, reject) => {
    const toolProcess = spawn(tool.executable, tool.args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    toolProcess.stdout.setEncoding('utf8');
    toolProcess.stdout.on('data', (chunk) => {
      if (output.length < 16 * 1024) output += chunk;
    });
    toolProcess.once('error', reject);
    toolProcess.once('close', (code) => {
      if (code !== 0) reject(new Error(`${tool.name} exited with code ${code}`));
      else if (output.trim() === '') reject(new Error(`${tool.name} returned no version`));
      else resolveTool(output.trim().split(/\r?\n/)[0]);
    });
  });
}

for (const tool of packagedTools) {
  const detected = await verifyTool(tool);
  process.stdout.write(`Packaged ${tool.name}: ${detected}\n`);
}

const temporary = await mkdtemp(join(tmpdir(), 'ytbm-packaged-smoke-'));
const userData = join(temporary, 'user-data');
const localData = join(temporary, 'local-data');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--disable-gpu', '--disable-software-rasterizer', '--worker'], {
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...environment,
    YTBM_ENVIRONMENT: 'test',
    YTBM_USER_DATA_PATH: userData,
    YTBM_LOCAL_DATA_PATH: localData,
  },
});
let processOutput = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  if (processOutput.length < 64 * 1024) processOutput += chunk;
});
child.stderr.on('data', (chunk) => {
  if (processOutput.length < 64 * 1024) processOutput += chunk;
});

try {
  const deadline = Date.now() + 15_000;
  const logPath = join(localData, 'logs', 'worker.jsonl');
  let ready = false;
  while (Date.now() < deadline) {
    await delay(250);
    try {
      const log = await readFile(logPath, 'utf8');
      if (log.includes('Worker ready')) {
        ready = true;
        break;
      }
    } catch {
      // The packaged worker is still starting.
    }
  }
  if (!ready) {
    let workerLog = '';
    try {
      workerLog = await readFile(logPath, 'utf8');
    } catch {
      // The failure may have happened before logging initialized.
    }
    throw new Error(
      `Packaged worker did not reach ready state. Process output: ${processOutput || '(none)'}. Worker log: ${workerLog || '(none)'}`,
    );
  }
  process.stdout.write('Packaged worker reached ready state with managed resource paths.\n');
} finally {
  child.kill();
  await delay(500);
  await rm(temporary, { recursive: true, force: true });
}
