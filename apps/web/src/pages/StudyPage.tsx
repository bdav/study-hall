import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { toFlashcard } from '@/lib/cards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  RefreshCw,
} from 'lucide-react';
import { CardStack } from '@/components/CardStack';
import { CenteredPage } from '@/components/CenteredPage';
import { StudySkeleton } from '@/components/PageSkeleton';
import { useStudySession } from '@/hooks/useStudySession';
import {
  useSlideAnimation,
  type CardSnapshot,
} from '@/hooks/useSlideAnimation';
import { DeckHeader } from '@/components/DeckHeader';
import {
  recallGradeColors,
  recallGradeLabels,
  type RecallGrade,
} from '@/lib/recallGrades';

// The session summary lists grades best first.
const summaryGradeOrder: RecallGrade[] = [
  'NAILED',
  'GOOD',
  'PARTIALLY_CORRECT',
  'MISSED',
];

const answerInputClasses =
  'h-auto flex-1 rounded-none border-0 border-b-2 border-white/40 bg-transparent py-2 text-center text-3xl font-bold uppercase tracking-wide text-white shadow-none focus-visible:ring-0 md:text-3xl placeholder:text-white/30';

const navButtonClasses =
  'absolute top-1/2 h-16 w-16 -translate-y-1/2 active:translate-y-[-50%] text-white/50 disabled:opacity-40 focus-visible:border-transparent focus-visible:ring-0';

const flipButtonClasses =
  'absolute right-3 top-3 rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80';

function CardFront({ text, onFlip }: { text: string; onFlip?: () => void }) {
  return (
    <>
      <p className="text-center text-3xl font-bold uppercase tracking-wide text-white">
        {text}
      </p>
      {onFlip && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFlip();
          }}
          className={flipButtonClasses}
          title="Flip to back"
          aria-label="Flip to back"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      )}
    </>
  );
}

function CardBack({
  card,
  result,
  onFlip,
}: {
  card: CardSnapshot['card'];
  result: NonNullable<CardSnapshot['result']>;
  onFlip?: () => void;
}) {
  return (
    <div className="text-center text-white" data-testid="correct-answer">
      <p className="text-sm uppercase tracking-wide text-white/50">
        {card.front}
      </p>
      <p className="mt-2 text-3xl font-bold uppercase tracking-wide text-white">
        {card.canonicalAnswer}
      </p>
      <p
        className={`mt-4 inline-block rounded-full px-4 py-1 text-lg font-semibold text-white ${recallGradeColors[result.recallGrade]}`}
        data-testid="result"
      >
        {recallGradeLabels[result.recallGrade]}
      </p>
      {result.accentMismatch && (
        <p className="mt-2 text-sm text-white/70" data-testid="accent-note">
          Check the accents in the answer above.
        </p>
      )}
      {onFlip && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFlip();
          }}
          className={flipButtonClasses}
          title="Flip to front"
          aria-label="Flip to front"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export default function StudyPage() {
  const { deckId } = useParams<{ deckId: string }>();

  const deckQuery = trpc.deck.getById.useQuery(
    { id: deckId ?? '' },
    { enabled: !!deckId },
  );

  const deck = deckQuery.data;
  const cards = useMemo(() => deck?.cards.map(toFlashcard) ?? [], [deck]);

  const {
    studyState,
    currentCard,
    position,
    sessionSize,
    remainingCount,
    isFlipped,
    toggleFlip,
    answerInput,
    setAnswerInput,
    error,
    history,
    handleStart,
    handleSubmitAnswer,
    handleDontKnow,
    handleFinish,
    handleNext,
    handleBack,
    handleForward,
    canGoBack,
    reviewEntry,
  } = useStudySession(deckId);

  const isReviewing = studyState.phase === 'reviewing';
  const isIdle = studyState.phase === 'idle';
  const isAtTitle = isIdle || (isReviewing && !reviewEntry);

  const displayCard = isAtTitle
    ? undefined
    : isReviewing
      ? reviewEntry?.card
      : currentCard;
  const displayResult =
    isReviewing && reviewEntry
      ? reviewEntry
      : studyState.phase === 'result'
        ? {
            recallGrade: studyState.recallGrade,
            accentMismatch: studyState.accentMismatch,
            userAnswer: studyState.userAnswer,
          }
        : null;
  const progress = isReviewing
    ? undefined
    : `Card ${position + 1} of ${sessionSize}`;

  const onSlideNext = useCallback(() => {
    if (isIdle) handleStart();
    else if (isReviewing) handleForward();
    else handleNext();
  }, [isIdle, isReviewing, handleStart, handleForward, handleNext]);

  const {
    slideKey,
    slideDirection,
    lastNavDirection,
    exitingCard,
    handleSlideEnd,
    slideToNext,
    slideToPrev,
  } = useSlideAnimation(
    {
      card: displayCard ?? null,
      result: displayResult,
      isFlipped,
      queueLength: remainingCount,
      progress,
    },
    onSlideNext,
    handleBack,
  );

  const forwardButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the forward button when arriving at the title card mid-session
  useEffect(() => {
    if (isAtTitle && !exitingCard) {
      forwardButtonRef.current?.focus();
    }
  }, [isAtTitle, exitingCard]);

  // Focus the appropriate nav button after slide animation completes
  useEffect(() => {
    if (
      exitingCard ||
      isAtTitle ||
      studyState.phase === 'answering' ||
      studyState.phase === 'complete'
    )
      return;
    if (lastNavDirection === 'back') {
      backButtonRef.current?.focus();
    }
  }, [exitingCard, lastNavDirection, isAtTitle, studyState.phase]);

  // Enter key starts session during idle phase (with slide)
  useEffect(() => {
    if (studyState.phase !== 'idle') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') slideToNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [studyState.phase, slideToNext]);

  // Enter key advances during result phase (with slide)
  useEffect(() => {
    if (studyState.phase !== 'result') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') slideToNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [studyState.phase, slideToNext]);

  if (deckQuery.isLoading) {
    return <StudySkeleton />;
  }

  if (deckQuery.isError || !deck) {
    return (
      <CenteredPage centered>
        <p className="text-destructive">Error loading deck.</p>
      </CenteredPage>
    );
  }

  if (cards.length === 0) {
    return (
      <CenteredPage>
        <DeckHeader
          deckName={deck.name}
          deckId={deckId ?? ''}
          activeTab="study"
          course={deck.course}
        />
        <p className="mt-6 text-center text-white/60">
          This deck has no cards.
        </p>
        <Link
          to={`/decks/${deckId}/cards`}
          className="mt-2 text-white/80 underline hover:text-white"
        >
          Add cards
        </Link>
      </CenteredPage>
    );
  }

  if (studyState.phase === 'nothing-due') {
    return (
      <CenteredPage>
        <DeckHeader
          deckName={deck.name}
          deckId={deckId ?? ''}
          activeTab="study"
          course={deck.course}
        />
        <div className="flex w-full flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-md pt-3">
            <div className="flex aspect-3/2 w-full flex-col items-center justify-center rounded-xl border border-white/30 bg-white/10 p-8 text-center backdrop-blur-sm">
              <p className="text-white/60">
                Nothing is due right now. Come back later to review this deck.
              </p>
            </div>
          </div>
        </div>
      </CenteredPage>
    );
  }

  if (studyState.phase === 'complete') {
    const gradeCounts = summaryGradeOrder
      .map((grade) => ({
        grade,
        count: history.filter((h) => h.recallGrade === grade).length,
      }))
      .filter(({ count }) => count > 0);

    return (
      <CenteredPage>
        <DeckHeader
          deckName={deck.name}
          deckId={deckId ?? ''}
          activeTab="study"
          course={deck.course}
        />
        <div className="flex w-full flex-1 flex-col items-center justify-center">
          <div className="relative w-full max-w-md pt-3">
            <div className="relative flex aspect-3/2 w-full flex-col items-center justify-center rounded-xl border border-white/30 bg-white/10 p-8 backdrop-blur-sm">
              <h2 className="text-2xl font-bold text-white">
                Session complete!
              </h2>
              <p className="mt-2 text-sm text-white/50">
                You answered {history.length} of {sessionSize} cards.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {gradeCounts.map(({ grade, count }) => (
                  <span
                    key={grade}
                    className={`inline-block rounded-full px-4 py-1 text-lg font-semibold text-white ${recallGradeColors[grade]}`}
                  >
                    {count} {recallGradeLabels[grade]}
                  </span>
                ))}
              </div>
            </div>
            <Button
              onClick={slideToPrev}
              variant="ghost"
              size="icon"
              aria-label="Previous"
              className={`-left-20 ${navButtonClasses}`}
            >
              <ChevronLeft className="size-14" />
            </Button>
          </div>
          <div className="mt-6">
            <button
              autoFocus
              onClick={handleStart}
              className="animate-pulse-halo cursor-pointer bg-transparent text-lg font-semibold text-white focus:outline-none"
            >
              Start another session
            </button>
          </div>
        </div>
      </CenteredPage>
    );
  }

  // Helper to render a study card — used for both the active card and the
  // frozen snapshot during slide animations, avoiding JSX duplication.
  const renderStudyCard = (
    card: CardSnapshot['card'],
    result: CardSnapshot['result'],
    flipped: boolean,
    queueLength: number,
    cardProgress: string | undefined,
    onFlip?: () => void,
  ) => (
    <CardStack
      queueLength={queueLength}
      progress={cardProgress}
      isFlipped={result ? flipped : undefined}
      backChildren={
        result ? (
          <CardBack card={card} result={result} onFlip={onFlip} />
        ) : undefined
      }
    >
      <CardFront
        text={card.front}
        onFlip={result && !flipped ? onFlip : undefined}
      />
    </CardStack>
  );

  return (
    <CenteredPage>
      <DeckHeader
        deckName={deck.name}
        deckId={deckId ?? ''}
        activeTab="study"
        course={deck.course}
      />

      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="flex w-full flex-1 flex-col items-center justify-center">
        <div className="relative w-full max-w-md">
          {exitingCard && slideDirection ? (
            <div className="overflow-hidden">
              <div className="relative">
                {/* Exiting card — in normal flow (maintains height), slides out */}
                <div
                  className={
                    slideDirection === 'left'
                      ? 'animate-card-out-left'
                      : 'animate-card-out-right'
                  }
                >
                  {renderStudyCard(
                    exitingCard.card,
                    exitingCard.result,
                    exitingCard.isFlipped,
                    exitingCard.queueLength,
                    exitingCard.progress,
                  )}
                </div>
                {/* Entering card — absolutely positioned, slides in */}
                {(displayCard || isAtTitle) && (
                  <div
                    className={`absolute inset-0 ${
                      slideDirection === 'left'
                        ? 'animate-card-in-from-right'
                        : 'animate-card-in-from-left'
                    }`}
                    onAnimationEnd={handleSlideEnd}
                  >
                    {displayCard ? (
                      renderStudyCard(
                        displayCard,
                        displayResult,
                        isFlipped,
                        remainingCount,
                        progress,
                        toggleFlip,
                      )
                    ) : (
                      <CardStack queueLength={cards.length}>
                        <p className="text-3xl font-bold text-white">
                          {deck.name}
                        </p>
                        <p className="mt-4 text-sm text-white/50">
                          {cards.length} cards
                        </p>
                      </CardStack>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : displayCard ? (
            <div key={slideKey}>
              {renderStudyCard(
                displayCard,
                displayResult,
                isFlipped,
                remainingCount,
                progress,
                toggleFlip,
              )}
            </div>
          ) : isAtTitle ? (
            <div key={slideKey}>
              <CardStack
                queueLength={cards.length}
                className={
                  isIdle ? 'animate-pulse-halo-border cursor-pointer' : ''
                }
                onClick={isIdle ? slideToNext : undefined}
              >
                <p className="text-3xl font-bold text-white">{deck.name}</p>
                <p className="mt-4 text-sm text-white/50">
                  {cards.length} cards
                </p>
              </CardStack>
            </div>
          ) : null}

          {!isAtTitle && (
            <Button
              ref={backButtonRef}
              onClick={slideToPrev}
              disabled={!canGoBack}
              variant="ghost"
              size="icon"
              aria-label="Previous"
              className={`-left-20 ${navButtonClasses} ${studyState.phase !== 'answering' && lastNavDirection === 'back' && canGoBack ? 'animate-pulse-halo' : ''}`}
            >
              <ChevronLeft className="size-14" />
            </Button>
          )}

          <Button
            ref={forwardButtonRef}
            onClick={slideToNext}
            disabled={studyState.phase === 'answering'}
            variant="ghost"
            size="icon"
            aria-label="Next"
            className={`-right-20 ${navButtonClasses} ${studyState.phase !== 'answering' && (lastNavDirection === 'forward' || isAtTitle) ? 'animate-pulse-halo' : ''}`}
          >
            <ChevronRight className="size-14" />
          </Button>
        </div>

        <div className="mt-6 w-full max-w-md">
          {studyState.phase === 'answering' && (
            <form
              className="relative w-full"
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmitAnswer();
              }}
            >
              <Input
                type="text"
                value={answerInput}
                onChange={(e) => setAnswerInput(e.target.value)}
                autoFocus
                className={answerInputClasses}
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                aria-label="Submit"
                disabled={!answerInput.trim()}
                className={`absolute right-0 top-1/2 -translate-y-1/2 active:translate-y-[-50%] text-white/50 disabled:opacity-40 ${answerInput.trim() ? 'animate-pulse-halo' : ''}`}
              >
                <CornerDownLeft className="size-7" />
              </Button>
            </form>
          )}

          {studyState.phase === 'answering' && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={handleDontKnow}
                className="cursor-pointer text-sm text-white/50 underline hover:text-white/80"
              >
                I don't know
              </button>
            </div>
          )}

          {(studyState.phase === 'result' || isReviewing) && displayResult ? (
            <p className="py-2 text-center text-3xl font-bold uppercase tracking-wide text-white">
              {displayResult.userAnswer ?? "I don't know"}
            </p>
          ) : studyState.phase !== 'answering' ? (
            <div className="py-2 text-3xl">&nbsp;</div>
          ) : null}

          {(studyState.phase === 'answering' ||
            studyState.phase === 'result') && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={handleFinish}
                className="cursor-pointer text-sm text-white/50 underline hover:text-white/80"
              >
                Finish session
              </button>
            </div>
          )}
        </div>
      </div>
    </CenteredPage>
  );
}
