import { useCallback, useEffect, useRef, useState } from 'react';

import type { AccountDto, ChannelDto, GoogleOAuthCapability, OAuthFlowDto } from '@ytbm/core';

import {
  useOAuthStatusController,
  useSettingsController,
  type FeatureController,
} from '../../controllers';

type AccountsApi = Pick<
  Window['ytbm'],
  | 'beginGoogleOAuth'
  | 'disconnectAccount'
  | 'discoverChannels'
  | 'getOAuthStatus'
  | 'listAccounts'
  | 'listChannels'
>;

export interface AccountsSnapshot {
  accounts: AccountDto[];
  channels: ChannelDto[];
}

export interface AccountsController {
  snapshot: AccountsSnapshot | null;
  loading: boolean;
  requestError: string | null;
  actionError: string | null;
  pendingAction: string | null;
  oauthFlow: OAuthFlowDto | null;
  refresh(): Promise<void>;
  beginOAuth(accountId: string | null, capability: GoogleOAuthCapability): Promise<boolean>;
  discoverChannels(accountId: string): Promise<boolean>;
  disconnect(accountId: string): Promise<boolean>;
  clearActionError(): void;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

export async function loadAccountsSnapshot(
  api: AccountsApi = window.ytbm,
): Promise<AccountsSnapshot> {
  const [accounts, channels] = await Promise.all([api.listAccounts(), api.listChannels()]);
  return { accounts, channels };
}

export function useAccountsController({
  api = window.ytbm,
  enabled = true,
}: {
  api?: AccountsApi;
  enabled?: boolean;
} = {}): AccountsController {
  const [snapshot, setSnapshot] = useState<AccountsSnapshot | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [oauthFlow, setOauthFlow] = useState<OAuthFlowDto | null>(null);
  const controllerRef = useRef<FeatureController | null>(null);
  const pendingActionRef = useRef<string | null>(null);

  const controller = useSettingsController<AccountsSnapshot>({
    enabled,
    queryKey: 'accounts',
    request: () => loadAccountsSnapshot(api),
    onSuccess: (next) => {
      setSnapshot(next);
      setRequestError(null);
    },
    onError: (error) => setRequestError(safeMessage(error)),
  });
  useEffect(() => {
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
    };
  }, [controller]);

  useOAuthStatusController({
    enabled: enabled && oauthFlow?.status === 'PENDING',
    queryKey: oauthFlow?.flowId ?? 'none',
    request: () => api.getOAuthStatus(oauthFlow!.flowId),
    onSuccess: (next) => {
      setOauthFlow(next);
      if (next.status === 'COMPLETED') void controllerRef.current?.refresh();
      if (next.status === 'FAILED' || next.status === 'EXPIRED') {
        setActionError(next.safeMessage ?? 'Google sign-in did not complete.');
      }
    },
    onError: (error) => setActionError(safeMessage(error)),
  });

  const run = useCallback(async (key: string, action: () => Promise<void>): Promise<boolean> => {
    if (pendingActionRef.current !== null) return false;
    pendingActionRef.current = key;
    setPendingAction(key);
    setActionError(null);
    try {
      await action();
      await controllerRef.current?.refresh();
      return true;
    } catch (error) {
      setActionError(safeMessage(error));
      return false;
    } finally {
      pendingActionRef.current = null;
      setPendingAction(null);
    }
  }, []);

  return {
    snapshot,
    loading: snapshot === null && requestError === null,
    requestError,
    actionError,
    pendingAction,
    oauthFlow,
    refresh: controller.refresh,
    clearActionError: () => setActionError(null),
    beginOAuth: (accountId, capability) =>
      run(`oauth:${accountId ?? 'new'}:${capability}`, async () => {
        const result = await api.beginGoogleOAuth(accountId, capability);
        if (result.status === 'UNAVAILABLE') throw new Error(result.safeMessage);
        setOauthFlow({
          flowId: result.flowId,
          capability: result.capability,
          status: 'PENDING',
          expiresAt: result.expiresAt,
          account: null,
          errorCode: null,
          safeMessage: null,
        });
      }),
    discoverChannels: (accountId) =>
      run(`discover:${accountId}`, async () => {
        await api.discoverChannels(accountId);
      }),
    disconnect: (accountId) =>
      run(`disconnect:${accountId}`, async () => {
        await api.disconnectAccount(accountId);
      }),
  };
}
