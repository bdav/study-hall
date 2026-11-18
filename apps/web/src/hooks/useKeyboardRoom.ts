import { useSyncExternalStore } from 'react';
import { keyboardRoom } from '@/lib/keyboardRoom';

function subscribe(onChange: () => void) {
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', onChange);
  window.addEventListener('resize', onChange);
  return () => {
    viewport?.removeEventListener('resize', onChange);
    window.removeEventListener('resize', onChange);
  };
}

/**
 * The height left visible above an on-screen keyboard while one is open,
 * or null (`keyboardRoom`), kept up to date as it opens and closes.
 */
export function useKeyboardRoom() {
  return useSyncExternalStore(
    subscribe,
    () =>
      keyboardRoom({
        windowHeight: window.innerHeight,
        viewport: window.visualViewport,
      }),
    () => null,
  );
}
