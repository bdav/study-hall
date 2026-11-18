/**
 * How much shorter than the window the visible part of the page must be to
 * be taken for an on-screen keyboard, the shortest of which is over 200px,
 * rather than a browser's toolbar.
 */
const KEYBOARD_MIN_HEIGHT = 150;

/**
 * The height left visible above an on-screen keyboard while one is open
 * (#140), or none. A phone's browser keeps the window's height as the
 * keyboard opens, shrinking only the visual viewport, so a shortfall the
 * size of a keyboard is one. Zooming in shrinks it too, so a zoomed page
 * has none.
 */
export function keyboardRoom({
  windowHeight,
  viewport,
}: {
  windowHeight: number;
  viewport: { height: number; scale: number } | null;
}): number | null {
  if (!viewport || viewport.scale > 1.01) return null;
  return windowHeight - viewport.height > KEYBOARD_MIN_HEIGHT
    ? Math.round(viewport.height)
    : null;
}
