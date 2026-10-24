import { describe, expect, it } from 'vitest';
import { ACCEPT_VIDEO, VIDEO_WRONG_TYPE, videoProblem } from './imageUpload.ts';

describe('videoProblem', () => {
  it('accepts MP4, WebM and QuickTime (.mov)', () => {
    for (const type of ['video/mp4', 'video/webm', 'video/quicktime'])
      expect(videoProblem({ size: 1000, type, name: 'a.bin' })).toBeNull();
    expect(ACCEPT_VIDEO).toContain('.mov');
  });

  it('lets through an empty or generic type when the extension is a video one', () => {
    for (const type of ['', 'application/octet-stream'])
      for (const name of ['a.mov', 'A.MP4', 'a.m4v', 'a.webm'])
        expect(videoProblem({ size: 1000, type, name })).toBeNull();
  });

  it('refuses other types, other extensions and files over the limit', () => {
    for (const type of ['', 'video/x-msvideo', 'image/png', 'application/octet-stream'])
      expect(videoProblem({ size: 1000, type, name: 'a.avi' })).toBe(VIDEO_WRONG_TYPE);
    expect(videoProblem({ size: 1000, type: 'image/png', name: 'a.mov' })).toBe(VIDEO_WRONG_TYPE);
    expect(videoProblem({ size: 16 * 1024 * 1024, type: 'video/quicktime', name: 'a.mov' })).toMatch(/troppo grande/);
  });
});
