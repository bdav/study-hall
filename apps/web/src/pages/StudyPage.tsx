import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { useSwipe } from '@/hooks/useSwipe';
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
import { useStoredChoice } from '@/hooks/useStoredChoice';
import {
  isFocusWithin,
  isNothingFocused,
  useActiveElement,
} from '@/hooks/useActiveElement';
import {
  ENTER_GLOW,
  KEYBOARD_ENTER_GLOW,
  KEYBOARD_ENTER_GLOW_BORDER,
} from '@/lib/enterGlow';
import { SessionPicker } from '@/components/SessionPicker';
import {
  STUDY_MODES,
  type SessionType,
  type StudyMode,
} from '@/lib/sessionChoices';
import {
  useSlideAnimation,
  type CardSnapshot,
} from '@/hooks/useSlideAnimation';
import { DeckHeader } from '@/components/DeckHeader';
import { StudyCardEditor } from '@/components/StudyCardEditor';
import { CardAnswersSummary } from '@/components/CardAnswers';
import { CardHistory } from '@/components/CardHistory';
import {
  asDirected,
  directionLabels,
  STUDY_DIRECTIONS,
  type StudyDirection,
} from '@/lib/directions';
import { recallGradeColors, recallGradeLabels } from '@/lib/recallGrades';
import { type Failure, type KnownState } from '@/lib/studySession';

const answerInputClasses =
  'h-auto flex-1 rounded-none border-0 border-b-2 border-white/40 bg-transparent py-2 text-center text-3xl font-bold uppercase tracking-wide text-white shadow-none focus-visible:ring-0 md:text-3xl placeholder:text-white/30';

// Below md, in a row under the card, since beside it they'd be off screen
const navButtonClasses =
  'h-12 w-12 text-white/50 disabled:opacity-40 focus-visible:border-transparent focus-visible:ring-0 md:absolute md:top-1/2 md:h-16 md:w-16 md:-translate-y-1/2 md:active:translate-y-[-50%]';

/** Holds Previous and Next: a row below md, nothing of its own from md. */
const navRowClasses = 'mt-2 flex justify-between md:contents';

/** Whether a key belongs to a dialog or the card's editor, not the page. */
function isInDialog(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest(
      '[role="dialog"], [role="alertdialog"], [data-card-answers], [data-card-editor]',
    ) !== null
  );
}

/**
 * Whether a key is the page's Enter shortcut: not in a dialog or the
 * card's editor, nor on a button or link, which Enter activates instead
 * (#81).
 */
function isPageEnter(e: KeyboardEvent) {
  return (
    e.key === 'Enter' &&
    !isInDialog(e.target) &&
    !(
      e.target instanceof Element &&
      e.target.closest('button, a[href], [role="button"]')
    )
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
  resumable,
  studyMode,
}: {
  deckSize: number;
  sessionSize: number | null;
  preview: { sessionSize: number; nextDueAt: string | null } | undefined;
  /**
   * An unfinished session, which starting resumes (#10), and on a
   * Reversible Deck the Direction Label of the direction it's in.
   */
  resumable: {
    answered: number;
    size: number;
    directionLabel?: string;
  } | null;
  /** Drill Weakest has nothing to drill, rather than nothing due (#9). */
  studyMode: StudyMode;
}) {
  const className = 'mt-4 text-sm text-white/50';
  const isDrill = studyMode === 'DRILL_WEAKEST';
  if (sessionSize !== null) {
    return <p className={className}>{cardCount(sessionSize)}</p>;
  }
  if (resumable) {
    return (
      <>
        <p className="mt-4 text-base text-white/80">Resume session?</p>
        <p className="mt-1 text-sm text-white/50">
          {resumable.answered} of {resumable.size} answered
          {resumable.directionLabel && ` · ${resumable.directionLabel}`}
        </p>
      </>
    );
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
      <p className={className}>
        {isDrill ? 'Nothing to drill' : 'Nothing due'} · {deckSize} in deck
      </p>
      {!isDrill && preview.nextDueAt && (
        <p className="mt-1 text-xs text-white/40">
          Next card due {nextDueFormat.format(new Date(preview.nextDueAt))}
        </p>
      )}
    </>
  );
}

/**
 * Below the learner's answer: which of the card's Canonical Answers it
 * matched, when that wasn't the primary shown on the card. An answer
 * accepted as the front of another card sharing this one's answer, in
 * Reverse, shows as any accepted answer does (#96).
 */
function AnswerNotes({
  card,
  result,
}: {
  card: Flashcard;
  result: { matchedAnswer: string | null; otherFront: string | null };
}) {
  const primary = card.answers[0]?.text;
  if (
    result.otherFront ||
    result.matchedAnswer === null ||
    result.matchedAnswer === primary
  ) {
    return null;
  }
  return (
    <p className="mt-2 text-sm text-white/70" data-testid="answer-notes">
      Matched “{result.matchedAnswer}”, one of the card’s answers.
    </p>
  );
}

const failureMessages: Record<Failure, string> = {
  start: 'Failed to start study session. Please try again.',
  answer: 'Failed to submit answer. Please try again.',
  finish: 'Failed to finish study session. Please try again.',
  accept: "Couldn't accept your answer. Please try again.",
};

export default function StudyPage() {
  const { deckId } = useParams<{ deckId: string }>();
  // Where the deck was reached from, which its links within it carry
  const location = useLocation();
  const yourAnswerId = useId();
  const answerChoiceId = useId();

  // How to study: Quick, Standard or Deep (#8), Standard each time the page
  // opens, and Study, Drill Weakest or Cram (#9), remembered by the browser
  const [sessionType, setSessionType] = useState<SessionType>('STANDARD');
  const [studyMode, setStudyMode] = useStoredChoice(
    'study-hall:study-mode',
    STUDY_MODES.map((mode) => mode.value),
    'STUDY',
  );
  // On a Reversible Deck, which way to study, remembered by the browser for
  // each deck; Forward on a deck studied one way (ADR-0011)
  const [chosenDirection, setDirection] = useStoredChoice<StudyDirection>(
    `study-hall:direction:${deckId}`,
    STUDY_DIRECTIONS,
    'FORWARD',
  );
  const deckQuery = trpc.deck.getById.useQuery(
    { id: deckId ?? '' },
    { enabled: !!deckId },
  );
  const deck = deckQuery.data;
  const isReversible = !!deck?.reversible;
  const labels = deck && isReversible ? directionLabels(deck) : undefined;
  const direction = isReversible ? chosenDirection : 'FORWARD';
  const cards = useMemo(() => deck?.cards.map(toFlashcard) ?? [], [deck]);

  const { view, act, preview, resumable, isAcceptingAnswer } = useStudySession(
    deckId,
    { sessionType, studyMode, direction },
  );
  const { screen } = view;
  const cardScreen = screen.kind === 'card' ? screen : null;
  const isAtTitle = screen.kind === 'title';
  // Before a session, rather than gone back to the title card within one
  const isIdle = isAtTitle && screen.sessionSize === null;
  const isAnswering = cardScreen?.stage === 'answering';
  const isGraded = cardScreen?.stage === 'graded';
  const isReviewing = cardScreen?.stage === 'reviewing';
  const titleQueueLength = isAtTitle
    ? (screen.sessionSize ?? preview?.sessionSize ?? cards.length)
    : 0;
  const titleDetails = (
    <TitleCardDetails
      deckSize={cards.length}
      sessionSize={isAtTitle ? screen.sessionSize : null}
      preview={preview}
      resumable={
        isIdle && resumable
          ? {
              ...resumable,
              directionLabel: labels?.[resumable.direction],
            }
          : null
      }
      studyMode={studyMode}
    />
  );

  const studiedItem = cardScreen?.item;
  const itemDirection = studiedItem?.direction ?? direction;
  // The card on screen as it's asked in its item's direction: in Reverse,
  // its primary answer asking for its front (ADR-0011). Edits go to the card
  // itself
  const displayCard =
    studiedItem && asDirected(studiedItem.card, studiedItem.direction);
  // Whether the card on screen is known already in its direction, when Mark
  // known would do nothing (ADR-0009); the same query as its history below
  // it
  const displayProgress = trpc.card.history.useQuery(
    { cardId: displayCard?.id ?? '', direction: itemDirection },
    { enabled: !!displayCard, gcTime: 0 },
  ).data?.progress;
  const canMarkDisplayKnown = !!displayProgress && !displayProgress.isKnown;
  const displayResult = cardScreen?.answer ?? null;
  const isFlipped = cardScreen?.flipped ?? false;
  const progress = cardScreen?.progress;
  const remainingCount = cardScreen?.remaining ?? 0;
  const error = view.failure && failureMessages[view.failure];

  const {
    slideKey,
    slideDirection,
    lastNavDirection,
    exitingCard,
    handleSlideEnd,
    slideTo,
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
    act.next,
    act.back,
  );

  const isEditing = !!displayCard && !!cardScreen?.editing;
  // An answered card keeps the side it shows; an unanswered one has no back
  // outside edit mode
  const editorShowsBack = displayResult
    ? isFlipped
    : !!cardScreen?.editing?.showsBack;

  // While a card slides in it's drawn in the slide, then again once it
  // settles, so an editor opened mid-slide would lose its edits
  const canEdit = !exitingCard;

  function startEditing(onBack = false) {
    if (canEdit) act.edit(onBack);
  }

  const forwardButtonRef = useRef<HTMLButtonElement>(null);
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const nextId = useId();
  const previousId = useId();
  const startAnotherId = useId();
  const answerId = useId();

  /**
   * Moves focus to where Enter should go next, for when the control that
   * had it goes: Previous on a card reviewed after going back, otherwise
   * Next. By id, as it's passed to the card while rendering it.
   */
  function focusNavigation() {
    const goingBack = lastNavDirection === 'back' && !isAtTitle;
    document.getElementById(goingBack ? previousId : nextId)?.focus();
  }

  // On a card with several answers "My answer was correct" first asks which
  // one the answer is another way of saying
  const acceptDisplayedAnswer =
    displayResult && displayCard
      ? () => {
          act.accept(displayResult.attemptId);
          // Its button goes once accepted
          if (!cardScreen?.asksWhichAnswer) focusNavigation();
        }
      : undefined;
  const isChoosingAnswer = !!cardScreen?.choosingAnswer;

  // Next and Previous, as buttons and as swipes across the card. A session
  // that's complete has only Previous
  const { canStart, canGoForward } = view;
  const canGoPrevious = view.canGoBack;

  // Focus goes to the control Enter should press next (#94) once the deck
  // has loaded, a slide ends, an answer is graded or edit mode ends:
  // Previous after going back, otherwise Next. Answering, the answer has it,
  // and once the session is over, Start another session
  const isDeckLoaded = !!deck;
  const isOver = screen.kind === 'summary';
  useEffect(() => {
    if (!isDeckLoaded || exitingCard || isEditing || isAnswering || isOver)
      return;
    if (lastNavDirection === 'back' && !isAtTitle) {
      backButtonRef.current?.focus();
    } else {
      forwardButtonRef.current?.focus();
    }
  }, [
    isDeckLoaded,
    exitingCard,
    isEditing,
    lastNavDirection,
    isAtTitle,
    isAnswering,
    isOver,
  ]);

  // Enter with nothing that takes it focused presses Next: on the title
  // card before a session, which starts it, and on a graded card, unless
  // editing (#81)
  const pageEnterPressesNext = canStart || (isGraded && !isEditing);
  useEffect(() => {
    if (!pageEnterPressesNext) return;
    function onKeyDown(e: KeyboardEvent) {
      if (isPageEnter(e)) slideToNext();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pageEnterPressesNext, slideToNext]);

  // The glow says what Enter would press now (#94): the control that has
  // focus, or Next when nothing has and the page's Enter presses it
  const active = useActiveElement();
  const nextGlows =
    canGoForward &&
    (active?.id === nextId ||
      (isNothingFocused(active) && pageEnterPressesNext));
  const previousGlows = canGoPrevious && active?.id === previousId;
  const titleCardGlows = canStart && isFocusWithin(active, '[data-title-card]');
  const submitGlows =
    !!view.answerInput.trim() && isFocusWithin(active, '[data-answer-form]');
  const swipe = useSwipe((direction) => {
    if (isEditing) return;
    if (direction === 'left' && canGoForward) slideToNext();
    if (direction === 'right' && canGoPrevious) slideToPrev();
  });

  // Once a session is over, back to the title card and its options, where
  // the next one is chosen and started (#93); what was marked known or
  // being accepted in the last session is put away with it
  function startAnother() {
    slideTo('right', act.startAnother);
  }

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

  // Read only: nothing to study until it's restored (#77)
  if (deck.archivedAt) {
    return (
      <CenteredPage>
        <DeckHeader
          deckName={deck.name}
          deckId={deckId ?? ''}
          activeTab="study"
          course={deck.course}
          archivedAt={deck.archivedAt}
        />
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
          state={location.state}
          className="mt-2 text-white/80 underline hover:text-white"
        >
          Add cards
        </Link>
      </CenteredPage>
    );
  }

  if (screen.kind === 'nothing-due') {
    return (
      <CenteredPage>
        <DeckHeader
          deckName={deck.name}
          deckId={deckId ?? ''}
          activeTab="study"
          course={deck.course}
        />
        <div className="mt-6 flex w-full flex-1 flex-col items-center justify-center">
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

  if (screen.kind === 'summary') {
    return (
      <CenteredPage>
        <DeckHeader
          deckName={deck.name}
          deckId={deckId ?? ''}
          activeTab="study"
          course={deck.course}
        />
        <div className="mt-6 flex w-full flex-1 flex-col items-center justify-center">
          <div
            className="relative w-full max-w-md pt-3"
            onTouchStart={swipe.onTouchStart}
            onTouchEnd={swipe.onTouchEnd}
          >
            <div className="relative flex aspect-3/2 w-full flex-col items-center justify-center rounded-xl border border-white/30 bg-white/10 p-8 backdrop-blur-sm">
              <h2 className="text-2xl font-bold text-white">
                Session complete!
              </h2>
              <p className="mt-2 text-sm text-white/50">
                You answered {screen.answered} of {screen.size} cards.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {screen.grades.map(({ grade, count }) => (
                  <span
                    key={grade}
                    className={`inline-block rounded-full px-4 py-1 text-lg font-semibold text-white ${recallGradeColors[grade]}`}
                  >
                    {count} {recallGradeLabels[grade]}
                  </span>
                ))}
              </div>
            </div>
            <div className={navRowClasses}>
              <Button
                id={previousId}
                onClick={slideToPrev}
                variant="ghost"
                size="icon"
                aria-label="Previous"
                className={`md:-left-20 ${navButtonClasses} ${active?.id === previousId ? KEYBOARD_ENTER_GLOW : ''}`}
              >
                <ChevronLeft className="size-10 md:size-14" />
              </Button>
            </div>
          </div>
          <div className="mt-6">
            <button
              id={startAnotherId}
              autoFocus
              onClick={startAnother}
              className={`cursor-pointer bg-transparent text-lg font-semibold text-white focus:outline-none ${active?.id === startAnotherId ? KEYBOARD_ENTER_GLOW : ''}`}
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
  const renderStudyCard = ({
    card,
    result,
    isFlipped: flipped,
    queueLength,
    progress: cardProgress,
    onFlip,
    editedAfterAnswer = false,
    onAcceptAnswer,
    onMarkKnown,
    knownState,
  }: CardSnapshot & {
    onFlip?: () => void;
    editedAfterAnswer?: boolean;
    onAcceptAnswer?: () => void;
    onMarkKnown?: () => void;
    knownState?: KnownState;
  }) => (
    <CardStack
      queueLength={queueLength}
      progress={cardProgress}
      isFlipped={result ? flipped : undefined}
      backChildren={
        result ? (
          <CardBack
            card={card}
            result={result}
            editedAfterAnswer={editedAfterAnswer}
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

  // The card on screen: the one in play, or one answered earlier, as asked
  // in its item's direction, and edited as it is
  const renderDisplayCard = (card: Flashcard) =>
    isEditing && studiedItem ? (
      <StudyCardEditor
        deckId={deckId ?? ''}
        card={studiedItem.card}
        direction={itemDirection}
        labels={labels}
        queueLength={remainingCount}
        progress={progress}
        canMarkKnown={canMarkDisplayKnown}
        isFlipped={editorShowsBack}
        onFlip={act.flip}
        onEdited={act.cardEdited}
        onChanged={act.cardChanged}
        onDeleted={() => act.cardDeleted(card.id)}
        // The card in play is done with, as is its Retry; an answered one
        // stays answered
        onMarkedKnown={() => act.dropUnanswered(card.id)}
        onDone={() => {
          act.stopEditing();
          // An unanswered card goes back to its answer; an answered one's
          // Next is focused once edit mode ends
          if (isAnswering) {
            document.getElementById(answerId)?.focus();
          }
        }}
      />
    ) : (
      renderStudyCard({
        card,
        result: displayResult,
        isFlipped,
        queueLength: remainingCount,
        progress,
        onFlip: () => {
          act.flip();
          // The front's flip button goes once flipped
          focusNavigation();
        },
        editedAfterAnswer: !!displayResult?.editedAfter,
        onAcceptAnswer: acceptDisplayedAnswer,
        onMarkKnown: canMarkDisplayKnown
          ? () => {
              // Its Retry, if missed, is skipped with it, as the session
              // does
              act.markKnown();
              // Its button goes once it's marked
              focusNavigation();
            }
          : undefined,
        knownState: cardScreen?.known,
      })
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

      <div className="mt-6 flex w-full flex-1 flex-col items-center justify-center">
        <div
          className="relative w-full max-w-md"
          onTouchStart={swipe.onTouchStart}
          onTouchEnd={swipe.onTouchEnd}
        >
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
                  {renderStudyCard(exitingCard)}
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
            <div key={slideKey} data-title-card>
              <CardStack
                queueLength={titleQueueLength}
                className={
                  canStart
                    ? `cursor-pointer ${titleCardGlows ? KEYBOARD_ENTER_GLOW_BORDER : ''}`
                    : ''
                }
                onClick={canStart ? slideToNext : undefined}
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
                onClick={() => startEditing()}
                className="relative touch-target rounded p-1 text-white/40 transition-colors enabled:hover:bg-white/10 enabled:hover:text-white/80"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className={navRowClasses}>
            {!isAtTitle && (
              <Button
                ref={backButtonRef}
                id={previousId}
                onClick={slideToPrev}
                disabled={!canGoPrevious}
                variant="ghost"
                size="icon"
                aria-label="Previous"
                className={`md:-left-20 ${navButtonClasses} ${previousGlows ? KEYBOARD_ENTER_GLOW : ''}`}
              >
                <ChevronLeft className="size-10 md:size-14" />
              </Button>
            )}

            <Button
              ref={forwardButtonRef}
              id={nextId}
              onClick={slideToNext}
              disabled={!canGoForward}
              variant="ghost"
              size="icon"
              aria-label="Next"
              className={`ml-auto md:-right-20 ${navButtonClasses} ${nextGlows ? KEYBOARD_ENTER_GLOW : ''}`}
            >
              <ChevronRight className="size-10 md:size-14" />
            </Button>
          </div>
        </div>

        <div className="mt-6 w-full max-w-md">
          {isAnswering && (
            <form
              className="relative w-full"
              data-answer-form
              onSubmit={(e) => {
                e.preventDefault();
                act.submit();
              }}
            >
              <Input
                id={answerId}
                type="text"
                value={view.answerInput}
                onChange={(e) => act.type(e.target.value)}
                autoFocus
                className={answerInputClasses}
              />
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                aria-label="Submit"
                disabled={!view.answerInput.trim()}
                className={`absolute right-0 top-1/2 -translate-y-1/2 active:translate-y-[-50%] text-white/50 disabled:opacity-40 ${submitGlows ? ENTER_GLOW : ''}`}
              >
                <CornerDownLeft className="size-7" />
              </Button>
            </form>
          )}

          {isAnswering && cardScreen.refusal && (
            <p
              role="status"
              className="mt-2 text-center text-sm text-amber-100"
            >
              {cardScreen.refusal}
            </p>
          )}

          {isAnswering && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={act.dontKnow}
                className="cursor-pointer text-sm text-white/50 underline hover:text-white/80"
              >
                I don't know
              </button>
            </div>
          )}

          {(isGraded || isReviewing) && displayResult ? (
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
                      onOpen={() => startEditing(true)}
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
                      {displayCard.answers.map((answer, i) => (
                        <Button
                          key={answer.id}
                          // Enter now chooses an answer
                          autoFocus={i === 0}
                          type="button"
                          size="sm"
                          disabled={isAcceptingAnswer}
                          onClick={() => {
                            // The choice goes once made
                            focusNavigation();
                            act.accept(displayResult.attemptId, answer.id);
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
                        onClick={() => {
                          act.cancelChoosing();
                          focusNavigation();
                        }}
                        className="text-white/70 hover:bg-white/10 hover:text-white"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {displayCard && (
                <CardHistory
                  key={displayCard.id}
                  cardId={displayCard.id}
                  direction={itemDirection}
                  // Coming back in this session, whatever its schedule says
                  showsNextReview={!cardScreen?.retryWaiting}
                />
              )}
            </>
          ) : isIdle && !resumable ? (
            // How to study, below the title card before a session
            <SessionPicker
              sessionType={sessionType}
              onSessionType={setSessionType}
              studyMode={studyMode}
              onStudyMode={setStudyMode}
              direction={
                labels && {
                  value: direction,
                  labels,
                  onChange: setDirection,
                }
              }
            />
          ) : !isAnswering ? (
            // Holds the answer's place, label included
            <div className="py-2 text-center" aria-hidden>
              <p className="text-xs">&nbsp;</p>
              <p className="text-3xl">&nbsp;</p>
            </div>
          ) : null}

          {isIdle && resumable && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={act.abandon}
                className="cursor-pointer text-sm text-white/50 underline hover:text-white/80"
              >
                Abandon session
              </button>
            </div>
          )}

          {(isAnswering || isGraded) && (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={act.finish}
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
