import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';

const manifest = JSON.parse(await readFile(resolve('resources/managed-binaries.json'), 'utf8'));
const binaries = [
  {
    name: 'yt-dlp',
    path: resolve('resources/yt-dlp/yt-dlp.exe'),
    args: ['--version'],
    expected: manifest.ytDlp,
  },
  {
    name: 'FFmpeg',
    path: resolve('resources/ffmpeg/ffmpeg.exe'),
    args: ['-version'],
    expected: manifest.ffmpeg,
  },
];

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function version(executable, args) {
  return new Promise((resolveVersion, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (output.length < 16 * 1024) output += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) reject(new Error(`Managed executable exited with code ${code}`));
      else resolveVersion(output.trim().split(/\r?\n/)[0] ?? 'unknown');
    });
  });
}

for (const binary of binaries) {
  try {
    await access(binary.path, constants.R_OK);
    const detectedHash = await sha256(binary.path);
    if (detectedHash !== binary.expected.sha256) {
      throw new Error(`SHA-256 mismatch (expected ${binary.expected.sha256}, got ${detectedHash})`);
    }
    const detectedVersion = await version(binary.path, binary.args);
    if (!detectedVersion.includes(binary.expected.version)) {
      throw new Error(
        `version mismatch (expected ${binary.expected.version}, got ${detectedVersion})`,
      );
    }
    process.stdout.write(`${binary.name}: ${detectedVersion}\n`);
  } catch (error) {
    process.stderr.write(
      `${binary.name} is required at ${binary.path} before packaging. ${error instanceof Error ? error.message : ''}\n`,
    );
    process.exitCode = 1;
  }
}
