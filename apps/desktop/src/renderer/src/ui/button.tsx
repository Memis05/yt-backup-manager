import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { CircleNotch } from '@phosphor-icons/react';

import { cx } from './classnames';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'compact' | 'default' | 'prominent';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    disabled = false,
    leadingIcon,
    loading = false,
    size = 'default',
    trailingIcon,
    type = 'button',
    variant = 'secondary',
    ...buttonProps
  },
  ref,
) {
  const loadingWithoutLeadingIcon = loading && leadingIcon === undefined;

  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      className={cx('ui-button', className)}
      data-size={size}
      data-variant={variant}
      data-loading-without-leading={loadingWithoutLeadingIcon ? '' : undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      <span className="ui-button__icon" aria-hidden="true">
        {loading && !loadingWithoutLeadingIcon ? (
          <CircleNotch className="ui-spinner" size={18} weight="regular" />
        ) : (
          leadingIcon
        )}
      </span>
      <span className="ui-button__label">{children}</span>
      {trailingIcon ? (
        <span className="ui-button__icon" aria-hidden="true">
          {trailingIcon}
        </span>
      ) : null}
      {loadingWithoutLeadingIcon ? (
        <span className="ui-button__loading-overlay" aria-hidden="true">
          <CircleNotch className="ui-spinner" size={18} weight="regular" />
        </span>
      ) : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  label: string;
  icon: ReactNode;
  size?: 'compact' | 'default' | 'prominent';
  variant?: Exclude<ButtonVariant, 'link'>;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, icon, label, size = 'default', type = 'button', variant = 'ghost', ...buttonProps },
  ref,
) {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      className={cx('ui-icon-button', className)}
      data-size={size}
      data-variant={variant}
      aria-label={label}
      title={buttonProps.title ?? label}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
});
