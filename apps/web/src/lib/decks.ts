/**
 * Whether a deck can be archived on its own: any but a Course Deck whose
 * course is active, which goes with its course (the API checks it too).
 */
export function canArchiveDeck(deck: {
  course?: { archivedAt?: Date | string | null } | null;
}) {
  return !deck.course || Boolean(deck.course.archivedAt);
}

/** What archiving a deck keeps, for its confirmation (#77). */
export function archiveDeckDescription(name: string) {
  return `Archive "${name}"? It leaves Flashcards, and its cards and their history are kept. You can restore it from Archived at the bottom of Flashcards.`;
}

/**
 * The router state a link into a Course Deck's pages carries from its
 * course's page, so the deck links back there rather than to Flashcards.
 */
export function cameFromCourse(courseId: string) {
  return { fromCourseId: courseId };
}

/** Whether a deck's pages were reached from this course's page. */
export function courseLedHere(state: unknown, courseId: string) {
  return (
    typeof state === 'object' &&
    state !== null &&
    'fromCourseId' in state &&
    state.fromCourseId === courseId
  );
}
