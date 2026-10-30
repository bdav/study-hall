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
