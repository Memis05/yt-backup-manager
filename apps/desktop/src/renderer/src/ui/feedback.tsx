import { useId, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

import {
  Archive,
  CheckCircle,
  Clock,
  Info,
  PauseCircle,
  SpinnerGap,
  WarningCircle,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';

import { Button, type ButtonProps } from './button';
import { cx } from './classnames';

export type StatusTone = 'healthy' | 'warning' | 'danger' | 'info' | 'neutral';
export type StatusAppearance = 'inline' | 'chip' | 'callout';
export type StatusKind =
  | 'verified'
  | 'connected'
  | 'completed'
  | 'active'
  | 'pending'
  | 'paused'
  | 'warning'
  | 'failed'
  | 'corrupt'
  | 'unavailable'
  | 'unknown';

const statusDefaults: Record<StatusKind, { tone: StatusTone; icon: Icon }> = {
  verified: { tone: 'healthy', icon: CheckCircle },
  connected: { tone: 'healthy', icon: CheckCircle },
  completed: { tone: 'healthy', icon: CheckCircle },
  active: { tone: 'info', icon: SpinnerGap },
  pending: { tone: 'neutral', icon: Clock },
  paused: { tone: 'warning', icon: PauseCircle },
  warning: { tone: 'warning', icon: WarningCircle },
  failed: { tone: 'danger', icon: XCircle },
  corrupt: { tone: 'danger', icon: XCircle },
  unavailable: { tone: 'neutral', icon: WarningCircle },
  unknown: { tone: 'neutral', icon: Info },
};

export interface StatusProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  label: ReactNode;
  kind?: StatusKind;
  tone?: StatusTone;
  appearance?: StatusAppearance;
  icon?: Icon;
  description?: ReactNode;
}

export function Status({
  appearance = 'inline',
  className,
  description,
  icon,
  kind = 'unknown',
  label,
  role,
  tone,
  ...statusProps
}: StatusProps) {
  const defaults = statusDefaults[kind];
  const StatusIcon = icon ?? defaults.icon;
  const resolvedTone = tone ?? defaults.tone;
  const resolvedRole =
    role ?? (appearance === 'callout' && resolvedTone === 'danger' ? 'alert' : undefined);

  return (
    <span
      {...statusProps}
      className={cx('ui-status', className)}
      data-appearance={appearance}
      data-tone={resolvedTone}
      role={resolvedRole}
    >
      <StatusIcon
        className={cx('ui-status__icon', kind === 'active' && 'ui-spinner')}
        size={appearance === 'callout' ? 20 : 16}
        weight="regular"
        aria-hidden="true"
      />
      <span className="ui-status__copy">
        <span className="ui-status__label">{label}</span>
        {description ? <span className="ui-status__description">{description}</span> : null}
      </span>
    </span>
  );
}

export const StatusTreatment = Status;

export interface ProgressProps {
  label: ReactNode;
  value?: number;
  max?: number;
  currentAction?: ReactNode;
  completed?: number;
  total?: number;
  className?: string;
}

export function Progress({
  className,
  completed,
  currentAction,
  label,
  max = 100,
  total,
  value,
}: ProgressProps) {
  const labelId = useId();
  const safeMax = Math.max(1, max);
  const determinate = value !== undefined;
  const clampedValue = determinate ? Math.min(Math.max(value, 0), safeMax) : undefined;
  const percent =
    clampedValue === undefined ? undefined : Math.round((clampedValue / safeMax) * 100);
  const progressProps = clampedValue === undefined ? {} : { value: clampedValue };

  return (
    <div
      className={cx('ui-progress', className)}
      data-indeterminate={!determinate ? '' : undefined}
    >
      <div className="ui-progress__header">
        <span id={labelId} className="ui-progress__label">
          {label}
        </span>
        {percent === undefined ? null : <span className="ui-progress__value">{percent}%</span>}
      </div>
      <progress
        {...progressProps}
        className="ui-progress__native"
        max={safeMax}
        aria-labelledby={labelId}
      />
      {currentAction || (completed !== undefined && total !== undefined) ? (
        <div className="ui-progress__details">
          {currentAction ? <span>{currentAction}</span> : null}
          {completed !== undefined && total !== undefined ? (
            <span className="ui-progress__count">
              {completed} of {total}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
  lines?: number;
}

export function Skeleton({
  className,
  label = 'Loading content',
  lines = 3,
  style,
  ...skeletonProps
}: SkeletonProps) {
  const count = Math.max(1, Math.round(lines));
  return (
    <div
      {...skeletonProps}
      className={cx('ui-skeleton-region', className)}
      style={style}
      role="status"
      aria-label={label}
      aria-live="polite"
    >
      <span className="ui-visually-hidden">{label}</span>
      <span className="ui-skeleton" aria-hidden="true">
        <span className="ui-skeleton__media" />
        {Array.from({ length: count }, (_, index) => (
          <span
            key={index}
            className="ui-skeleton__line"
            style={{ '--ui-skeleton-line': index } as CSSProperties}
          />
        ))}
      </span>
    </div>
  );
}

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  icon?: Icon;
}

export function EmptyState({
  action,
  className,
  description,
  icon: EmptyIcon = Archive,
  title,
  ...stateProps
}: EmptyStateProps) {
  return (
    <div {...stateProps} className={cx('ui-empty-state', className)}>
      <EmptyIcon className="ui-empty-state__icon" size={28} weight="regular" aria-hidden="true" />
      <div className="ui-empty-state__copy">
        <h2 className="ui-empty-state__title">{title}</h2>
        <p className="ui-empty-state__description">{description}</p>
      </div>
      {action ? <div className="ui-empty-state__action">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description: ReactNode;
  retry?: Omit<ButtonProps, 'children'> & { label?: ReactNode };
  action?: ReactNode;
}

export function ErrorState({
  action,
  className,
  description,
  retry,
  title,
  ...stateProps
}: ErrorStateProps) {
  const retryAction = retry
    ? (() => {
        const { label = 'Try again', ...buttonProps } = retry;
        return <Button {...buttonProps}>{label}</Button>;
      })()
    : action;

  return (
    <div {...stateProps} className={cx('ui-error-state', className)} role="alert">
      <WarningCircle
        className="ui-error-state__icon"
        size={24}
        weight="regular"
        aria-hidden="true"
      />
      <div className="ui-error-state__copy">
        <h2 className="ui-error-state__title">{title}</h2>
        <p className="ui-error-state__description">{description}</p>
      </div>
      {retryAction ? <div className="ui-error-state__action">{retryAction}</div> : null}
    </div>
  );
}
