import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleCheck,
  Loader2,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { BackLink } from '@/components/BackLink';
import { CenteredPage } from '@/components/CenteredPage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CourseSkeleton } from '@/components/PageSkeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LessonExercise } from '@/components/LessonExercise';
import { LessonFrame } from '@/components/LessonFrame';
import { LessonOutline } from '@/components/LessonOutline';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ReviewCardsDialog } from '@/components/ReviewCardsDialog';
import {
  currentStepIndex,
  lessonSteps,
  stepSearch,
  type LessonStep,
} from '@/lib/lessonSteps';

/** How often to check on a lesson another open is writing. */
const GENERATING_POLL_MS = 3000;

type Lesson = inferRouterOutputs<AppRouter>['lesson']['getById'];
type LessonVersion = NonNullable<Lesson['version']>;

function LessonHeader({ lesson }: { lesson: Lesson }) {
  return (
    <>
      <BackLink to={`/courses/${lesson.course.id}`}>
        {lesson.course.title}
      </BackLink>
      <h1 className="mt-2 text-2xl font-bold">{lesson.title}</h1>
    </>
  );
}

/**
 * Starts the lesson over, so its exercises can be practised from scratch.
 * The lesson then shows only answers given from now on; earlier ones are
 * still saved. Opened from the header's ⋯ menu, so it's out of the way.
 */
function StartOverDialog({
  lesson,
  open,
  onOpenChange,
}: {
  lesson: Lesson;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const startOver = trpc.lesson.startOver.useMutation({
    onSuccess: async () => {
      // Starting over clears Lesson Completion
      utils.course.getById.invalidate({ id: lesson.course.id });
      // The refetched lesson remounts every exercise. Only then forget the
      // revealed answers, which now need a new attempt: a revealed exercise
      // still mounted would refetch them and fail
      await utils.lesson.getById.invalidate({ id: lesson.id });
      utils.exercise.answers.reset();
    },
    onError: () => {
      toast.error("Couldn't start the lesson over");
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Start this lesson over?"
      description="Your answers are cleared from the lesson so you can practise its exercises from scratch, and it's no longer marked complete. Your earlier answers are still saved."
      confirmLabel="Start over"
      onConfirm={() => startOver.mutate({ id: lesson.id })}
    />
  );
}

/** The header's icon-only buttons. */
const ICON_BUTTON =
  'rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white';

/**
 * The written lesson's header, pinned to the top: the way back to the
 * course, the title, Lesson Completion and a ⋯ menu of rarely used actions.
 */
function WrittenLessonHeader({
  lesson,
  leading,
}: {
  lesson: Lesson;
  /** Controls before the title, such as the outline's toggles. */
  leading?: ReactNode;
}) {
  const [isStartingOver, setIsStartingOver] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-white/15 bg-[oklch(0.3_0.1_228)]/90 px-4 py-3 backdrop-blur-md md:px-8">
      <div className="flex items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <BackLink to={`/courses/${lesson.course.id}`}>
            {lesson.course.title}
          </BackLink>
          <h1
            title={lesson.title}
            className="line-clamp-2 text-lg font-bold md:line-clamp-1 md:text-xl"
          >
            {lesson.title}
          </h1>
        </div>
        <CompletionToggle lesson={lesson} />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More actions"
            className={ICON_BUTTON}
          >
            <MoreHorizontal className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="border border-white/20 bg-[oklch(0.25_0.08_230)] text-white ring-0"
          >
            <DropdownMenuItem
              onSelect={() => setIsStartingOver(true)}
              className="focus:bg-white/10 focus:text-white"
            >
              Start over
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <StartOverDialog
        lesson={lesson}
        open={isStartingOver}
        onOpenChange={setIsStartingOver}
      />
    </header>
  );
}

/** Shown in place of a lesson that hasn't been written yet. */
function NotWrittenYet({
  lesson,
  children,
}: {
  lesson: Lesson;
  children: ReactNode;
}) {
  return (
    <CenteredPage>
      <div className="w-full max-w-2xl text-white">
        <LessonHeader lesson={lesson} />
        <div className="mt-8 text-white/70">{children}</div>
        {/* Completion needs no AI, so an unwritten lesson is never locked */}
        <LessonCompletion lesson={lesson} />
      </div>
    </CenteredPage>
  );
}

/** Sets or undoes Lesson Completion, refreshing what shows it. */
function useSetCompleted(lesson: Lesson) {
  const utils = trpc.useUtils();
  return trpc.lesson.setCompleted.useMutation({
    onSuccess: () => {
      utils.lesson.getById.invalidate({ id: lesson.id });
      // The syllabus shows the lesson's status and where to continue
      utils.course.getById.invalidate({ id: lesson.course.id });
    },
    onError: () => {
      toast.error("Couldn't save the lesson's completion");
    },
  });
}

/** Lesson Completion as a compact toggle, for the header. */
function CompletionToggle({ lesson }: { lesson: Lesson }) {
  const setCompleted = useSetCompleted(lesson);
  const complete = lesson.completedAt !== null;
  const Icon = complete ? CircleCheck : Circle;

  return (
    <button
      type="button"
      aria-pressed={complete}
      onClick={() =>
        setCompleted.mutate({ id: lesson.id, completed: !complete })
      }
      disabled={setCompleted.isPending}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm disabled:opacity-60 ${
        complete
          ? 'bg-white/20 text-white'
          : 'text-white/70 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon className="size-4" />
      Complete
    </button>
  );
}

/**
 * Lesson Completion: the learner's own mark that they're done with the
 * lesson, set and undone in any order. It records where they are in the
 * syllabus, never how well they know the material.
 */
function LessonCompletion({ lesson }: { lesson: Lesson }) {
  const setCompleted = useSetCompleted(lesson);
  const complete = lesson.completedAt !== null;

  return (
    <section className="mt-8 flex flex-wrap items-center gap-3 border-t border-white/20 pt-6">
      {complete && (
        <p className="text-white/80">You marked this lesson complete.</p>
      )}
      <button
        type="button"
        onClick={() =>
          setCompleted.mutate({ id: lesson.id, completed: !complete })
        }
        disabled={setCompleted.isPending}
        className={
          complete
            ? 'rounded-lg px-3 py-2 text-sm text-white/60 hover:text-white disabled:opacity-60'
            : 'rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-60'
        }
      >
        {complete ? 'Mark as not complete' : 'Mark lesson complete'}
      </button>
    </section>
  );
}

/**
 * Proposes review cards from the lesson, weighted toward the exercises the
 * learner got wrong, and opens them in the preview. Only the cards the
 * learner confirms join the Course Deck (ADR-0001).
 */
function MakeReviewCards({ lessonId }: { lessonId: string }) {
  const utils = trpc.useUtils();
  const propose = trpc.lesson.proposeReviewCards.useMutation();
  const create = trpc.lesson.createReviewCards.useMutation({
    onSuccess: ({ deckId, createdCount }) => {
      propose.reset();
      utils.card.listByDeck.invalidate({ deckId });
      utils.deck.list.invalidate();
      toast.success(
        `Added ${createdCount} review ${createdCount === 1 ? 'card' : 'cards'} to the course deck`,
      );
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  const proposal = propose.data;

  return (
    <section className="mt-8">
      <h3 className="text-lg font-semibold">Review</h3>
      <p className="mt-2 text-white/70">
        Turn this lesson into flashcards for spaced review, with extra cards on
        the exercises you got wrong. You choose which ones to keep.
      </p>
      <button
        type="button"
        onClick={() => propose.mutate({ id: lessonId })}
        disabled={propose.isPending}
        className="mt-3 flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-60"
      >
        {propose.isPending && <Loader2 className="size-4 animate-spin" />}
        {propose.isPending ? 'Proposing cards…' : 'Make review cards'}
      </button>
      {propose.isError && (
        <p className="mt-2 text-sm text-destructive">{propose.error.message}</p>
      )}

      {proposal && (
        <ReviewCardsDialog
          open
          onClose={() => propose.reset()}
          onConfirm={(cards) =>
            create.mutate({
              id: lessonId,
              model: proposal.model,
              promptVersion: proposal.promptVersion,
              // Typed Recall is the only card type the preview edits
              cards: cards.map((card) => ({ type: 'TYPED_RECALL', ...card })),
            })
          }
          isPending={create.isPending}
          proposals={proposal.cards}
          existingCards={proposal.existingCards}
        />
      )}
    </section>
  );
}

/**
 * Whether a key press should move between steps: a bare ← or →, never while
 * the learner is typing, or in a dialog or menu that has its own use for
 * the arrows.
 */
function isStepKey(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return false;
  if (event.defaultPrevented) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) return true;
  return !(
    target.isContentEditable ||
    target.closest(
      'input, textarea, select, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    )
  );
}

/** Prose keeps a comfortable reading width; examples may use more. */
const STEP_WIDTHS: Record<LessonStep['kind'], string> = {
  section: 'max-w-[70ch]',
  examples: 'max-w-4xl',
  practice: 'max-w-3xl',
  'wrap-up': 'max-w-[70ch]',
};

/** What one step of a written lesson shows. */
function StepContent({
  step,
  lesson,
  version,
  canUseAI,
}: {
  step: LessonStep;
  lesson: Lesson;
  version: LessonVersion;
  canUseAI: boolean;
}) {
  switch (step.kind) {
    case 'section': {
      const block = version.content[step.sectionIndex];
      return (
        <section>
          <h2 className="text-xl font-semibold">{block.heading}</h2>
          {block.paragraphs.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex} className="mt-3 text-white/80">
              {paragraph}
            </p>
          ))}
        </section>
      );
    }
    case 'examples':
      return (
        <section>
          <h2 className="text-xl font-semibold">Examples</h2>
          <ul className="mt-4 space-y-3">
            {version.examples.map((example, index) => (
              <li
                key={index}
                className="rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm"
              >
                <p className="font-medium">{example.example}</p>
                <p className="mt-1 text-sm text-white/70">
                  {example.explanation}
                </p>
              </li>
            ))}
          </ul>
        </section>
      );
    case 'practice':
      return (
        <section>
          <h2 className="text-xl font-semibold">Practice</h2>
          <ol aria-label="Exercises" className="mt-4 space-y-3">
            {version.exercises.map((exercise, index) => (
              <LessonExercise
                // Starting over gives every exercise a fresh start
                key={`${exercise.id}:${lesson.resetAt ?? ''}`}
                exercise={exercise}
                index={index}
                lessonId={lesson.id}
              />
            ))}
          </ol>
          {/* Open Exercises can need AI to check, so the API hides them from
              learners without AI access (ADR-0005) */}
          {version.hiddenExerciseCount > 0 && (
            <p className="mt-3 text-sm text-white/50">
              {version.hiddenExerciseCount === 1
                ? '1 more exercise needs'
                : `${version.hiddenExerciseCount} more exercises need`}{' '}
              AI to check your answers, and your account doesn&apos;t have
              access to AI features.
            </p>
          )}
        </section>
      );
    case 'wrap-up':
      return (
        <section>
          <h2 className="text-xl font-semibold">Wrap up</h2>
          {/* Proposing cards is an AI call */}
          {canUseAI && <MakeReviewCards lessonId={lesson.id} />}
          <LessonCompletion lesson={lesson} />
        </section>
      );
  }
}

/** A written lesson, read one step at a time. */
function WrittenLesson({
  lesson,
  version,
  canUseAI,
}: {
  lesson: Lesson;
  version: LessonVersion;
  canUseAI: boolean;
}) {
  const steps = lessonSteps(version);
  // The step is in the URL, so reloading, going back and links land on it.
  // A step the lesson doesn't have opens the first
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentIndex = currentStepIndex(steps, searchParams);
  const goTo = (step: LessonStep) => navigate(stepSearch(step));
  const current = steps[currentIndex];
  const previous = steps[currentIndex - 1];
  const next = steps[currentIndex + 1];

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isStepKey(event)) return;
    const target = event.key === 'ArrowLeft' ? previous : next;
    if (target) {
      event.preventDefault();
      goTo(target);
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const renderOutline = (onNavigate?: () => void) => (
    <LessonOutline
      steps={steps}
      currentId={current.id}
      answeredCount={
        version.exercises.filter((exercise) => exercise.latestAttempt).length
      }
      exerciseCount={version.exercises.length}
      onNavigate={onNavigate}
    />
  );

  // A new step starts at its top, as a new page would
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [current.id]);

  const outlineToggles = (
    <>
      <button
        type="button"
        onClick={() => setIsOutlineCollapsed(!isOutlineCollapsed)}
        aria-label={isOutlineCollapsed ? 'Show outline' : 'Hide outline'}
        className={`hidden md:block ${ICON_BUTTON}`}
      >
        {isOutlineCollapsed ? (
          <PanelLeftOpen className="size-5" />
        ) : (
          <PanelLeftClose className="size-5" />
        )}
      </button>
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetTrigger
          aria-label="Open outline"
          className={`md:hidden ${ICON_BUTTON}`}
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent className="border-r border-white/20 bg-[oklch(0.25_0.08_230)] text-white">
          <SheetTitle>Lesson outline</SheetTitle>
          <SheetDescription className="sr-only">
            The steps of {lesson.title}
          </SheetDescription>
          {renderOutline(() => setIsDrawerOpen(false))}
        </SheetContent>
      </Sheet>
    </>
  );

  return (
    <LessonFrame
      header={<WrittenLessonHeader lesson={lesson} leading={outlineToggles} />}
      outline={isOutlineCollapsed ? undefined : renderOutline()}
    >
      <div className={`mx-auto w-full ${STEP_WIDTHS[current.kind]}`}>
        <StepContent
          step={current}
          lesson={lesson}
          version={version}
          canUseAI={canUseAI}
        />
        <nav
          aria-label="Lesson steps"
          className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/20 pt-6"
        >
          {previous ? (
            <button
              type="button"
              onClick={() => goTo(previous)}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-white/70 hover:text-white"
            >
              <ChevronLeft className="size-4" />
              Previous: {previous.title}
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button
              type="button"
              onClick={() => goTo(next)}
              className="flex items-center gap-1 rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30"
            >
              Next: {next.title}
              <ChevronRight className="size-4" />
            </button>
          )}
        </nav>
      </div>
    </LessonFrame>
  );
}

export default function LessonPage() {
  const { lessonId = '' } = useParams<{ lessonId: string }>();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const lessonQuery = trpc.lesson.getById.useQuery(
    { id: lessonId },
    // While another open writes the lesson, check back until it's done
    {
      refetchInterval: (query) =>
        query.state.data?.generating ? GENERATING_POLL_MS : false,
    },
  );

  // A lesson is written the first time it's opened. The ref asks once per
  // lesson, so a re-run effect (StrictMode) never pays for a second call.
  const requestedFor = useRef<string | null>(null);

  const generate = trpc.lesson.generate.useMutation({
    onSuccess: async (data) => {
      // A refetch still in flight would put back the lesson without content
      await utils.lesson.getById.cancel({ id: lessonId });
      utils.lesson.getById.setData({ id: lessonId }, data);
    },
    onError: (error) => {
      // Another open got there first: wait for it, and take over if it fails
      if (error.data?.code === 'CONFLICT') {
        requestedFor.current = null;
        utils.lesson.getById.invalidate({ id: lessonId });
      }
    },
  });
  const { mutate: generateLesson } = generate;

  const lesson = lessonQuery.data;
  const canUseAI = Boolean(me.data?.user?.canUseAI);
  const needsGenerating =
    lesson !== undefined && lesson.version === null && !lesson.generating;

  useEffect(() => {
    if (needsGenerating && canUseAI && requestedFor.current !== lessonId) {
      requestedFor.current = lessonId;
      generateLesson({ id: lessonId });
    }
  }, [needsGenerating, canUseAI, lessonId, generateLesson]);

  if (lessonQuery.isLoading) {
    return <CourseSkeleton />;
  }

  if (lessonQuery.isError || !lesson) {
    const notFound = lessonQuery.error?.data?.code === 'NOT_FOUND';
    return (
      <CenteredPage centered>
        <p className="text-destructive">
          {notFound ? 'Lesson not found.' : 'Error loading lesson.'}
        </p>
      </CenteredPage>
    );
  }

  if (lesson.version) {
    return (
      <WrittenLesson
        lesson={lesson}
        version={lesson.version}
        canUseAI={canUseAI}
      />
    );
  }

  const waitingForOtherOpen =
    lesson.generating ||
    (generate.error?.data?.code === 'CONFLICT' && lessonQuery.isFetching);

  // Until we know whether the learner can use AI, the lesson is on its way
  if (!canUseAI && !me.isLoading && !waitingForOtherOpen) {
    return (
      <NotWrittenYet lesson={lesson}>
        This lesson hasn&apos;t been written yet, and writing it needs AI
        access, which your account doesn&apos;t have.
      </NotWrittenYet>
    );
  }

  if (generate.isError && !waitingForOtherOpen) {
    // The monthly AI spending cap was reached: AI is paused, not broken
    if (generate.error?.data?.code === 'TOO_MANY_REQUESTS') {
      return (
        <NotWrittenYet lesson={lesson}>{generate.error.message}</NotWrittenYet>
      );
    }

    return (
      <NotWrittenYet lesson={lesson}>
        <p>We couldn&apos;t write this lesson. {generate.error?.message}</p>
        <button
          type="button"
          onClick={() => generateLesson({ id: lessonId })}
          className="mt-4 rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30"
        >
          Try again
        </button>
      </NotWrittenYet>
    );
  }

  return (
    <NotWrittenYet lesson={lesson}>
      <div
        role="status"
        aria-label="Writing your lesson"
        className="flex items-center gap-2"
      >
        <Loader2 className="size-4 animate-spin" />
        Writing your lesson. This takes a little while the first time.
      </div>
    </NotWrittenYet>
  );
}
