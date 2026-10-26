import { useEffect, useRef } from 'react';

/** Calls `tick` every `ms` while the browser tab is visible (pages of the reserved area that follow devices). */
export function useRefresh(tick: () => void, ms: number): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  }, [tick]);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') latest.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}
