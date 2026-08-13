import { DEFAULT_APP_SETTINGS } from '@ytbm/core';
import { describe, expect, it, vi } from 'vitest';

import {
  scheduledWorkerArguments,
  scheduledIntegrityWorkerArguments,
  PeriodicIntegritySchedulingService,
  PERIODIC_INTEGRITY_TASK_ID,
  validateScheduledExecutable,
  windowsTaskName,
  windowsTaskXml,
  type WindowsScheduledTaskDefinition,
} from '../src/index';

const scheduleId = '8f2abf93-a705-4c24-84e7-5e3fa4fcdb91';
const executablePath = 'C:\\Program Files\\YouTube Backup Manager\\YouTubeBackupManager.exe';

describe('Windows scheduler command safety', () => {
  it('uses a stable owned namespace and fixed worker arguments', () => {
    expect(windowsTaskName(scheduleId)).toBe(`\\YouTubeBackupManager-Schedule-${scheduleId}`);
    expect(scheduledWorkerArguments(scheduleId)).toBe(`--worker --scheduled ${scheduleId}`);
    expect(scheduledIntegrityWorkerArguments(scheduleId)).toBe(
      `--worker --scheduled-integrity ${scheduleId}`,
    );
  });

  it('rejects malformed IDs and development Electron paths', () => {
    expect(() => windowsTaskName('../unrelated')).toThrow(/schedule ID/i);
    expect(() => validateScheduledExecutable('C:\\dev\\electron.exe')).toThrow(/Development/);
  });

  it.each([
    ['DAILY', null, null, '<ScheduleByDay>'],
    ['WEEKLY', 1, null, '<Monday/>'],
    ['EVERY_N_HOURS', null, 4, '<Interval>PT4H</Interval>'],
  ] as const)('creates safe %s XML', (frequency, weekday, everyHours, marker) => {
    const xml = windowsTaskXml({
      operationKind: 'BACKUP',
      scheduleId,
      executablePath,
      frequency,
      localTime: '02:30',
      weekday,
      everyHours,
      catchUp: true,
      enabled: true,
    });
    expect(xml).toContain(marker);
    expect(xml).toContain('<StartWhenAvailable>true</StartWhenAvailable>');
    expect(xml).toContain(`--worker --scheduled ${scheduleId}`);
    expect(xml).not.toContain('cmd.exe');
    expect(xml).not.toContain('powershell');
  });

  it('uses a fixed integrity worker action for the maintenance task', () => {
    const xml = windowsTaskXml({
      operationKind: 'INTEGRITY',
      scheduleId,
      executablePath,
      frequency: 'DAILY',
      localTime: '03:00',
      weekday: null,
      everyHours: null,
      catchUp: true,
      enabled: true,
    });
    expect(xml).toContain(`--worker --scheduled-integrity ${scheduleId}`);
    expect(xml).not.toContain('--worker --scheduled ');
  });
});

describe('periodic integrity scheduling', () => {
  it('registers one app-owned maintenance wake and deduplicates work by persisted history', async () => {
    let definition: WindowsScheduledTaskDefinition | null = null;
    let lastStartedAt: number | null = null;
    const startIntegrity = vi.fn(() => {
      lastStartedAt = Date.parse('2026-08-13T03:00:00+02:00');
      return { runId: crypto.randomUUID(), plannedChecks: 4 };
    });
    const service = new PeriodicIntegritySchedulingService({
      adapter: {
        available: true,
        listOwnedTasks: async () => [],
        upsertTask: async (value) => {
          definition = value;
        },
        removeTask: async () => undefined,
      },
      executablePath,
      settings: async () => ({
        ...DEFAULT_APP_SETTINGS,
        periodicIntegrity: {
          ...DEFAULT_APP_SETTINGS.periodicIntegrity,
          enabled: true,
          localTime: '03:00',
        },
      }),
      lastIntegrityStartedAt: () => lastStartedAt,
      startIntegrity,
      now: () => Date.parse('2026-08-13T03:00:00+02:00'),
    });

    await service.reconcile();
    expect(definition).toMatchObject({
      operationKind: 'INTEGRITY',
      scheduleId: PERIODIC_INTEGRITY_TASK_ID,
      frequency: 'DAILY',
      localTime: '03:00',
    });
    await expect(service.trigger()).resolves.toMatchObject({ plannedChecks: 4 });
    await expect(service.trigger()).resolves.toBeNull();
    expect(startIntegrity).toHaveBeenCalledTimes(1);
  });
});
