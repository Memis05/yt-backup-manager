import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  isOperationPending,
  pendingOperationsReducer,
  usePendingOperations,
} from '../../src/renderer/src/app/use-pending-operations';

describe('operation-scoped pending state', () => {
  it('tracks independent operations without a global busy lock', () => {
    const { result } = renderHook(() => usePendingOperations());
    let finishAccount!: () => void;
    let finishDestination!: () => void;

    act(() => {
      finishAccount = result.current.beginOperation('account:connect');
      finishDestination = result.current.beginOperation('destination:add');
    });

    expect(result.current.isPending('account:connect')).toBe(true);
    expect(result.current.isPending('destination:add')).toBe(true);
    expect(result.current.isPending('backup:start')).toBe(false);

    act(() => finishAccount());
    expect(result.current.isPending('account:connect')).toBe(false);
    expect(result.current.isPending('destination:add')).toBe(true);

    act(() => finishDestination());
    expect(result.current.pendingOperations.size).toBe(0);
  });

  it('counts overlapping work with the same operation key', () => {
    const once = pendingOperationsReducer(new Map(), { type: 'begin', operation: 'sync:channel' });
    const twice = pendingOperationsReducer(once, { type: 'begin', operation: 'sync:channel' });
    const remaining = pendingOperationsReducer(twice, { type: 'end', operation: 'sync:channel' });
    const settled = pendingOperationsReducer(remaining, { type: 'end', operation: 'sync:channel' });

    expect(twice.get('sync:channel')).toBe(2);
    expect(isOperationPending(remaining, 'sync:channel')).toBe(true);
    expect(isOperationPending(settled, 'sync:channel')).toBe(false);
  });

  it('always releases runOperation state after a rejected task', async () => {
    const { result } = renderHook(() => usePendingOperations());
    const failure = new Error('safe failure');
    let rejectTask!: (reason: Error) => void;
    const task = new Promise<never>((_resolve, reject) => {
      rejectTask = reject;
    });
    let observedFailure: Promise<unknown> | undefined;

    act(() => {
      observedFailure = result.current
        .runOperation('repair:start', () => task)
        .catch((error) => error);
    });
    expect(result.current.isPending('repair:start')).toBe(true);

    await act(async () => {
      rejectTask(failure);
      await observedFailure;
    });

    expect(await observedFailure).toBe(failure);
    expect(result.current.isPending('repair:start')).toBe(false);
  });
});
