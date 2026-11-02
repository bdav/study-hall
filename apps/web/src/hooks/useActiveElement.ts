import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  document.addEventListener('focusin', onChange);
  document.addEventListener('focusout', onChange);
  return () => {
    document.removeEventListener('focusin', onChange);
    document.removeEventListener('focusout', onChange);
  };
}

/**
 * The element that has focus, kept up to date as focus moves, or the page's
 * body when nothing has it. A focused element that's removed leaves focus
 * on the body without saying so, so whatever removes it moves focus on.
 */
export function useActiveElement() {
  return useSyncExternalStore(
    subscribe,
    () => document.activeElement,
    () => null,
  );
}

/**
 * Whether nothing on the page has focus, counting an element since
 * removed, which leaves it on the body.
 */
export function isNothingFocused(active: Element | null) {
  return active === null || active === document.body || !active.isConnected;
}

/** Whether focus is on, or inside, an element matching `selector`. */
export function isFocusWithin(active: Element | null, selector: string) {
  return active?.closest(selector) != null;
}
