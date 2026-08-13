import {
  forwardRef,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';

import { CheckCircle, Info, WarningCircle, X, XCircle, type Icon } from '@phosphor-icons/react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as ToastPrimitive from '@radix-ui/react-toast';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { Button, IconButton, type ButtonProps } from './button';
import { cx } from './classnames';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  delayDuration?: number;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export function Tooltip({
  align = 'center',
  children,
  content,
  delayDuration = 500,
  side = 'top',
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={100}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="ui-tooltip" side={side} align={align} sideOffset={6}>
            {content}
            <TooltipPrimitive.Arrow className="ui-tooltip__arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export interface MenuItemDefinition {
  type?: 'item';
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect?: () => void;
}

export interface MenuSeparatorDefinition {
  type: 'separator';
  id: string;
}

export interface MenuLabelDefinition {
  type: 'label';
  id: string;
  label: ReactNode;
}

export type MenuDefinition = MenuItemDefinition | MenuSeparatorDefinition | MenuLabelDefinition;

function DropdownItems({ items }: { items: readonly MenuDefinition[] }) {
  return items.map((item) => {
    if (item.type === 'separator') {
      return <DropdownPrimitive.Separator key={item.id} className="ui-menu__separator" />;
    }
    if (item.type === 'label') {
      return (
        <DropdownPrimitive.Label key={item.id} className="ui-menu__label">
          {item.label}
        </DropdownPrimitive.Label>
      );
    }
    return (
      <DropdownPrimitive.Item
        key={item.id}
        className="ui-menu__item"
        data-danger={item.danger ? '' : undefined}
        disabled={item.disabled ?? false}
        {...(item.onSelect === undefined ? {} : { onSelect: item.onSelect })}
      >
        {item.icon ? (
          <span className="ui-menu__icon" aria-hidden="true">
            {item.icon}
          </span>
        ) : null}
        <span className="ui-menu__item-label">{item.label}</span>
        {item.shortcut ? <span className="ui-menu__shortcut">{item.shortcut}</span> : null}
      </DropdownPrimitive.Item>
    );
  });
}

function ContextItems({ items }: { items: readonly MenuDefinition[] }) {
  return items.map((item) => {
    if (item.type === 'separator') {
      return <ContextMenuPrimitive.Separator key={item.id} className="ui-menu__separator" />;
    }
    if (item.type === 'label') {
      return (
        <ContextMenuPrimitive.Label key={item.id} className="ui-menu__label">
          {item.label}
        </ContextMenuPrimitive.Label>
      );
    }
    return (
      <ContextMenuPrimitive.Item
        key={item.id}
        className="ui-menu__item"
        data-danger={item.danger ? '' : undefined}
        disabled={item.disabled ?? false}
        {...(item.onSelect === undefined ? {} : { onSelect: item.onSelect })}
      >
        {item.icon ? (
          <span className="ui-menu__icon" aria-hidden="true">
            {item.icon}
          </span>
        ) : null}
        <span className="ui-menu__item-label">{item.label}</span>
        {item.shortcut ? <span className="ui-menu__shortcut">{item.shortcut}</span> : null}
      </ContextMenuPrimitive.Item>
    );
  });
}

export interface DropdownMenuProps {
  trigger: ReactElement;
  items: readonly MenuDefinition[];
  ariaLabel?: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export function DropdownMenu({
  align = 'end',
  ariaLabel,
  items,
  side = 'bottom',
  trigger,
}: DropdownMenuProps) {
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild aria-label={ariaLabel}>
        {trigger}
      </DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          className="ui-menu"
          side={side}
          align={align}
          sideOffset={4}
          collisionPadding={8}
        >
          <DropdownItems items={items} />
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

export interface ContextMenuProps {
  children: ReactElement;
  items: readonly MenuDefinition[];
  ariaLabel?: string;
}

export function ContextMenu({ ariaLabel, children, items }: ContextMenuProps) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild aria-label={ariaLabel}>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className="ui-menu" collisionPadding={8}>
          <ContextItems items={items} />
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

export interface DialogProps {
  trigger?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeLabel?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  preventEscapeClose?: boolean;
  className?: string;
}

export function Dialog({
  children,
  className,
  closeLabel = 'Close dialog',
  defaultOpen,
  description,
  footer,
  initialFocusRef,
  onOpenChange,
  open,
  preventEscapeClose = false,
  returnFocusRef,
  title,
  trigger,
}: DialogProps) {
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);
  const rootProps = {
    ...(open === undefined ? {} : { open }),
    ...(defaultOpen === undefined ? {} : { defaultOpen }),
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
  };

  return (
    <DialogPrimitive.Root {...rootProps}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog__overlay" />
        <DialogPrimitive.Content
          className={cx('ui-dialog', className)}
          onEscapeKeyDown={(event) => {
            if (preventEscapeClose) {
              event.preventDefault();
            }
          }}
          onOpenAutoFocus={(event) => {
            previouslyFocusedElement.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (initialFocusRef?.current) {
              event.preventDefault();
              initialFocusRef.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            const focusTarget = returnFocusRef?.current ?? previouslyFocusedElement.current;
            if (focusTarget?.isConnected) {
              event.preventDefault();
              focusTarget.focus();
            }
          }}
        >
          <div className="ui-dialog__header">
            <div className="ui-dialog__heading">
              <DialogPrimitive.Title className="ui-dialog__title">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="ui-dialog__description">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label={closeLabel} icon={<X size={18} weight="regular" />} />
            </DialogPrimitive.Close>
          </div>
          <div className="ui-dialog__body">{children}</div>
          {footer ? <div className="ui-dialog__footer">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export interface ToastMessage {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactElement;
  actionAltText?: string;
  variant?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  duration?: number;
}

const toastIcons: Record<NonNullable<ToastMessage['variant']>, Icon> = {
  neutral: Info,
  success: CheckCircle,
  warning: WarningCircle,
  danger: XCircle,
  info: Info,
};

export interface ToastProps extends ToastMessage {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  dismissLabel?: string;
}

export function Toast({
  action,
  actionAltText = 'Complete notification action',
  defaultOpen,
  description,
  dismissLabel = 'Dismiss notification',
  duration = 5000,
  onOpenChange,
  open,
  title,
  variant = 'neutral',
}: ToastProps) {
  const ToastIcon = toastIcons[variant];
  const rootProps = {
    ...(open === undefined ? {} : { open }),
    ...(defaultOpen === undefined ? {} : { defaultOpen }),
    ...(onOpenChange === undefined ? {} : { onOpenChange }),
  };

  return (
    <ToastPrimitive.Root
      {...rootProps}
      className="ui-toast"
      data-variant={variant}
      duration={Math.max(duration, 5000)}
    >
      <span className="ui-toast__icon" aria-hidden="true">
        <ToastIcon size={18} weight="regular" />
      </span>
      <span className="ui-toast__copy">
        <ToastPrimitive.Title className="ui-toast__title">{title}</ToastPrimitive.Title>
        {description ? (
          <ToastPrimitive.Description className="ui-toast__description">
            {description}
          </ToastPrimitive.Description>
        ) : null}
      </span>
      {action ? (
        <ToastPrimitive.Action asChild altText={actionAltText}>
          {action}
        </ToastPrimitive.Action>
      ) : null}
      <ToastPrimitive.Close asChild>
        <IconButton label={dismissLabel} icon={<X size={16} weight="regular" />} size="compact" />
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

export interface ToastProviderProps {
  children: ReactNode;
  messages: readonly ToastMessage[];
  onDismiss?: (id: string) => void;
  ariaLabel?: string;
}

export function ToastProvider({
  ariaLabel = 'Notifications',
  children,
  messages,
  onDismiss,
}: ToastProviderProps) {
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {children}
      {messages.slice(-3).map((message) => (
        <Toast
          key={message.id}
          {...message}
          open
          onOpenChange={(nextOpen) => !nextOpen && onDismiss?.(message.id)}
        />
      ))}
      <ToastPrimitive.Viewport className="ui-toast-viewport" aria-label={ariaLabel} />
    </ToastPrimitive.Provider>
  );
}

export interface DialogActionProps extends ButtonProps {
  closeOnSelect?: boolean;
}

export const DialogAction = forwardRef<HTMLButtonElement, DialogActionProps>(function DialogAction(
  { closeOnSelect = false, ...buttonProps },
  ref,
) {
  const button = <Button {...buttonProps} ref={ref} />;
  return closeOnSelect ? <DialogPrimitive.Close asChild>{button}</DialogPrimitive.Close> : button;
});

export const MenuTriggerButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function MenuTriggerButton({ className, type = 'button', ...buttonProps }, ref) {
  return (
    <button {...buttonProps} ref={ref} type={type} className={cx('ui-menu-trigger', className)} />
  );
});

export function ToastViewport(props: HTMLAttributes<HTMLOListElement>) {
  return (
    <ToastPrimitive.Viewport {...props} className={cx('ui-toast-viewport', props.className)} />
  );
}
