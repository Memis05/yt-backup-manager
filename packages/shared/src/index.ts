export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
