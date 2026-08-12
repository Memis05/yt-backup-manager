import { describe, expect, it } from 'vitest';

import { assertJobTransition, canTransitionJob } from '../src';

describe('job transition foundation', () => {
  it('permits documented durable transitions', () => {
    expect(canTransitionJob('PENDING', 'READY')).toBe(true);
    expect(canTransitionJob('RUNNING', 'INTERRUPTED')).toBe(true);
    expect(() => assertJobTransition('PAUSED', 'READY')).not.toThrow();
  });

  it('rejects transitions that would bypass verification work', () => {
    expect(canTransitionJob('READY', 'COMPLETED')).toBe(false);
    expect(() => assertJobTransition('COMPLETED', 'RUNNING')).toThrow();
  });
});
