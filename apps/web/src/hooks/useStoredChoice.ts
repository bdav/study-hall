import { useState } from 'react';

/**
 * One of a few choices, remembered by the browser. Storage can be missing
 * or refuse access (a private window, blocked site data), so the choice
 * then falls back, or lasts only as long as the page.
 */
export function useStoredChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T,
) {
  const [choice, setChoice] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return choices.find((option) => option === stored) ?? fallback;
    } catch {
      return fallback;
    }
  });

  const choose = (next: T) => {
    setChoice(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Remembered for this page only
    }
  };

  return [choice, choose] as const;
}

/** A setting that's on or off, remembered by the browser as above. */
export function useStoredFlag(key: string, fallback: boolean) {
  const [choice, choose] = useStoredChoice(
    key,
    ['on', 'off'],
    fallback ? 'on' : 'off',
  );
  return [choice === 'on', (on: boolean) => choose(on ? 'on' : 'off')] as const;
}
