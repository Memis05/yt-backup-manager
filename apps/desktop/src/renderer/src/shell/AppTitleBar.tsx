import { useEffect, useState } from 'react';

import { APPLICATION_ICON_DATA_URL, APPLICATION_NAME } from '../../../app-identity';

export interface AppTitleBarStatus {
  label: string;
  onActivate(): void;
}

export interface AppTitleBarProps {
  status?: AppTitleBarStatus | undefined;
}

export function AppTitleBar({ status }: AppTitleBarProps) {
  const [windowActive, setWindowActive] = useState(() => document.hasFocus());

  useEffect(() => {
    const activate = () => setWindowActive(true);
    const deactivate = () => setWindowActive(false);
    window.addEventListener('focus', activate);
    window.addEventListener('blur', deactivate);
    return () => {
      window.removeEventListener('focus', activate);
      window.removeEventListener('blur', deactivate);
    };
  }, []);

  return (
    <header
      className="app-titlebar"
      data-testid="app-titlebar"
      data-window-active={windowActive ? 'true' : 'false'}
    >
      <div className="app-titlebar__safe-area">
        <div className="app-titlebar__identity" aria-label={APPLICATION_NAME}>
          <img className="app-titlebar__icon" src={APPLICATION_ICON_DATA_URL} alt="" />
          <span className="app-titlebar__name">{APPLICATION_NAME}</span>
        </div>
        <div className="app-titlebar__drag-space" aria-hidden="true" />
        {status === undefined ? null : (
          <button
            className="app-titlebar__status app-no-drag"
            type="button"
            onClick={status.onActivate}
          >
            {status.label}
          </button>
        )}
      </div>
    </header>
  );
}
