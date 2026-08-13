import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

const common = {
  globals: false,
  environment: 'node' as const,
  restoreMocks: true,
  clearMocks: true,
};

export default defineConfig({
  resolve: {
    alias: {
      '@ytbm/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      '@ytbm/database/worker': resolve(import.meta.dirname, 'packages/database/src/index.ts'),
      '@ytbm/download-ytdlp': resolve(import.meta.dirname, 'packages/download-ytdlp/src/index.ts'),
      '@ytbm/integrity': resolve(import.meta.dirname, 'packages/integrity/src/index.ts'),
      '@ytbm/ipc': resolve(import.meta.dirname, 'packages/ipc/src/index.ts'),
      '@ytbm/job-engine': resolve(import.meta.dirname, 'packages/job-engine/src/index.ts'),
      '@ytbm/manifest': resolve(import.meta.dirname, 'packages/manifest/src/index.ts'),
      '@ytbm/media-ffmpeg': resolve(import.meta.dirname, 'packages/media-ffmpeg/src/index.ts'),
      '@ytbm/recovery': resolve(import.meta.dirname, 'packages/recovery/src/index.ts'),
      '@ytbm/scheduler-windows': resolve(
        import.meta.dirname,
        'packages/scheduler-windows/src/index.ts',
      ),
      '@ytbm/security': resolve(import.meta.dirname, 'packages/security/src/index.ts'),
      '@ytbm/shared': resolve(import.meta.dirname, 'packages/shared/src/index.ts'),
      '@ytbm/source-youtube': resolve(import.meta.dirname, 'packages/source-youtube/src/index.ts'),
      '@ytbm/storage-core': resolve(import.meta.dirname, 'packages/storage-core/src/index.ts'),
      '@ytbm/storage-filesystem': resolve(
        import.meta.dirname,
        'packages/storage-filesystem/src/index.ts',
      ),
      '@ytbm/storage-google-drive': resolve(
        import.meta.dirname,
        'packages/storage-google-drive/src/index.ts',
      ),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          ...common,
          name: 'unit',
          include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          ...common,
          name: 'integration',
          include: ['packages/**/*.integration.test.ts', 'apps/**/*.integration.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/out/**'],
          testTimeout: 15_000,
          hookTimeout: 15_000,
        },
      },
    ],
  },
});
