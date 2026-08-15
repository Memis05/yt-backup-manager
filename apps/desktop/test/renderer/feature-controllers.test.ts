import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONTROLLER_CADENCE_MS,
  useActivityController,
  useBackupController,
  useIntegrityController,
  useLibraryController,
  useLoadController,
  useOAuthStatusController,
  usePlaylistsController,
  usePollingController,
  useRecoveryController,
  useSettingsController,
  useSourceSyncController,
  type AsyncControllerOptions,
  type DebouncedFeatureControllerOptions,
  type FeatureController,
} from '../../src/renderer/src/features/controllers';

type PollingFeatureHook = (options: AsyncControllerOptions<number>) => FeatureController;
type DebouncedFeatureHook = (
  options: DebouncedFeatureControllerOptions<number>,
) => FeatureController;

async function advanceTimers(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('feature controller ownership', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps the existing polling and debounce cadences explicit', () => {
    expect(CONTROLLER_CADENCE_MS).toEqual({
      oauthStatus: 1_000,
      sourceSync: 1_000,
      activity: 1_000,
      integrity: 2_000,
      recovery: 750,
      library: 200,
      playlists: 200,
    });
  });

  it.each<[string, PollingFeatureHook, number]>([
    ['OAuth', useOAuthStatusController<number>, CONTROLLER_CADENCE_MS.oauthStatus],
    ['source sync', useSourceSyncController<number>, CONTROLLER_CADENCE_MS.sourceSync],
    ['recovery', useRecoveryController<number>, CONTROLLER_CADENCE_MS.recovery],
  ])('preserves delayed first-tick polling for %s', async (_name, useController, cadence) => {
    const request = vi.fn(async () => 1);
    const onSuccess = vi.fn();
    const mounted = renderHook(() => useController({ request, onSuccess }));

    await flushMicrotasks();
    expect(request).not.toHaveBeenCalled();
    await advanceTimers(cadence - 1);
    expect(request).not.toHaveBeenCalled();
    await advanceTimers(1);
    expect(request).toHaveBeenCalledTimes(1);
    await advanceTimers(cadence);
    expect(request).toHaveBeenCalledTimes(2);

    mounted.unmount();
  });

  it.each<[string, PollingFeatureHook, number]>([
    ['activity', useActivityController<number>, CONTROLLER_CADENCE_MS.activity],
    ['integrity', useIntegrityController<number>, CONTROLLER_CADENCE_MS.integrity],
  ])('loads %s immediately, then at its current cadence', async (_name, useController, cadence) => {
    const request = vi.fn(async () => 1);
    const mounted = renderHook(() => useController({ request, onSuccess: vi.fn() }));

    await flushMicrotasks();
    expect(request).toHaveBeenCalledTimes(1);
    await advanceTimers(cadence - 1);
    expect(request).toHaveBeenCalledTimes(1);
    await advanceTimers(1);
    expect(request).toHaveBeenCalledTimes(2);

    mounted.unmount();
  });

  it.each<[string, DebouncedFeatureHook]>([
    ['library', useLibraryController<number>],
    ['playlists', usePlaylistsController<number>],
  ])('keeps only the trailing 200 ms %s query', async (_name, useController) => {
    const onSuccess = vi.fn();
    const mounted = renderHook(
      ({ queryKey, value }) =>
        useController({
          queryKey,
          request: async () => value,
          onSuccess,
        }),
      { initialProps: { queryKey: 'first', value: 1 } },
    );

    await advanceTimers(100);
    mounted.rerender({ queryKey: 'second', value: 2 });
    await advanceTimers(199);
    expect(onSuccess).not.toHaveBeenCalled();
    await advanceTimers(1);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith(2);

    mounted.unmount();
  });

  it.each([
    ['backup', useBackupController<number>],
    ['settings', useSettingsController<number>],
  ] as const)(
    'loads %s route data once and supports authoritative refresh',
    async (_name, hook) => {
      const request = vi.fn(async () => 1);
      const mounted = renderHook(() => hook({ request, onSuccess: vi.fn() }));

      await flushMicrotasks();
      expect(request).toHaveBeenCalledOnce();

      await act(async () => mounted.result.current.refresh());
      expect(request).toHaveBeenCalledTimes(2);

      mounted.unmount();
    },
  );

  it('cleans up its timer and does not publish after unmount', async () => {
    const request = vi.fn(async () => 1);
    const onSuccess = vi.fn();
    const mounted = renderHook(() =>
      usePollingController({
        ownerKey: 'cleanup-test',
        intervalMs: 100,
        request,
        onSuccess,
      }),
    );

    mounted.unmount();
    await advanceTimers(500);
    expect(request).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('stops polling when its owning route becomes inactive', async () => {
    const request = vi.fn(async () => 1);
    const mounted = renderHook(
      ({ enabled }) =>
        useActivityController({
          enabled,
          request,
          onSuccess: vi.fn(),
        }),
      { initialProps: { enabled: true } },
    );

    await flushMicrotasks();
    expect(request).toHaveBeenCalledOnce();

    mounted.rerender({ enabled: false });
    await advanceTimers(CONTROLLER_CADENCE_MS.activity * 3);
    expect(request).toHaveBeenCalledOnce();

    mounted.unmount();
  });

  it('does not publish a route load that settles after route exit', async () => {
    let resolveRequest!: (value: number) => void;
    const onSuccess = vi.fn();
    const mounted = renderHook(
      ({ enabled }) =>
        useLoadController({
          enabled,
          ownerKey: 'load-route-exit-test',
          request: () =>
            new Promise<number>((resolve) => {
              resolveRequest = resolve;
            }),
          onSuccess,
        }),
      { initialProps: { enabled: true } },
    );

    await flushMicrotasks();
    mounted.rerender({ enabled: false });
    await act(async () => {
      resolveRequest(1);
      await Promise.resolve();
    });
    expect(onSuccess).not.toHaveBeenCalled();

    mounted.unmount();
  });

  it('does not create duplicate pollers when its callbacks rerender', async () => {
    const request = vi.fn(async () => 1);
    const mounted = renderHook(
      ({ version }) =>
        usePollingController({
          ownerKey: 'rerender-owner-test',
          intervalMs: 100,
          request,
          onSuccess: () => version,
        }),
      { initialProps: { version: 0 } },
    );

    mounted.rerender({ version: 1 });
    mounted.rerender({ version: 2 });
    mounted.rerender({ version: 3 });
    await advanceTimers(100);
    expect(request).toHaveBeenCalledOnce();

    mounted.unmount();
  });

  it('restarts an immediate poll when its live-query identity changes', async () => {
    const onSuccess = vi.fn();
    const mounted = renderHook(
      ({ queryKey, value }) =>
        usePollingController({
          ownerKey: 'query-key-reset-test',
          queryKey,
          intervalMs: 1_000,
          immediate: true,
          request: async () => value,
          onSuccess,
        }),
      { initialProps: { queryKey: 'ACTIVE:1', value: 1 } },
    );

    await flushMicrotasks();
    expect(onSuccess).toHaveBeenLastCalledWith(1);

    mounted.rerender({ queryKey: 'ATTENTION:1', value: 2 });
    await flushMicrotasks();
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenLastCalledWith(2);

    mounted.unmount();
  });

  it('grants one live owner per feature key and promotes a waiting mount', async () => {
    const firstRequest = vi.fn(async () => 1);
    const secondRequest = vi.fn(async () => 2);
    const first = renderHook(() =>
      usePollingController({
        ownerKey: 'single-owner-test',
        intervalMs: 100,
        request: firstRequest,
        onSuccess: vi.fn(),
      }),
    );
    const second = renderHook(() =>
      usePollingController({
        ownerKey: 'single-owner-test',
        intervalMs: 100,
        request: secondRequest,
        onSuccess: vi.fn(),
      }),
    );

    await advanceTimers(100);
    expect(firstRequest).toHaveBeenCalledOnce();
    expect(secondRequest).not.toHaveBeenCalled();

    first.unmount();
    await flushMicrotasks();
    await advanceTimers(100);
    expect(secondRequest).toHaveBeenCalledOnce();

    second.unmount();
  });

  it('serializes slow requests and coalesces repeated ticks into one refresh', async () => {
    let resolveRequest!: (value: number) => void;
    const request = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const mounted = renderHook(() =>
      usePollingController({
        ownerKey: 'single-flight-test',
        intervalMs: 100,
        request,
        onSuccess: vi.fn(),
      }),
    );

    act(() => vi.advanceTimersByTime(300));
    await flushMicrotasks();
    expect(request).toHaveBeenCalledOnce();

    await act(async () => {
      resolveRequest(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(2);

    mounted.unmount();
  });

  it('keeps a manual refresh pending through a queued single-flight refresh', async () => {
    const resolvers: Array<(value: number) => void> = [];
    const request = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const mounted = renderHook(() =>
      usePollingController({
        ownerKey: 'await-queued-refresh-test',
        intervalMs: 100,
        request,
        onSuccess: vi.fn(),
      }),
    );

    await advanceTimers(100);
    let refreshSettled = false;
    const refresh = mounted.result.current.refresh().then(() => {
      refreshSettled = true;
    });

    await act(async () => {
      resolvers[0]?.(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(refreshSettled).toBe(false);

    await act(async () => {
      resolvers[1]?.(2);
      await refresh;
    });
    expect(refreshSettled).toBe(true);

    mounted.unmount();
  });

  it('exposes an immediate refresh for post-mutation ownership', async () => {
    const request = vi.fn(async () => 1);
    const mounted = renderHook(() =>
      useOAuthStatusController({ request, onSuccess: vi.fn(), enabled: true }),
    );

    await act(async () => mounted.result.current.refresh());
    expect(request).toHaveBeenCalledOnce();

    mounted.unmount();
  });
});
