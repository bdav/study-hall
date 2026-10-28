import { useRef, type TouchEvent } from 'react';
import { swipeDirection, type Point } from '@/lib/swipe';

/**
 * Where a drag belongs to the control it starts on, such as typing,
 * pressing a button or editing a card, rather than being a swipe.
 */
const OWN_DRAG =
  'input, textarea, select, button, a, [contenteditable], [data-card-editor], [data-card-answers]';

/**
 * Touch handlers that call `onSwipe` with the direction of a swipe across
 * the element they're spread on. Mouse drags are left alone, and taps still
 * click as before.
 */
export function useSwipe(onSwipe: (direction: 'left' | 'right') => void) {
  const start = useRef<Point | null>(null);
  return {
    onTouchStart(event: TouchEvent) {
      // A pinch or another gesture with more than one finger isn't a swipe
      const touch = event.touches.length === 1 ? event.touches[0] : null;
      const ownDrag =
        event.target instanceof Element && event.target.closest(OWN_DRAG);
      start.current =
        touch && !ownDrag ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd(event: TouchEvent) {
      const from = start.current;
      start.current = null;
      const touch = event.changedTouches[0];
      if (!from || !touch) return;
      const direction = swipeDirection(from, {
        x: touch.clientX,
        y: touch.clientY,
      });
      if (direction) onSwipe(direction);
    },
  };
}
