import { describe, expect, it } from 'vitest';

import { createWindowOptions } from '../src/main/window-options';

describe('Electron window configuration', () => {
  it('uses the approved Window Controls Overlay with the native resizable frame', () => {
    const options = createWindowOptions('C:\\safe\\preload.js');

    expect(options).toMatchObject({
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
    });
  });

  it('enforces isolation, sandboxing, and disabled Node integration', () => {
    const options = createWindowOptions('C:\\safe\\preload.js');

    expect(options.webPreferences).toMatchObject({
      preload: 'C:\\safe\\preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
  });
});
