import { describe, expect, it } from 'vitest';

import { InternalRouteSchema, ScheduleUpsertSchema } from '../src';

describe('Phase 6 renderer and scheduling DTO boundaries', () => {
  it('accepts fixed internal notification routes and rejects arbitrary navigation data', () => {
    expect(
      InternalRouteSchema.parse({
        section: 'integrity',
        entityId: '8f2abf93-a705-4c24-84e7-5e3fa4fcdb91',
      }),
    ).toEqual({
      section: 'integrity',
      entityId: '8f2abf93-a705-4c24-84e7-5e3fa4fcdb91',
    });
    expect(() =>
      InternalRouteSchema.parse({ section: 'https://example.test', entityId: null }),
    ).toThrow();
    expect(() =>
      InternalRouteSchema.parse({ section: 'integrity', entityId: null, path: 'C:\\secret' }),
    ).toThrow();
  });

  it('requires bounded schedule fields without accepting renderer commands', () => {
    expect(() =>
      ScheduleUpsertSchema.parse({
        id: null,
        channelId: null,
        enabled: true,
        frequency: 'EVERY_N_HOURS',
        localTime: '02:00',
        weekday: null,
        everyHours: 0,
        catchUp: true,
        backupOnStartup: false,
      }),
    ).toThrow();
    expect(() =>
      ScheduleUpsertSchema.parse({
        id: null,
        channelId: null,
        enabled: true,
        frequency: 'DAILY',
        localTime: '02:00',
        weekday: null,
        everyHours: null,
        catchUp: true,
        backupOnStartup: false,
        command: 'powershell.exe',
      }),
    ).toThrow();
  });
});
