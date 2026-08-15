import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ArrowRight,
  ClockCounterClockwise,
  CloudArrowUp,
  Pause,
  Play,
  ShieldCheck,
} from '@phosphor-icons/react';

import type { AppRoute } from '../../app/routes';
import { Button, Dialog, EmptyState, ErrorState, Progress, Skeleton, Status } from '../../ui';
import { useHomeController } from './home-controller';
import {
  buildHomePresentation,
  formatHomeBytes,
  formatHomeDate,
  formatHomeRelativeTime,
  homeRunOutcome,
} from './home-model';
import './home.css';

export interface HomeScreenProps {
  onNavigate(route: AppRoute): void;
  onOpenRecovery(): void | Promise<void>;
}

function HomeLoading() {
  return (
    <div className="home-loading" role="status" aria-label="Loading Home" aria-live="polite">
      <span className="ui-visually-hidden">Loading Home</span>
      <Skeleton
        announce={false}
        className="home-loading__conclusion"
        label="Loading backup status"
        lines={2}
      />
      <div className="home-loading__summary">
        <Skeleton announce={false} label="Loading archive summary" lines={3} />
        <Skeleton announce={false} label="Loading recent backups" lines={3} />
      </div>
    </div>
  );
}

function HomeArchiveSummary({
  mediaCount,
  selectedChannelCount,
  verifiedBytes,
  verifiedCopyCount,
}: {
  mediaCount: number;
  selectedChannelCount: number;
  verifiedBytes: number;
  verifiedCopyCount: number;
}) {
  return (
    <section className="home-section home-archive" aria-labelledby="home-archive-title">
      <h2 id="home-archive-title">Archive</h2>
      <dl className="home-archive__facts">
        <div>
          <dt>Channels</dt>
          <dd>{selectedChannelCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Media items</dt>
          <dd>{mediaCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Verified copies</dt>
          <dd>{verifiedCopyCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Verified size</dt>
          <dd>{formatHomeBytes(verifiedBytes)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function HomeScreen({ onNavigate, onOpenRecovery }: HomeScreenProps) {
  const [chooserOpen, setChooserOpen] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const homeHeading = useRef<HTMLHeadingElement>(null);
  const backupAction = useRef<HTMLButtonElement>(null);
  const firstChannel = useRef<HTMLInputElement>(null);
  const noEligibleChannels = useRef<HTMLParagraphElement>(null);
  const controller = useHomeController({
    onBackupAccepted: () => {
      setChooserOpen(false);
      onNavigate({ area: 'activity', view: 'active' });
    },
  });
  const presentation = useMemo(
    () => (controller.snapshot === null ? null : buildHomePresentation(controller.snapshot)),
    [controller.snapshot],
  );
  const partialSetup = presentation?.setup.kind === 'partial' ? presentation.setup : null;
  const controlsUnavailable = controller.requestError !== null;
  const eligibleChannelIds = useMemo(
    () => new Set(presentation?.eligibleChannels.map((channel) => channel.id) ?? []),
    [presentation],
  );
  const eligibleSelectedChannelId =
    selectedChannelId !== null && eligibleChannelIds.has(selectedChannelId)
      ? selectedChannelId
      : (presentation?.eligibleChannels[0]?.id ?? null);
  const recoveryCanResume =
    controller.snapshot?.latestRecovery !== null &&
    controller.snapshot?.latestRecovery !== undefined &&
    ['DRAFT', 'SCANNING', 'READY_FOR_REVIEW', 'IMPORTING', 'FAILED'].includes(
      controller.snapshot.latestRecovery.status,
    );

  useEffect(() => {
    if (!chooserOpen || selectedChannelId === null || eligibleChannelIds.has(selectedChannelId)) {
      return;
    }
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement.closest('.home-backup-dialog') !== null
    ) {
      return;
    }
    (firstChannel.current ?? noEligibleChannels.current)?.focus();
  }, [chooserOpen, eligibleChannelIds, selectedChannelId]);

  const openChooser = (): void => {
    if (presentation === null || presentation.eligibleChannels.length === 0) return;
    if (!controller.startRetryLocked) controller.clearStartError();
    setSelectedChannelId(presentation.eligibleChannels[0]!.id);
    setChooserOpen(true);
  };

  const openRecovery = async (): Promise<void> => {
    if (recoveryPending) return;
    setRecoveryPending(true);
    try {
      await onOpenRecovery();
    } finally {
      setRecoveryPending(false);
    }
  };

  const headerAction =
    presentation === null || partialSetup !== null ? null : presentation.setup.kind ===
        'configured' && controller.startRetryLocked ? (
      <Button
        ref={backupAction}
        variant="primary"
        onClick={() => onNavigate({ area: 'activity', view: 'active' })}
        trailingIcon={<ArrowRight size={17} weight="regular" />}
      >
        Check Activity
      </Button>
    ) : presentation.setup.kind === 'configured' && presentation.eligibleChannels.length > 0 ? (
      <Button
        ref={backupAction}
        variant="primary"
        loading={controller.operationPending}
        disabled={controlsUnavailable || controller.operationPending}
        onClick={openChooser}
        leadingIcon={<CloudArrowUp size={18} weight="regular" />}
      >
        Back up now
      </Button>
    ) : presentation.setup.kind === 'configured' ? (
      <Button
        ref={backupAction}
        variant="primary"
        onClick={() => onNavigate({ area: 'channels', panel: 'backup' })}
      >
        Review channels
      </Button>
    ) : null;

  if (controller.loading) {
    return (
      <div className="home-screen">
        <header className="home-header">
          <h1 ref={homeHeading} tabIndex={-1}>
            Home
          </h1>
        </header>
        <HomeLoading />
      </div>
    );
  }

  if (controller.snapshot === null || presentation === null) {
    return (
      <div className="home-screen">
        <header className="home-header">
          <h1 ref={homeHeading} tabIndex={-1}>
            Home
          </h1>
        </header>
        <ErrorState
          title="Home could not load backup data"
          description="The app could not load all confirmed archive details. Your existing backup files are not changed."
          action={
            <div className="home-reconnecting__actions">
              <Button variant="primary" onClick={() => void controller.refresh()}>
                Retry Home
              </Button>
              <Button onClick={() => onNavigate({ area: 'settings', category: 'advanced' })}>
                Open diagnostics
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const { dashboard } = controller.snapshot;

  return (
    <div className="home-screen">
      <header className="home-header">
        <h1 ref={homeHeading} tabIndex={-1}>
          Home
        </h1>
        {headerAction}
      </header>

      {controller.requestError !== null ? (
        <div className="home-reconnecting" role="alert">
          <Status
            kind="warning"
            label="Home could not refresh"
            description="Confirmed archive details remain visible, but backup controls are unavailable."
          />
          <div className="home-reconnecting__actions">
            <Button size="compact" onClick={() => void controller.refresh()}>
              Retry
            </Button>
            <Button
              size="compact"
              variant="ghost"
              onClick={() => onNavigate({ area: 'settings', category: 'advanced' })}
            >
              Diagnostics
            </Button>
          </div>
        </div>
      ) : null}

      {controller.startError !== null && !chooserOpen ? (
        <div className="home-action-error" role="alert">
          <span>{controller.startError}</span>
          {controller.startRetryLocked ? (
            <Button
              size="compact"
              variant="ghost"
              onClick={() => onNavigate({ area: 'activity', view: 'active' })}
            >
              Check Activity
            </Button>
          ) : (
            <Button size="compact" variant="ghost" onClick={controller.clearStartError}>
              Dismiss
            </Button>
          )}
        </div>
      ) : null}

      {presentation.setup.kind === 'empty' ? (
        <EmptyState
          className="home-onboarding"
          title="Create or recover your backup archive"
          description="The app can read your YouTube archive but cannot upload, edit, or delete YouTube content. Set up a new backup, or restore the local catalog from existing app-created backup files without changing them."
          icon={ShieldCheck}
          action={
            <div className="home-onboarding__actions">
              <Button
                variant="primary"
                onClick={() => onNavigate({ area: 'settings', category: 'accounts' })}
              >
                Set up a new backup
              </Button>
              <Button
                loading={recoveryPending}
                disabled={controlsUnavailable}
                onClick={() => void openRecovery()}
              >
                {recoveryCanResume ? 'Resume recovery' : 'Restore an existing backup'}
              </Button>
            </div>
          }
        />
      ) : partialSetup !== null ? (
        <EmptyState
          className="home-onboarding"
          title={partialSetup.title}
          description={partialSetup.description}
          icon={ClockCounterClockwise}
          action={
            <div className="home-onboarding__actions">
              <Button
                variant="primary"
                onClick={() => onNavigate(partialSetup.route)}
                trailingIcon={<ArrowRight size={17} weight="regular" />}
              >
                Continue setup
              </Button>
              <Button
                variant="ghost"
                loading={recoveryPending}
                disabled={controlsUnavailable}
                onClick={() => void openRecovery()}
              >
                {recoveryCanResume ? 'Resume recovery' : 'Restore an existing backup'}
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <section className="home-health" data-tone={presentation.health.tone}>
            <Status
              className="home-health__status"
              kind={
                presentation.health.tone === 'healthy'
                  ? 'verified'
                  : presentation.health.tone === 'warning'
                    ? 'warning'
                    : presentation.health.tone === 'danger'
                      ? 'failed'
                      : presentation.health.tone === 'info'
                        ? 'active'
                        : 'unknown'
              }
              label="Archive status"
            />
            <h2>{presentation.health.title}</h2>
            <p>{presentation.health.description}</p>
          </section>

          {presentation.activeOperation !== null ? (
            <section className="home-section home-active" aria-labelledby="home-active-title">
              <div className="home-section__heading">
                <div>
                  <p className="home-section__label">Active</p>
                  <h2 id="home-active-title">{presentation.activeOperation.title}</h2>
                </div>
                <Status
                  kind={
                    presentation.activeOperation.job.status === 'PAUSED'
                      ? 'paused'
                      : ['BLOCKED', 'RETRY_WAIT'].includes(presentation.activeOperation.job.status)
                        ? 'warning'
                        : 'active'
                  }
                  label={presentation.activeOperation.stateLabel}
                />
              </div>
              {presentation.activeOperation.job.progressRatio === null &&
              ['BLOCKED', 'PAUSED'].includes(presentation.activeOperation.job.status) ? (
                <p className="home-active__progress-note">
                  <span>{presentation.activeOperation.phase}</span>
                  <span>Progress unavailable</span>
                </p>
              ) : (
                <Progress
                  label={presentation.activeOperation.phase}
                  {...(presentation.activeOperation.job.progressRatio === null
                    ? {}
                    : { value: presentation.activeOperation.job.progressRatio * 100 })}
                  currentAction={
                    presentation.activeOperation.job.bytesTotal === null
                      ? formatHomeBytes(presentation.activeOperation.job.bytesProcessed)
                      : `${formatHomeBytes(presentation.activeOperation.job.bytesProcessed)} of ${formatHomeBytes(presentation.activeOperation.job.bytesTotal)}`
                  }
                />
              )}
              {presentation.activeOperation.destinationLabel !== null ? (
                <p
                  className="home-active__destination"
                  title={presentation.activeOperation.destinationLabel}
                >
                  Destination: {presentation.activeOperation.destinationLabel}
                </p>
              ) : null}
              <div className="home-active__actions">
                <Button onClick={() => onNavigate({ area: 'activity', view: 'active' })}>
                  Open Activity
                </Button>
                {presentation.activeOperation.canPause ? (
                  <Button
                    disabled={controlsUnavailable || controller.operationPending}
                    leadingIcon={<Pause size={17} weight="fill" />}
                    onClick={() =>
                      void controller.controlOperation(presentation.activeOperation!.job, 'PAUSE')
                    }
                  >
                    Pause
                  </Button>
                ) : presentation.activeOperation.canResume ? (
                  <Button
                    disabled={controlsUnavailable || controller.operationPending}
                    leadingIcon={<Play size={17} weight="fill" />}
                    onClick={() =>
                      void controller.controlOperation(presentation.activeOperation!.job, 'RESUME')
                    }
                  >
                    Resume
                  </Button>
                ) : null}
              </div>
            </section>
          ) : null}

          {presentation.attention.length > 0 ? (
            <section className="home-section home-attention" aria-labelledby="home-attention-title">
              <div className="home-section__heading">
                <div>
                  <p className="home-section__label">Needs attention</p>
                  <h2 id="home-attention-title">Resolve backup issues</h2>
                </div>
              </div>
              <div className="home-row-list">
                {presentation.attention.map((item, index) => {
                  const descriptionId = `home-attention-description-${index}`;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="home-action-row"
                      onClick={() => onNavigate(item.route)}
                      aria-label={`${item.title}: ${item.actionLabel}`}
                      aria-describedby={descriptionId}
                    >
                      <span>
                        <strong>{item.title}</strong>
                        <small id={descriptionId}>{item.description}</small>
                      </span>
                      <span className="home-action-row__action">
                        {item.actionLabel}
                        <ArrowRight size={16} weight="regular" aria-hidden="true" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <HomeArchiveSummary
            mediaCount={dashboard.mediaCount}
            selectedChannelCount={dashboard.selectedChannelCount}
            verifiedBytes={dashboard.verifiedBytes}
            verifiedCopyCount={dashboard.verifiedCopyCount}
          />

          {presentation.channelSummaries.length > 0 ? (
            <section className="home-section" aria-labelledby="home-channels-title">
              <div className="home-section__heading">
                <h2 id="home-channels-title">Channels and destinations</h2>
                <Button variant="link" onClick={() => onNavigate({ area: 'channels' })}>
                  View channels
                </Button>
              </div>
              <div className="home-row-list">
                {presentation.channelSummaries.map((channel) => (
                  <button
                    key={channel.channelId}
                    type="button"
                    className="home-action-row"
                    onClick={() =>
                      onNavigate({ area: 'channels', entityId: channel.channelId, panel: 'backup' })
                    }
                    aria-label={`Open backup settings for ${channel.title}`}
                  >
                    <span>
                      <strong title={channel.title}>{channel.title}</strong>
                      <small title={channel.destinationSummary}>{channel.destinationSummary}</small>
                    </span>
                    <span className="home-action-row__meta">
                      {channel.lastBackupAt === null
                        ? 'No completed backup yet'
                        : `Last backup ${formatHomeRelativeTime(channel.lastBackupAt)}`}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {presentation.recentRuns.length > 0 ? (
            <section className="home-section" aria-labelledby="home-recent-title">
              <div className="home-section__heading">
                <h2 id="home-recent-title">Recent backup outcomes</h2>
                <Button
                  variant="link"
                  onClick={() => onNavigate({ area: 'activity', view: 'history' })}
                >
                  View history
                </Button>
              </div>
              <div className="home-row-list">
                {presentation.recentRuns.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="home-action-row"
                    onClick={() =>
                      onNavigate({
                        area: 'activity',
                        view: 'history',
                        entityId: run.id,
                        detail: 'overview',
                      })
                    }
                    aria-label={`Open backup run for ${run.channelTitle}, ${homeRunOutcome(run)}`}
                  >
                    <span>
                      <strong>{run.channelTitle}</strong>
                      <small>{homeRunOutcome(run)}</small>
                    </span>
                    <span className="home-action-row__meta">
                      {formatHomeDate(run.completedAt ?? run.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <Dialog
        className="home-backup-dialog"
        open={chooserOpen}
        onOpenChange={(open) => {
          setChooserOpen(open);
          if (
            !open &&
            !controller.operationPending &&
            !controller.reconcilingStart &&
            !controller.startRetryLocked
          ) {
            controller.clearStartError();
          }
        }}
        title="Back up now"
        description="Choose one managed channel. The backup continues in Activity after it is accepted."
        initialFocusRef={firstChannel}
        returnFocusRef={presentation.setup.kind === 'configured' ? backupAction : homeHeading}
        footer={
          <>
            <Button variant="ghost" onClick={() => setChooserOpen(false)}>
              {controller.operationPending || controller.reconcilingStart ? 'Hide' : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              loading={controller.operationPending || controller.reconcilingStart}
              disabled={
                controlsUnavailable ||
                eligibleSelectedChannelId === null ||
                controller.startRetryLocked ||
                (!controller.retryStartAllowed && controller.startError !== null)
              }
              onClick={() => {
                if (eligibleSelectedChannelId !== null) {
                  void controller.startBackup(eligibleSelectedChannelId);
                }
              }}
            >
              {controller.reconcilingStart
                ? 'Checking Activity'
                : controller.retryStartAllowed
                  ? 'Try again'
                  : 'Start backup'}
            </Button>
          </>
        }
      >
        <fieldset
          className="home-channel-chooser"
          disabled={controller.operationPending || controller.reconcilingStart}
        >
          <legend>Choose a channel</legend>
          {presentation.eligibleChannels.length === 0 ? (
            <p ref={noEligibleChannels} tabIndex={-1} className="home-channel-chooser__empty">
              No channels are currently eligible. Review channel access and backup destinations.
            </p>
          ) : null}
          {presentation.eligibleChannels.map((channel, index) => (
            <label key={channel.id}>
              <input
                ref={index === 0 ? firstChannel : undefined}
                type="radio"
                name="home-backup-channel"
                value={channel.id}
                checked={eligibleSelectedChannelId === channel.id}
                onChange={() => setSelectedChannelId(channel.id)}
              />
              <span>{channel.title}</span>
            </label>
          ))}
        </fieldset>
        {controller.startError !== null ? (
          <div className="home-dialog-error" role="alert">
            <strong>Backup start was not confirmed</strong>
            <span>{controller.startError}</span>
            {!controller.retryStartAllowed ? (
              <Button
                size="compact"
                variant="link"
                onClick={() => onNavigate({ area: 'activity', view: 'active' })}
              >
                Check Activity
              </Button>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
