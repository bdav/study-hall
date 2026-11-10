import type { ReactNode } from 'react';
import { DeckCard } from '@/components/DeckCard';
import { countOf } from '@/lib/format';

/**
 * A deck's tile, as Flashcards and Home show it: its name, its course on a
 * Course Deck and its cards, then whatever the page adds below.
 */
export function DeckTile({
  deck,
  wideOnPhones,
  children,
}: {
  deck: { name: string; course: { title: string } | null; cardCount: number };
  wideOnPhones?: boolean;
  children?: ReactNode;
}) {
  return (
    <DeckCard
      stackCount={Math.min(deck.cardCount, 3)}
      wideOnPhones={wideOnPhones}
    >
      <p className="text-center text-lg font-bold tracking-wide break-words text-white uppercase">
        {deck.name}
      </p>
      {deck.course && (
        <p className="mt-0.5 text-center text-xs text-white/50">
          Course: {deck.course.title}
        </p>
      )}
      <p className="mt-1 text-sm text-white/60">
        {countOf(deck.cardCount, 'card')}
      </p>
      {children}
    </DeckCard>
  );
}
