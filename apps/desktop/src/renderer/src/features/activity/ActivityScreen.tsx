import { useMemo, useRef, useState, type KeyboardEvent } from 'react';

import {
  ArrowClockwise,
  CaretRight,
  ClockCounterClockwise,
  DotsThree,
  Pause,
  Play,
  ShieldWarning,
  Stop,
} from '@phosphor-icons/react';
import type {
  ActivityAttentionIssueDto,
  ActivityLogCategory,
  ActivityOperationDto,
  ActivityTechnicalJobDto,
  BackupRunDto,
  JobControlAction,
  RunControlAction,
} from '@ytbm/core';

import type { AppRoute } from '../../app/routes';
import {
  Button,
  Dialog,
  DialogAction,
  DropdownMenu,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  PageHeader,
  Progress,
  SegmentedControl,
  Select,
  Skeleton,
  Status,
} from '../../ui';
import { usePendingOperations } from '../../app/use-pending-operations';
import { useActivityScreenController } from './activity-controller';
import {
  ACTIVITY_PHASE_LABELS,
  JOB_ACTION_LABELS,
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  LOG_FILTER_LABELS,
  OPERATION_ACTION_LABELS,
  OPERATION_STATUS_LABELS,
  RUN_STATUS_LABELS,
  TRIGGER_LABELS,
  attentionGroupLabel,
  operationTone,
} from './activity-model';
import './activity.css';

const PAGE_SIZE = 25;

type ActivityRoute = Extract<AppRoute, { area: 'activity' }>;

interface ConfirmationState {
  kind: 'operation' | 'job';
  id: string;
  action: RunControlAction | JobControlAction;
  title: string;
}

function formatDate(value: number | null): string {
  if (value === null) return 'Not completed';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

function formatBytes(value: number | null): string {
  if (value === null) return 'Size unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : amount >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatEta(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `About ${seconds} seconds remaining`;
  const minutes = Math.ceil(seconds / 60);
  return `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} remaining`;
}

function dateBoundary(value: string, endOfDay = false): number | null {
  if (value === '') return null;
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function Pager({
  page,
  pageSize = PAGE_SIZE,
  total,
  onPage,
}: {
  page: number;
  pageSize?: number;
  total: number;
  onPage(page: number): void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="activity-pager" aria-label="Activity pages">
      <Button size="compact" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page} of {pages}
      </span>
      <Button size="compact" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

function ActivityTabs({
  route,
  onNavigate,
  attentionCount,
}: {
  route: ActivityRoute;
  onNavigate(route: AppRoute): void;
  attentionCount: number;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = [
    { value: 'active', label: 'Active' },
    { value: 'history', label: 'History' },
    { value: 'attention', label: 'Needs attention', count: attentionCount },
  ] as const;

  const selectTab = (index: number): void => {
    const tab = tabs[index];
    if (tab === undefined) return;
    onNavigate({ area: 'activity', view: tab.value });
    tabRefs.current[index]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(nextIndex);
  };

  return (
    <div className="activity-tabs" role="tablist" aria-label="Activity views">
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          ref={(element) => {
            tabRefs.current[index] = element;
          }}
          id={`activity-tab-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={route.view === tab.value}
          aria-controls={`activity-panel-${tab.value}`}
          tabIndex={route.view === tab.value ? 0 : -1}
          onClick={() => selectTab(index)}
          onKeyDown={(event) => onTabKeyDown(event, index)}
        >
          <span>{tab.label}</span>
          {'count' in tab && tab.count > 0 ? (
            <span className="activity-tabs__count" aria-label={`${tab.count} items`}>
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function OperationActions({
  operation,
  busy,
  onAction,
  onConfirm,
}: {
  operation: ActivityOperationDto;
  busy: boolean;
  onAction(action: RunControlAction): void;
  onConfirm(action: RunControlAction): void;
}) {
  const primary = operation.availableActions.find(
    (action) => action === 'RESUME' || action === 'PAUSE',
  );
  const overflow = operation.availableActions.filter((action) => action !== primary);
  return (
    <div className="activity-row__controls" onClick={(event) => event.stopPropagation()}>
      {primary !== undefined ? (
        <Button
          size="compact"
          loading={busy}
          leadingIcon={primary === 'RESUME' ? <Play size={16} /> : <Pause size={16} />}
          onClick={() => onAction(primary)}
        >
          {OPERATION_ACTION_LABELS[primary]}
        </Button>
      ) : null}
      {overflow.length > 0 ? (
        <DropdownMenu
          ariaLabel={`More actions for ${operation.title}`}
          trigger={
            <IconButton
              label={`More actions for ${operation.title}`}
              icon={<DotsThree size={20} />}
            />
          }
          items={overflow.map((action) => ({
            id: action,
            label: OPERATION_ACTION_LABELS[action],
            danger: action === 'CANCEL_KEEP_PARTIAL',
            onSelect: () =>
              action === 'CANCEL_KEEP_PARTIAL' ? onConfirm(action) : onAction(action),
          }))}
        />
      ) : null}
    </div>
  );
}

function OperationRow({
  operation,
  dominant = false,
  busy,
  onOpen,
  onAction,
  onConfirm,
}: {
  operation: ActivityOperationDto;
  dominant?: boolean;
  busy: boolean;
  onOpen(): void;
  onAction(action: RunControlAction): void;
  onConfirm(action: RunControlAction): void;
}) {
  const eta = formatEta(operation.etaSeconds);
  const speed =
    operation.speedBytesPerSec === null ? null : `${formatBytes(operation.speedBytesPerSec)}/s`;
  const pace = [speed, eta].filter((value): value is string => value !== null).join(' · ');
  const currentAction =
    operation.status === 'RETRY_WAIT' && operation.nextRetryAt !== null
      ? `Retrying ${formatDate(operation.nextRetryAt)}`
      : pace || `${operation.completedSteps} of ${operation.totalSteps} steps complete`;
  return (
    <article className="activity-operation" data-dominant={dominant ? '' : undefined}>
      <button className="activity-operation__body" type="button" onClick={onOpen}>
        <span className="activity-operation__heading">
          <span>
            <strong>{operation.title}</strong>
            <small>{operation.channelTitle}</small>
          </span>
          <Status
            appearance="chip"
            label={OPERATION_STATUS_LABELS[operation.status]}
            tone={operationTone(operation.status)}
          />
        </span>
        <Progress
          label={ACTIVITY_PHASE_LABELS[operation.phase]}
          {...(operation.progressRatio === null ? {} : { value: operation.progressRatio * 100 })}
          currentAction={currentAction}
        />
        {operation.destinationBranches.length > 0 ? (
          <span className="activity-branches" aria-label="Destination progress">
            {operation.destinationBranches.map((branch) => (
              <span key={branch.destinationId} className="activity-branch">
                <span>{branch.label}</span>
                <Status
                  label={OPERATION_STATUS_LABELS[branch.status]}
                  tone={operationTone(branch.status)}
                />
              </span>
            ))}
          </span>
        ) : null}
        {operation.safeMessage !== null ? (
          <span className="activity-operation__message">{operation.safeMessage}</span>
        ) : null}
      </button>
      <OperationActions
        operation={operation}
        busy={busy}
        onAction={onAction}
        onConfirm={onConfirm}
      />
    </article>
  );
}

function RunRow({ run, onOpen }: { run: BackupRunDto; onOpen(): void }) {
  const totalCopies = run.localCopyCount + run.driveUploadCount;
  return (
    <article role="listitem">
      <button className="activity-history-row" type="button" onClick={onOpen}>
        <time
          className="activity-history-row__time"
          dateTime={new Date(run.createdAt).toISOString()}
        >
          {formatDate(run.createdAt)}
        </time>
        <span className="activity-history-row__main">
          <strong>{run.channelTitle}</strong>
          <small>{TRIGGER_LABELS[run.triggerType]}</small>
        </span>
        <span className="activity-history-row__outcome">
          <Status label={RUN_STATUS_LABELS[run.status]} tone={operationTone(run.status)} />
          <small>
            {run.downloadedCount} downloaded, {totalCopies} copies written, {run.failedCount} failed
          </small>
        </span>
        <span className="activity-history-row__bytes">{formatBytes(run.bytesTransferred)}</span>
        <CaretRight size={16} aria-hidden="true" />
      </button>
    </article>
  );
}

function TechnicalJobRow({
  job,
  busy,
  onAction,
}: {
  job: ActivityTechnicalJobDto;
  busy: boolean;
  onAction(action: JobControlAction): void;
}) {
  return (
    <article className="activity-technical-row">
      <span>
        <strong>{JOB_TYPE_LABELS[job.jobType]}</strong>
        <small>{job.destinationLabel ?? 'Archive-wide step'}</small>
      </span>
      <Status label={JOB_STATUS_LABELS[job.status]} tone={operationTone(job.status)} />
      <span className="activity-technical-row__attempts">
        Attempt {job.attemptCount} of {job.maxAttempts}
      </span>
      {job.availableActions.length > 0 ? (
        <DropdownMenu
          ariaLabel={`Actions for ${JOB_TYPE_LABELS[job.jobType]}`}
          trigger={
            <IconButton
              label={`Actions for ${JOB_TYPE_LABELS[job.jobType]}`}
              icon={<DotsThree size={20} />}
              disabled={busy}
            />
          }
          items={job.availableActions.map((action) => ({
            id: action,
            label: JOB_ACTION_LABELS[action],
            danger: action.startsWith('CANCEL_'),
            onSelect: () => onAction(action),
          }))}
        />
      ) : (
        <span />
      )}
      {job.safeMessage !== null ? <p>{job.safeMessage}</p> : null}
    </article>
  );
}

function DetailsDialog({
  route,
  controller,
  detailPage,
  busyJobId,
  onClose,
  onDetailPage,
  onJobAction,
}: {
  route: ActivityRoute;
  controller: ReturnType<typeof useActivityScreenController>;
  detailPage: number;
  busyJobId: string | null;
  onClose(): void;
  onDetailPage(page: number): void;
  onJobAction(job: ActivityTechnicalJobDto, action: JobControlAction): void;
}) {
  const details = controller.operationDetails ?? controller.runDetails;
  const run = details?.run;
  const operation = controller.operationDetails?.operation;
  return (
    <Dialog
      open={route.entityId !== undefined}
      onOpenChange={(open) => !open && onClose()}
      title={operation?.title ?? run?.channelTitle ?? 'Activity details'}
      description={
        operation === undefined
          ? run === undefined
            ? 'Loading a fresh worker-backed summary.'
            : `${TRIGGER_LABELS[run.triggerType]} started ${formatDate(run.createdAt)}`
          : `${operation.channelTitle}. ${ACTIVITY_PHASE_LABELS[operation.phase]}`
      }
      className="activity-details-dialog"
    >
      {controller.detailError !== null ? (
        <ErrorState
          title="Details are unavailable"
          description={controller.detailError}
          retry={{ onClick: () => void controller.refreshDetails() }}
        />
      ) : details === null ? (
        <Skeleton lines={5} label="Loading activity details" />
      ) : (
        <div className="activity-details">
          {operation !== undefined ? (
            <section
              className="activity-details__summary"
              aria-labelledby="operation-summary-title"
            >
              <h2 id="operation-summary-title">Operation summary</h2>
              <Progress
                label={ACTIVITY_PHASE_LABELS[operation.phase]}
                {...(operation.progressRatio === null
                  ? {}
                  : { value: operation.progressRatio * 100 })}
                completed={operation.completedSteps}
                total={operation.totalSteps}
              />
              <div className="activity-details__facts">
                <span>
                  <small>Status</small>
                  <strong>{OPERATION_STATUS_LABELS[operation.status]}</strong>
                </span>
                <span>
                  <small>Processed</small>
                  <strong>{formatBytes(operation.bytesProcessed)}</strong>
                </span>
                <span>
                  <small>Started</small>
                  <strong>{formatDate(operation.createdAt)}</strong>
                </span>
              </div>
            </section>
          ) : run !== undefined ? (
            <section className="activity-details__summary" aria-labelledby="run-summary-title">
              <h2 id="run-summary-title">Run summary</h2>
              <div className="activity-details__facts">
                <span>
                  <small>Status</small>
                  <strong>{RUN_STATUS_LABELS[run.status]}</strong>
                </span>
                <span>
                  <small>Downloaded</small>
                  <strong>{run.downloadedCount}</strong>
                </span>
                <span>
                  <small>Local copies</small>
                  <strong>{run.localCopyCount}</strong>
                </span>
                <span>
                  <small>Drive copies</small>
                  <strong>{run.driveUploadCount}</strong>
                </span>
                <span>
                  <small>Failed steps</small>
                  <strong>{run.failedCount}</strong>
                </span>
                <span>
                  <small>Transferred</small>
                  <strong>{formatBytes(run.bytesTransferred)}</strong>
                </span>
              </div>
            </section>
          ) : null}
          <details className="activity-technical" open={route.detail === 'technical'}>
            <summary>Technical details</summary>
            <p className="activity-technical__intro">
              Durable worker steps are shown here for diagnosis and exact step-level control.
            </p>
            <div className="activity-technical__list">
              {details.technicalJobs.map((job) => (
                <TechnicalJobRow
                  key={job.id}
                  job={job}
                  busy={busyJobId === job.id}
                  onAction={(action) => onJobAction(job, action)}
                />
              ))}
            </div>
            <Pager
              page={detailPage}
              total={'totalJobs' in details ? details.totalJobs : 0}
              onPage={onDetailPage}
            />
          </details>
        </div>
      )}
    </Dialog>
  );
}

function AttentionView({
  issues,
  page,
  total,
  onPage,
  onResolve,
}: {
  issues: readonly ActivityAttentionIssueDto[];
  page: number;
  total: number;
  onPage(page: number): void;
  onResolve(issue: ActivityAttentionIssueDto): void;
}) {
  const groups = useMemo(() => {
    const grouped = new Map<ActivityAttentionIssueDto['kind'], ActivityAttentionIssueDto[]>();
    for (const issue of issues) {
      const items = grouped.get(issue.kind) ?? [];
      items.push(issue);
      grouped.set(issue.kind, items);
    }
    return grouped;
  }, [issues]);
  if (issues.length === 0) {
    return (
      <EmptyState
        title="Nothing needs attention"
        description="Blocked work, storage issues, authorization problems, integrity failures, and schedule errors will appear here."
        icon={ShieldWarning}
      />
    );
  }
  return (
    <div className="activity-attention-groups">
      {[...groups.entries()].map(([kind, items]) => (
        <section
          key={kind}
          className="activity-attention-group"
          aria-labelledby={`attention-${kind}`}
        >
          <header>
            <h2 id={`attention-${kind}`}>{attentionGroupLabel(kind)}</h2>
            <span>{items.reduce((count, item) => count + item.count, 0)}</span>
          </header>
          {items.map((issue) => (
            <article key={issue.id} className="activity-attention-row">
              <span>
                <strong>{issue.title}</strong>
                <small>{issue.summary}</small>
              </span>
              <time dateTime={new Date(issue.createdAt).toISOString()}>
                {formatDate(issue.createdAt)}
              </time>
              <Button variant="primary" size="compact" onClick={() => onResolve(issue)}>
                {issue.resolutionLabel}
              </Button>
            </article>
          ))}
        </section>
      ))}
      <Pager page={page} total={total} onPage={onPage} />
    </div>
  );
}

export function ActivityScreen({
  route,
  onNavigate,
  notice,
  onNotice,
}: {
  route: ActivityRoute;
  onNavigate(route: AppRoute): void;
  notice: string | null;
  onNotice(message: string | null): void;
}) {
  const [livePage, setLivePage] = useState(1);
  const [attentionPage, setAttentionPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [detailPage, setDetailPage] = useState(1);
  const [historyCategory, setHistoryCategory] = useState<ActivityLogCategory>('ALL');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const pending = usePendingOperations();
  const controller = useActivityScreenController({
    route,
    livePage,
    attentionPage,
    historyPage,
    historyCategory,
    channelId,
    destinationId,
    from: dateBoundary(fromDate),
    to: dateBoundary(toDate, true),
    detailPage,
  });

  const controlOperation = async (operationId: string, action: RunControlAction) => {
    const key = `operation:${operationId}`;
    try {
      await pending.runOperation(key, async () => {
        await window.ytbm.controlActivityOperation(operationId, action);
        await controller.refresh();
        if (route.entityId === operationId) await controller.refreshDetails();
        onNotice(`${OPERATION_ACTION_LABELS[action]} requested.`);
      });
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'The operation action could not be completed.',
      );
    }
  };

  const controlJob = async (job: ActivityTechnicalJobDto, action: JobControlAction) => {
    setBusyJobId(job.id);
    try {
      await window.ytbm.controlJob(job.id, action);
      await Promise.all([controller.refresh(), controller.refreshDetails()]);
      onNotice(`${JOB_ACTION_LABELS[action]} requested.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'The job action could not be completed.');
    } finally {
      setBusyJobId(null);
    }
  };

  const confirmJobAction = (job: ActivityTechnicalJobDto, action: JobControlAction) => {
    if (action.startsWith('CANCEL_')) {
      setConfirmation({ kind: 'job', id: job.id, action, title: JOB_TYPE_LABELS[job.jobType] });
    } else {
      void controlJob(job, action);
    }
  };

  const resolveAttention = (issue: ActivityAttentionIssueDto) => {
    const resolution = issue.resolutionRoute;
    switch (resolution.area) {
      case 'activity':
        onNavigate({ area: 'activity', view: resolution.view, entityId: resolution.entityId });
        break;
      case 'storage':
        onNavigate({ area: 'storage', entityId: resolution.destinationId });
        break;
      case 'integrity':
        onNavigate({ area: 'integrity', view: 'issues', entityId: resolution.copyId });
        break;
      case 'settings':
        onNavigate({ area: 'settings', category: resolution.category });
        break;
    }
  };

  const liveOperations = controller.live?.operations ?? [];
  const dominant = liveOperations.find((operation) =>
    ['RUNNING', 'PAUSE_REQUESTED', 'CANCEL_REQUESTED'].includes(operation.status),
  );
  const remaining = dominant
    ? liveOperations.filter((operation) => operation.id !== dominant.id)
    : liveOperations;
  const historyEvents = (controller.log?.events ?? []).filter(
    (event) => historyCategory !== 'ALL' || event.category !== 'BACKUPS',
  );

  return (
    <main className="activity-screen">
      <PageHeader
        title="Activity"
        description="Follow backup work, review archive history, and resolve anything that needs your attention."
        action={
          <Button
            size="compact"
            leadingIcon={<ArrowClockwise size={16} />}
            onClick={() => void controller.refresh()}
          >
            Refresh
          </Button>
        }
      />
      <ActivityTabs
        route={route}
        onNavigate={onNavigate}
        attentionCount={controller.attention?.totalItems ?? controller.live?.attentionCount ?? 0}
      />
      {notice !== null ? (
        <div className="activity-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => onNotice(null)} aria-label="Dismiss message">
            Close
          </button>
        </div>
      ) : null}
      {controller.error !== null ? (
        <ErrorState
          title="Activity is unavailable"
          description={controller.error}
          retry={{ onClick: () => void controller.refresh() }}
        />
      ) : controller.loading ? (
        <Skeleton lines={7} label="Loading Activity" />
      ) : route.view === 'active' ? (
        <section
          id="activity-panel-active"
          className="activity-view"
          role="tabpanel"
          aria-labelledby="activity-tab-active"
        >
          <div className="activity-summary" aria-label="Operation summary">
            <span>
              <strong>{controller.live?.activeCount ?? 0}</strong>
              <small>In progress</small>
            </span>
            <span>
              <strong>{controller.live?.pausedCount ?? 0}</strong>
              <small>Paused</small>
            </span>
            <span>
              <strong>{controller.live?.retryingCount ?? 0}</strong>
              <small>Retry scheduled</small>
            </span>
            <span>
              <strong>{controller.live?.attentionCount ?? 0}</strong>
              <small>Need attention</small>
            </span>
          </div>
          <header className="activity-section-heading">
            <span>
              <h2>Active operations</h2>
              <p>Each row represents one media backup or one archive-wide finishing operation.</p>
            </span>
          </header>
          {liveOperations.length === 0 ? (
            <EmptyState
              title="No active operations"
              description="New backup, verification, and repair work will appear here while it is running or waiting."
              icon={ClockCounterClockwise}
            />
          ) : (
            <div className="activity-operation-list">
              {dominant !== undefined ? (
                <OperationRow
                  operation={dominant}
                  dominant
                  busy={pending.isPending(`operation:${dominant.id}`)}
                  onOpen={() => {
                    setDetailPage(1);
                    onNavigate({ area: 'activity', view: 'active', entityId: dominant.id });
                  }}
                  onAction={(action) => void controlOperation(dominant.id, action)}
                  onConfirm={(action) =>
                    setConfirmation({
                      kind: 'operation',
                      id: dominant.id,
                      action,
                      title: dominant.title,
                    })
                  }
                />
              ) : null}
              {remaining.map((operation) => (
                <OperationRow
                  key={operation.id}
                  operation={operation}
                  busy={pending.isPending(`operation:${operation.id}`)}
                  onOpen={() => {
                    setDetailPage(1);
                    onNavigate({ area: 'activity', view: 'active', entityId: operation.id });
                  }}
                  onAction={(action) => void controlOperation(operation.id, action)}
                  onConfirm={(action) =>
                    setConfirmation({
                      kind: 'operation',
                      id: operation.id,
                      action,
                      title: operation.title,
                    })
                  }
                />
              ))}
              <Pager
                page={livePage}
                total={controller.live?.totalItems ?? 0}
                onPage={setLivePage}
              />
            </div>
          )}
        </section>
      ) : route.view === 'history' ? (
        <section
          id="activity-panel-history"
          className="activity-view"
          role="tabpanel"
          aria-labelledby="activity-tab-history"
        >
          <header className="activity-section-heading activity-section-heading--history">
            <span>
              <h2>Backup and archive history</h2>
              <p>Completed runs are preserved alongside durable archive events.</p>
            </span>
            <SegmentedControl
              ariaLabel="History type"
              value={historyCategory}
              options={(
                [
                  'ALL',
                  'BACKUPS',
                  'ARCHIVE_CHANGES',
                  'DESTINATIONS',
                  'INTEGRITY',
                  'REPAIRS',
                  'SCHEDULES',
                ] as ActivityLogCategory[]
              ).map((value) => ({ value, label: LOG_FILTER_LABELS[value] }))}
              onValueChange={(value) => {
                setHistoryCategory(value as ActivityLogCategory);
                setHistoryPage(1);
              }}
            />
          </header>
          <div className="activity-history-filters" aria-label="History filters">
            <Select
              label="Channel"
              value={channelId ?? 'ALL'}
              options={[
                { value: 'ALL', label: 'All channels' },
                ...controller.channels.map((channel) => ({
                  value: channel.id,
                  label: channel.title,
                })),
              ]}
              onValueChange={(value) => {
                setChannelId(value === 'ALL' ? null : value);
                setHistoryPage(1);
              }}
            />
            <Select
              label="Destination"
              value={destinationId ?? 'ALL'}
              options={[
                { value: 'ALL', label: 'All destinations' },
                ...controller.destinations.map((destination) => ({
                  value: destination.id,
                  label:
                    destination.destinationType === 'FILESYSTEM'
                      ? destination.rootPath
                      : `Google Drive - ${destination.accountEmail ?? destination.accountDisplayName ?? 'Google account'}`,
                })),
              ]}
              onValueChange={(value) => {
                setDestinationId(value === 'ALL' ? null : value);
                setHistoryPage(1);
              }}
            />
            <Input
              label="From"
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => {
                setFromDate(event.currentTarget.value);
                setHistoryPage(1);
              }}
            />
            <Input
              label="To"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => {
                setToDate(event.currentTarget.value);
                setHistoryPage(1);
              }}
            />
          </div>
          {historyCategory === 'ALL' || historyCategory === 'BACKUPS' ? (
            <section className="activity-history-section" aria-labelledby="backup-runs-title">
              <h3 id="backup-runs-title">Backup runs</h3>
              {(controller.runHistory?.runs.length ?? 0) === 0 ? (
                <p className="activity-inline-empty">No backup runs match this view.</p>
              ) : (
                <div className="activity-history-list" role="list">
                  {controller.runHistory?.runs.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      onOpen={() => {
                        setDetailPage(1);
                        onNavigate({ area: 'activity', view: 'history', entityId: run.id });
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}
          {historyCategory !== 'BACKUPS' ? (
            <section className="activity-history-section" aria-labelledby="archive-events-title">
              <h3 id="archive-events-title">Archive events</h3>
              {historyEvents.length === 0 ? (
                <p className="activity-inline-empty">No archive events match this view.</p>
              ) : (
                <div className="activity-event-list" role="list">
                  {historyEvents.map((event) => (
                    <article key={event.id} className="activity-event-row" role="listitem">
                      <time dateTime={new Date(event.createdAt).toISOString()}>
                        {formatDate(event.createdAt)}
                      </time>
                      <span>
                        <strong>{event.title}</strong>
                        <small>{event.summary}</small>
                      </span>
                      <span className="activity-event-row__context">
                        {event.mediaTitle ??
                          event.channelTitle ??
                          event.destinationLabel ??
                          'Archive'}
                      </span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
          <Pager
            page={historyPage}
            total={
              historyCategory === 'BACKUPS'
                ? (controller.runHistory?.totalItems ?? 0)
                : historyCategory === 'ALL'
                  ? Math.max(
                      controller.runHistory?.totalItems ?? 0,
                      controller.log?.totalItems ?? 0,
                    )
                  : (controller.log?.totalItems ?? 0)
            }
            onPage={setHistoryPage}
          />
        </section>
      ) : (
        <section
          id="activity-panel-attention"
          className="activity-view"
          role="tabpanel"
          aria-labelledby="activity-tab-attention"
        >
          <header className="activity-section-heading">
            <span>
              <h2>Needs attention</h2>
              <p>Issues are grouped by the place where they can be resolved.</p>
            </span>
          </header>
          <AttentionView
            issues={controller.attention?.issues ?? []}
            page={attentionPage}
            total={controller.attention?.totalItems ?? 0}
            onPage={setAttentionPage}
            onResolve={resolveAttention}
          />
        </section>
      )}
      <DetailsDialog
        route={route}
        controller={controller}
        detailPage={detailPage}
        busyJobId={busyJobId}
        onClose={() => onNavigate({ area: 'activity', view: route.view })}
        onDetailPage={setDetailPage}
        onJobAction={confirmJobAction}
      />
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
        title={
          confirmation?.action === 'CANCEL_REMOVE_PARTIAL'
            ? 'Cancel and remove partial files?'
            : 'Cancel this work?'
        }
        description={confirmation?.title}
        footer={
          <>
            <DialogAction closeOnSelect onClick={() => setConfirmation(null)}>
              Keep working
            </DialogAction>
            <DialogAction
              variant="danger"
              leadingIcon={<Stop size={16} />}
              onClick={() => {
                const selected = confirmation;
                setConfirmation(null);
                if (selected === null) return;
                if (selected.kind === 'operation') {
                  void controlOperation(selected.id, selected.action as RunControlAction);
                } else {
                  const job =
                    controller.operationDetails?.technicalJobs.find(
                      (item) => item.id === selected.id,
                    ) ??
                    controller.runDetails?.technicalJobs.find((item) => item.id === selected.id);
                  if (job !== undefined) void controlJob(job, selected.action as JobControlAction);
                }
              }}
            >
              {confirmation?.action === 'CANCEL_REMOVE_PARTIAL'
                ? 'Cancel and remove files'
                : 'Cancel and keep files'}
            </DialogAction>
          </>
        }
      >
        <p>
          {confirmation?.action === 'CANCEL_REMOVE_PARTIAL'
            ? 'Downloaded partial files for this individual step will be deleted. Verified backup data is not affected.'
            : 'Completed and partial files will be kept so the durable worker can reuse them later.'}
        </p>
      </Dialog>
    </main>
  );
}
