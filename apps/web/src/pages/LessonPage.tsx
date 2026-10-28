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
import { useStoredChoice } from '@/hooks/useStoredChoice';
import {
  useStoredPracticeSettings,
  type StoredPracticeSettings,
} from '@/hooks/useStoredPracticeSettings';
import { BackLink } from '@/components/BackLink';
import { CenteredPage } from '@/components/CenteredPage';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CourseSkeleton } from '@/components/PageSkeleton';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  LessonPractice,
  type PracticeSettings,
} from '@/components/LessonPractice';
import { LESSON_FRAME_WIDTH, LessonFrame } from '@/components/LessonFrame';
import { LessonOutline } from '@/components/LessonOutline';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  CompletionToggle,
  LessonCompletion,
} from '@/components/LessonCompletion';
import { LessonWrapUp } from '@/components/LessonWrapUp';
import {
  adjacentSteps,
  currentStepIndex,
  isReadingStep,
  lessonSteps,
  stepSearch,
  type LessonStep,
  READING_VIEWS,
  currentExerciseId,
  currentExerciseIndex,
  exerciseElementId,
  exerciseSearch,
  PRACTICE_VIEWS,
  type ReadingView,
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
 * A choice between a few ways of showing a step, such as the reading view
 * on the reading steps or Practice's view. Built with `viewChoice`, which
 * keeps the options and the setter's type in step.
 */
interface ViewChoice {
  /** What the choice is called, such as "Reading view". */
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}

function viewChoice<T extends string>(
  label: string,
  options: readonly { value: T; label: string }[],
  value: T,
  onChange: (value: T) => void,
): ViewChoice {
  // Only the options' values are ever passed back
  return { label, options, value, onChange: (v) => onChange(v as T) };
}

/** A pressed-or-not button, for a setting that's on or off. */
function ToggleButton({
  pressed,
  onChange,
  children,
}: {
  pressed: boolean;
  onChange: (pressed: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={`rounded-md px-3 py-1 ${
        pressed ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

const MENU_ITEM = 'focus:bg-white/10 focus:text-white';

/**
 * The written lesson's header, pinned to the top: the way back to the
 * course, the title, the step's view (the reading view on the reading
 * steps, Practice's on Practice), Practice's toggles, Lesson Completion and
 * a ⋯ menu of rarely used actions. Where the header has no room, on
 * narrower screens, the view and toggles move into the ⋯ menu.
 */
function WrittenLessonHeader({
  lesson,
  leading,
  view,
  practiceToggles,
}: {
  lesson: Lesson;
  /** Controls before the title, such as the outline's toggles. */
  leading?: ReactNode;
  /** Left out on a step with only one way of showing it. */
  view?: ViewChoice;
  /** Practice's toggles; left out on steps other than Practice. */
  practiceToggles?: StoredPracticeSettings;
}) {
  const [isStartingOver, setIsStartingOver] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-white/15 bg-[oklch(0.3_0.1_228)]/90 py-3 backdrop-blur-md">
      <div className={`flex items-center gap-3 ${LESSON_FRAME_WIDTH}`}>
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
        {view && (
          <ViewControl choice={view} className="hidden md:inline-flex" />
        )}
        {practiceToggles && (
          <div
            role="group"
            aria-label="Show"
            className={`hidden lg:inline-flex ${SEGMENTED}`}
          >
            <ToggleButton
              pressed={practiceToggles.showMyAnswers}
              onChange={practiceToggles.setShowMyAnswers}
            >
              My answers
            </ToggleButton>
            <ToggleButton
              pressed={practiceToggles.showAnswerKey}
              onChange={practiceToggles.setShowAnswerKey}
            >
              Answer key
            </ToggleButton>
          </div>
        )}
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
            {view && (
              <div className="md:hidden">
                <DropdownMenuLabel>{view.label}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={view.value}
                  onValueChange={view.onChange}
                >
                  {view.options.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                      className={MENU_ITEM}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </div>
            )}
            {practiceToggles && (
              <div className="lg:hidden">
                <DropdownMenuCheckboxItem
                  checked={practiceToggles.showMyAnswers}
                  onCheckedChange={practiceToggles.setShowMyAnswers}
                  className={MENU_ITEM}
                >
                  Show my answers
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={practiceToggles.showAnswerKey}
                  onCheckedChange={practiceToggles.setShowAnswerKey}
                  className={MENU_ITEM}
                >
                  Show answer key
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
              </div>
            )}
            <DropdownMenuItem
              onSelect={() => setIsStartingOver(true)}
              className={MENU_ITEM}
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

/** One content section of a lesson, at a comfortable reading width. */
function SectionContent({
  block,
  id,
}: {
  block: LessonVersion['content'][number];
  id?: string;
}) {
  return (
    <section id={id} className="max-w-[70ch] scroll-mt-28">
      <h2 className="text-xl font-semibold">{block.heading}</h2>
      {block.paragraphs.map((paragraph, paragraphIndex) => (
        <p key={paragraphIndex} className="mt-3 text-white/80">
          {paragraph}
        </p>
      ))}
    </section>
  );
}

function ExamplesContent({
  examples,
  id,
}: {
  examples: LessonVersion['examples'];
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="text-xl font-semibold">Examples</h2>
      <ul className="mt-4 space-y-3">
        {examples.map((example, index) => (
          <li
            key={index}
            className="rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm"
          >
            <p className="font-medium">{example.example}</p>
            <p className="mt-1 text-sm text-white/70">{example.explanation}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The look of the header's segmented controls. */
const SEGMENTED =
  'shrink-0 rounded-lg border border-white/20 bg-white/5 p-0.5 text-sm';

/** A view choice as a segmented control, one button per option. */
function ViewControl({
  choice,
  className = '',
}: {
  choice: ViewChoice;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={choice.label}
      className={`${SEGMENTED} ${className}`}
    >
      {choice.options.map((option) => (
        <ToggleButton
          key={option.value}
          pressed={choice.value === option.value}
          onChange={() => choice.onChange(option.value)}
        >
          {option.label}
        </ToggleButton>
      ))}
    </div>
  );
}

/**
 * Full lesson: every content section and the Examples on one page, so the
 * browser's find works across the lesson.
 */
function FullLesson({
  steps,
  version,
}: {
  steps: LessonStep[];
  version: LessonVersion;
}) {
  return (
    <div className="space-y-12">
      {steps.map((step) => {
        const id = sectionElementId(step);
        if (step.kind === 'section') {
          return (
            <SectionContent
              key={step.id}
              id={id}
              block={version.content[step.sectionIndex]}
            />
          );
        }
        if (step.kind === 'examples') {
          return (
            <ExamplesContent
              key={step.id}
              id={id}
              examples={version.examples}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

/** What one step of a written lesson shows. */
function StepContent({
  step,
  lesson,
  version,
  canUseAI,
  practice,
}: {
  step: LessonStep;
  lesson: Lesson;
  version: LessonVersion;
  canUseAI: boolean;
  practice: PracticeSettings;
}) {
  switch (step.kind) {
    case 'section':
      return <SectionContent block={version.content[step.sectionIndex]} />;
    case 'examples':
      return <ExamplesContent examples={version.examples} />;
    case 'practice':
      return (
        <LessonPractice lesson={lesson} version={version} settings={practice} />
      );
    case 'wrap-up':
      return (
        <LessonWrapUp lesson={lesson} version={version} canUseAI={canUseAI} />
      );
  }
}

/** Where a reading step sits on the Full lesson page. */
const sectionElementId = (step: LessonStep) => `step-${step.id}`;

/**
 * How far below the top of the viewport a section's top must be, at most,
 * for it to be the one being read: just under the pinned header, where
 * scrolling to a section puts it.
 */
const READING_LINE_PX = 150;

/** How near the end of the page counts as at its end, for rounding. */
const PAGE_END_SLACK_PX = 2;

/**
 * The section being read on the Full lesson page: the last whose top has
 * passed the reading line, or the last of all once the page is scrolled to
 * its end, since a short last section may never reach the line.
 */
function sectionBeingRead(readingSteps: LessonStep[]) {
  const page = document.documentElement;
  const scrollable = page.scrollHeight > window.innerHeight;
  if (
    scrollable &&
    window.innerHeight + window.scrollY >= page.scrollHeight - PAGE_END_SLACK_PX
  ) {
    return readingSteps[readingSteps.length - 1];
  }
  return (
    readingSteps.findLast(
      (step) =>
        (document
          .getElementById(sectionElementId(step))
          ?.getBoundingClientRect().top ?? Infinity) <= READING_LINE_PX,
    ) ?? readingSteps[0]
  );
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
  const current = steps[currentIndex];
  // The step last navigated to, ahead of the render that shows it, so a
  // scroll in between can't take the learner back to where they were
  const navigatingTo = useRef(current.id);
  useEffect(() => {
    navigatingTo.current = current.id;
  }, [current.id]);
  // Scrolling to a section on the Full lesson page. A late section may only
  // scroll as far as the page's end, so the jump's own scroll is left alone
  // rather than taken as the learner reading the last section
  const jumping = useRef(false);
  const jumpTo = (step: LessonStep) => {
    jumping.current = true;
    document.getElementById(sectionElementId(step))?.scrollIntoView();
    // A frame's scroll events come before its animation frames, so this
    // only clears the mark when the jump didn't move the page at all
    requestAnimationFrame(() => {
      jumping.current = false;
    });
  };
  const goTo = (step: LessonStep) => {
    navigatingTo.current = step.id;
    navigate(stepSearch(step));
  };
  const [readingView, setReadingView] = useStoredChoice<ReadingView>(
    'study-hall:lesson-reading-view',
    READING_VIEWS.map((view) => view.value),
    'by-section',
  );
  const isFullPage = readingView === 'full' && isReadingStep(current);
  const { previous, next } = adjacentSteps(steps, currentIndex, readingView);

  const practiceSettings = useStoredPracticeSettings();
  const exerciseIds = version.exercises.map((exercise) => exercise.id);
  const exerciseIndex = currentExerciseIndex(exerciseIds, searchParams);
  const isPagingExercises =
    current.kind === 'practice' &&
    practiceSettings.view === 'one' &&
    exerciseIds.length > 0;
  const moveToExercise = (index: number) => {
    navigatingTo.current = current.id;
    navigate(exerciseSearch(exerciseIds[index]));
  };
  // One at a time, the exercise on screen is always in the URL, for the
  // tutor (#24); replacing keeps arriving to one history entry
  const namesNoExercise =
    isPagingExercises && currentExerciseId(searchParams) === null;
  const nameFirstExercise = useEffectEvent(() => {
    navigate(exerciseSearch(exerciseIds[0]), { replace: true });
  });
  useEffect(() => {
    if (namesNoExercise) nameFirstExercise();
  }, [namesNoExercise]);

  const practice: PracticeSettings = {
    view: practiceSettings.view,
    showMyAnswers: practiceSettings.showMyAnswers,
    showAnswerKey: practiceSettings.showAnswerKey,
    exerciseIndex,
    onMoveExercise: moveToExercise,
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isStepKey(event)) return;
    // One at a time, the keys page through the exercises, then on past them
    if (isPagingExercises) {
      const targetIndex = exerciseIndex + (event.key === 'ArrowLeft' ? -1 : 1);
      if (targetIndex >= 0 && targetIndex < exerciseIds.length) {
        event.preventDefault();
        moveToExercise(targetIndex);
        return;
      }
    }
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
      onNavigate={(step) => {
        navigatingTo.current = step.id;
        onNavigate?.();
        // Full lesson is one page, so a section in it is a place to scroll to
        if (isFullPage && isReadingStep(step)) jumpTo(step);
      }}
    />
  );

  // A new page starts at its top, except that Full lesson opens at the
  // section in the URL, so switching views, going back and reloading keep
  // the learner's place
  const pageKey = isFullPage ? 'full-lesson' : current.id;
  const scrollToPlace = useEffectEvent(() => {
    const exerciseId = currentExerciseId(searchParams);
    if (isFullPage && current !== steps.find(isReadingStep)) {
      jumpTo(current);
    } else if (current.kind === 'practice' && exerciseId) {
      // Such as a missed exercise linked from Wrap up
      document.getElementById(exerciseElementId(exerciseId))?.scrollIntoView();
    } else {
      window.scrollTo({ top: 0 });
    }
  });
  useEffect(() => {
    scrollToPlace();
  }, [pageKey]);

  // In Full lesson the URL follows the section being read. Replacing rather
  // than pushing keeps scrolling out of the browser's history
  const followReading = useEffectEvent(() => {
    if (jumping.current) {
      jumping.current = false;
      return;
    }
    const target = steps.find((step) => step.id === navigatingTo.current);
    // On its way to Practice or Wrap up, the learner has left the page
    if (!target || !isReadingStep(target)) return;
    const reading = sectionBeingRead(steps.filter(isReadingStep));
    if (reading.id !== target.id) {
      navigatingTo.current = reading.id;
      navigate(stepSearch(reading), { replace: true });
    }
  });
  useEffect(() => {
    if (!isFullPage) return;
    window.addEventListener('scroll', followReading, { passive: true });
    return () => window.removeEventListener('scroll', followReading);
  }, [isFullPage]);

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
      header={
        <WrittenLessonHeader
          lesson={lesson}
          leading={outlineToggles}
          view={
            isReadingStep(current)
              ? viewChoice(
                  'Reading view',
                  READING_VIEWS,
                  readingView,
                  setReadingView,
                )
              : current.kind === 'practice'
                ? viewChoice(
                    'Practice view',
                    PRACTICE_VIEWS,
                    practiceSettings.view,
                    practiceSettings.setView,
                  )
                : undefined
          }
          practiceToggles={
            current.kind === 'practice' ? practiceSettings : undefined
          }
        />
      }
      outline={isOutlineCollapsed ? undefined : renderOutline()}
    >
      {/* Beside the outline while it's open; centred once it's collapsed */}
      <div
        className={`w-full ${isFullPage ? 'max-w-4xl' : STEP_WIDTHS[current.kind]} ${isOutlineCollapsed ? 'mx-auto' : ''}`}
      >
        {isFullPage ? (
          <FullLesson steps={steps} version={version} />
        ) : (
          <StepContent
            step={current}
            lesson={lesson}
            version={version}
            canUseAI={canUseAI}
            practice={practice}
          />
        )}
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
        // Continue opens another lesson, which starts afresh
        key={lesson.id}
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
