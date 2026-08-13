import type { QueueSection } from '@ytbm/core';
import { describe, expect, it } from 'vitest';

import {
  appRouteToLegacySection,
  appRouteToQueueSection,
  defaultAppRoute,
  legacySectionToAppRoute,
  primaryRoute,
  queueSectionToAppRoute,
  type AppRoute,
  type LegacySection,
} from '../../src/renderer/src/app/routes';

describe('renderer AppRoute compatibility', () => {
  it('defines Home as the stable default and exposes the primary destination', () => {
    expect(defaultAppRoute).toEqual({ area: 'home' });
    expect(primaryRoute({ area: 'library', view: 'playlists', entityId: 'playlist-1' })).toBe(
      'library',
    );
  });

  it.each<[LegacySection, AppRoute]>([
    ['dashboard', { area: 'home' }],
    ['accounts', { area: 'settings', category: 'accounts' }],
    ['channels', { area: 'channels' }],
    ['library', { area: 'library', view: 'media' }],
    ['playlists', { area: 'library', view: 'playlists' }],
    ['backup', { area: 'channels', panel: 'backup' }],
    ['queue', { area: 'activity', view: 'active' }],
    ['storage', { area: 'storage' }],
    ['integrity', { area: 'integrity', view: 'overview' }],
    ['settings', { area: 'settings', category: 'general' }],
    ['recovery', { area: 'settings', category: 'recovery' }],
  ])('maps legacy section %s to its target route', (legacySection, route) => {
    expect(legacySectionToAppRoute(legacySection)).toEqual(route);
  });

  it.each<[AppRoute, LegacySection]>([
    [{ area: 'home' }, 'dashboard'],
    [{ area: 'library', view: 'media', entityId: 'media-1' }, 'library'],
    [{ area: 'library', view: 'playlists', entityId: 'playlist-1' }, 'playlists'],
    [{ area: 'channels', entityId: 'channel-1', panel: 'backup' }, 'backup'],
    [{ area: 'channels', entityId: 'channel-1', panel: 'schedule' }, 'channels'],
    [{ area: 'activity', view: 'active', entityId: 'job-1' }, 'queue'],
    [{ area: 'activity', view: 'attention', entityId: 'job-2' }, 'queue'],
    [{ area: 'activity', view: 'history', entityId: 'run-1' }, 'backup'],
    [{ area: 'storage', flow: 'add' }, 'storage'],
    [{ area: 'integrity', view: 'issues', entityId: 'copy-1' }, 'integrity'],
    [{ area: 'settings', category: 'accounts' }, 'accounts'],
    [{ area: 'settings', category: 'recovery' }, 'recovery'],
    [{ area: 'settings', category: 'notifications' }, 'settings'],
  ])('selects the safe legacy host for $area', (route, legacySection) => {
    expect(appRouteToLegacySection(route)).toBe(legacySection);
  });

  it.each([
    ['ACTIVE', { area: 'activity', view: 'active' }],
    ['WAITING_DOWNLOADS', { area: 'activity', view: 'active' }],
    ['RETRYING', { area: 'activity', view: 'active' }],
    ['PAUSED', { area: 'activity', view: 'active' }],
    ['ALL', { area: 'activity', view: 'active' }],
    ['ATTENTION', { area: 'activity', view: 'attention' }],
    ['COMPLETED', { area: 'activity', view: 'history' }],
  ] as const)('keeps queue filter %s synchronized with Activity routing', (section, route) => {
    expect(queueSectionToAppRoute(section)).toEqual(route);
  });

  it.each<[AppRoute, QueueSection, QueueSection]>([
    [{ area: 'activity', view: 'attention' }, 'ACTIVE', 'ATTENTION'],
    [{ area: 'activity', view: 'active' }, 'ATTENTION', 'ACTIVE'],
    [{ area: 'activity', view: 'active' }, 'COMPLETED', 'ACTIVE'],
    [{ area: 'activity', view: 'active', entityId: 'job-1' }, 'RETRYING', 'ACTIVE'],
    [{ area: 'activity', view: 'active' }, 'WAITING_DOWNLOADS', 'WAITING_DOWNLOADS'],
    [{ area: 'activity', view: 'active' }, 'RETRYING', 'RETRYING'],
    [{ area: 'activity', view: 'history' }, 'COMPLETED', 'COMPLETED'],
    [{ area: 'activity', view: 'history' }, 'ACTIVE', 'COMPLETED'],
    [{ area: 'library', view: 'media' }, 'PAUSED', 'PAUSED'],
  ])(
    'resolves semantic Activity routing against the selected legacy filter',
    (route, selectedSection, expectedSection) => {
      expect(appRouteToQueueSection(route, selectedSection)).toBe(expectedSection);
    },
  );
});
