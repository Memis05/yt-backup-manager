import type { MenuItemConstructorOptions } from 'electron';

export interface ApplicationMenuController {
  setApplicationMenu(menu: null): void;
}

export interface TrayMenuActions {
  open(): void;
  backupNow(): void;
  pauseActiveWork(): void;
  resumePausedWork(): void;
  quit(): void | Promise<void>;
}

export function removeDefaultApplicationMenu(menu: ApplicationMenuController): void {
  menu.setApplicationMenu(null);
}

export function createTrayMenuTemplate(actions: TrayMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Open', click: actions.open },
    { label: 'Backup now', click: actions.backupNow },
    { label: 'Pause active work', click: actions.pauseActiveWork },
    { label: 'Resume paused work', click: actions.resumePausedWork },
    { type: 'separator' },
    { label: 'Quit', click: actions.quit },
  ];
}
