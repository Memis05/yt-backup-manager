import { useCallback, useMemo, useReducer } from 'react';

export type PendingOperationCounts = ReadonlyMap<string, number>;

export type PendingOperationAction =
  { type: 'begin'; operation: string } | { type: 'end'; operation: string };

export function pendingOperationsReducer(
  state: PendingOperationCounts,
  action: PendingOperationAction,
): PendingOperationCounts {
  const next = new Map(state);
  const currentCount = next.get(action.operation) ?? 0;

  if (action.type === 'begin') {
    next.set(action.operation, currentCount + 1);
    return next;
  }

  if (currentCount <= 1) next.delete(action.operation);
  else next.set(action.operation, currentCount - 1);
  return next;
}

export function isOperationPending(state: PendingOperationCounts, operation: string): boolean {
  return (state.get(operation) ?? 0) > 0;
}

export interface PendingOperationsController {
  pendingOperations: ReadonlySet<string>;
  isPending(operation: string): boolean;
  beginOperation(operation: string): () => void;
  runOperation<Result>(operation: string, task: () => Promise<Result> | Result): Promise<Result>;
}

/**
 * Tracks pending work by operation key instead of disabling the whole UI.
 * Counts make repeated work under the same key safe: the key remains pending
 * until every matching operation has settled.
 */
export function usePendingOperations(): PendingOperationsController {
  const [counts, dispatch] = useReducer(pendingOperationsReducer, new Map());

  const isPending = useCallback(
    (operation: string) => isOperationPending(counts, operation),
    [counts],
  );

  const beginOperation = useCallback((operation: string) => {
    dispatch({ type: 'begin', operation });
    let ended = false;

    return () => {
      if (ended) return;
      ended = true;
      dispatch({ type: 'end', operation });
    };
  }, []);

  const runOperation = useCallback(
    async <Result>(operation: string, task: () => Promise<Result> | Result): Promise<Result> => {
      const endOperation = beginOperation(operation);
      try {
        return await task();
      } finally {
        endOperation();
      }
    },
    [beginOperation],
  );

  const pendingOperations = useMemo<ReadonlySet<string>>(() => new Set(counts.keys()), [counts]);

  return {
    pendingOperations,
    isPending,
    beginOperation,
    runOperation,
  };
}
