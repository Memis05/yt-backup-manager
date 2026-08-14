import type { InternalRoute } from '@ytbm/core';

import type { AppRoute } from './routes';

export type ActivityEntityView = 'active' | 'history' | 'attention';

export interface ResolvedActivityEntity {
  entityId: string;
  routeEntityId?: string;
  view: ActivityEntityView;
}

/**
 * Fresh, authorized entity IDs already returned to the renderer.
 *
 * An omitted collection means that the renderer cannot currently prove the
 * entity exists. An empty collection means a fresh response proved it does not
 * exist. This distinction lets callers explain unavailable versus stale links
 * without performing side effects inside the adapter.
 */
export interface InternalRouteResolutionContext {
  backupRunIds?: readonly string[];
  activityEntities?: readonly ResolvedActivityEntity[];
  destinationIds?: readonly string[];
  integrityCopyIds?: readonly string[];
}

export type InternalRouteEntityResolution =
  'none' | 'ignored' | 'resolved' | 'unavailable' | 'stale';

export interface InternalRouteResolution {
  route: AppRoute;
  entityResolution: InternalRouteEntityResolution;
  fallbackMessage: string | null;
}

export interface LatestEventGuard {
  begin(): () => boolean;
  invalidate(): void;
}

/** Creates side-effect-free generation tokens so only the latest async event may commit. */
export function createLatestEventGuard(): LatestEventGuard {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      const eventGeneration = generation;
      return () => eventGeneration === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}

const UNAVAILABLE_MESSAGE = 'The linked item could not be resolved. Showing its parent view.';
const STALE_MESSAGE = 'The linked item is no longer available. Showing its parent view.';

function parentResolution(route: AppRoute): InternalRouteResolution {
  return { route, entityResolution: 'none', fallbackMessage: null };
}

function ignoredResolution(route: AppRoute): InternalRouteResolution {
  return { route, entityResolution: 'ignored', fallbackMessage: null };
}

function unresolvedResolution(
  route: AppRoute,
  knownIds: readonly string[] | undefined,
): InternalRouteResolution {
  return {
    route,
    entityResolution: knownIds === undefined ? 'unavailable' : 'stale',
    fallbackMessage: knownIds === undefined ? UNAVAILABLE_MESSAGE : STALE_MESSAGE,
  };
}

function includesEntity(knownIds: readonly string[] | undefined, entityId: string): boolean {
  return knownIds?.includes(entityId) ?? false;
}

/**
 * Pure compatibility adapter for the stable persisted notification route.
 * Entity IDs are copied into renderer routes only when a fresh authorized
 * response in `context` proves the target still exists.
 */
export function resolveInternalRoute(
  internalRoute: InternalRoute,
  context: InternalRouteResolutionContext = {},
): InternalRouteResolution {
  const { entityId, section } = internalRoute;

  switch (section) {
    case 'dashboard': {
      const route: AppRoute = { area: 'home' };
      return entityId === null ? parentResolution(route) : ignoredResolution(route);
    }

    case 'backup': {
      const parent: AppRoute = { area: 'activity', view: 'history' };
      if (entityId === null) return parentResolution(parent);
      if (!includesEntity(context.backupRunIds, entityId)) {
        return unresolvedResolution(parent, context.backupRunIds);
      }
      return {
        route: { ...parent, entityId },
        entityResolution: 'resolved',
        fallbackMessage: null,
      };
    }

    case 'queue': {
      const parent: AppRoute = { area: 'activity', view: 'active' };
      if (entityId === null) return parentResolution(parent);
      const entity = context.activityEntities?.find((candidate) => candidate.entityId === entityId);
      if (entity === undefined) {
        const knownIds = context.activityEntities?.map((candidate) => candidate.entityId);
        return unresolvedResolution(parent, knownIds);
      }
      return {
        route: {
          area: 'activity',
          view: entity.view,
          entityId: entity.routeEntityId ?? entityId,
        },
        entityResolution: 'resolved',
        fallbackMessage: null,
      };
    }

    case 'storage': {
      const parent: AppRoute = { area: 'storage' };
      if (entityId === null) return parentResolution(parent);
      if (!includesEntity(context.destinationIds, entityId)) {
        return unresolvedResolution(parent, context.destinationIds);
      }
      return {
        route: { ...parent, entityId },
        entityResolution: 'resolved',
        fallbackMessage: null,
      };
    }

    case 'integrity': {
      const parent: AppRoute = {
        area: 'integrity',
        view: entityId === null ? 'overview' : 'issues',
      };
      if (entityId === null) return parentResolution(parent);
      if (!includesEntity(context.integrityCopyIds, entityId)) {
        return unresolvedResolution(parent, context.integrityCopyIds);
      }
      return {
        route: { area: 'integrity', view: 'issues', entityId },
        entityResolution: 'resolved',
        fallbackMessage: null,
      };
    }

    case 'settings': {
      const route: AppRoute = { area: 'settings', category: 'general' };
      return entityId === null ? parentResolution(route) : ignoredResolution(route);
    }
  }
}

/** Convenience form for consumers that do not surface fallback messaging. */
export function internalRouteToAppRoute(
  internalRoute: InternalRoute,
  context: InternalRouteResolutionContext = {},
): AppRoute {
  return resolveInternalRoute(internalRoute, context).route;
}
