import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { Icon } from '@phosphor-icons/react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cx } from './classnames';

export interface TabDefinition {
  value: string;
  label: string;
  content: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: readonly TabDefinition[];
  ariaLabel: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: 'horizontal' | 'vertical';
  activationMode?: 'automatic' | 'manual';
  className?: string;
}

export function Tabs({
  activationMode = 'automatic',
  ariaLabel,
  className,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  tabs,
  value,
}: TabsProps) {
  const firstEnabled = tabs.find((tab) => !tab.disabled)?.value;
  const rootProps = {
    ...(value === undefined ? {} : { value }),
    ...(defaultValue === undefined && value === undefined && firstEnabled !== undefined
      ? { defaultValue: firstEnabled }
      : defaultValue === undefined
        ? {}
        : { defaultValue }),
    ...(onValueChange === undefined ? {} : { onValueChange }),
  };

  return (
    <TabsPrimitive.Root
      {...rootProps}
      className={cx('ui-tabs', className)}
      orientation={orientation}
      activationMode={activationMode}
    >
      <TabsPrimitive.List className="ui-tabs__list" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            className="ui-tabs__trigger"
            value={tab.value}
            disabled={tab.disabled}
          >
            <span>{tab.label}</span>
            {tab.count === undefined ? null : (
              <span className="ui-tabs__count" aria-label={`${tab.count} items`}>
                {tab.count}
              </span>
            )}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content key={tab.value} className="ui-tabs__content" value={tab.value}>
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

export interface SegmentedControlOption {
  value: string;
  label: string;
  icon?: Icon;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: readonly SegmentedControlOption[];
  ariaLabel: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function SegmentedControl({
  ariaLabel,
  className,
  defaultValue,
  onValueChange,
  options,
  value,
}: SegmentedControlProps) {
  const firstEnabled = options.find((option) => !option.disabled)?.value ?? '';
  const [internalValue, setInternalValue] = useState(defaultValue ?? firstEnabled);
  const currentValue = value ?? internalValue;
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  const select = (nextValue: string) => {
    if (value === undefined) {
      setInternalValue(nextValue);
    }
    onValueChange?.(nextValue);
  };

  const move = (event: KeyboardEvent<HTMLButtonElement>, direction: 1 | -1 | 'first' | 'last') => {
    const enabledOptions = options.filter((option) => !option.disabled);
    if (enabledOptions.length === 0) {
      return;
    }

    const currentIndex = enabledOptions.findIndex((option) => option.value === currentValue);
    let nextOption = enabledOptions[0];
    if (direction === 'last') {
      nextOption = enabledOptions.at(-1);
    } else if (direction !== 'first') {
      const normalizedIndex = currentIndex < 0 ? 0 : currentIndex;
      nextOption = enabledOptions.at(
        (normalizedIndex + direction + enabledOptions.length) % enabledOptions.length,
      );
    }

    if (!nextOption) {
      return;
    }
    event.preventDefault();
    select(nextOption.value);
    buttonRefs.current.get(nextOption.value)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        move(event, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        move(event, -1);
        break;
      case 'Home':
        move(event, 'first');
        break;
      case 'End':
        move(event, 'last');
        break;
      default:
        break;
    }
  };

  return (
    <div className={cx('ui-segmented', className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const OptionIcon = option.icon;
        const selected = option.value === currentValue;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) {
                buttonRefs.current.set(option.value, node);
              } else {
                buttonRefs.current.delete(option.value);
              }
            }}
            type="button"
            className="ui-segmented__option"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            onClick={() => select(option.value)}
            onKeyDown={handleKeyDown}
          >
            {OptionIcon ? <OptionIcon size={17} weight="regular" aria-hidden="true" /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
