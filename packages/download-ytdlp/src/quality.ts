import type { QualityProfile } from '@ytbm/core';

export interface YtDlpFormat {
  format_id?: unknown;
  ext?: unknown;
  vcodec?: unknown;
  acodec?: unknown;
  height?: unknown;
  width?: unknown;
  fps?: unknown;
  filesize?: unknown;
  filesize_approx?: unknown;
  tbr?: unknown;
  abr?: unknown;
}

export interface SelectedFormat {
  videoFormatId: string;
  audioFormatId: string | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  expectedBytes: number | null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && value !== 'none' ? value : null;
}

function formatBytes(format: YtDlpFormat): number | null {
  return numberOrNull(format.filesize) ?? numberOrNull(format.filesize_approx);
}

function heightCap(profile: QualityProfile): number | null {
  if (profile === 'MAX_4K') return 2160;
  if (profile === 'MAX_1080P') return 1080;
  if (profile === 'MAX_720P') return 720;
  return null;
}

function videoScore(format: YtDlpFormat): number {
  return (numberOrNull(format.height) ?? 0) * 1_000_000 + (numberOrNull(format.tbr) ?? 0) * 1_000;
}

function audioScore(format: YtDlpFormat): number {
  return (numberOrNull(format.abr) ?? numberOrNull(format.tbr) ?? 0) * 1_000;
}

export function selectYtDlpFormats(
  formats: readonly YtDlpFormat[],
  profile: QualityProfile,
): SelectedFormat | null {
  const cap = heightCap(profile);
  const video = formats
    .filter((format) => {
      const id = stringOrNull(format.format_id);
      const codec = stringOrNull(format.vcodec);
      const height = numberOrNull(format.height);
      return id !== null && codec !== null && (cap === null || height === null || height <= cap);
    })
    .sort((left, right) => videoScore(right) - videoScore(left))[0];
  if (video === undefined) return null;
  const videoId = stringOrNull(video.format_id);
  if (videoId === null) return null;
  const embeddedAudio = stringOrNull(video.acodec);
  const audio =
    embeddedAudio === null
      ? formats
          .filter(
            (format) =>
              stringOrNull(format.format_id) !== null &&
              stringOrNull(format.acodec) !== null &&
              stringOrNull(format.vcodec) === null,
          )
          .sort((left, right) => audioScore(right) - audioScore(left))[0]
      : undefined;
  const audioId = audio === undefined ? null : stringOrNull(audio.format_id);
  if (embeddedAudio === null && audioId === null) return null;
  const videoBytes = formatBytes(video);
  const audioBytes = audio === undefined ? null : formatBytes(audio);
  return {
    videoFormatId: videoId,
    audioFormatId: audioId,
    container: stringOrNull(video.ext),
    videoCodec: stringOrNull(video.vcodec),
    audioCodec: embeddedAudio ?? (audio === undefined ? null : stringOrNull(audio.acodec)),
    width: numberOrNull(video.width),
    height: numberOrNull(video.height),
    fps: numberOrNull(video.fps),
    expectedBytes:
      videoBytes === null || (audio !== undefined && audioBytes === null)
        ? null
        : videoBytes + (audioBytes ?? 0),
  };
}
