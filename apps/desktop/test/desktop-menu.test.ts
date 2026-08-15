import { describe, expect, it, vi } from 'vitest';

import { createTrayMenuTemplate, removeDefaultApplicationMenu } from '../src/main/desktop-menu';

describe('desktop menus', () => {
  it('removes the default application menu', () => {
    const setApplicationMenu = vi.fn();

    removeDefaultApplicationMenu({ setApplicationMenu });

    expect(setApplicationMenu).toHaveBeenCalledOnce();
    expect(setApplicationMenu).toHaveBeenCalledWith(null);
  });

  it('preserves the complete tray command menu and action wiring', () => {
    const actions = {
      open: vi.fn(),
      backupNow: vi.fn(),
      pauseActiveWork: vi.fn(),
      resumePausedWork: vi.fn(),
      quit: vi.fn(),
    };

    const template = createTrayMenuTemplate(actions);

    expect(template.map(({ label, type }) => label ?? type)).toEqual([
      'Open',
      'Backup now',
      'Pause active work',
      'Resume paused work',
      'separator',
      'Quit',
    ]);
    expect(template[0]?.click).toBe(actions.open);
    expect(template[1]?.click).toBe(actions.backupNow);
    expect(template[2]?.click).toBe(actions.pauseActiveWork);
    expect(template[3]?.click).toBe(actions.resumePausedWork);
    expect(template[5]?.click).toBe(actions.quit);
  });
});
