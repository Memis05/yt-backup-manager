import type { BrowserWindowConstructorOptions } from 'electron';

export function createWindowOptions(
  preloadPath: string,
  icon?: BrowserWindowConstructorOptions['icon'],
): BrowserWindowConstructorOptions {
  return {
    ...(icon === undefined ? {} : { icon }),
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    show: false,
    backgroundColor: '#0B0B0D',
    frame: true,
    thickFrame: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#101012',
      symbolColor: '#F4F4F5',
      height: 40,
    },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  };
}
