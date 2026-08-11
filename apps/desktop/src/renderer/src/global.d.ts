import type { YouTubeBackupManagerApi } from '../../preload';

declare global {
  interface Window {
    readonly ytbm: YouTubeBackupManagerApi;
  }
}

export {};
