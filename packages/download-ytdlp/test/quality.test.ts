import { describe, expect, it } from 'vitest';

import { selectYtDlpFormats } from '../src';

const formats = [
  {
    format_id: '720-combined',
    ext: 'mp4',
    vcodec: 'avc1',
    acodec: 'aac',
    height: 720,
    tbr: 1200,
    filesize: 10,
  },
  {
    format_id: '1080-video',
    ext: 'webm',
    vcodec: 'vp9',
    acodec: 'none',
    height: 1080,
    tbr: 2500,
    filesize: 20,
  },
  {
    format_id: '2160-video',
    ext: 'webm',
    vcodec: 'vp9',
    acodec: 'none',
    height: 2160,
    tbr: 5000,
    filesize: 40,
  },
  { format_id: 'audio-low', ext: 'm4a', vcodec: 'none', acodec: 'aac', abr: 96, filesize: 2 },
  { format_id: 'audio-best', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 160, filesize: 3 },
];

describe('yt-dlp quality selection', () => {
  it.each([
    ['BEST_AVAILABLE', '2160-video', 2160],
    ['MAX_4K', '2160-video', 2160],
    ['MAX_1080P', '1080-video', 1080],
    ['MAX_720P', '720-combined', 720],
  ] as const)('selects %s under its height cap', (profile, id, height) => {
    expect(selectYtDlpFormats(formats, profile)).toMatchObject({
      videoFormatId: id,
      height,
    });
  });

  it('selects the best audio-only representation for a separate video stream', () => {
    expect(selectYtDlpFormats(formats, 'MAX_1080P')).toMatchObject({
      videoFormatId: '1080-video',
      audioFormatId: 'audio-best',
      expectedBytes: 23,
    });
  });
});
