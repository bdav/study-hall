import { BackLink } from '@/components/BackLink';
import { DeckTabs } from '@/components/DeckTabs';

interface DeckHeaderProps {
  deckName: string;
  deckId: string;
  activeTab: 'study' | 'cards' | 'stats';
  /** A Course Deck's course, which reviewing it links back to. */
  course?: { id: string; title: string } | null;
}

export function DeckHeader({
  deckName,
  deckId,
  activeTab,
  course,
}: DeckHeaderProps) {
  return (
    <div className="relative w-full max-w-4xl">
      {course && (
        <BackLink to={`/courses/${course.id}`}>{course.title}</BackLink>
      )}
      <h1 className="text-3xl font-bold text-white">{deckName}</h1>
      <div className="absolute right-0 top-1/2 -translate-y-1/2">
        <DeckTabs deckId={deckId} activeTab={activeTab} />
      </div>
    </div>
  );
}
