import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@ytbm/core',
          '@ytbm/database',
          '@ytbm/ipc',
          '@ytbm/job-engine',
          '@ytbm/security',
          '@ytbm/shared',
        ],
      }),
    ],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/main/index.ts'),
        external: ['better-sqlite3'],
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@ytbm/core', '@ytbm/ipc', '@ytbm/ipc/renderer', 'zod'],
      }),
    ],
    build: {
      rollupOptions: {
        input: resolve(import.meta.dirname, 'src/preload/index.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
  },
});
