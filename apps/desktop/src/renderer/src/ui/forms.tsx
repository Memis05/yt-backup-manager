import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import {
  CaretDown,
  CaretUp,
  Check,
  MagnifyingGlass,
  Minus,
  WarningCircle,
  X,
  type Icon,
} from '@phosphor-icons/react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cx } from './classnames';

interface FieldMessagesProps {
  controlId: string;
  description?: ReactNode;
  error?: ReactNode;
}

function FieldMessages({ controlId, description, error }: FieldMessagesProps) {
  return (
    <>
      {description ? (
        <span id={`${controlId}-description`} className="ui-field__description">
          {description}
        </span>
      ) : null}
      {error ? (
        <span id={`${controlId}-error`} className="ui-field__error">
          <WarningCircle size={16} weight="regular" aria-hidden="true" />
          <span>{error}</span>
        </span>
      ) : null}
    </>
  );
}

function describedBy(
  controlId: string,
  description: ReactNode,
  error: ReactNode,
): string | undefined {
  const ids = [
    description ? `${controlId}-description` : null,
    error ? `${controlId}-error` : null,
  ];
  return ids.filter(Boolean).join(' ') || undefined;
}

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'aria-describedby' | 'aria-invalid'
> {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  leadingIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, description, error, id, label, leadingIcon, ...inputProps },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;

  return (
    <div className="ui-field">
      <label id={labelId} className="ui-field__label" htmlFor={controlId}>
        {label}
      </label>
      <span className={cx('ui-input-shell', className)} data-invalid={error ? '' : undefined}>
        {leadingIcon ? (
          <span className="ui-input-shell__leading" aria-hidden="true">
            {leadingIcon}
          </span>
        ) : null}
        <input
          {...inputProps}
          ref={ref}
          id={controlId}
          className="ui-input"
          aria-labelledby={labelId}
          aria-describedby={describedBy(controlId, description, error)}
          aria-invalid={error ? true : undefined}
        />
      </span>
      <FieldMessages controlId={controlId} description={description} error={error} />
    </div>
  );
});

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'aria-label' | 'defaultValue' | 'onChange' | 'type' | 'value'
> {
  label?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  pending?: boolean;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    className,
    defaultValue = '',
    id,
    label = 'Search',
    onChange,
    onKeyDown,
    onValueChange,
    pending = false,
    value,
    ...inputProps
  },
  forwardedRef,
) {
  const localRef = useRef<HTMLInputElement | null>(null);
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentValue = value ?? internalValue;

  const updateValue = (nextValue: string) => {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  };

  const setRefs = (node: HTMLInputElement | null) => {
    localRef.current = node;
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  };

  const clear = () => {
    updateValue('');
    localRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (!event.defaultPrevented && event.key === 'Escape' && currentValue.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      clear();
    }
  };

  return (
    <div className={cx('ui-search', className)} data-pending={pending ? '' : undefined}>
      <label id={labelId} className="ui-visually-hidden" htmlFor={controlId}>
        {label}
      </label>
      <MagnifyingGlass
        className="ui-search__leading"
        size={18}
        weight="regular"
        aria-hidden="true"
      />
      <input
        {...inputProps}
        ref={setRefs}
        id={controlId}
        type="search"
        className="ui-search__input"
        aria-labelledby={labelId}
        aria-busy={pending || undefined}
        value={currentValue}
        onChange={(event) => {
          updateValue(event.currentTarget.value);
          onChange?.(event);
        }}
        onKeyDown={handleKeyDown}
      />
      {currentValue ? (
        <button
          type="button"
          className="ui-search__clear"
          aria-label={`Clear ${label}`}
          onClick={clear}
        >
          <X size={16} weight="regular" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: Icon;
}

export interface SelectProps {
  label: ReactNode;
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  description?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
}

export function Select({
  className,
  defaultValue,
  description,
  disabled = false,
  error,
  id,
  label,
  name,
  onValueChange,
  options,
  placeholder = 'Select an option',
  required = false,
  value,
}: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const rootProps = {
    ...(value === undefined ? {} : { value }),
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(onValueChange === undefined ? {} : { onValueChange }),
    ...(name === undefined ? {} : { name }),
  };

  return (
    <div className={cx('ui-field', className)}>
      <span id={labelId} className="ui-field__label">
        {label}
      </span>
      <SelectPrimitive.Root {...rootProps} disabled={disabled} required={required}>
        <SelectPrimitive.Trigger
          id={controlId}
          className="ui-select__trigger"
          aria-labelledby={labelId}
          aria-describedby={describedBy(controlId, description, error)}
          aria-invalid={error ? true : undefined}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon className="ui-select__icon">
            <CaretDown size={16} weight="regular" aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="ui-select__content" position="popper" sideOffset={4}>
            <SelectPrimitive.ScrollUpButton className="ui-select__scroll-button">
              <CaretUp size={15} weight="regular" aria-hidden="true" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="ui-select__viewport">
              {options.map((option) => {
                const OptionIcon = option.icon;
                return (
                  <SelectPrimitive.Item
                    key={option.value}
                    className="ui-select__item"
                    value={option.value}
                    disabled={option.disabled ?? false}
                  >
                    <SelectPrimitive.ItemIndicator className="ui-select__indicator">
                      <Check size={15} weight="bold" aria-hidden="true" />
                    </SelectPrimitive.ItemIndicator>
                    {OptionIcon ? (
                      <OptionIcon size={16} weight="regular" aria-hidden="true" />
                    ) : null}
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                );
              })}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="ui-select__scroll-button">
              <CaretDown size={15} weight="regular" aria-hidden="true" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      <FieldMessages controlId={controlId} description={description} error={error} />
    </div>
  );
}

export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean | 'indeterminate';
  defaultChecked?: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  id?: string;
  className?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  {
    checked,
    className,
    defaultChecked,
    description,
    disabled = false,
    id,
    label,
    name,
    onCheckedChange,
    required = false,
    value,
    'aria-labelledby': externalLabelledBy,
    'aria-describedby': externalDescribedBy,
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const rootProps = {
    ...(checked === undefined ? {} : { checked }),
    ...(defaultChecked === undefined ? {} : { defaultChecked }),
    ...(onCheckedChange === undefined ? {} : { onCheckedChange }),
    ...(name === undefined ? {} : { name }),
    ...(value === undefined ? {} : { value }),
  };

  return (
    <label
      className={cx('ui-choice', className)}
      htmlFor={controlId}
      data-disabled={disabled ? '' : undefined}
    >
      <CheckboxPrimitive.Root
        {...rootProps}
        ref={ref}
        id={controlId}
        className="ui-checkbox"
        disabled={disabled}
        required={required}
        aria-labelledby={externalLabelledBy ?? labelId}
        aria-describedby={
          externalDescribedBy ?? (description ? `${controlId}-description` : undefined)
        }
      >
        <CheckboxPrimitive.Indicator className="ui-checkbox__indicator">
          <Check className="ui-checkbox__check" size={14} weight="bold" aria-hidden="true" />
          <Minus className="ui-checkbox__minus" size={14} weight="bold" aria-hidden="true" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className="ui-choice__copy">
        <span id={labelId} className="ui-choice__label">
          {label}
        </span>
        {description ? (
          <span id={`${controlId}-description`} className="ui-choice__description">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
});

export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  id?: string;
  className?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    className,
    defaultChecked,
    description,
    disabled = false,
    id,
    label,
    name,
    onCheckedChange,
    required = false,
    value,
    'aria-labelledby': externalLabelledBy,
    'aria-describedby': externalDescribedBy,
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const rootProps = {
    ...(checked === undefined ? {} : { checked }),
    ...(defaultChecked === undefined ? {} : { defaultChecked }),
    ...(onCheckedChange === undefined ? {} : { onCheckedChange }),
    ...(name === undefined ? {} : { name }),
    ...(value === undefined ? {} : { value }),
  };

  return (
    <label
      className={cx('ui-switch-row', className)}
      htmlFor={controlId}
      data-disabled={disabled ? '' : undefined}
    >
      <span className="ui-choice__copy">
        <span id={labelId} className="ui-choice__label">
          {label}
        </span>
        {description ? (
          <span id={`${controlId}-description`} className="ui-choice__description">
            {description}
          </span>
        ) : null}
      </span>
      <SwitchPrimitive.Root
        {...rootProps}
        ref={ref}
        id={controlId}
        className="ui-switch"
        disabled={disabled}
        required={required}
        aria-labelledby={externalLabelledBy ?? labelId}
        aria-describedby={
          externalDescribedBy ?? (description ? `${controlId}-description` : undefined)
        }
      >
        <SwitchPrimitive.Thumb className="ui-switch__thumb" />
      </SwitchPrimitive.Root>
    </label>
  );
});
