import { Component, createRef, useEffect, useRef, type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import type { AppRoute } from '../app/routes';
import { AppTitleBar, type AppTitleBarStatus } from './AppTitleBar';
import { Sidebar } from './Sidebar';

interface RouteBoundaryProps {
  children: ReactNode;
  resetKey: string;
}

interface RouteBoundaryState {
  error: Error | null;
  resetKey: string;
}

class RouteBoundary extends Component<RouteBoundaryProps, RouteBoundaryState> {
  public override state: RouteBoundaryState = {
    error: null,
    resetKey: this.props.resetKey,
  };
  private readonly heading = createRef<HTMLHeadingElement>();

  public static getDerivedStateFromError(error: Error): Partial<RouteBoundaryState> {
    return { error };
  }

  public static getDerivedStateFromProps(
    props: RouteBoundaryProps,
    state: RouteBoundaryState,
  ): Partial<RouteBoundaryState> | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  public override componentDidCatch(): void {
    this.heading.current?.focus();
  }

  public override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <section className="app-route-error" role="alert">
        <h1 ref={this.heading} tabIndex={-1}>
          This view could not be shown
        </h1>
        <p>Return to this view to try again, or open Settings &gt; Advanced for diagnostics.</p>
      </section>
    );
  }
}

export interface AppShellProps {
  route: AppRoute;
  onNavigate(route: AppRoute): void;
  titleBarStatus?: AppTitleBarStatus | undefined;
  overlays?: ReactNode;
  children: ReactNode;
}

function routeIdentity(route: AppRoute): string {
  switch (route.area) {
    case 'home':
      return 'home';
    case 'library':
      return `library:${route.view}:${route.entityId ?? ''}`;
    case 'channels':
      return `channels:${route.entityId ?? ''}:${route.panel ?? ''}`;
    case 'activity':
      return `activity:${route.view}:${route.entityId ?? ''}:${route.detail ?? ''}`;
    case 'storage':
      return `storage:${route.entityId ?? ''}:${route.flow ?? ''}`;
    case 'integrity':
      return `integrity:${route.view}:${route.entityId ?? ''}:${route.flow ?? ''}`;
    case 'settings':
      return `settings:${route.category}`;
  }
}

export function PageFrame({ children }: { children: ReactNode }) {
  return <div className="app-page-frame">{children}</div>;
}

export function AppShell({ route, onNavigate, titleBarStatus, overlays, children }: AppShellProps) {
  const content = useRef<HTMLElement>(null);
  const identity = routeIdentity(route);

  useEffect(() => {
    const outlet = content.current;
    if (outlet === null) return;
    outlet.scrollTop = 0;
    outlet.scrollLeft = 0;
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement.getAttribute('role') === 'tab' &&
      outlet.contains(activeElement)
    ) {
      return;
    }
    const heading = outlet.querySelector<HTMLElement>('h1, h2');
    if (heading !== null) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      return;
    }
    outlet.focus({ preventScroll: true });
  }, [identity]);

  return (
    <TooltipPrimitive.Provider delayDuration={500} skipDelayDuration={100}>
      <div className="app-root">
        <AppTitleBar status={titleBarStatus} />
        <div className="app-workspace">
          <Sidebar route={route} onNavigate={onNavigate} />
          <main ref={content} className="app-route-outlet" tabIndex={-1}>
            <RouteBoundary resetKey={identity}>
              <PageFrame>{children}</PageFrame>
            </RouteBoundary>
          </main>
        </div>
        <div className="app-global-overlays">{overlays}</div>
      </div>
    </TooltipPrimitive.Provider>
  );
}
