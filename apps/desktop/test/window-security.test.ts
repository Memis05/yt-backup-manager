import { describe, expect, it } from 'vitest';

import { createWindowOptions } from '../src/main/window-options';

describe('Electron renderer security', () => {
  it('enforces isolation, sandboxing, and disabled Node integration', () => {
    const options = createWindowOptions('C:\\safe\\preload.js');

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    });
  });
});
