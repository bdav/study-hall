import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Pencil,
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
import { StudyCardEditor } from '@/components/StudyCardEditor';
import { CardAnswersSummary } from '@/components/CardAnswers';
import { CardHistory } from '@/components/CardHistory';
import {
  gradeOf,
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

/** Whether a key belongs to a dialog or the card's editor, not the page. */
function isInDialog(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(
      '[role="dialog"], [role="alertdialog"], [data-card-answers], [data-card-editor]',
    ) !== null
  );
}

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

/** What marking a card known did, once done. */
type KnownState = 'marked' | 'already';

function CardBack({
  card,
  result,
  editedAfterAnswer = false,
  onFlip,
  onAcceptAnswer,
  isAcceptingAnswer = false,
  onMarkKnown,
  knownState,
}: {
  card: CardSnapshot['card'];
  result: NonNullable<CardSnapshot['result']>;
  /** The card was edited after this answer, so the grade is for the old card. */
  editedAfterAnswer?: boolean;
  onFlip?: () => void;
  /** "My answer was correct", for the card in play or one reviewed. */
  onAcceptAnswer?: () => void;
  isAcceptingAnswer?: boolean;
  /** Marks the card known (ADR-0009). */
  onMarkKnown?: () => void;
  /** Once marked known: whether that changed it, or it was known already. */
  knownState?: KnownState;
}) {
  // A typed answer graded MISSED, still graded against the card as it is
  const canAccept =
    onAcceptAnswer &&
    result.recallGrade === 'MISSED' &&
    result.userAnswer !== null &&
    !editedAfterAnswer;

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
      {canAccept && (
        <button
          type="button"
          disabled={isAcceptingAnswer}
          onClick={(e) => {
            e.stopPropagation();
            onAcceptAnswer();
          }}
          className="mt-3 block w-full text-sm text-white/70 underline hover:text-white disabled:opacity-50"
        >
          My answer was correct
        </button>
      )}
      {knownState ? (
        <p className="mt-3 text-sm text-white/70">
          {knownState === 'marked' ? 'Marked known' : 'Already known'}
        </p>
      ) : (
        onMarkKnown && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMarkKnown();
            }}
            className="mt-3 block w-full text-sm text-white/70 underline hover:text-white"
          >
            Mark known
          </button>
        )
      )}
      {result.matchedVariant && (
        <p className="mt-2 text-sm text-white/70" data-testid="variant-note">
          Matched the accepted variant “{result.matchedVariant}”.
        </p>
      )}
      {result.accentMismatch && (
        <p className="mt-2 text-sm text-white/70" data-testid="accent-note">
          {result.matchedVariant
            ? 'Check the accents in that variant.'
            : 'Check the accents in the answer above.'}
        </p>
      )}
      {editedAfterAnswer && (
        <p className="mt-2 text-sm text-white/70">
          Graded before you edited this card. It doesn't count toward the card's
          progress.
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

function cardCount(count: number) {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

const nextDueFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * The title card's count: before a session, how many cards one would hold
 * and how many the deck has, or that nothing is due and when the next card
 * is; during a session, its size.
 */
function TitleCardDetails({
  deckSize,
  sessionSize,
  preview,
}: {
  deckSize: number;
  sessionSize: number | null;
  preview: { sessionSize: number; nextDueAt: string | null } | undefined;
}) {
  const className = 'mt-4 text-sm text-white/50';
  if (sessionSize !== null) {
    return <p className={className}>{cardCount(sessionSize)}</p>;
  }
  if (!preview) return <p className={className}>{deckSize} in deck</p>;
  if (preview.sessionSize > 0) {
    return (
      <p className={className}>
        {preview.sessionSize} to study · {deckSize} in deck
      </p>
    );
  }
  return (
    <>
      <p className={className}>Nothing due · {deckSize} in deck</p>
      {preview.nextDueAt && (
        <p className="mt-1 text-xs text-white/40">
          Next card due {nextDueFormat.format(new Date(preview.nextDueAt))}
        </p>
      )}
    </>
  );
}

/**
 * Below the learner's answer: which of the card's Canonical Answers it
 * matched, when that wasn't the primary shown on the card.
 */
function AnswerNotes({
  card,
  result,
}: {
  card: Flashcard;
  result: { matchedAnswer: string | null };
}) {
  const primary = card.answers[0]?.text;
  if (result.matchedAnswer === null || result.matchedAnswer === primary) {
    return null;
  }
  return (
    <p className="mt-2 text-sm text-white/70" data-testid="answer-notes">
      Matched “{result.matchedAnswer}”, one of the card’s answers.
    </p>
  );
}

export default function StudyPage() {
  const { deckId } = useParams<{ deckId: string }>();
  const utils = trpc.useUtils();
  // Answered cards marked known from below their grade, and what it did
  const [knownCards, setKnownCards] = useState<Map<string, KnownState>>(
    () => new Map(),
  );
  const markKnown = trpc.card.markKnown.useMutation({
    onSuccess: ({ markedCount }, { cardIds }) => {
      setKnownCards((prev) => {
        const next = new Map(prev);
        for (const cardId of cardIds) {
          next.set(cardId, markedCount > 0 ? 'marked' : 'already');
        }
        return next;
      });
      for (const cardId of cardIds) utils.card.history.invalidate({ cardId });
    },
  });
  const yourAnswerId = useId();
  const answerChoiceId = useId();
  // The card in edit mode, for the slide it was turned on in, and, for a
  // card not yet answered, whether its back is in view
  const [editing, setEditing] = useState<{
    cardId: string;
    slideKey: number;
    showsBack: boolean;
  } | null>(null);
  // The attempt whose "My answer was correct" is choosing an answer
  const [choosingAnswerFor, setChoosingAnswerFor] = useState<string | null>(
    null,
  );

  const queuePreviewQuery = trpc.study.queuePreview.useQuery(
    { deckId: deckId ?? '' },
    { enabled: !!deckId },
  );
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
    handleAcceptAnswer,
    isAcceptingAnswer,
    handleFinish,
    replaceCard,
    showUnresetChange,
    removeCard,
    editedAfterAnswer,
    handleNext,
    handleBack,
    handleForward,
    canGoBack,
    reviewEntry,
  } = useStudySession(deckId);

  const isReviewing = studyState.phase === 'reviewing';
  const isIdle = studyState.phase === 'idle';
  const isAtTitle = isIdle || (isReviewing && !reviewEntry);
  // Before a session, what one would hold; during one, its size
  const preview = queuePreviewQuery.data;
  const titleQueueLength = isIdle
    ? (preview?.sessionSize ?? cards.length)
    : sessionSize;
  const titleDetails = (
    <TitleCardDetails
      deckSize={cards.length}
      sessionSize={isIdle ? null : sessionSize}
      preview={preview}
    />
  );

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
            attemptId: studyState.attemptId,
            userAnswer: studyState.userAnswer,
            ...gradeOf(studyState),
          }
        : null;
  // "My answer was correct" regrades the answer, so the card's history shows
  // its new grade
  async function acceptAnswer(
    attemptId: string,
    cardId: string,
    canonicalAnswerId?: string,
  ) {
    await handleAcceptAnswer(attemptId, canonicalAnswerId);
    utils.card.history.invalidate({ cardId });
  }
  // On a card with several answers it first asks which one the answer is
  // another way of saying
  const acceptDisplayedAnswer =
    displayResult && displayCard
      ? () =>
          displayCard.answers.length > 1
            ? setChoosingAnswerFor(displayResult.attemptId)
            : acceptAnswer(displayResult.attemptId, displayCard.id)
      : undefined;
  const isChoosingAnswer =
    !!displayResult && choosingAnswerFor === displayResult.attemptId;
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

  // Moving to another card leaves edit mode
  const isEditing =
    !!displayCard &&
    editing?.cardId === displayCard.id &&
    editing.slideKey === slideKey;
  // An answered card keeps the side it shows; an unanswered one has no back
  // outside edit mode
  const editorShowsBack = displayResult
    ? isFlipped
    : isEditing && editing.showsBack;
  const flipEditor = displayResult
    ? toggleFlip
    : () =>
        setEditing((prev) => prev && { ...prev, showsBack: !prev.showsBack });

  // While a card slides in it's drawn in the slide, then again once it
  // settles, so an editor opened mid-slide would lose its edits
  const canEdit = !exitingCard;

  function startEditing(cardId: string, onBack = false) {
    if (!canEdit) return;
    setEditing({ cardId, slideKey, showsBack: onBack });
    if (onBack && displayResult && !isFlipped) toggleFlip();
  }

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
      if (e.key === 'Enter' && !isInDialog(e.target)) slideToNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [studyState.phase, slideToNext]);

  // Enter key advances during result phase (with slide), unless editing
  useEffect(() => {
    if (studyState.phase !== 'result' || isEditing) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && !isInDialog(e.target)) slideToNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [studyState.phase, isEditing, slideToNext]);

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
    gradedBeforeEdit = false,
    onAcceptAnswer?: () => void,
    onMarkKnown?: () => void,
    knownState?: KnownState,
  ) => (
    <CardStack
      queueLength={queueLength}
      progress={cardProgress}
      isFlipped={result ? flipped : undefined}
      backChildren={
        result ? (
          <CardBack
            card={card}
            result={result}
            editedAfterAnswer={gradedBeforeEdit}
            onFlip={onFlip}
            onAcceptAnswer={onAcceptAnswer}
            isAcceptingAnswer={isAcceptingAnswer}
            onMarkKnown={onMarkKnown}
            knownState={knownState}
          />
        ) : undefined
      }
    >
      <CardFront
        text={card.front}
        onFlip={result && !flipped ? onFlip : undefined}
      />
    </CardStack>
  );

  // The card on screen: the one in play, or one answered earlier
  const renderDisplayCard = (card: Flashcard) =>
    isEditing ? (
      <StudyCardEditor
        deckId={deckId ?? ''}
        card={card}
        queueLength={remainingCount}
        progress={progress}
        isFlipped={editorShowsBack}
        onFlip={flipEditor}
        onEdited={replaceCard}
        onChanged={showUnresetChange}
        onDeleted={() => removeCard(card.id)}
        onMarkedKnown={() => {
          // The card in play is done with; an answered one stays answered
          if (!history.some((entry) => entry.card.id === card.id)) {
            removeCard(card.id);
          }
        }}
        onDone={() => setEditing(null)}
      />
    ) : (
      renderStudyCard(
        card,
        displayResult,
        isFlipped,
        remainingCount,
        progress,
        toggleFlip,
        editedAfterAnswer.has(card.id),
        acceptDisplayedAnswer,
        () => markKnown.mutate({ cardIds: [card.id] }),
        knownCards.get(card.id),
      )
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
                      renderDisplayCard(displayCard)
                    ) : (
                      <CardStack queueLength={titleQueueLength}>
                        <p className="text-3xl font-bold text-white">
                          {deck.name}
                        </p>
                        {titleDetails}
                      </CardStack>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : displayCard ? (
            <div key={slideKey}>{renderDisplayCard(displayCard)}</div>
          ) : isAtTitle ? (
            <div key={slideKey}>
              <CardStack
                queueLength={titleQueueLength}
                className={
                  isIdle ? 'animate-pulse-halo-border cursor-pointer' : ''
                }
                onClick={isIdle ? slideToNext : undefined}
              >
                <p className="text-3xl font-bold text-white">{deck.name}</p>
                {titleDetails}
              </CardStack>
            </div>
          ) : null}

          {/* Part of the editor, so Enter toggles it rather than moving on */}
          {/* Gone in edit mode, which Cancel or Save ends */}
          {displayCard && !isEditing && (
            <div className="absolute left-3 top-6 z-10" data-card-editor>
              <button
                type="button"
                aria-label="Edit card"
                disabled={!canEdit}
                title="Edit card"
                onClick={() => startEditing(displayCard.id)}
                className="rounded p-1 text-white/40 transition-colors enabled:hover:bg-white/10 enabled:hover:text-white/80"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}

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
            <>
              <div
                role="group"
                aria-labelledby={yourAnswerId}
                className="py-2 text-center"
              >
                <p
                  id={yourAnswerId}
                  className="text-xs uppercase tracking-wide text-white/50"
                >
                  Your answer
                </p>
                <p className="text-3xl font-bold uppercase tracking-wide text-white">
                  {displayResult.userAnswer ?? "I don't know"}
                </p>
                {displayCard && (
                  <>
                    <AnswerNotes card={displayCard} result={displayResult} />
                    <CardAnswersSummary
                      card={displayCard}
                      onOpen={() => startEditing(displayCard.id, true)}
                      caption="Accepted answers"
                      disabled={isEditing}
                      className="mx-auto max-w-md text-center"
                    />
                  </>
                )}
                {isChoosingAnswer && displayCard && (
                  <div
                    role="group"
                    aria-labelledby={answerChoiceId}
                    className="mt-3 text-sm"
                  >
                    <p id={answerChoiceId} className="text-white/70">
                      Which answer is yours another way of saying?
                    </p>
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      {displayCard.answers.map((answer) => (
                        <Button
                          key={answer.id}
                          type="button"
                          size="sm"
                          disabled={isAcceptingAnswer}
                          onClick={() => {
                            setChoosingAnswerFor(null);
                            acceptAnswer(
                              displayResult.attemptId,
                              displayCard.id,
                              answer.id,
                            );
                          }}
                          className="bg-white/20 text-white hover:bg-white/30"
                        >
                          {answer.text}
                        </Button>
                      ))}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setChoosingAnswerFor(null)}
                        className="text-white/70 hover:bg-white/10 hover:text-white"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {displayCard && (
                <CardHistory key={displayCard.id} cardId={displayCard.id} />
              )}
            </>
          ) : studyState.phase !== 'answering' ? (
            // Holds the answer's place, label included
            <div className="py-2 text-center" aria-hidden>
              <p className="text-xs">&nbsp;</p>
              <p className="text-3xl">&nbsp;</p>
            </div>
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
