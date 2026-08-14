import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  ArrowLeft,
  Cloud,
  HardDrive,
  Play,
  SlidersHorizontal,
  YoutubeLogo,
} from '@phosphor-icons/react';
import {
  QUALITY_PROFILE_LABELS,
  type ChannelDto,
  type DestinationDto,
  type QualityProfile,
  type ScheduleDto,
  type ScheduleUpsert,
} from '@ytbm/core';

import type { AppRoute } from '../../app/routes';
import {
  Button,
  Checkbox,
  Dialog,
  DialogAction,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Status,
  Switch,
  Tabs,
} from '../../ui';
import { useChannelsController, type ChannelsSnapshot } from './channels-controller';
import './channels.css';

type ChannelsRoute = Extract<AppRoute, { area: 'channels' }>;

interface ChannelsScreenProps {
  route: ChannelsRoute;
  onNavigate(route: AppRoute): void;
  notice: string | null;
  onNotice(message: string | null): void;
}

const QUALITY_OPTIONS = [
  { value: 'GLOBAL', label: 'Use global default' },
  ...Object.entries(QUALITY_PROFILE_LABELS).map(([value, label]) => ({ value, label })),
] as const;

function formatDate(value: number | null): string {
  return value === null
    ? 'Not yet'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function destinationName(destination: DestinationDto): string {
  if (destination.destinationType === 'FILESYSTEM') {
    return destination.lastKnownMountPath ?? destination.rootPath;
  }
  return destination.accountEmail ?? destination.accountDisplayName ?? destination.rootName;
}

function destinationAvailabilityLabel(destination: DestinationDto): string {
  switch (destination.availabilityStatus) {
    case 'AVAILABLE':
      return 'Available';
    case 'DISCONNECTED':
    case 'ERROR':
      return 'Unavailable';
    case 'READ_ONLY':
      return 'Read-only destination';
    case 'FULL':
      return 'Not enough space';
    case 'AUTH_REQUIRED':
      return 'Needs sign-in';
    case 'UNKNOWN':
      return 'Availability unknown';
  }
}

function channelHealth(snapshot: ChannelsSnapshot, channelId: string) {
  return (
    snapshot.integrity.channels.find((item) => item.channelId === channelId)?.health ?? {
      complete: 0,
      partial: 0,
      pending: 0,
      missing: 0,
      corrupt: 0,
      unavailable: 0,
      authRequired: 0,
    }
  );
}

function healthStatus(snapshot: ChannelsSnapshot, channelId: string) {
  const health = channelHealth(snapshot, channelId);
  if (health.corrupt + health.missing + health.authRequired > 0) {
    return { kind: 'warning' as const, label: 'Needs attention' };
  }
  if (health.partial + health.pending + health.unavailable > 0) {
    return { kind: 'pending' as const, label: 'Backup incomplete' };
  }
  if (health.complete > 0) return { kind: 'verified' as const, label: 'Backed up' };
  return { kind: 'unknown' as const, label: 'No backup yet' };
}

function channelSchedule(
  snapshot: ChannelsSnapshot,
  channelId: string,
): {
  schedule: ScheduleDto | null;
  inherited: boolean;
} {
  const override = snapshot.schedules.find((item) => item.channelId === channelId && item.enabled);
  if (override) return { schedule: override, inherited: false };
  const global = snapshot.schedules.find((item) => item.channelId === null && item.enabled);
  return { schedule: global ?? null, inherited: global !== undefined };
}

function scheduleLabel(schedule: ScheduleDto | null): string {
  if (!schedule) return 'Manual backups only';
  if (schedule.frequency === 'DAILY') return `Daily at ${schedule.localTime}`;
  if (schedule.frequency === 'WEEKLY') return `Weekly at ${schedule.localTime}`;
  return `Every ${schedule.everyHours ?? 1} hours`;
}

function ChannelIdentity({ channel }: { channel: ChannelDto }) {
  return (
    <span className="channels-identity">
      {channel.thumbnailUrl ? (
        <img src={channel.thumbnailUrl} alt="" className="channels-avatar" />
      ) : (
        <span className="channels-avatar channels-avatar--fallback" aria-hidden="true">
          {channel.title.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="channels-identity__copy">
        <span className="channels-identity__title">{channel.title}</span>
        <span className="channels-identity__meta">{channel.handle ?? 'YouTube channel'}</span>
      </span>
    </span>
  );
}

function ActionError({ message, onDismiss }: { message: string | null; onDismiss(): void }) {
  if (!message) return null;
  return (
    <div className="channels-action-error" role="alert">
      <span>{message}</span>
      <Button variant="ghost" size="compact" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

function BackupAction({
  channel,
  snapshot,
  pending,
  locked,
  onStart,
  onNavigate,
}: {
  channel: ChannelDto;
  snapshot: ChannelsSnapshot;
  pending: boolean;
  locked: boolean;
  onStart(): void;
  onNavigate(route: AppRoute): void;
}) {
  const settings = snapshot.settings.find((item) => item.channelId === channel.id);
  const ready = channel.backupEnabled && (settings?.destinationIds.length ?? 0) > 0;
  return (
    <span className="channels-backup-action">
      <Button
        size="compact"
        variant="primary"
        leadingIcon={<Play size={16} weight="fill" />}
        disabled={!ready || locked}
        loading={pending}
        onClick={onStart}
      >
        Back up now
      </Button>
      {locked ? (
        <Button
          size="compact"
          variant="link"
          onClick={() => onNavigate({ area: 'activity', view: 'active' })}
        >
          Check Activity
        </Button>
      ) : !ready ? (
        <Button size="compact" variant="link" onClick={() => onNavigate({ area: 'storage' })}>
          {channel.backupEnabled ? 'Choose storage' : 'Enable channel'}
        </Button>
      ) : null}
    </span>
  );
}

function ChannelsList({
  snapshot,
  pendingAction,
  startLockedChannelId,
  onNavigate,
  onStartBackup,
  onToggleRequest,
}: {
  snapshot: ChannelsSnapshot;
  pendingAction: string | null;
  startLockedChannelId: string | null;
  onNavigate(route: AppRoute): void;
  onStartBackup(channelId: string): void;
  onToggleRequest(channel: ChannelDto): void;
}) {
  if (snapshot.channels.length === 0) {
    return (
      <EmptyState
        title="No YouTube channels found"
        description="Connect a YouTube account in Settings, then refresh its accessible channels."
        icon={YoutubeLogo}
        action={
          <Button onClick={() => onNavigate({ area: 'settings', category: 'accounts' })}>
            Open Accounts
          </Button>
        }
      />
    );
  }
  return (
    <div className="channels-list" role="list" aria-label="YouTube channels">
      {snapshot.channels.map((channel) => {
        const settings = snapshot.settings.find((item) => item.channelId === channel.id);
        const status = healthStatus(snapshot, channel.id);
        const schedule = channelSchedule(snapshot, channel.id);
        const unavailable = snapshot.destinations.filter(
          (item) =>
            settings?.destinationIds.includes(item.id) && item.availabilityStatus !== 'AVAILABLE',
        ).length;
        return (
          <article key={channel.id} className="channels-row" role="listitem">
            <button
              type="button"
              className="channels-row__main"
              onClick={() =>
                onNavigate({ area: 'channels', entityId: channel.id, panel: 'overview' })
              }
            >
              <ChannelIdentity channel={channel} />
              <span className="channels-row__facts">
                <Status kind={status.kind} label={status.label} />
                <span>{countLabel(settings?.destinationIds.length ?? 0, 'destination')}</span>
                <span>{scheduleLabel(schedule.schedule)}</span>
                {unavailable > 0 ? (
                  <span className="channels-warning">{unavailable} unavailable</span>
                ) : null}
              </span>
            </button>
            <div className="channels-row__actions">
              <BackupAction
                channel={channel}
                snapshot={snapshot}
                pending={pendingAction === `backup:${channel.id}`}
                locked={startLockedChannelId === channel.id}
                onStart={() => onStartBackup(channel.id)}
                onNavigate={onNavigate}
              />
              <Switch
                label={`Back up ${channel.title}`}
                checked={channel.backupEnabled}
                disabled={pendingAction !== null}
                onCheckedChange={() => onToggleRequest(channel)}
              />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function OverviewPanel({
  channel,
  snapshot,
  onNavigate,
}: {
  channel: ChannelDto;
  snapshot: ChannelsSnapshot;
  onNavigate(route: AppRoute): void;
}) {
  const settings = snapshot.settings.find((item) => item.channelId === channel.id);
  const health = channelHealth(snapshot, channel.id);
  const latestRun = snapshot.runs.find((run) => run.channelId === channel.id) ?? null;
  const latestSuccessful = snapshot.runs.find(
    (run) => run.channelId === channel.id && run.status === 'COMPLETED',
  );
  const schedule = channelSchedule(snapshot, channel.id);
  const activeJob = snapshot.queue.jobs.find(
    (job) =>
      channel.id === job.channelId && !['COMPLETED', 'CANCELLED', 'FAILED'].includes(job.status),
  );
  const status = healthStatus(snapshot, channel.id);
  return (
    <div className="channels-detail-grid">
      <section className="channels-section" aria-labelledby="channel-health-heading">
        <h2 id="channel-health-heading">Backup health</h2>
        <Status kind={status.kind} label={status.label} appearance="callout" />
        <dl className="channels-definition-grid">
          <div>
            <dt>Protected media</dt>
            <dd>{health.complete}</dd>
          </div>
          <div>
            <dt>Incomplete</dt>
            <dd>{health.partial + health.pending}</dd>
          </div>
          <div>
            <dt>Needs attention</dt>
            <dd>{health.missing + health.corrupt + health.authRequired}</dd>
          </div>
        </dl>
      </section>
      <section className="channels-section" aria-labelledby="channel-timing-heading">
        <h2 id="channel-timing-heading">Backup timing</h2>
        <dl className="channels-definition-list">
          <div>
            <dt>Last successful backup</dt>
            <dd>{formatDate(latestSuccessful?.completedAt ?? null)}</dd>
          </div>
          <div>
            <dt>Most recent run</dt>
            <dd>
              {latestRun
                ? `${latestRun.status.toLowerCase()} · ${formatDate(latestRun.createdAt)}`
                : 'No recent run'}
            </dd>
          </div>
          <div>
            <dt>Next scheduled backup</dt>
            <dd>
              {schedule.schedule?.nextExpectedAt
                ? formatDate(schedule.schedule.nextExpectedAt)
                : scheduleLabel(schedule.schedule)}
            </dd>
          </div>
          <div>
            <dt>Schedule source</dt>
            <dd>
              {schedule.inherited
                ? 'Global schedule'
                : schedule.schedule
                  ? 'Channel override'
                  : 'Manual'}
            </dd>
          </div>
        </dl>
      </section>
      <section
        className="channels-section channels-section--wide"
        aria-labelledby="channel-destinations-heading"
      >
        <h2 id="channel-destinations-heading">Intended destinations</h2>
        {(settings?.destinationIds.length ?? 0) === 0 ? (
          <p className="channels-muted">No destination selected.</p>
        ) : (
          <ul className="channels-plain-list">
            {snapshot.destinations
              .filter((item) => settings?.destinationIds.includes(item.id))
              .map((destination) => (
                <li key={destination.id}>
                  {destination.destinationType === 'FILESYSTEM' ? (
                    <HardDrive size={18} />
                  ) : (
                    <Cloud size={18} />
                  )}
                  <span>{destinationName(destination)}</span>
                  <Status
                    kind={destination.availabilityStatus === 'AVAILABLE' ? 'connected' : 'warning'}
                    label={destinationAvailabilityLabel(destination)}
                  />
                </li>
              ))}
          </ul>
        )}
        <Button variant="link" onClick={() => onNavigate({ area: 'storage' })}>
          Manage storage
        </Button>
      </section>
      {activeJob ? (
        <section
          className="channels-section channels-section--wide"
          aria-labelledby="channel-operation-heading"
        >
          <h2 id="channel-operation-heading">Active operation</h2>
          <div className="channels-active-operation">
            <Status kind="active" label={activeJob.jobType.replaceAll('_', ' ').toLowerCase()} />
            <Button
              variant="link"
              onClick={() =>
                onNavigate({
                  area: 'activity',
                  view: 'active',
                  entityId: activeJob.backupRunId ?? activeJob.id,
                })
              }
            >
              Open Activity
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BackupPanel({
  channel,
  snapshot,
  pendingAction,
  onDestinationsChange,
  onQualityRequest,
  onNavigate,
}: {
  channel: ChannelDto;
  snapshot: ChannelsSnapshot;
  pendingAction: string | null;
  onDestinationsChange(destinationIds: string[]): void;
  onQualityRequest(profile: QualityProfile | null): void;
  onNavigate(route: AppRoute): void;
}) {
  const settings = snapshot.settings.find((item) => item.channelId === channel.id);
  if (!settings) return null;
  return (
    <div className="channels-panel-stack">
      <section className="channels-section" aria-labelledby="channel-quality-heading">
        <h2 id="channel-quality-heading">Video quality</h2>
        <Select
          label="Quality for future copies"
          value={settings.qualityProfileOverride ?? 'GLOBAL'}
          options={QUALITY_OPTIONS}
          disabled={pendingAction !== null}
          description={`Effective quality: ${QUALITY_PROFILE_LABELS[settings.effectiveQualityProfile]}`}
          onValueChange={(value) =>
            onQualityRequest(value === 'GLOBAL' ? null : (value as QualityProfile))
          }
        />
      </section>
      <section className="channels-section" aria-labelledby="channel-storage-heading">
        <h2 id="channel-storage-heading">Destinations</h2>
        {snapshot.destinations.length === 0 ? (
          <div className="channels-inline-empty">
            <p>No backup destinations are configured.</p>
            <Button variant="link" onClick={() => onNavigate({ area: 'storage' })}>
              Add storage
            </Button>
          </div>
        ) : (
          <div className="channels-destination-choices">
            {snapshot.destinations.map((destination) => {
              const selected = settings.destinationIds.includes(destination.id);
              const next = selected
                ? settings.destinationIds.filter((id) => id !== destination.id)
                : [...settings.destinationIds, destination.id];
              return (
                <Checkbox
                  key={destination.id}
                  label={destinationName(destination)}
                  description={
                    destination.availabilityStatus === 'AVAILABLE'
                      ? destination.destinationType === 'FILESYSTEM'
                        ? 'Local filesystem'
                        : 'Google Drive'
                      : `${destinationAvailabilityLabel(destination)}. It remains selected and work may wait.`
                  }
                  checked={selected}
                  disabled={pendingAction !== null}
                  onCheckedChange={() => onDestinationsChange(next)}
                />
              );
            })}
          </div>
        )}
        <p className="channels-save-note" role="status">
          Destination changes save automatically.
        </p>
      </section>
    </div>
  );
}

function SchedulePanel({
  channel,
  snapshot,
  pendingAction,
  onSave,
  onRemove,
}: {
  channel: ChannelDto;
  snapshot: ChannelsSnapshot;
  pendingAction: string | null;
  onSave(input: ScheduleUpsert): void;
  onRemove(scheduleId: string): void;
}) {
  const existing = snapshot.schedules.find((item) => item.channelId === channel.id) ?? null;
  const inherited =
    snapshot.schedules.find((item) => item.channelId === null && item.enabled) ?? null;
  const [mode, setMode] = useState(existing ? 'OVERRIDE' : inherited ? 'GLOBAL' : 'MANUAL');
  const [frequency, setFrequency] = useState<ScheduleUpsert['frequency']>(
    existing?.frequency ?? inherited?.frequency ?? 'DAILY',
  );
  const [localTime, setLocalTime] = useState(
    existing?.localTime ?? inherited?.localTime ?? '02:00',
  );
  const [weekday, setWeekday] = useState(existing?.weekday ?? inherited?.weekday ?? 1);
  const [everyHours, setEveryHours] = useState(existing?.everyHours ?? inherited?.everyHours ?? 24);
  const [catchUp, setCatchUp] = useState(existing?.catchUp ?? inherited?.catchUp ?? true);
  const [backupOnStartup, setBackupOnStartup] = useState(
    existing?.backupOnStartup ?? inherited?.backupOnStartup ?? false,
  );
  const busy = pendingAction !== null;
  const removeOverride = () => existing && onRemove(existing.id);
  return (
    <div className="channels-panel-stack">
      <section className="channels-section">
        <h2>Schedule source</h2>
        <Select
          label="How this channel runs"
          value={mode}
          disabled={busy}
          options={[
            {
              value: 'GLOBAL',
              label: inherited
                ? `Use global schedule (${scheduleLabel(inherited)})`
                : 'Use global schedule (not configured)',
              disabled: !inherited,
            },
            { value: 'OVERRIDE', label: 'Use a channel override' },
            { value: 'MANUAL', label: 'Manual backups only' },
          ]}
          onValueChange={(value) => setMode(value as typeof mode)}
        />
        {mode !== 'OVERRIDE' ? (
          <div className="channels-schedule-actions">
            <p>
              {mode === 'GLOBAL'
                ? 'This channel inherits the enabled global schedule.'
                : 'This channel will run only when you choose Back up now.'}
            </p>
            {existing ? (
              <Button variant="danger" onClick={removeOverride} loading={busy}>
                Remove channel override
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
      {mode === 'OVERRIDE' ? (
        <section className="channels-section">
          <h2>Channel schedule</h2>
          <div className="channels-form-grid">
            <Select
              label="Frequency"
              value={frequency}
              options={[
                { value: 'DAILY', label: 'Daily' },
                { value: 'WEEKLY', label: 'Weekly' },
                { value: 'EVERY_N_HOURS', label: 'Every number of hours' },
              ]}
              onValueChange={(value) => setFrequency(value as ScheduleUpsert['frequency'])}
            />
            {frequency !== 'EVERY_N_HOURS' ? (
              <Input
                label="Local time"
                type="time"
                value={localTime}
                onChange={(event) => setLocalTime(event.currentTarget.value)}
              />
            ) : null}
            {frequency === 'WEEKLY' ? (
              <Select
                label="Weekday"
                value={String(weekday)}
                options={[
                  'Sunday',
                  'Monday',
                  'Tuesday',
                  'Wednesday',
                  'Thursday',
                  'Friday',
                  'Saturday',
                ].map((label, index) => ({ value: String(index), label }))}
                onValueChange={(value) => setWeekday(Number(value))}
              />
            ) : null}
            {frequency === 'EVERY_N_HOURS' ? (
              <Input
                label="Hours between backups"
                type="number"
                min={1}
                max={168}
                value={everyHours}
                onChange={(event) => setEveryHours(Number(event.currentTarget.value))}
              />
            ) : null}
          </div>
          <Switch
            label="Catch up after a missed run"
            checked={catchUp}
            onCheckedChange={setCatchUp}
          />
          <Switch
            label="Back up on app startup"
            checked={backupOnStartup}
            onCheckedChange={setBackupOnStartup}
          />
          <div className="channels-schedule-actions">
            <Button
              variant="primary"
              loading={pendingAction === `schedule:${channel.id}`}
              onClick={() =>
                onSave({
                  id: existing?.id ?? null,
                  channelId: channel.id,
                  enabled: true,
                  frequency,
                  localTime,
                  weekday: frequency === 'WEEKLY' ? weekday : null,
                  everyHours: frequency === 'EVERY_N_HOURS' ? everyHours : null,
                  catchUp,
                  backupOnStartup,
                })
              }
            >
              Save schedule
            </Button>
            {existing ? (
              <Button variant="danger" onClick={removeOverride} disabled={busy}>
                Remove override
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SourcePanel({
  channel,
  snapshot,
  pendingAction,
  syncJob,
  onSync,
  onNavigate,
}: {
  channel: ChannelDto;
  snapshot: ChannelsSnapshot;
  pendingAction: string | null;
  syncJob: ReturnType<typeof useChannelsController>['syncJob'];
  onSync(): void;
  onNavigate(route: AppRoute): void;
}) {
  const identities = snapshot.accounts.filter((account) =>
    channel.accessibleAccountIds.includes(account.id),
  );
  const activeSync =
    syncJob?.channelId === channel.id &&
    ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(syncJob.status);
  const terminalSync =
    syncJob?.channelId === channel.id && ['COMPLETED', 'FAILED'].includes(syncJob.status)
      ? syncJob
      : null;
  return (
    <div className="channels-panel-stack">
      <section className="channels-section">
        <h2>Source catalog</h2>
        <dl className="channels-definition-list">
          <div>
            <dt>Last refreshed</dt>
            <dd>{formatDate(channel.lastSyncAt)}</dd>
          </div>
          <div>
            <dt>Source status</dt>
            <dd>{channel.sourceStatus.toLowerCase().replaceAll('_', ' ')}</dd>
          </div>
          <div>
            <dt>Catalog</dt>
            <dd>
              {countLabel(channel.videosCount, 'video')}, {countLabel(channel.shortsCount, 'Short')}
              , {countLabel(channel.liveCount, 'live stream')}
            </dd>
          </div>
        </dl>
        {activeSync && syncJob ? (
          <Status
            kind="active"
            appearance="callout"
            label={
              syncJob.status === 'RETRY_WAIT'
                ? syncJob.nextRetryAt === null
                  ? 'Trying source refresh again'
                  : `Trying source refresh again at ${formatDate(syncJob.nextRetryAt)}`
                : syncJob.status === 'QUEUED'
                  ? 'Source refresh queued'
                  : `Refreshing ${syncJob.phase.toLowerCase()}`
            }
            description={
              syncJob.status === 'RETRY_WAIT' && syncJob.safeMessage
                ? syncJob.safeMessage
                : syncJob.progressRatio === null
                  ? 'Waiting for source progress'
                  : `${Math.round(syncJob.progressRatio * 100)}% complete`
            }
          />
        ) : null}
        {terminalSync ? (
          <Status
            kind={terminalSync.status === 'COMPLETED' ? 'completed' : 'failed'}
            appearance="callout"
            label={
              terminalSync.status === 'COMPLETED'
                ? 'Source refresh completed'
                : 'Source refresh failed'
            }
            description={terminalSync.safeMessage ?? undefined}
          />
        ) : null}
        <Button
          variant="primary"
          loading={pendingAction === `sync:${channel.id}` || activeSync}
          disabled={activeSync}
          onClick={onSync}
        >
          Refresh source
        </Button>
      </section>
      <section className="channels-section">
        <h2>Connected identities</h2>
        {identities.length === 0 ? (
          <p className="channels-muted">
            No connected identity currently grants access to this channel.
          </p>
        ) : (
          <ul className="channels-plain-list">
            {identities.map((account) => (
              <li key={account.id}>
                <YoutubeLogo size={18} />
                <span>{account.email ?? account.displayName ?? 'Google account'}</span>
                <Status
                  kind={account.connectionState === 'CONNECTED' ? 'connected' : 'warning'}
                  label={
                    account.connectionState === 'CONNECTED'
                      ? 'YouTube connected'
                      : 'Sign-in required'
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="link"
          onClick={() => onNavigate({ area: 'settings', category: 'accounts' })}
        >
          Manage accounts
        </Button>
      </section>
      <section className="channels-section channels-section--quiet">
        <h2>Read-only access</h2>
        <p>
          YouTube access is used only to discover channel metadata and acquire media for your
          backups. This app cannot upload, delete, or edit YouTube content.
        </p>
      </section>
    </div>
  );
}

function ChannelDetails({
  route,
  channel,
  snapshot,
  controller,
  onNavigate,
  onToggleRequest,
  onQualityRequest,
}: {
  route: ChannelsRoute;
  channel: ChannelDto;
  snapshot: ChannelsSnapshot;
  controller: ReturnType<typeof useChannelsController>;
  onNavigate(route: AppRoute): void;
  onToggleRequest(channel: ChannelDto): void;
  onQualityRequest(profile: QualityProfile | null): void;
}) {
  const panel = route.panel ?? 'overview';
  return (
    <div className="channels-page channels-page--detail">
      <PageHeader
        context={
          <Button
            variant="link"
            leadingIcon={<ArrowLeft size={16} />}
            onClick={() => onNavigate({ area: 'channels' })}
          >
            Channels
          </Button>
        }
        title={<ChannelIdentity channel={channel} />}
        description="Backup policy, schedule, and source access for this logical YouTube channel."
        action={
          <BackupAction
            channel={channel}
            snapshot={snapshot}
            pending={controller.pendingAction === `backup:${channel.id}`}
            locked={controller.startLockedChannelId === channel.id}
            onStart={() => void controller.startBackup(channel.id)}
            onNavigate={onNavigate}
          />
        }
        overflow={
          <IconButton
            label={channel.backupEnabled ? `Disable ${channel.title}` : `Enable ${channel.title}`}
            icon={<SlidersHorizontal size={18} />}
            onClick={() => onToggleRequest(channel)}
          />
        }
      />
      <ActionError message={controller.actionError} onDismiss={controller.clearActionError} />
      <Tabs
        ariaLabel="Channel details"
        value={panel}
        onValueChange={(value) =>
          onNavigate({
            area: 'channels',
            entityId: channel.id,
            panel: value as NonNullable<ChannelsRoute['panel']>,
          })
        }
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <OverviewPanel channel={channel} snapshot={snapshot} onNavigate={onNavigate} />
            ),
          },
          {
            value: 'backup',
            label: 'Backup',
            content: (
              <BackupPanel
                channel={channel}
                snapshot={snapshot}
                pendingAction={controller.pendingAction}
                onDestinationsChange={(ids) => void controller.updateDestinations(channel.id, ids)}
                onQualityRequest={onQualityRequest}
                onNavigate={onNavigate}
              />
            ),
          },
          {
            value: 'schedule',
            label: 'Schedule',
            content: (
              <SchedulePanel
                channel={channel}
                snapshot={snapshot}
                pendingAction={controller.pendingAction}
                onSave={(input) => void controller.saveSchedule(input)}
                onRemove={(id) => void controller.removeSchedule(id)}
              />
            ),
          },
          {
            value: 'source',
            label: 'Source',
            content: (
              <SourcePanel
                channel={channel}
                snapshot={snapshot}
                pendingAction={controller.pendingAction}
                syncJob={controller.syncJob}
                onSync={() => void controller.startSync(channel.id)}
                onNavigate={onNavigate}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

export function ChannelsScreen({ route, onNavigate, notice, onNotice }: ChannelsScreenProps) {
  const controller = useChannelsController({
    onBackupAccepted: () => onNavigate({ area: 'activity', view: 'active' }),
  });
  const [toggleTarget, setToggleTarget] = useState<ChannelDto | null>(null);
  const [qualityTarget, setQualityTarget] = useState<QualityProfile | null | undefined>(undefined);
  const dialogActionRef = useRef<HTMLButtonElement>(null);
  const snapshot = controller.snapshot;
  const selectedChannel = useMemo(
    () => snapshot?.channels.find((channel) => channel.id === route.entityId) ?? null,
    [route.entityId, snapshot],
  );

  useEffect(() => {
    if (notice === null) return;
    const timer = globalThis.setTimeout(() => onNotice(null), 6_000);
    return () => globalThis.clearTimeout(timer);
  }, [notice, onNotice]);

  const requestQuality = async (profile: QualityProfile | null) => {
    if (!selectedChannel) return;
    const preview = await controller.previewQuality(selectedChannel.id, profile);
    if (preview) setQualityTarget(profile);
  };

  if (controller.loading) {
    return (
      <main className="channels-page">
        <PageHeader title="Channels" description="Loading channel backup policy and health." />
        <Skeleton lines={6} />
      </main>
    );
  }
  if (controller.requestError || !snapshot) {
    return (
      <main className="channels-page">
        <ErrorState
          title="Channels could not be loaded"
          description={controller.requestError ?? 'The worker did not return channel state.'}
          retry={{ onClick: () => void controller.refresh() }}
        />
      </main>
    );
  }
  if (route.entityId && !selectedChannel) {
    return (
      <main className="channels-page">
        <ErrorState
          title="Channel not found"
          description="This channel is no longer in the local catalog."
          action={
            <Button onClick={() => onNavigate({ area: 'channels' })}>Back to Channels</Button>
          }
        />
      </main>
    );
  }

  const body: ReactNode = selectedChannel ? (
    <ChannelDetails
      route={route}
      channel={selectedChannel}
      snapshot={snapshot}
      controller={controller}
      onNavigate={onNavigate}
      onToggleRequest={setToggleTarget}
      onQualityRequest={(profile) => void requestQuality(profile)}
    />
  ) : (
    <main className="channels-page">
      <PageHeader
        title="Channels"
        description="Choose what is protected, where copies go, and when backups run."
      />
      {notice ? (
        <div className="channels-notice" role="status">
          {notice}
        </div>
      ) : null}
      <ActionError message={controller.actionError} onDismiss={controller.clearActionError} />
      <ChannelsList
        snapshot={snapshot}
        pendingAction={controller.pendingAction}
        startLockedChannelId={controller.startLockedChannelId}
        onNavigate={onNavigate}
        onStartBackup={(id) => void controller.startBackup(id)}
        onToggleRequest={setToggleTarget}
      />
    </main>
  );

  return (
    <>
      {body}
      <Dialog
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.backupEnabled ? 'Disable channel backup?' : 'Enable channel backup?'}
        description={
          toggleTarget?.backupEnabled
            ? 'This stops future scheduled and manual backups for the channel. Existing backup files and catalog history are kept.'
            : 'This allows manual and scheduled backups after at least one destination is selected.'
        }
        initialFocusRef={dialogActionRef}
        footer={
          <>
            <DialogAction variant="ghost" closeOnSelect>
              Cancel
            </DialogAction>
            <DialogAction
              ref={dialogActionRef}
              variant={toggleTarget?.backupEnabled ? 'danger' : 'primary'}
              loading={controller.pendingAction?.startsWith('enabled:') ?? false}
              onClick={() => {
                if (!toggleTarget) return;
                void controller
                  .setEnabled(toggleTarget.id, !toggleTarget.backupEnabled)
                  .then((succeeded) => succeeded && setToggleTarget(null));
              }}
            >
              {toggleTarget?.backupEnabled ? 'Disable backup' : 'Enable backup'}
            </DialogAction>
          </>
        }
      >
        <p>{toggleTarget ? `Channel: ${toggleTarget.title}` : ''}</p>
      </Dialog>
      <Dialog
        open={qualityTarget !== undefined}
        onOpenChange={(open) => !open && setQualityTarget(undefined)}
        title="Apply channel quality"
        description="The selected quality will be used when this channel needs a new media copy."
        footer={
          <>
            <DialogAction variant="ghost" closeOnSelect>
              Cancel
            </DialogAction>
            <DialogAction
              variant="primary"
              loading={controller.pendingAction?.startsWith('quality-apply:') ?? false}
              onClick={() => {
                if (!selectedChannel || qualityTarget === undefined) return;
                void controller
                  .applyQuality(selectedChannel.id, qualityTarget)
                  .then((succeeded) => succeeded && setQualityTarget(undefined));
              }}
            >
              Apply to new media
            </DialogAction>
          </>
        }
      >
        {controller.qualityPreview ? (
          <div className="channels-quality-decision">
            <p>
              <strong>
                {QUALITY_PROFILE_LABELS[controller.qualityPreview.previousEffectiveQualityProfile]}
              </strong>{' '}
              to{' '}
              <strong>
                {QUALITY_PROFILE_LABELS[controller.qualityPreview.targetEffectiveQualityProfile]}
              </strong>
            </p>
            {controller.qualityPreview.isQualityIncrease ? (
              <p>
                {countLabel(controller.qualityPreview.eligibleMediaCount, 'media item')} and{' '}
                {countLabel(
                  controller.qualityPreview.eligibleCopyCount,
                  'verified copy',
                  'verified copies',
                )}{' '}
                are known to use a lower profile.
              </p>
            ) : (
              <p>This change does not increase the effective quality profile.</p>
            )}
            <Status
              kind="warning"
              appearance="callout"
              label="Existing-copy upgrade is not available"
              description={controller.qualityPreview.unsupportedReason}
            />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
