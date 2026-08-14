import type { QueueSection } from '@ytbm/core';

/**
 * Renderer-owned navigation model.
 *
 * This intentionally stays separate from the persisted notification route
 * contract in `@ytbm/core`. Persisted routes are translated at the renderer
 * boundary by `internal-route-adapter.ts`.
 */
export type AppRoute =
  | { area: 'home' }
  | {
      area: 'library';
      view: 'media' | 'playlists';
      entityId?: string;
    }
  | {
      area: 'channels';
      entityId?: string;
      panel?: 'overview' | 'backup' | 'schedule' | 'source';
    }
  | {
      area: 'activity';
      view: 'active' | 'history' | 'attention';
      entityId?: string;
      detail?: 'overview' | 'technical';
    }
  | {
      area: 'storage';
      entityId?: string;
      flow?: 'add';
    }
  | {
      area: 'integrity';
      view: 'overview' | 'issues' | 'history';
      entityId?: string;
      flow?: 'verify' | 'repair';
    }
  | {
      area: 'settings';
      category:
        | 'general'
        | 'accounts'
        | 'backup'
        | 'scheduling'
        | 'integrity'
        | 'notifications'
        | 'advanced'
        | 'recovery'
        | 'about';
    };

/** Sections owned by the pre-migration renderer. */
export type LegacySection =
  | 'dashboard'
  | 'accounts'
  | 'channels'
  | 'library'
  | 'playlists'
  | 'backup'
  | 'queue'
  | 'storage'
  | 'integrity'
  | 'settings'
  | 'recovery';

export type PrimaryRoute = AppRoute['area'];

export const defaultAppRoute: AppRoute = { area: 'home' };

/** Returns the primary navigation destination represented by a route. */
export function primaryRoute(route: AppRoute): PrimaryRoute {
  return route.area;
}

/** Keeps legacy queue filters aligned with Activity's semantic local route. */
export function queueSectionToAppRoute(section: QueueSection): AppRoute {
  switch (section) {
    case 'ATTENTION':
      return { area: 'activity', view: 'attention' };
    case 'COMPLETED':
      return { area: 'activity', view: 'history' };
    case 'ACTIVE':
    case 'WAITING_DOWNLOADS':
    case 'RETRYING':
    case 'PAUSED':
    case 'ALL':
      return { area: 'activity', view: 'active' };
  }
}

const ACTIVE_ACTIVITY_QUEUE_SECTIONS = new Set<QueueSection>([
  'ACTIVE',
  'WAITING_DOWNLOADS',
  'RETRYING',
  'PAUSED',
  'ALL',
]);

/**
 * Resolves Activity's semantic route back to the compatible legacy filter.
 * Secondary Active filters remain selected while the user stays on Active,
 * while direct navigation and persisted notification routes cannot leave the
 * legacy queue displaying an incompatible Attention or Completed filter.
 */
export function appRouteToQueueSection(
  route: AppRoute,
  selectedSection: QueueSection,
): QueueSection {
  if (route.area !== 'activity') return selectedSection;
  if (route.view === 'history') return 'COMPLETED';
  if (route.view === 'attention') return 'ATTENTION';
  if (route.entityId !== undefined) return 'ACTIVE';
  return ACTIVE_ACTIVITY_QUEUE_SECTIONS.has(selectedSection) ? selectedSection : 'ACTIVE';
}

/**
 * Maps old renderer section changes onto the target information architecture.
 *
 * The legacy `backup` screen combined channel configuration and run history.
 * Direct legacy navigation came from a channel's Configure action, so its
 * deterministic compatibility target is the Channels backup panel. Run-history
 * notifications use the separate internal-route adapter and land in Activity.
 */
export function legacySectionToAppRoute(section: LegacySection): AppRoute {
  switch (section) {
    case 'dashboard':
      return { area: 'home' };
    case 'accounts':
      return { area: 'settings', category: 'accounts' };
    case 'channels':
      return { area: 'channels' };
    case 'library':
      return { area: 'library', view: 'media' };
    case 'playlists':
      return { area: 'library', view: 'playlists' };
    case 'backup':
      return { area: 'channels', panel: 'backup' };
    case 'queue':
      return { area: 'activity', view: 'active' };
    case 'storage':
      return { area: 'storage' };
    case 'integrity':
      return { area: 'integrity', view: 'overview' };
    case 'settings':
      return { area: 'settings', category: 'general' };
    case 'recovery':
      return { area: 'settings', category: 'recovery' };
  }
}

/**
 * Chooses the legacy screen that can safely host a target route during the
 * incremental migration. Entity and flow details remain in `AppRoute` and are
 * not inferred by the legacy renderer.
 */
export function appRouteToLegacySection(route: AppRoute): LegacySection {
  switch (route.area) {
    case 'home':
      return 'dashboard';
    case 'library':
      return route.view === 'playlists' ? 'playlists' : 'library';
    case 'channels':
      return route.panel === 'backup' ? 'backup' : 'channels';
    case 'activity':
      return route.view === 'history' ? 'backup' : 'queue';
    case 'storage':
      return 'storage';
    case 'integrity':
      return 'integrity';
    case 'settings':
      if (route.category === 'accounts') return 'accounts';
      if (route.category === 'recovery') return 'recovery';
      return 'settings';
  }
}
