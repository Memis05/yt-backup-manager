import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cx } from './classnames';

export interface SettingsRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  description?: ReactNode;
  control: ReactElement;
  status?: ReactNode;
}

export function SettingsRow({
  className,
  control,
  description,
  label,
  status,
  ...rowProps
}: SettingsRowProps) {
  const rowId = useId();
  const labelId = `${rowId}-label`;
  const descriptionId = description ? `${rowId}-description` : undefined;
  const labelledControl = isValidElement<Record<string, unknown>>(control)
    ? cloneElement(control, {
        'aria-labelledby': labelId,
        ...(descriptionId === undefined ? {} : { 'aria-describedby': descriptionId }),
      })
    : control;

  return (
    <div {...rowProps} className={cx('ui-settings-row', className)}>
      <div className="ui-settings-row__copy">
        <div id={labelId} className="ui-settings-row__label">
          {label}
        </div>
        {description ? (
          <div id={descriptionId} className="ui-settings-row__description">
            {description}
          </div>
        ) : null}
        {status ? <div className="ui-settings-row__status">{status}</div> : null}
      </div>
      <div className="ui-settings-row__control">{labelledControl}</div>
    </div>
  );
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  overflow?: ReactNode;
  context?: ReactNode;
}

export function PageHeader({
  action,
  className,
  context,
  description,
  overflow,
  title,
  ...headerProps
}: PageHeaderProps) {
  return (
    <header {...headerProps} className={cx('ui-page-header', className)}>
      {context ? <div className="ui-page-header__context">{context}</div> : null}
      <div className="ui-page-header__row">
        <div className="ui-page-header__copy">
          <h1 className="ui-page-header__title">{title}</h1>
          {description ? <p className="ui-page-header__description">{description}</p> : null}
        </div>
        {action || overflow ? (
          <div className="ui-page-header__actions">
            {action}
            {overflow}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  ariaLabel: string;
  primary?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function toolbarItems(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { actions, ariaLabel, className, filters, onKeyDown, primary, ...toolbarProps },
  ref,
) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || isEditableTarget(event.target)) {
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }

    const items = toolbarItems(event.currentTarget);
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    let nextIndex: number;
    if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = items.length - 1;
    } else if (event.key === 'ArrowRight') {
      nextIndex = (Math.max(currentIndex, -1) + 1) % items.length;
    } else {
      nextIndex = (currentIndex <= 0 ? items.length : currentIndex) - 1;
    }
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <div
      {...toolbarProps}
      ref={ref}
      className={cx('ui-toolbar', className)}
      role="toolbar"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {primary ? <div className="ui-toolbar__primary">{primary}</div> : null}
      {filters ? <div className="ui-toolbar__filters">{filters}</div> : null}
      {actions ? <div className="ui-toolbar__actions">{actions}</div> : null}
    </div>
  );
});
