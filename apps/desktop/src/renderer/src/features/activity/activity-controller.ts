import { useCallback, useState } from 'react';

import type {
  ActivityAttentionPage,
  ActivityLogCategory,
  ActivityLogPage,
  ActivityOperationDetails,
  ActivityOperationsPage,
  ActivityRunDetails,
  BackupRunHistoryPage,
  ChannelDto,
  DestinationDto,
} from '@ytbm/core';

import type { AppRoute } from '../../app/routes';
import {
  useActivityController,
  useActivityDetailsController,
  useActivityHistoryController,
} from '../controllers';

const PAGE_SIZE = 25;

export interface ActivityControllerState {
  live: ActivityOperationsPage | null;
  attention: ActivityAttentionPage | null;
  runHistory: BackupRunHistoryPage | null;
  log: ActivityLogPage | null;
  operationDetails: ActivityOperationDetails | null;
  runDetails: ActivityRunDetails | null;
  channels: ChannelDto[];
  destinations: DestinationDto[];
  loading: boolean;
  detailLoading: boolean;
  error: string | null;
  detailError: string | null;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Activity could not be loaded.';
}

export function useActivityScreenController(input: {
  route: Extract<AppRoute, { area: 'activity' }>;
  livePage: number;
  attentionPage: number;
  historyPage: number;
  historyCategory: ActivityLogCategory;
  channelId: string | null;
  destinationId: string | null;
  from: number | null;
  to: number | null;
  detailPage: number;
}): ActivityControllerState & {
  refresh(): Promise<void>;
  refreshDetails(): Promise<void>;
} {
  const { route } = input;
  const [live, setLive] = useState<ActivityOperationsPage | null>(null);
  const [attention, setAttention] = useState<ActivityAttentionPage | null>(null);
  const [runHistory, setRunHistory] = useState<BackupRunHistoryPage | null>(null);
  const [log, setLog] = useState<ActivityLogPage | null>(null);
  const [operationDetails, setOperationDetails] = useState<ActivityOperationDetails | null>(null);
  const [runDetails, setRunDetails] = useState<ActivityRunDetails | null>(null);
  const [channels, setChannels] = useState<ChannelDto[]>([]);
  const [destinations, setDestinations] = useState<DestinationDto[]>([]);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [loadedDetailKey, setLoadedDetailKey] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{ key: string; message: string } | null>(null);
  const [detailsError, setDetailsError] = useState<{ key: string; message: string } | null>(null);
  const liveQueryKey = `live:${route.view}:${input.livePage}:${input.attentionPage}`;
  const historyQueryKey = `history:${input.historyPage}:${input.historyCategory}:${input.channelId ?? ''}:${input.destinationId ?? ''}:${input.from ?? ''}:${input.to ?? ''}`;
  const currentQueryKey = route.view === 'history' ? historyQueryKey : liveQueryKey;
  const detailQueryKey = `${route.view}:${route.entityId ?? ''}:${input.detailPage}`;

  const requestLive = useCallback(async () => {
    const [operations, issues] = await Promise.all([
      window.ytbm.listActivityOperations({
        page: input.livePage,
        pageSize: PAGE_SIZE,
      }),
      window.ytbm.listActivityAttention({
        page: input.attentionPage,
        pageSize: PAGE_SIZE,
      }),
    ]);
    return { operations, issues };
  }, [input.attentionPage, input.livePage]);

  const liveController = useActivityController({
    enabled: route.view !== 'history',
    queryKey: liveQueryKey,
    request: requestLive,
    onSuccess: ({ operations, issues }) => {
      setLive(operations);
      setAttention(issues);
      setLoadedQueryKey(liveQueryKey);
      setRequestError(null);
    },
    onError: (requestError) => {
      setRequestError({ key: liveQueryKey, message: safeMessage(requestError) });
    },
  });

  const requestHistory = useCallback(async () => {
    const logCategory = input.historyCategory === 'BACKUPS' ? 'BACKUPS' : input.historyCategory;
    const [runs, events, availableChannels, availableDestinations] = await Promise.all([
      window.ytbm.listBackupRunHistory({
        page: input.historyPage,
        pageSize: PAGE_SIZE,
        status: null,
        triggerType: null,
        channelId: input.channelId,
        destinationId: input.destinationId,
        from: input.from,
        to: input.to,
      }),
      window.ytbm.listActivityLog({
        page: input.historyPage,
        pageSize: PAGE_SIZE,
        category: logCategory,
        channelId: input.channelId,
        mediaItemId: null,
        destinationId: input.destinationId,
        from: input.from,
        to: input.to,
      }),
      window.ytbm.listChannels({ selectedOnly: false }),
      window.ytbm.listDestinations(),
    ]);
    return { runs, events, availableChannels, availableDestinations };
  }, [
    input.channelId,
    input.destinationId,
    input.from,
    input.historyCategory,
    input.historyPage,
    input.to,
  ]);

  const historyController = useActivityHistoryController({
    enabled: route.view === 'history',
    queryKey: historyQueryKey,
    request: requestHistory,
    onSuccess: ({ availableChannels, availableDestinations, events, runs }) => {
      setLog(events);
      setRunHistory(runs);
      setChannels(availableChannels);
      setDestinations(availableDestinations);
      setLoadedQueryKey(historyQueryKey);
      setRequestError(null);
    },
    onError: (requestError) => {
      setRequestError({ key: historyQueryKey, message: safeMessage(requestError) });
    },
  });

  const requestDetails = useCallback(async () => {
    if (route.entityId === undefined) return { operation: null, run: null };
    if (route.view === 'history') {
      return {
        operation: null,
        run: await window.ytbm.getActivityRunDetails({
          runId: route.entityId,
          page: input.detailPage,
          pageSize: PAGE_SIZE,
        }),
      };
    }
    return {
      operation: await window.ytbm.getActivityOperationDetails({
        operationId: route.entityId,
        page: input.detailPage,
        pageSize: PAGE_SIZE,
      }),
      run: null,
    };
  }, [input.detailPage, route.entityId, route.view]);

  const detailsController = useActivityDetailsController({
    enabled: route.entityId !== undefined,
    queryKey: detailQueryKey,
    request: requestDetails,
    onSuccess: ({ operation, run }) => {
      setOperationDetails(operation);
      setRunDetails(run);
      setLoadedDetailKey(detailQueryKey);
      setDetailsError(null);
    },
    onError: (requestError) => {
      setDetailsError({ key: detailQueryKey, message: safeMessage(requestError) });
    },
  });

  const currentOperationDetails =
    route.view !== 'history' && operationDetails?.operation.id === route.entityId
      ? operationDetails
      : null;
  const currentRunDetails =
    route.view === 'history' && runDetails?.run.id === route.entityId ? runDetails : null;
  const error = requestError?.key === currentQueryKey ? requestError.message : null;
  const detailError = detailsError?.key === detailQueryKey ? detailsError.message : null;

  return {
    live,
    attention,
    runHistory,
    log,
    operationDetails: currentOperationDetails,
    runDetails: currentRunDetails,
    channels,
    destinations,
    loading: loadedQueryKey !== currentQueryKey && error === null,
    detailLoading:
      route.entityId !== undefined && loadedDetailKey !== detailQueryKey && detailError === null,
    error,
    detailError,
    refresh: route.view === 'history' ? historyController.refresh : liveController.refresh,
    refreshDetails: detailsController.refresh,
  };
}
