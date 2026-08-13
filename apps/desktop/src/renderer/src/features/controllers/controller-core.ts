import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export interface AsyncControllerOptions<Result> {
  enabled?: boolean;
  request: () => Promise<Result>;
  onSuccess: (result: Result) => void;
  onError?: (error: unknown) => void;
}

export interface PollingControllerOptions<Result> extends AsyncControllerOptions<Result> {
  ownerKey: string;
  intervalMs: number;
  immediate?: boolean;
  /** Restarts this owner when inputs that identify its live query change. */
  queryKey?: string;
}

export interface LoadControllerOptions<Result> extends AsyncControllerOptions<Result> {
  ownerKey: string;
  /** Reloads when inputs that identify the route-owned request change. */
  queryKey?: string;
}

export interface DebouncedControllerOptions<Result> extends AsyncControllerOptions<Result> {
  ownerKey: string;
  delayMs: number;
  /** A stable serialization of the query inputs that own the debounce. */
  queryKey: string;
}

export interface FeatureController {
  /** Requests a fresh value now, while retaining single-flight behavior. */
  refresh(): Promise<void>;
}

const controllerOwners = new Map<string, symbol>();
const ownershipWaiters = new Map<string, Map<symbol, () => void>>();

function claimOwnership(ownerKey: string, token: symbol): boolean {
  const currentOwner = controllerOwners.get(ownerKey);
  if (currentOwner !== undefined && currentOwner !== token) return false;
  controllerOwners.set(ownerKey, token);
  return true;
}

function subscribeForOwnership(ownerKey: string, token: symbol, listener: () => void): () => void {
  const waiters = ownershipWaiters.get(ownerKey) ?? new Map<symbol, () => void>();
  waiters.set(token, listener);
  ownershipWaiters.set(ownerKey, waiters);

  return () => {
    const currentWaiters = ownershipWaiters.get(ownerKey);
    currentWaiters?.delete(token);
    if (currentWaiters?.size === 0) ownershipWaiters.delete(ownerKey);
  };
}

function releaseOwnership(ownerKey: string, token: symbol): void {
  if (controllerOwners.get(ownerKey) !== token) return;
  controllerOwners.delete(ownerKey);
  for (const notify of ownershipWaiters.get(ownerKey)?.values() ?? []) notify();
}

function useLatestControllerCallbacks<Result>(options: AsyncControllerOptions<Result>): {
  request: RefObject<() => Promise<Result>>;
  onSuccess: RefObject<(result: Result) => void>;
  onError: RefObject<((error: unknown) => void) | undefined>;
} {
  const request = useRef(options.request);
  const onSuccess = useRef(options.onSuccess);
  const onError = useRef(options.onError);

  useEffect(() => {
    request.current = options.request;
  }, [options.request]);
  useEffect(() => {
    onSuccess.current = options.onSuccess;
  }, [options.onSuccess]);
  useEffect(() => {
    onError.current = options.onError;
  }, [options.onError]);

  return { request, onSuccess, onError };
}

function createSingleFlightRunner<Result>(input: {
  isActive(): boolean;
  request(): Promise<Result>;
  onSuccess(result: Result): void;
  onError(error: unknown): void;
}): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let refreshQueued = false;

  const run = (): Promise<void> => {
    if (!input.isActive()) return Promise.resolve();
    if (inFlight !== null) {
      refreshQueued = true;
      return inFlight;
    }

    const requestCycle = Promise.resolve()
      .then(() => input.request())
      .then((result) => {
        if (input.isActive()) input.onSuccess(result);
      })
      .catch((error: unknown) => {
        if (input.isActive()) input.onError(error);
      })
      .finally(() => {
        inFlight = null;
        if (!refreshQueued || !input.isActive()) return;
        refreshQueued = false;
        return run();
      });

    inFlight = requestCycle;
    return requestCycle;
  };

  return run;
}

/**
 * Owns exactly one interval for an owner key and prevents overlapping requests.
 * A queued manual/timer refresh runs once after the active request settles.
 */
export function usePollingController<Result>(
  options: PollingControllerOptions<Result>,
): FeatureController {
  const { enabled = true, immediate = false, intervalMs, ownerKey, queryKey = '' } = options;
  const { onError, onSuccess, request } = useLatestControllerCallbacks(options);
  const ownerToken = useRef(Symbol(ownerKey));
  const execute = useRef<() => Promise<void>>(() => Promise.resolve());
  const [ownershipAttempt, setOwnershipAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      execute.current = () => Promise.resolve();
      return;
    }

    let mounted = true;
    const token = ownerToken.current;
    const unsubscribe = subscribeForOwnership(ownerKey, token, () => {
      if (mounted) setOwnershipAttempt((attempt) => attempt + 1);
    });

    if (!claimOwnership(ownerKey, token)) {
      execute.current = () => Promise.resolve();
      return () => {
        mounted = false;
        unsubscribe();
      };
    }

    const run = createSingleFlightRunner({
      isActive: () => mounted,
      request: () => request.current(),
      onSuccess: (result) => onSuccess.current(result),
      onError: (error) => onError.current?.(error),
    });
    execute.current = run;

    if (immediate) void run();
    const timer = globalThis.setInterval(() => void run(), intervalMs);

    return () => {
      mounted = false;
      execute.current = () => Promise.resolve();
      globalThis.clearInterval(timer);
      unsubscribe();
      releaseOwnership(ownerKey, token);
    };
  }, [
    enabled,
    immediate,
    intervalMs,
    onError,
    onSuccess,
    ownerKey,
    ownershipAttempt,
    queryKey,
    request,
  ]);

  const refresh = useCallback(() => execute.current(), []);
  return { refresh };
}

/** Owns one immediate request while its route is active, with explicit refresh support. */
export function useLoadController<Result>(
  options: LoadControllerOptions<Result>,
): FeatureController {
  const { enabled = true, ownerKey, queryKey = '' } = options;
  const { onError, onSuccess, request } = useLatestControllerCallbacks(options);
  const ownerToken = useRef(Symbol(ownerKey));
  const execute = useRef<() => Promise<void>>(() => Promise.resolve());
  const [ownershipAttempt, setOwnershipAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      execute.current = () => Promise.resolve();
      return;
    }

    let mounted = true;
    const token = ownerToken.current;
    const unsubscribe = subscribeForOwnership(ownerKey, token, () => {
      if (mounted) setOwnershipAttempt((attempt) => attempt + 1);
    });

    if (!claimOwnership(ownerKey, token)) {
      execute.current = () => Promise.resolve();
      return () => {
        mounted = false;
        unsubscribe();
      };
    }

    const run = createSingleFlightRunner({
      isActive: () => mounted,
      request: () => request.current(),
      onSuccess: (result) => onSuccess.current(result),
      onError: (error) => onError.current?.(error),
    });
    execute.current = run;
    void run();

    return () => {
      mounted = false;
      execute.current = () => Promise.resolve();
      unsubscribe();
      releaseOwnership(ownerKey, token);
    };
  }, [enabled, onError, onSuccess, ownerKey, ownershipAttempt, queryKey, request]);

  const refresh = useCallback(() => execute.current(), []);
  return { refresh };
}

/** Owns one trailing-edge debounced request for a feature query. */
export function useDebouncedController<Result>(
  options: DebouncedControllerOptions<Result>,
): FeatureController {
  const { delayMs, enabled = true, ownerKey, queryKey } = options;
  const { onError, onSuccess, request } = useLatestControllerCallbacks(options);
  const ownerToken = useRef(Symbol(ownerKey));
  const execute = useRef<() => Promise<void>>(() => Promise.resolve());
  const [ownershipAttempt, setOwnershipAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      execute.current = () => Promise.resolve();
      return;
    }

    let mounted = true;
    const token = ownerToken.current;
    const unsubscribe = subscribeForOwnership(ownerKey, token, () => {
      if (mounted) setOwnershipAttempt((attempt) => attempt + 1);
    });

    if (!claimOwnership(ownerKey, token)) {
      execute.current = () => Promise.resolve();
      return () => {
        mounted = false;
        unsubscribe();
      };
    }

    const run = createSingleFlightRunner({
      isActive: () => mounted,
      request: () => request.current(),
      onSuccess: (result) => onSuccess.current(result),
      onError: (error) => onError.current?.(error),
    });
    execute.current = run;
    const timer = globalThis.setTimeout(() => void run(), delayMs);

    return () => {
      mounted = false;
      execute.current = () => Promise.resolve();
      globalThis.clearTimeout(timer);
      unsubscribe();
      releaseOwnership(ownerKey, token);
    };
  }, [delayMs, enabled, onError, onSuccess, ownerKey, ownershipAttempt, queryKey, request]);

  const refresh = useCallback(() => execute.current(), []);
  return { refresh };
}
