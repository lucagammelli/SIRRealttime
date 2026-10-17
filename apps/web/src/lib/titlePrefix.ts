import { useEffect } from 'react';

const PREFIX = /^\[[^\]]*\] /;

/** Pure: `title` with `[prefix] ` in front (an older prefix is replaced); without prefix, the bare title. */
export function prefixedTitle(title: string, prefix: string | null): string {
  const bare = title.replace(PREFIX, '');
  return prefix ? `[${prefix}] ${bare}` : bare;
}

/**
 * Keeps `[prefix] ` in front of the title of the browser tab while mounted, whatever title the pages set
 * (they write `document.title` in their effects: a MutationObserver on <head> puts the prefix back).
 * Removed when `prefix` becomes null or on unmount.
 */
export function useTitlePrefix(prefix: string | null): void {
  useEffect(() => {
    const apply = (): void => {
      const next = prefixedTitle(document.title, prefix);
      if (next !== document.title) document.title = next;
    };
    apply();
    if (prefix === null) return;
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = prefixedTitle(document.title, null);
    };
  }, [prefix]);
}
