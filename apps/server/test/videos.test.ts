import { describe, expect, it } from 'vitest';
import { inspectVideo, VideoRejected } from '../src/lib/videos.js';
import { png } from './imageFixtures.js';
import { mp4, webm } from './videoFixtures.js';

describe('videos recognized from the bytes', () => {
  it('reads type and size of an MP4 and of a WebM', () => {
    expect(inspectVideo(mp4(1280, 720))).toEqual({ mime: 'video/mp4', width: 1280, height: 720 });
    expect(inspectVideo(mp4(640, 360, 10, ['mp42']))).toEqual({ mime: 'video/mp4', width: 640, height: 360 });
    expect(inspectVideo(webm(1920, 1080))).toEqual({ mime: 'video/webm', width: 1920, height: 1080 });
  });

  it('refuses anything else, whatever the name', () => {
    const appended = Buffer.concat([mp4(10, 10), Buffer.from('<script>alert(1)</script>')]);
    const truncated = mp4(10, 10).subarray(0, 60);
    const bad = [
      png(10, 10),
      Buffer.from('not a video at all'),
      Buffer.alloc(0),
      mp4(10, 10, 8, ['qt  ']),
      appended,
      truncated,
      mp4(0, 0),
      mp4(5000, 100),
      webm(10, 10, 8, 'matroska'),
      webm(0, 10),
    ];
    for (const file of bad) expect(() => inspectVideo(file)).toThrow(VideoRejected);
  });
});
