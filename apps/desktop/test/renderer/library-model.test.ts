import { describe, expect, it } from 'vitest';

import {
  copySummaryLabel,
  formatLibraryDuration,
  mediaException,
} from '../../src/renderer/src/features/library/library-model';
import { mediaFixture } from './library-test-fixtures';

describe('Library presentation model', () => {
  it('keeps healthy routine grid metadata quiet', () => {
    const item = mediaFixture();
    expect(mediaException(item)).toBeNull();
    expect(copySummaryLabel(item)).toBe('1 verified copy');
  });

  it('prioritizes authorization, copy attention, destination, then source exceptions', () => {
    expect(
      mediaException(
        mediaFixture({
          sourceStatus: 'REMOVED',
          copySummary: {
            copyCount: 1,
            verifiedCount: 0,
            pendingCount: 0,
            attentionCount: 1,
            unavailableCount: 1,
            authRequiredCount: 1,
          },
        }),
      ),
    ).toEqual({ label: 'Drive authorization required', tone: 'warning' });
    expect(
      mediaException(
        mediaFixture({
          copySummary: {
            copyCount: 1,
            verifiedCount: 0,
            pendingCount: 0,
            attentionCount: 1,
            unavailableCount: 0,
            authRequiredCount: 0,
          },
        }),
      ),
    ).toEqual({ label: 'Backup needs attention', tone: 'danger' });
  });

  it('formats long and short durations without a remote dependency', () => {
    expect(formatLibraryDuration(65)).toBe('1:05');
    expect(formatLibraryDuration(3_665)).toBe('1:01:05');
    expect(formatLibraryDuration(null)).toBe('Duration unavailable');
  });
});
