import { useRef, useState } from 'react';

import {
  ArrowsClockwise,
  Cloud,
  DotsThree,
  LinkBreak,
  Plus,
  YoutubeLogo,
} from '@phosphor-icons/react';
import type { AccountDto, GoogleOAuthCapability } from '@ytbm/core';

import type { AppRoute } from '../../../app/routes';
import {
  Button,
  Dialog,
  DialogAction,
  DropdownMenu,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  Select,
  Skeleton,
  Status,
} from '../../../ui';
import { useAccountsController } from './accounts-controller';
import './accounts.css';

const SETTINGS_CATEGORIES = [
  ['general', 'General'],
  ['accounts', 'Accounts'],
  ['backup', 'Backup'],
  ['scheduling', 'Scheduling'],
  ['integrity', 'Integrity'],
  ['notifications', 'Notifications'],
  ['advanced', 'Advanced'],
  ['recovery', 'Recovery'],
  ['about', 'About'],
] as const;

type SettingsCategory = Extract<AppRoute, { area: 'settings' }>['category'];

function accountName(account: AccountDto): string {
  return account.displayName ?? account.email ?? 'Google account';
}

function sourceNeedsAttention(account: AccountDto): boolean {
  return account.connectionState !== 'CONNECTED' || !account.capabilities.youtubeReadonly;
}

function driveNeedsAttention(account: AccountDto): boolean {
  return account.capabilities.driveConnectionState === 'REAUTH_REQUIRED';
}

function AccountPrimaryAction({
  account,
  pending,
  onOAuth,
}: {
  account: AccountDto;
  pending: boolean;
  onOAuth(capability: GoogleOAuthCapability): void;
}) {
  if (sourceNeedsAttention(account)) {
    return (
      <Button variant="primary" size="compact" loading={pending} onClick={() => onOAuth('YOUTUBE')}>
        Sign in again
      </Button>
    );
  }
  if (driveNeedsAttention(account)) {
    return (
      <Button
        variant="primary"
        size="compact"
        loading={pending}
        onClick={() => onOAuth('GOOGLE_DRIVE')}
      >
        Reconnect Drive
      </Button>
    );
  }
  if (!account.capabilities.driveFile) {
    return (
      <Button size="compact" loading={pending} onClick={() => onOAuth('GOOGLE_DRIVE')}>
        Connect Drive
      </Button>
    );
  }
  return null;
}

function SettingsNavigation({ onNavigate }: { onNavigate(route: AppRoute): void }) {
  return (
    <>
      <nav className="accounts-settings-nav" aria-label="Settings categories">
        {SETTINGS_CATEGORIES.map(([category, label]) => (
          <button
            key={category}
            type="button"
            className="accounts-settings-nav__item"
            aria-current={category === 'accounts' ? 'page' : undefined}
            onClick={() => onNavigate({ area: 'settings', category })}
          >
            {label}
          </button>
        ))}
      </nav>
      <Select
        className="accounts-settings-select"
        label="Settings category"
        value="accounts"
        options={SETTINGS_CATEGORIES.map(([value, label]) => ({ value, label }))}
        onValueChange={(category) =>
          onNavigate({ area: 'settings', category: category as SettingsCategory })
        }
      />
    </>
  );
}

export function AccountsSettingsScreen({ onNavigate }: { onNavigate(route: AppRoute): void }) {
  const controller = useAccountsController();
  const [disconnectTarget, setDisconnectTarget] = useState<AccountDto | null>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);

  if (controller.loading) {
    return (
      <main className="accounts-page">
        <SettingsNavigation onNavigate={onNavigate} />
        <div className="accounts-content">
          <PageHeader title="Accounts" description="Loading Google account capabilities." />
          <Skeleton lines={6} />
        </div>
      </main>
    );
  }
  if (controller.requestError || !controller.snapshot) {
    return (
      <main className="accounts-page">
        <SettingsNavigation onNavigate={onNavigate} />
        <div className="accounts-content">
          <ErrorState
            title="Accounts could not be loaded"
            description={controller.requestError ?? 'The worker did not return account state.'}
            retry={{ onClick: () => void controller.refresh() }}
          />
        </div>
      </main>
    );
  }

  const { accounts, channels } = controller.snapshot;
  return (
    <>
      <main className="accounts-page">
        <SettingsNavigation onNavigate={onNavigate} />
        <div className="accounts-content">
          <PageHeader
            title="Accounts"
            description="Google identities can grant read-only YouTube access, Google Drive backup access, or both."
            action={
              accounts.length > 0 ? (
                <Button
                  variant="primary"
                  leadingIcon={<Plus size={17} />}
                  loading={controller.pendingAction === 'oauth:new:YOUTUBE'}
                  onClick={() => void controller.beginOAuth(null, 'YOUTUBE')}
                >
                  Connect Google account
                </Button>
              ) : null
            }
          />
          {controller.oauthFlow?.status === 'PENDING' ? (
            <Status
              appearance="callout"
              kind="active"
              label={`Waiting for ${controller.oauthFlow.capability === 'YOUTUBE' ? 'YouTube' : 'Google Drive'} sign-in`}
              description="Complete authorization in the browser. This screen will update automatically."
            />
          ) : null}
          {controller.oauthFlow?.status === 'COMPLETED' ? (
            <Status
              appearance="callout"
              kind="completed"
              label="Google authorization completed"
              description="Account capabilities have been refreshed."
            />
          ) : null}
          {controller.actionError ? (
            <div className="accounts-error" role="alert">
              <span>{controller.actionError}</span>
              <Button variant="ghost" size="compact" onClick={controller.clearActionError}>
                Dismiss
              </Button>
            </div>
          ) : null}
          {accounts.length === 0 ? (
            <EmptyState
              title="No Google accounts connected"
              description="Connect an account to discover its YouTube channels. Google Drive access is requested separately when you choose to use it."
              icon={YoutubeLogo}
              action={
                <Button
                  variant="primary"
                  onClick={() => void controller.beginOAuth(null, 'YOUTUBE')}
                >
                  Connect Google account
                </Button>
              }
            />
          ) : (
            <div className="accounts-list" role="list" aria-label="Connected Google accounts">
              {accounts.map((account) => {
                const accountChannels = channels.filter((channel) =>
                  channel.accessibleAccountIds.includes(account.id),
                );
                const oauthPending =
                  controller.pendingAction?.startsWith(`oauth:${account.id}:`) ?? false;
                return (
                  <div className="accounts-row" role="listitem" key={account.id}>
                    <div className="accounts-row__identity">
                      {account.avatarUrl ? (
                        <img className="accounts-avatar" src={account.avatarUrl} alt="" />
                      ) : (
                        <span
                          className="accounts-avatar accounts-avatar--fallback"
                          aria-hidden="true"
                        >
                          {accountName(account).slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <h2>{accountName(account)}</h2>
                        <p>{account.email ?? 'Email unavailable'}</p>
                      </div>
                    </div>
                    <div
                      className="accounts-capabilities"
                      aria-label={`Capabilities for ${accountName(account)}`}
                    >
                      <Status
                        icon={YoutubeLogo}
                        kind={sourceNeedsAttention(account) ? 'warning' : 'connected'}
                        label={
                          sourceNeedsAttention(account)
                            ? 'YouTube sign-in required'
                            : 'YouTube read-only'
                        }
                      />
                      <Status
                        icon={Cloud}
                        kind={
                          account.capabilities.driveFile && !driveNeedsAttention(account)
                            ? 'connected'
                            : driveNeedsAttention(account)
                              ? 'warning'
                              : 'unavailable'
                        }
                        label={
                          account.capabilities.driveFile && !driveNeedsAttention(account)
                            ? 'Drive connected'
                            : driveNeedsAttention(account)
                              ? 'Drive sign-in required'
                              : 'Drive not connected'
                        }
                      />
                      <span className="accounts-channel-count">
                        {accountChannels.length} accessible{' '}
                        {accountChannels.length === 1 ? 'channel' : 'channels'}
                      </span>
                    </div>
                    <div className="accounts-row__actions">
                      <AccountPrimaryAction
                        account={account}
                        pending={oauthPending}
                        onOAuth={(capability) => void controller.beginOAuth(account.id, capability)}
                      />
                      <DropdownMenu
                        ariaLabel={`More actions for ${accountName(account)}`}
                        trigger={
                          <IconButton
                            label={`More actions for ${accountName(account)}`}
                            icon={<DotsThree size={20} weight="bold" />}
                          />
                        }
                        items={[
                          {
                            id: 'refresh',
                            label: 'Refresh accessible channels',
                            icon: <ArrowsClockwise size={17} />,
                            disabled:
                              controller.pendingAction !== null || sourceNeedsAttention(account),
                            onSelect: () => void controller.discoverChannels(account.id),
                          },
                          {
                            id: 'youtube',
                            label: 'Reconnect YouTube',
                            icon: <YoutubeLogo size={17} />,
                            disabled: controller.pendingAction !== null,
                            onSelect: () => void controller.beginOAuth(account.id, 'YOUTUBE'),
                          },
                          {
                            id: 'drive',
                            label: account.capabilities.driveFile
                              ? 'Reconnect Drive'
                              : 'Connect Drive',
                            icon: <Cloud size={17} />,
                            disabled: controller.pendingAction !== null,
                            onSelect: () => void controller.beginOAuth(account.id, 'GOOGLE_DRIVE'),
                          },
                          { type: 'separator', id: 'separator' },
                          {
                            id: 'disconnect',
                            label: 'Disconnect account',
                            icon: <LinkBreak size={17} />,
                            danger: true,
                            disabled: controller.pendingAction !== null,
                            onSelect: () => setDisconnectTarget(account),
                          },
                        ]}
                      />
                    </div>
                    {accountChannels.length > 0 ? (
                      <details className="accounts-channels">
                        <summary>Accessible channels</summary>
                        <ul>
                          {accountChannels.map((channel) => (
                            <li key={channel.id}>
                              <span>{channel.title}</span>
                              <span>{channel.handle ?? 'YouTube channel'}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <section className="accounts-readonly" aria-labelledby="youtube-safety-heading">
            <YoutubeLogo size={20} aria-hidden="true" />
            <div>
              <h2 id="youtube-safety-heading">YouTube remains read-only</h2>
              <p>
                The app can read channel and media information for backup. It cannot upload, delete,
                rename, or otherwise modify content on YouTube.
              </p>
            </div>
          </section>
        </div>
      </main>
      <Dialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => !open && setDisconnectTarget(null)}
        title="Disconnect Google account?"
        description="Stored OAuth credentials for both YouTube and Google Drive will be removed from this app."
        initialFocusRef={disconnectRef}
        footer={
          <>
            <DialogAction variant="ghost" closeOnSelect>
              Cancel
            </DialogAction>
            <DialogAction
              ref={disconnectRef}
              variant="danger"
              loading={controller.pendingAction === `disconnect:${disconnectTarget?.id ?? ''}`}
              onClick={() => {
                if (!disconnectTarget) return;
                void controller
                  .disconnect(disconnectTarget.id)
                  .then((succeeded) => succeeded && setDisconnectTarget(null));
              }}
            >
              Disconnect account
            </DialogAction>
          </>
        }
      >
        <div className="accounts-disconnect-copy">
          <p>
            <strong>{disconnectTarget ? accountName(disconnectTarget) : ''}</strong> will no longer
            refresh YouTube source data or access Google Drive.
          </p>
          <p>
            Existing local catalog records, backup history, schedules, and verified backup files are
            kept. Google Drive objects already created by the app are not deleted.
          </p>
        </div>
      </Dialog>
    </>
  );
}
