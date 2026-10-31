import { useState } from 'react';

/**
 * State kept for the browser tab (sessionStorage), so a reload picks it up
 * where it was. What the tab kept is used only when `isValid` accepts it,
 * so a shape from an older build starts afresh rather than breaking the
 * page. Storage can be missing or refuse access (a private window, blocked
 * site data), so the state then lasts only as long as the page.
 */
export function useTabState<T>(
  key: string,
  initial: T,
  isValid: (kept: unknown) => kept is T,
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const kept = sessionStorage.getItem(key);
      if (kept === null) return initial;
      const parsed: unknown = JSON.parse(kept);
      return isValid(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });

  const set = (next: T) => {
    setValue(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Kept for this page only
    }
  };

  return [value, set] as const;
}

/** Forgets state kept for the tab, so the next visit starts afresh. */
export function forgetTabState(...keys: string[]) {
  try {
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // Nothing was kept
  }
}
