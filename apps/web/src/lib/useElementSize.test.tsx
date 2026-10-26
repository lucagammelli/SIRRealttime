import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElementSize } from './useLayout.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useElementSize', () => {
  it('measures before the first paint: the first committed render already has the size', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 120 } as DOMRect);
    const seen: string[] = [];
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const { width, height } = useElementSize(ref);
      seen.push(`${width}x${height}`);
      return <div ref={ref} />;
    }
    const { container } = render(<Probe />);
    expect(container).toBeTruthy();
    expect(seen.at(-1)).toBe('300x120');
  });
});
