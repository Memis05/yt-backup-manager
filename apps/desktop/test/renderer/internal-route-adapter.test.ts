import type { InternalRoute } from '@ytbm/core';
import { describe, expect, it } from 'vitest';

import {
  createLatestEventGuard,
  internalRouteToAppRoute,
  resolveInternalRoute,
  type InternalRouteResolutionContext,
} from '../../src/renderer/src/app/internal-route-adapter';

const entityId = '8f2abf93-a705-4c24-84e7-5e3fa4fcdb91';
const staleId = '6f108bf1-f7c7-4adc-8e79-64a854ce494e';

function internalRoute(section: InternalRoute['section'], id: string | null = null): InternalRoute {
  return { section, entityId: id };
}

describe('stable internal notification route adapter', () => {
  it('allows only the latest asynchronous internal-route event to commit', () => {
    const guard = createLatestEventGuard();
    const firstEventMayCommit = guard.begin();
    const secondEventMayCommit = guard.begin();

    expect(firstEventMayCommit()).toBe(false);
    expect(secondEventMayCommit()).toBe(true);

    guard.invalidate();
    expect(secondEventMayCommit()).toBe(false);
  });

  it.each<[InternalRoute['section'], object]>([
    ['dashboard', { area: 'home' }],
    ['backup', { area: 'activity', view: 'history' }],
    ['queue', { area: 'activity', view: 'active' }],
    ['storage', { area: 'storage' }],
    ['integrity', { area: 'integrity', view: 'overview' }],
    ['settings', { area: 'settings', category: 'general' }],
  ])('maps stable %s routes with null entities to their safe parent', (section, route) => {
    expect(resolveInternalRoute(internalRoute(section))).toEqual({
      route,
      entityResolution: 'none',
      fallbackMessage: null,
    });
  });

  it('preserves exact entities only after fresh authorized responses resolve them', () => {
    const context: InternalRouteResolutionContext = {
      backupRunIds: [entityId],
      activityEntities: [
        { entityId, view: 'active' },
        { entityId: staleId, view: 'attention' },
      ],
      destinationIds: [entityId],
      integrityCopyIds: [entityId],
    };

    expect(internalRouteToAppRoute(internalRoute('backup', entityId), context)).toEqual({
      area: 'activity',
      view: 'history',
      entityId,
    });
    expect(internalRouteToAppRoute(internalRoute('queue', entityId), context)).toEqual({
      area: 'activity',
      view: 'active',
      entityId,
    });
    expect(internalRouteToAppRoute(internalRoute('queue', staleId), context)).toEqual({
      area: 'activity',
      view: 'attention',
      entityId: staleId,
    });
    expect(internalRouteToAppRoute(internalRoute('storage', entityId), context)).toEqual({
      area: 'storage',
      entityId,
    });
    expect(internalRouteToAppRoute(internalRoute('integrity', entityId), context)).toEqual({
      area: 'integrity',
      view: 'issues',
      entityId,
    });
  });

  it.each<InternalRoute['section']>(['backup', 'queue', 'storage', 'integrity'])(
    'falls back without copying a %s entity when resolution data is unavailable',
    (section) => {
      const result = resolveInternalRoute(internalRoute(section, entityId));

      expect(result.entityResolution).toBe('unavailable');
      expect(result.fallbackMessage).toContain('could not be resolved');
      expect(result.route).not.toHaveProperty('entityId');
    },
  );

  it.each<InternalRoute['section']>(['backup', 'queue', 'storage', 'integrity'])(
    'falls back without copying a stale %s entity after a fresh empty response',
    (section) => {
      const context: InternalRouteResolutionContext = {
        backupRunIds: [],
        activityEntities: [],
        destinationIds: [],
        integrityCopyIds: [],
      };
      const result = resolveInternalRoute(internalRoute(section, entityId), context);

      expect(result.entityResolution).toBe('stale');
      expect(result.fallbackMessage).toContain('no longer available');
      expect(result.route).not.toHaveProperty('entityId');
    },
  );

  it('keeps an unresolved integrity notification in the issues parent', () => {
    expect(
      resolveInternalRoute(internalRoute('integrity', staleId), { integrityCopyIds: [] }).route,
    ).toEqual({ area: 'integrity', view: 'issues' });
  });

  it.each<InternalRoute['section']>(['dashboard', 'settings'])(
    'ignores unexpected entities for %s instead of inferring a target',
    (section) => {
      const result = resolveInternalRoute(internalRoute(section, entityId));
      expect(result.entityResolution).toBe('ignored');
      expect(result.route).not.toHaveProperty('entityId');
      expect(result.fallbackMessage).toBeNull();
    },
  );
});
