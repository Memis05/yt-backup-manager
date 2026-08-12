import type { MediaType, SourceStatus } from '@ytbm/core';

export function parseYouTubeDuration(value: string | null): number | null {
  if (value === null) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (match === null) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return Math.round(days * 86_400 + hours * 3_600 + minutes * 60 + seconds);
}

export function classifyYouTubeMedia(input: {
  durationSeconds: number | null;
  actualEndTime: string | null;
  publishedAt: number | null;
}): MediaType {
  if (input.actualEndTime !== null) return 'LIVE';
  // The Data API exposes neither a Shorts flag nor video orientation. Duration <= 180s is
  // therefore an intentionally documented heuristic and may include short horizontal videos.
  const threeMinuteShortsStartedAt = Date.parse('2024-10-15T00:00:00.000Z');
  const maximumDuration =
    input.publishedAt !== null && input.publishedAt < threeMinuteShortsStartedAt ? 60 : 180;
  if (input.durationSeconds !== null && input.durationSeconds <= maximumDuration) return 'SHORT';
  return 'VIDEO';
}

export function sourceStatusFromPrivacy(value: string | null): SourceStatus {
  if (value === 'private') return 'PRIVATE';
  if (value === 'unlisted') return 'UNLISTED';
  if (value === 'public') return 'AVAILABLE';
  return 'UNKNOWN';
}
