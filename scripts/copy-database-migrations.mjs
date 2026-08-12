import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repositoryRoot, 'packages/database/drizzle');
const destination = resolve(repositoryRoot, 'apps/desktop/out/drizzle');

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
