import { useState, type ComponentType } from 'react';
import {
  Archive,
  CaretDoubleLeft,
  CaretDoubleRight,
  GearSix,
  HardDrives,
  House,
  Pulse,
  ShieldCheck,
  YoutubeLogo,
} from '@phosphor-icons/react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import type { AppRoute } from '../app/routes';

type RouteArea = AppRoute['area'];

interface NavigationItem {
  area: RouteArea;
  label: string;
  icon: ComponentType<{ size?: number; weight?: 'regular' | 'fill'; 'aria-hidden'?: boolean }>;
  route: AppRoute;
}

const ARCHIVE_NAVIGATION: readonly NavigationItem[] = [
  { area: 'home', label: 'Home', icon: House, route: { area: 'home' } },
  {
    area: 'library',
    label: 'Library',
    icon: Archive,
    route: { area: 'library', view: 'media' },
  },
  { area: 'channels', label: 'Channels', icon: YoutubeLogo, route: { area: 'channels' } },
];

const OPERATIONS_NAVIGATION: readonly NavigationItem[] = [
  {
    area: 'activity',
    label: 'Activity',
    icon: Pulse,
    route: { area: 'activity', view: 'active' },
  },
  { area: 'storage', label: 'Storage', icon: HardDrives, route: { area: 'storage' } },
  {
    area: 'integrity',
    label: 'Integrity',
    icon: ShieldCheck,
    route: { area: 'integrity', view: 'overview' },
  },
];

const SETTINGS_ITEM: NavigationItem = {
  area: 'settings',
  label: 'Settings',
  icon: GearSix,
  route: { area: 'settings', category: 'general' },
};

export interface SidebarProps {
  route: AppRoute;
  onNavigate(route: AppRoute): void;
}

function NavItem({
  item,
  active,
  onNavigate,
}: {
  item: NavigationItem;
  active: boolean;
  onNavigate(route: AppRoute): void;
}) {
  const Icon = item.icon;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <button
          className="app-nav-item"
          type="button"
          aria-current={active ? 'page' : undefined}
          aria-label={item.label}
          onClick={() => onNavigate(item.route)}
        >
          <span className="app-nav-item__marker" aria-hidden="true" />
          <Icon size={18} weight={active ? 'fill' : 'regular'} aria-hidden={true} />
          <span className="app-nav-item__label">{item.label}</span>
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="app-nav-tooltip" side="right" sideOffset={8}>
          {item.label}
          <TooltipPrimitive.Arrow className="app-nav-tooltip__arrow" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Sidebar({ route, onNavigate }: SidebarProps) {
  const [userExpanded, setUserExpanded] = useState(false);
  const renderGroup = (label: string, items: readonly NavigationItem[]) => (
    <div className="app-sidebar__group" role="group" aria-label={label}>
      {items.map((item) => (
        <NavItem
          key={item.area}
          item={item}
          active={route.area === item.area}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );

  return (
    <aside className="app-sidebar" data-user-expanded={userExpanded ? 'true' : 'false'}>
      <nav className="app-sidebar__navigation" aria-label="Primary navigation">
        {renderGroup('Archive', ARCHIVE_NAVIGATION)}
        <div className="app-sidebar__divider" aria-hidden="true" />
        {renderGroup('Operations', OPERATIONS_NAVIGATION)}
        <div className="app-sidebar__spacer" />
        <NavItem
          item={SETTINGS_ITEM}
          active={route.area === SETTINGS_ITEM.area}
          onNavigate={onNavigate}
        />
      </nav>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button
            className="app-sidebar__expand app-no-drag"
            type="button"
            aria-label={userExpanded ? 'Collapse navigation' : 'Expand navigation'}
            aria-pressed={userExpanded}
            onClick={() => setUserExpanded((current) => !current)}
          >
            {userExpanded ? (
              <CaretDoubleLeft size={16} aria-hidden="true" />
            ) : (
              <CaretDoubleRight size={16} aria-hidden="true" />
            )}
            <span className="app-sidebar__expand-label">
              {userExpanded ? 'Collapse navigation' : 'Expand navigation'}
            </span>
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="app-nav-tooltip" side="right" sideOffset={8}>
            {userExpanded ? 'Collapse navigation' : 'Expand navigation'}
            <TooltipPrimitive.Arrow className="app-nav-tooltip__arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </aside>
  );
}
