import { describe, expect, it } from 'vitest';

import { ChannelQualityChangeApplySchema, ChannelQualityChangePreviewSchema } from '../src';

const channelId = '00000000-0000-4000-8000-000000000001';

describe('channel quality decision DTOs', () => {
  it('keeps existing-copy execution explicitly unsupported', () => {
    expect(
      ChannelQualityChangePreviewSchema.parse({
        channelId,
        previousEffectiveQualityProfile: 'MAX_1080P',
        targetEffectiveQualityProfile: 'MAX_4K',
        isQualityIncrease: true,
        eligibleMediaCount: 4,
        eligibleCopyCount: 7,
        upgradeExistingSupported: false,
        unsupportedReason: 'Existing verified copies are not replaced.',
      }),
    ).toMatchObject({ upgradeExistingSupported: false, eligibleMediaCount: 4 });

    expect(() =>
      ChannelQualityChangePreviewSchema.parse({
        channelId,
        previousEffectiveQualityProfile: 'MAX_1080P',
        targetEffectiveQualityProfile: 'MAX_4K',
        isQualityIncrease: true,
        eligibleMediaCount: 4,
        eligibleCopyCount: 7,
        upgradeExistingSupported: true,
        unsupportedReason: 'Unsupported.',
      }),
    ).toThrow();
  });

  it('accepts only the new-media policy', () => {
    expect(
      ChannelQualityChangeApplySchema.parse({
        channelId,
        qualityProfileOverride: 'MAX_4K',
        policy: 'NEW_MEDIA_ONLY',
      }).policy,
    ).toBe('NEW_MEDIA_ONLY');
    expect(() =>
      ChannelQualityChangeApplySchema.parse({
        channelId,
        qualityProfileOverride: 'MAX_4K',
        policy: 'UPGRADE_EXISTING',
      }),
    ).toThrow();
  });
});
