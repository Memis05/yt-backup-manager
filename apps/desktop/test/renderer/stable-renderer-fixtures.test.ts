import { describe, expect, it } from 'vitest';

import {
  STABLE_RENDERER_FIXTURE_KINDS,
  stableRendererFixtures,
} from '../../src/renderer/src/testing/stable-renderer-fixtures';

describe('stable renderer fixtures', () => {
  it('covers every frozen migration state exactly once', () => {
    const fixtureKinds = Object.values(stableRendererFixtures).map((fixture) => fixture.kind);
    expect(fixtureKinds).toEqual(STABLE_RENDERER_FIXTURE_KINDS);
    expect(new Set(fixtureKinds).size).toBe(STABLE_RENDERER_FIXTURE_KINDS.length);
  });

  it('keeps recovery preview read-only until explicit confirmation', () => {
    expect(stableRendererFixtures.recoveryPreview).toMatchObject({
      explicitConfirmationRequired: true,
      canonicalCatalogMutated: false,
      credentialImports: 0,
    });
  });

  it('uses durable-operation states that retain completed partial work', () => {
    expect(stableRendererFixtures.paused.partialDataRetained).toBe(true);
    expect(stableRendererFixtures.cancelled.partialDataRetained).toBe(true);
    expect(stableRendererFixtures.completedWithIssues.completedItems).toBeGreaterThan(0);
  });
});
