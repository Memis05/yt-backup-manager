import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useRef, useState } from 'react';

import { DotsThree, Gear, GridFour, List } from '@phosphor-icons/react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

import {
  Button,
  Checkbox,
  ContextMenu,
  Dialog,
  DropdownMenu,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  Progress,
  SearchInput,
  SegmentedControl,
  Select,
  SettingsRow,
  Skeleton,
  Status,
  Switch,
  Tabs,
  ToastProvider,
  Toolbar,
  Tooltip,
} from '../../src/renderer/src/ui';

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe('product controls', () => {
  it('keeps buttons native, named, and protected from duplicate activation while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <>
        <Button variant="primary" onClick={onClick}>
          Start backup
        </Button>
        <Button loading onClick={onClick}>
          Planning backup
        </Button>
        <IconButton label="Open settings" icon={<Gear size={18} />} />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Start backup' }));
    await user.click(screen.getByRole('button', { name: 'Planning backup' }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Planning backup' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Planning backup' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveAccessibleName(
      'Open settings',
    );
    expect(screen.getByRole('button', { name: 'Open settings' })).toHaveAttribute(
      'title',
      'Open settings',
    );
    expect(screen.getByRole('button', { name: 'Planning backup' })).toHaveAttribute(
      'data-loading-without-leading',
      '',
    );
  });

  it('labels input, checkbox, and switch controls with their persistent help text', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    const onSwitchChange = vi.fn();

    render(
      <>
        <Input
          label="Folder name"
          description="Used inside the selected destination."
          error="Choose a valid folder name."
        />
        <Checkbox
          label="Back up to Archive D:"
          description="Keep this destination in the channel plan."
          onCheckedChange={onCheckedChange}
        />
        <Checkbox label="Back up selected destinations" defaultChecked="indeterminate" />
        <Switch
          label="Start with Windows"
          description="Launch this application when you sign in."
          onCheckedChange={onSwitchChange}
        />
      </>,
    );

    const input = screen.getByRole('textbox', { name: 'Folder name' });
    expect(input).toHaveAccessibleDescription(
      'Used inside the selected destination. Choose a valid folder name.',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.click(screen.getByRole('checkbox', { name: 'Back up to Archive D:' }));
    await user.click(screen.getByRole('switch', { name: 'Start with Windows' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(onSwitchChange).toHaveBeenCalledWith(true);
    expect(
      screen
        .getByRole('checkbox', { name: 'Back up selected destinations' })
        .querySelector('.ui-checkbox__minus'),
    ).toBeVisible();
  });

  it('selects a finite choice through the Radix keyboard model', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Select
        label="Backup quality"
        defaultValue="1080p"
        options={[
          { value: 'best', label: 'Best available' },
          { value: '1080p', label: 'Up to 1080p' },
          { value: '720p', label: 'Up to 720p' },
        ]}
        onValueChange={onValueChange}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Backup quality' });
    trigger.focus();
    await user.keyboard('{Enter}{End}{Enter}');

    expect(onValueChange).toHaveBeenCalledWith('720p');
    expect(trigger).toHaveTextContent('Up to 720p');
  });

  it('clears search with Escape without moving focus', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <SearchInput
        label="Search library"
        placeholder="Title or channel"
        onValueChange={onValueChange}
      />,
    );

    const search = screen.getByRole('searchbox', { name: 'Search library' });
    await user.type(search, 'archive');
    await user.keyboard('{Escape}');

    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(onValueChange).toHaveBeenLastCalledWith('');
    expect(screen.queryByRole('button', { name: 'Clear Search library' })).not.toBeInTheDocument();
  });
});

describe('keyboard navigation', () => {
  it('uses arrow-key activation and programmatic relationships for Tabs', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        ariaLabel="Library views"
        tabs={[
          { value: 'media', label: 'Media', content: <p>Media panel</p> },
          { value: 'playlists', label: 'Playlists', content: <p>Playlist panel</p> },
        ]}
      />,
    );

    const mediaTab = screen.getByRole('tab', { name: 'Media' });
    const playlistsTab = screen.getByRole('tab', { name: 'Playlists' });
    mediaTab.focus();
    await user.keyboard('{ArrowRight}');

    expect(playlistsTab).toHaveFocus();
    expect(playlistsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Playlist panel');
    expect(playlistsTab).toHaveAttribute('aria-controls');
  });

  it('supports vertical Tabs and keeps disabled choices out of keyboard selection', async () => {
    const user = userEvent.setup();
    render(
      <Tabs
        ariaLabel="Settings categories"
        orientation="vertical"
        tabs={[
          { value: 'general', label: 'General', content: <p>General settings</p> },
          {
            value: 'accounts',
            label: 'Accounts',
            content: <p>Account settings</p>,
            disabled: true,
          },
          { value: 'backup', label: 'Backup', content: <p>Backup settings</p> },
        ]}
      />,
    );

    const general = screen.getByRole('tab', { name: 'General' });
    const accounts = screen.getByRole('tab', { name: 'Accounts' });
    general.focus();
    await user.keyboard('{ArrowDown}');

    expect(accounts).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Backup' })).toHaveFocus();
    expect(general.closest('.ui-tabs')).toHaveAttribute('data-orientation', 'vertical');
  });

  it('uses a single roving tab stop for low-risk segmented display modes', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Library layout"
        defaultValue="grid"
        onValueChange={onValueChange}
        options={[
          { value: 'grid', label: 'Grid', icon: GridFour },
          { value: 'list', label: 'List', icon: List },
        ]}
      />,
    );

    const grid = screen.getByRole('radio', { name: 'Grid' });
    const list = screen.getByRole('radio', { name: 'List' });
    grid.focus();
    await user.keyboard('{ArrowRight}');

    expect(list).toHaveFocus();
    expect(list).toHaveAttribute('aria-checked', 'true');
    expect(grid).toHaveAttribute('tabindex', '-1');
    expect(onValueChange).toHaveBeenCalledWith('list');
  });

  it('moves through non-editable toolbar actions without hijacking search arrows', async () => {
    const user = userEvent.setup();
    render(
      <Toolbar
        ariaLabel="Library tools"
        primary={<SearchInput label="Search media" />}
        actions={
          <>
            <Button>Clear filters</Button>
            <Button>Refresh</Button>
          </>
        }
      />,
    );

    const clear = screen.getByRole('button', { name: 'Clear filters' });
    clear.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveFocus();

    const search = screen.getByRole('searchbox', { name: 'Search media' });
    search.focus();
    await user.keyboard('{ArrowRight}');
    expect(search).toHaveFocus();
  });
});

describe('temporary layers', () => {
  it('exposes a focused tooltip without replacing the trigger accessible name and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Open application settings">
        <IconButton label="Settings" icon={<Gear size={18} />} />
      </Tooltip>,
    );

    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Settings' });
    expect(trigger).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Open application settings');
    expect(trigger).toHaveAccessibleName('Settings');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('supports keyboard menu selection and an equivalent secondary-click accelerator', async () => {
    const user = userEvent.setup();
    const onOpenLogs = vi.fn();
    const onVerify = vi.fn();
    const items = [
      { id: 'verify', label: 'Verify copies', onSelect: onVerify },
      { type: 'separator' as const, id: 'separator' },
      { id: 'logs', label: 'Open logs', onSelect: onOpenLogs },
    ];

    render(
      <>
        <DropdownMenu
          trigger={<IconButton label="More actions" icon={<DotsThree size={18} />} />}
          items={items}
        />
        <ContextMenu items={items}>
          <button type="button">Destination row</button>
        </ContextMenu>
      </>,
    );

    const trigger = screen.getByRole('button', { name: 'More actions' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(onVerify).toHaveBeenCalledTimes(1);

    const destination = screen.getByRole('button', { name: 'Destination row' });
    destination.focus();
    fireEvent.contextMenu(destination, { clientX: 12, clientY: 12 });
    const contextMenu = await screen.findByRole('menu');
    await user.click(within(contextMenu).getByRole('menuitem', { name: 'Open logs' }));
    expect(onOpenLogs).toHaveBeenCalledTimes(1);
  });

  it('traps dialog focus, closes on Escape, and restores the trigger', async () => {
    const user = userEvent.setup();

    function DialogHarness() {
      const firstActionRef = useRef<HTMLButtonElement>(null);
      return (
        <Dialog
          trigger={<Button>Open backup dialog</Button>}
          title="Start backup"
          description="Review saved settings before planning durable work."
          initialFocusRef={firstActionRef}
          footer={<Button>Start backup</Button>}
        >
          <Button ref={firstActionRef}>Review destinations</Button>
        </Dialog>
      );
    }

    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open backup dialog' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Start backup' });
    expect(screen.getByRole('button', { name: 'Review destinations' })).toHaveFocus();

    for (let index = 0; index < 5; index += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('restores focus for a controlled dialog without an in-component trigger', async () => {
    const user = userEvent.setup();

    function ControlledDialogHarness() {
      const [open, setOpen] = useState(false);
      const returnFocusRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <Button ref={returnFocusRef} onClick={() => setOpen(true)}>
            Open controlled dialog
          </Button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            returnFocusRef={returnFocusRef}
            title="Controlled dialog"
            description="Confirms focus restoration without a Radix trigger."
          >
            <Button>Review</Button>
          </Dialog>
        </>
      );
    }

    render(<ControlledDialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open controlled dialog' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('stacks at most three toasts and exposes a named dismiss action', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onUndo = vi.fn();
    render(
      <ToastProvider
        onDismiss={onDismiss}
        messages={[
          { id: 'one', title: 'One saved' },
          { id: 'two', title: 'Two saved' },
          { id: 'three', title: 'Three saved' },
          {
            id: 'four',
            title: 'Four saved',
            variant: 'danger',
            actionAltText: 'Undo saving item four',
            action: <Button onClick={onUndo}>Undo</Button>,
          },
        ]}
      >
        <span>Application</span>
      </ToastProvider>,
    );

    expect(screen.queryByText('One saved')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(document.querySelector('.ui-toast button button')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    await user.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0]!);
    expect(onDismiss).toHaveBeenCalledWith('two');
  });
});

describe('feedback semantics', () => {
  it('pairs status text with a hidden semantic icon and alerts on blocking danger callouts', () => {
    render(
      <>
        <Status kind="verified" label="Verified" />
        <Status
          kind="failed"
          appearance="callout"
          label="Backup failed"
          description="Open Activity for the safe error and next action."
        />
      </>,
    );

    expect(screen.getByText('Verified').closest('.ui-status')).toHaveAttribute(
      'data-tone',
      'healthy',
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Backup failed');
    expect(alert).toHaveTextContent('Open Activity for the safe error and next action.');
    expect(alert.querySelector('.ui-status__icon')).toHaveAttribute('aria-hidden', 'true');
  });

  it('reports determinate and indeterminate progress truthfully', () => {
    const { rerender } = render(
      <Progress
        label="Backup progress"
        value={45}
        currentAction="Uploading to Google Drive"
        completed={9}
        total={20}
      />,
    );

    const progress = screen.getByRole('progressbar', { name: 'Backup progress' });
    expect(progress).toHaveAttribute('value', '45');
    expect(progress).toHaveAttribute('max', '100');
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('9 of 20')).toBeInTheDocument();

    rerender(<Progress label="Preparing backup" currentAction="Checking destinations" />);
    expect(screen.getByRole('progressbar', { name: 'Preparing backup' })).not.toHaveAttribute(
      'value',
    );
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();

    rerender(<Progress label="Invalid maximum" value={4} max={0} />);
    expect(screen.getByRole('progressbar', { name: 'Invalid maximum' })).toHaveAttribute(
      'max',
      '1',
    );
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('keeps loading, empty, error, header, and settings states structured', () => {
    render(
      <>
        <PageHeader title="Storage" description="Destinations and verified copies." />
        <Skeleton label="Loading destinations" lines={2} />
        <EmptyState title="No destinations" description="Add one destination to begin." />
        <ErrorState title="Could not load media" description="Your filters have been preserved." />
        <SettingsRow
          label="Start with Windows"
          description="Launch the app when you sign in."
          control={<Switch label="Enable Start with Windows" />}
        />
      </>,
    );

    expect(screen.getByRole('heading', { name: 'Storage' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading destinations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No destinations' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load media');
    expect(screen.getByText('Start with Windows')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Start with Windows' })).toHaveAccessibleDescription(
      'Launch the app when you sign in.',
    );
  });
});

describe('accessibility and theme safeguards', () => {
  it('has no automated accessibility violations in a representative primitive composition', async () => {
    const { container } = render(
      <main>
        <h1>Backup settings</h1>
        <Input label="Destination label" description="Use a recognizable location." />
        <Checkbox label="Back up to Local archive" />
        <Switch label="Start minimized" />
        <Status kind="connected" label="Connected" />
        <Progress label="Verification progress" value={30} />
        <Button variant="primary">Save changes</Button>
      </main>,
    );

    const results = await axe.run(container, {
      rules: {
        // jsdom has no layout/canvas model; token contrast is asserted separately below.
        'color-contrast': { enabled: false },
      },
    });
    expect(results.violations).toEqual([]);
  });

  it('meets the DESIGN contrast thresholds for text, focus, brand, and semantic states', () => {
    const textPairs = [
      ['#F4F4F5', '#141416'],
      ['#B3B3BA', '#141416'],
      ['#FFFFFF', '#D93842'],
      ['#76D6AD', '#10261F'],
      ['#F2C46D', '#2A2112'],
      ['#FF7A83', '#2B1518'],
    ] as const;
    const nonTextPairs = [
      ['#68686F', '#141416'],
      ['#FF6B72', '#0B0B0D'],
    ] as const;

    for (const [foreground, background] of textPairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const [foreground, background] of nonTextPairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(3);
    }
  });

  it('ships focus-visible, reduced-motion, forced-colors, semantic variables, and no-drag rules', () => {
    const css = readFileSync(
      resolve(import.meta.dirname, '../../src/renderer/src/ui/primitives.css'),
      'utf8',
    );

    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*animation:\s*none/);
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('forced-color-adjust: auto');
    expect(css).toContain('var(--color-focus');
    expect(css).toContain('var(--color-brand-action');
    expect(css).toContain('var(--color-status-danger');
    expect(css).toContain('-webkit-app-region: no-drag');
  });
});
