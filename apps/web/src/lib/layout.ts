/**
 * The width a page's content is laid out in: the pinned header, the lesson
 * frame and the course page all use it, so a title stays in place moving
 * between a course and its lessons. Fixed rather than fitted to what's on
 * the page, so nothing shifts sideways from step to step; any extra width
 * goes outside it.
 */
export const PAGE_WIDTH = 'mx-auto w-full max-w-7xl px-4 md:px-8';

/**
 * PAGE_WIDTH for content with a panel docked at the window's right edge,
 * such as the lesson's tutor: it starts where PAGE_WIDTH would, so it stays
 * in line with the header, and the panel takes the space to its right.
 */
export const PAGE_WIDTH_BESIDE_PANEL =
  'w-full max-w-7xl px-4 md:px-8 ml-[max(0px,calc((100%_-_80rem)/2))]';
