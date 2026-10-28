export interface Point {
  x: number;
  y: number;
}

/** How far a drag must go across to be a swipe, in CSS pixels. */
const MIN_DISTANCE = 60;

/**
 * Which way a touch drag from `start` to `end` swipes, if it's a swipe at
 * all: far enough across, and at least twice as far across as up or down,
 * so scrolling the page is never taken for one.
 */
export function swipeDirection(
  start: Point,
  end: Point,
): 'left' | 'right' | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < 2 * Math.abs(dy)) {
    return null;
  }
  return dx < 0 ? 'left' : 'right';
}
