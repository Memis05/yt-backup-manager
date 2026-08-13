import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const guardedSourceRoots = ['main', 'preload', 'renderer'].map((directory) =>
  join(desktopRoot, directory),
);
const sourceFilePattern = /\.(?:[cm]?[jt]sx?)$/u;
const forbiddenDatabaseReferences = [
  /['"]@ytbm\/database(?:\/[^'"]*)?['"]/u,
  /['"]better-sqlite3['"]/u,
  /['"]drizzle-orm(?:\/[^'"]*)?['"]/u,
  /['"]sqlite3['"]/u,
  /['"]node:sqlite['"]/u,
  /packages[\\/]database(?:[\\/]|['"])/u,
] as const;

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(path);
      return entry.isFile() && sourceFilePattern.test(entry.name) ? [path] : [];
    }),
  );
  return nestedFiles.flat();
}

describe('database ownership architecture', () => {
  it.each([
    "import '@ytbm/database/worker';",
    "import Database from 'better-sqlite3';",
    "import '../../../../packages/database';",
    "import '../../../../packages/database/dist/index.js';",
    "import '../../../../packages/database/src/index.ts';",
  ])('recognizes forbidden database access: %s', (source) => {
    expect(forbiddenDatabaseReferences.some((reference) => reference.test(source))).toBe(true);
  });

  it('keeps database imports out of desktop main, preload, and renderer code', async () => {
    const files = (await Promise.all(guardedSourceRoots.map(collectSourceFiles))).flat();

    expect(files.length).toBeGreaterThan(4);

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const forbiddenReference of forbiddenDatabaseReferences) {
        expect(source, `worker-only database reference found in ${file}`).not.toMatch(
          forbiddenReference,
        );
      }
    }
  });
});
