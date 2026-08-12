import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

describe('database ownership architecture', () => {
  it('keeps database imports out of desktop main, preload, and renderer code', async () => {
    const files = [
      join(desktopRoot, 'main', 'index.ts'),
      join(desktopRoot, 'main', 'desktop-ipc.ts'),
      join(desktopRoot, 'preload', 'index.ts'),
      join(desktopRoot, 'renderer', 'src', 'App.tsx'),
    ];

    for (const file of files) {
      await expect(readFile(file, 'utf8')).resolves.not.toContain('@ytbm/database');
      await expect(readFile(file, 'utf8')).resolves.not.toContain('better-sqlite3');
    }
  });
});
