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

/**
 * A pinned header above a page with a docked panel: it starts in line with
 * the page's content, as PAGE_WIDTH_BESIDE_PANEL does, and runs to the
 * window's right edge, so its last action, the panel's toggle, sits there.
 */
// No set width: the margin takes its share and the row fills the rest
export const HEADER_BESIDE_PANEL =
  'px-4 md:px-8 lg:pr-6 ml-[max(0px,calc((100%_-_80rem)/2))]';

/** The width of a panel docked at the window's right edge, such as the tutor. */
export const DOCKED_PANEL_WIDTH = 'w-80 xl:w-96';

/**
 * How a docked panel, and the space kept for it, slides open and shut,
 * unless the learner prefers less motion.
 */
export const DOCKED_PANEL_SLIDE =
  'transition-[width] duration-300 ease-out motion-reduce:transition-none';

/**
 * A grid of tiles, as Flashcards' decks and Courses' courses: one per row
 * on phones, three across from sm. Shared, so the two pages stay alike.
 */
export const TILE_GRID = 'grid grid-cols-1 gap-6 sm:grid-cols-3';

/** A tile's shape: wider than tall. */
export const TILE_SHAPE = 'aspect-3/2';

/**
 * TILE_SHAPE for a tile in TILE_GRID, wider still below sm, where each is a
 * row in a one-column list.
 */
export const TILE_SHAPE_WIDE_ON_PHONES = 'aspect-2/1 sm:aspect-3/2';
