import { describe, expect, it, vi } from 'vitest';

import { DESKTOP_IPC_CHANNELS, type WorkerRpcClient } from '@ytbm/ipc';

import { registerDesktopIpcHandlers, type IpcHandlerRegistrar } from '../src/main/desktop-ipc';

describe('desktop Activity IPC protocol gate', () => {
  it('opens the application on the existing worker while Activity waits for replacement', async () => {
    const handlers = new Map<string, (event: unknown, input: unknown) => Promise<unknown>>();
    const registrar: IpcHandlerRegistrar = {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => void handlers.delete(channel),
    };
    const methods: string[] = [];
    const worker = {
      request: vi.fn(async (method: string) => {
        methods.push(method);
        if (method === 'schedules.list') return { schedules: [] };
        if (method === 'activity.operations') {
          return {
            operations: [],
            page: 1,
            pageSize: 25,
            totalItems: 0,
            activeCount: 0,
            pausedCount: 0,
            retryingCount: 0,
            attentionCount: 0,
          };
        }
        throw new Error(`Unexpected worker method: ${method}`);
      }),
    } as unknown as Pick<WorkerRpcClient, 'request'>;
    let releaseWorker!: () => void;
    const currentWorker = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });

    registerDesktopIpcHandlers(
      registrar,
      worker as WorkerRpcClient,
      async () => undefined,
      async () => null,
      async () => undefined,
      async () => undefined,
      () => true,
      undefined,
      () => currentWorker,
    );

    const schedules = handlers.get(DESKTOP_IPC_CHANNELS.schedulesList)!;
    const activity = handlers.get(DESKTOP_IPC_CHANNELS.activityOperations)!;
    await expect(schedules(null, {})).resolves.toEqual({ schedules: [] });

    const pendingActivity = activity(null, { page: 1, pageSize: 25 });
    await Promise.resolve();
    expect(methods).toEqual(['schedules.list']);

    releaseWorker();
    await expect(pendingActivity).resolves.toMatchObject({ operations: [], totalItems: 0 });
    expect(methods).toEqual(['schedules.list', 'activity.operations']);
  });
});
