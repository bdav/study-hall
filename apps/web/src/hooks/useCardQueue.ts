import { useState, useCallback } from 'react';
import { type Flashcard } from '@/lib/cards';

export function useCardQueue(cards: Flashcard[]) {
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [cardsStudied, setCardsStudied] = useState(0);

  const currentCard = queue[0] ?? null;

  const reset = useCallback(() => {
    setQueue([...cards]);
    setCardsStudied(0);
  }, [cards]);

  const advance = useCallback((requeue: boolean) => {
    setQueue((prev) => {
      const [current, ...remaining] = prev;
      if (requeue && current) {
        remaining.push(current);
      }
      return remaining;
    });
    setCardsStudied((prev) => prev + 1);
  }, []);

  return {
    queue,
    currentCard,
    cardsStudied,
    reset,
    advance,
  };
}
