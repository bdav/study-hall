import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { BackLink } from '@/components/BackLink';
import { courseLedHere } from '@/lib/decks';
import { DeckTabs } from '@/components/DeckTabs';
import { ArchivedDeckNotice } from '@/components/ArchivedDeckNotice';

interface DeckHeaderProps {
  deckName: string;
  deckId: string;
  activeTab: 'study' | 'cards' | 'stats';
  /**
   * A Course Deck's course, which the deck links back to when the course's
   * page led to it (`cameFromCourse`); otherwise it links back to
   * Flashcards, as a standalone deck does, naming an archived course.
   */
  course?: {
    id: string;
    title: string;
    archivedAt?: Date | string | null;
  } | null;
  /** Shown in place of the deck name, such as an editable title. */
  title?: ReactNode;
  /** When the deck was archived: its pages then say so, with Restore. */
  archivedAt?: Date | string | null;
}

/**
 * A deck page's title and its tabs: the tabs below the title on narrow
 * screens, and beside it from md, where a long title wraps rather than
 * running under them.
 */
export function DeckHeader({
  deckName,
  deckId,
  activeTab,
  course,
  title,
  archivedAt,
}: DeckHeaderProps) {
  const { state } = useLocation();
  return (
    <div className="w-full max-w-4xl">
      {course && !course.archivedAt && courseLedHere(state, course.id) ? (
        <BackLink to={`/courses/${course.id}`}>{course.title}</BackLink>
      ) : (
        // Back to Flashcards, where the deck is listed, unless its course's
        // page led here
        <div className="flex flex-wrap items-baseline gap-x-3">
          <BackLink to="/flashcards">Flashcards</BackLink>
          {course?.archivedAt && (
            <p className="text-sm text-white/60">
              From the archived course {course.title}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="min-w-0">
          {title ?? (
            <h1 className="text-3xl font-bold break-words text-white">
              {deckName}
            </h1>
          )}
        </div>
        <div className="shrink-0">
          <DeckTabs deckId={deckId} activeTab={activeTab} />
        </div>
      </div>
      {archivedAt && (
        <ArchivedDeckNotice deckId={deckId} archivedAt={archivedAt} />
      )}
    </div>
  );
}
