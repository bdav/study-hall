import { useCallback, useEffect, useRef, useState } from 'react';
import { type Flashcard } from '@/lib/cards';
import { type GradedAnswer } from '@/lib/recallGrades';

export type CardSnapshot = {
  card: Pick<Flashcard, 'front' | 'canonicalAnswer'>;
  result: GradedAnswer | null;
  isFlipped: boolean;
  queueLength: number;
  progress: string | undefined;
};

type CurrentDisplay = {
  card: CardSnapshot['card'] | null;
  result: CardSnapshot['result'];
  isFlipped: boolean;
  queueLength: number;
  progress: string | undefined;
};

export function useSlideAnimation(
  current: CurrentDisplay,
  onNext: () => void,
  onBack: () => void,
) {
  const [slideKey, setSlideKey] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(
    null,
  );
  const [lastNavDirection, setLastNavDirection] = useState<'forward' | 'back'>(
    'forward',
  );
  const [exitingCard, setExitingCard] = useState<CardSnapshot | null>(null);

  // Ref to snapshot current display state before navigation.
  // Updated on every render so it's always current when event handlers read it.
  const displayRef = useRef<CardSnapshot>({
    card: current.card ?? { front: '', canonicalAnswer: '' },
    result: current.result,
    isFlipped: current.isFlipped,
    queueLength: current.queueLength,
    progress: current.progress,
  });
  useEffect(() => {
    displayRef.current = {
      card: current.card ?? { front: '', canonicalAnswer: '' },
      result: current.result,
      isFlipped: current.isFlipped,
      queueLength: current.queueLength,
      progress: current.progress,
    };
  });

  const handleSlideEnd = useCallback(() => {
    setExitingCard(null);
    setSlideDirection(null);
  }, []);

  // Fallback cleanup — onAnimationEnd doesn't fire in JSDOM
  useEffect(() => {
    if (!exitingCard) return;
    const timer = setTimeout(handleSlideEnd, 400);
    return () => clearTimeout(timer);
  }, [exitingCard, handleSlideEnd]);

  const slideToNext = useCallback(() => {
    setExitingCard(displayRef.current);
    setSlideDirection('left');
    setSlideKey((k) => k + 1);
    setLastNavDirection('forward');
    onNext();
  }, [onNext]);

  const slideToPrev = useCallback(() => {
    setExitingCard(displayRef.current);
    setSlideDirection('right');
    setSlideKey((k) => k + 1);
    setLastNavDirection('back');
    onBack();
  }, [onBack]);

  return {
    slideKey,
    slideDirection,
    lastNavDirection,
    setLastNavDirection,
    exitingCard,
    handleSlideEnd,
    slideToNext,
    slideToPrev,
  };
}
