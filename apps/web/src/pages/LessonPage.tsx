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
  PanelRight,
} from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { useStoredChoice, useStoredFlag } from '@/hooks/useStoredChoice';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  useStoredPagingView,
  useStoredPracticeToggles,
  type PracticeToggles,
} from '@/hooks/useStoredLessonSettings';
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
import { ItemCount } from '@/components/ItemCount';
import { LessonFrame } from '@/components/LessonFrame';
import { PinnedHeader } from '@/components/PinnedHeader';
import { LessonOutline } from '@/components/LessonOutline';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  CompletionMenuItem,
  CompletionToggle,
  LessonCompletion,
} from '@/components/LessonCompletion';
import { LessonWrapUp } from '@/components/LessonWrapUp';
import { TutorPanel } from '@/components/TutorPanel';
import {
  adjacentSteps,
  currentStepIndex,
  isReadingStep,
  lessonSteps,
  stepSearch,
  type LessonStep,
  READING_VIEWS,
  currentExerciseId,
  namedExerciseIndex,
  exerciseElementId,
  exerciseSearch,
  namedExampleIndex,
  exampleSearch,
  pagingViews,
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
  /**
   * Kept out of the header, in the ⋯ menu at every width, so the header
   * shows only the view of what's on screen.
   */
  menuOnly?: boolean;
}

function viewChoice<T extends string>(
  label: string,
  options: readonly { value: T; label: string }[],
  value: T,
  onChange: (value: T) => void,
  { menuOnly = false } = {},
): ViewChoice {
  // Only the options' values are ever passed back
  return {
    label,
    options,
    value,
    onChange: (v) => onChange(v as T),
    menuOnly,
  };
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

/**
 * An on-or-off setting as a switch, for settings that don't depend on each
 * other, unlike the options of a view.
 */
function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-white/80 hover:text-white"
    >
      <span
        aria-hidden
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-white/80' : 'bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-3 rounded-full transition-transform ${
            checked ? 'translate-x-3 bg-[oklch(0.3_0.1_228)]' : 'bg-white/80'
          }`}
        />
      </span>
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
  tutorToggle,
  views,
  practiceToggles,
}: {
  lesson: Lesson;
  /** Controls before the title, such as the outline's toggles. */
  leading?: ReactNode;
  /** Opens and closes the tutor, at the far right, for learners who can use AI. */
  tutorToggle?: ReactNode;
  /** The step's views, if it can be shown more than one way. */
  views: ViewChoice[];
  /** Practice's toggles; left out on steps other than Practice. */
  practiceToggles?: PracticeToggles;
}) {
  const [isStartingOver, setIsStartingOver] = useState(false);

  return (
    <>
      <PinnedHeader
        back={{
          to: `/courses/${lesson.course.id}`,
          label: lesson.course.title,
        }}
        title={lesson.title}
        leading={leading}
      >
        {views
          .filter((view) => !view.menuOnly)
          .map((view) => (
            <ViewControl
              key={view.label}
              choice={view}
              className="hidden md:inline-flex"
            />
          ))}
        {practiceToggles && (
          <div
            role="group"
            // The switches' own labels say what they show; the group's name
            // gives screen readers the same context
            aria-label="Show"
            className="mx-2 hidden shrink-0 items-center lg:flex"
          >
            <Switch
              checked={practiceToggles.showMyAnswers}
              onChange={practiceToggles.setShowMyAnswers}
            >
              My answers
            </Switch>
            <Switch
              checked={practiceToggles.showAnswerKey}
              onChange={practiceToggles.setShowAnswerKey}
            >
              Answer key
            </Switch>
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
            {/* The header has no room for the toggle on narrow screens */}
            <div className="sm:hidden">
              <CompletionMenuItem lesson={lesson} className={MENU_ITEM} />
              <DropdownMenuSeparator />
            </div>
            {views.map((view) => (
              <div
                key={view.label}
                className={view.menuOnly ? undefined : 'md:hidden'}
              >
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
            ))}
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
        {tutorToggle}
      </PinnedHeader>
      <StartOverDialog
        lesson={lesson}
        open={isStartingOver}
        onOpenChange={setIsStartingOver}
      />
    </>
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

/**
 * The lesson's examples: one at a time like a textbook's, set off by a
 * rule with its explanation beneath, or all of them as a table, each
 * beside its explanation.
 */
function ExamplesContent({
  examples,
  id,
  shownIndex,
}: {
  examples: LessonVersion['examples'];
  id?: string;
  /** The one example shown, one at a time; left out to show them all. */
  shownIndex?: number;
}) {
  if (shownIndex === undefined) {
    return (
      <section id={id} className="scroll-mt-28">
        <h2 className="text-xl font-semibold">Examples</h2>
        <dl className="mt-4 divide-y divide-white/10 border-y border-white/10">
          {examples.map(({ example, explanation }, index) => (
            <div
              key={index}
              className="gap-6 py-3 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            >
              <dt className="font-medium">{example}</dt>
              <dd className="mt-1 text-sm text-white/70 sm:mt-0">
                {explanation}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }
  const { example, explanation } = examples[shownIndex];
  return (
    <section id={id} className="scroll-mt-28">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">Examples</h2>
        <ItemCount noun="Example" index={shownIndex} count={examples.length} />
      </div>
      <p className="mt-6 border-l-2 border-white/50 pl-4 text-2xl font-medium break-words">
        {example}
      </p>
      <p className="mt-4 max-w-[70ch] text-white/80">{explanation}</p>
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
  exampleIndex,
}: {
  step: LessonStep;
  lesson: Lesson;
  version: LessonVersion;
  canUseAI: boolean;
  practice: PracticeSettings;
  /** The example shown one at a time; left out to show them all. */
  exampleIndex?: number;
}) {
  switch (step.kind) {
    case 'section':
      return <SectionContent block={version.content[step.sectionIndex]} />;
    case 'examples':
      return (
        <ExamplesContent
          examples={version.examples}
          shownIndex={exampleIndex}
        />
      );
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

/**
 * A step whose items are shown one at a time: which item is on screen, of
 * how many, and the query string that opens each.
 */
interface Paging {
  noun: 'example' | 'exercise';
  index: number;
  count: number;
  /** Whether the URL names the item, rather than leaving the first implied. */
  named: boolean;
  search: (index: number) => string;
}

/**
 * Where Previous or Next goes: a step, or another item of the step shown
 * one at a time. A step reached going back opens at its end, its last item
 * when it's shown one at a time, as a stack of cards would.
 */
type Target =
  | { step: LessonStep; atEnd: boolean }
  | { itemIndex: number; noun: Paging['noun'] };

function targetLabel(direction: 'Previous' | 'Next', target: Target) {
  return 'step' in target
    ? `${direction}: ${target.step.title}`
    : `${direction} ${target.noun}`;
}

/**
 * A footer button: to a step, its direction above the step's title, which
 * wraps within the button's half of the footer; to an item, one line, below
 * an empty line where the direction would be, so the two buttons' main
 * text lines up. The arrow lines up with the main text's first line.
 */
function TargetButton({
  direction,
  target,
  onClick,
  alone,
}: {
  direction: 'Previous' | 'Next';
  target: Target;
  onClick: () => void;
  /** The footer's only button, which may take its whole width. */
  alone: boolean;
}) {
  const toStep = 'step' in target;
  const Arrow = direction === 'Previous' ? ChevronLeft : ChevronRight;
  const arrow = (
    // As tall as a line of the main text, below the direction's line
    <span className="mt-4 flex h-6 shrink-0 items-center">
      <Arrow className="size-4" />
    </span>
  );
  return (
    <button
      type="button"
      aria-label={targetLabel(direction, target)}
      onClick={onClick}
      className={`flex items-start gap-1 rounded-lg px-3 py-2 text-white/70 hover:text-white ${
        direction === 'Previous'
          ? 'justify-self-start text-left'
          : 'justify-self-end text-right'
      } ${
        // Alone, the whole footer, room for a long title on a phone
        alone ? 'col-span-2' : direction === 'Next' ? 'col-start-2' : ''
      }`}
    >
      {direction === 'Previous' && arrow}
      <span className="min-w-0">
        <span className="block h-4 text-xs opacity-70">
          {toStep && direction}
        </span>
        <span className="block">
          {toStep ? target.step.title : targetLabel(direction, target)}
        </span>
      </span>
      {direction === 'Next' && arrow}
    </button>
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
  const goTo = (step: LessonStep, atEnd = false) => {
    navigatingTo.current = step.id;
    navigate((atEnd && lastItemSearch(step)) || stepSearch(step));
  };
  const [readingView, setReadingView] = useStoredChoice<ReadingView>(
    'study-hall:lesson-reading-view',
    READING_VIEWS.map((view) => view.value),
    'by-section',
  );
  const isFullPage = readingView === 'full' && isReadingStep(current);
  const { previous, next } = adjacentSteps(steps, currentIndex, readingView);

  const [pagingView, setPagingView] = useStoredPagingView();
  const practiceToggles = useStoredPracticeToggles();
  const exerciseIds = version.exercises.map((exercise) => exercise.id);
  const exampleCount = version.examples.length;
  // The item the URL names, if any it has; one it lacks opens the first
  const namedExercise = namedExerciseIndex(exerciseIds, searchParams);
  const exerciseIndex = namedExercise ?? 0;
  const namedExample = namedExampleIndex(exampleCount, searchParams);

  // The step on screen, when its items are shown one at a time. In Full
  // lesson, Examples are part of the one page, so all are shown
  const paging: Paging | null =
    pagingView !== 'one' || isFullPage
      ? null
      : current.kind === 'practice' && exerciseIds.length > 0
        ? {
            noun: 'exercise',
            index: exerciseIndex,
            count: exerciseIds.length,
            named: namedExercise !== null,
            search: (index) => exerciseSearch(exerciseIds[index]),
          }
        : current.kind === 'examples' && exampleCount > 0
          ? {
              noun: 'example',
              index: namedExample ?? 0,
              count: exampleCount,
              named: namedExample !== null,
              search: exampleSearch,
            }
          : null;
  // A step's last item, for arriving at it going back, when it's shown one
  // at a time; null when it isn't
  function lastItemSearch(step: LessonStep) {
    if (pagingView !== 'one') return null;
    if (step.kind === 'practice' && exerciseIds.length > 0) {
      return exerciseSearch(exerciseIds[exerciseIds.length - 1]);
    }
    if (step.kind === 'examples' && readingView !== 'full' && exampleCount) {
      return exampleSearch(exampleCount - 1);
    }
    return null;
  }
  const moveToItem = (index: number) => {
    navigatingTo.current = current.id;
    if (paging) navigate(paging.search(index));
  };
  // One at a time, the item on screen is always in the URL, so the tutor
  // (#24) knows the exercise: the first is written on arriving, or in place
  // of one the step lacks. Replacing keeps it to one history entry. Moving
  // between two paged steps keeps namesNoItem true, so the step is a
  // dependency too
  const namesNoItem = paging !== null && !paging.named;
  const nameFirstItem = useEffectEvent(() => {
    if (paging) navigate(paging.search(0), { replace: true });
  });
  useEffect(() => {
    if (namesNoItem) nameFirstItem();
  }, [namesNoItem, current.id]);

  const practice: PracticeSettings = {
    view: pagingView,
    showMyAnswers: practiceToggles.showMyAnswers,
    showAnswerKey: practiceToggles.showAnswerKey,
    exerciseIndex,
  };

  // Where the footer's buttons and the arrow keys go. One at a time, they
  // walk the step's items, and only past the first or last reach the steps
  // either side
  const back: Target | undefined =
    paging && paging.index > 0
      ? { itemIndex: paging.index - 1, noun: paging.noun }
      : previous && { step: previous, atEnd: true };
  const forward: Target | undefined =
    paging && paging.index < paging.count - 1
      ? { itemIndex: paging.index + 1, noun: paging.noun }
      : next && { step: next, atEnd: false };
  const goToTarget = (target: Target) => {
    if ('step' in target) goTo(target.step, target.atEnd);
    else moveToItem(target.itemIndex);
  };

  // Moving on from the outline or with the keys takes focus to the new
  // step's heading, so none is left on the link that was clicked (the
  // browser shows its ring once a key is pressed), and screen readers say
  // where the learner is. The footer's buttons keep focus, so Enter keeps
  // moving on
  const stepRef = useRef<HTMLDivElement>(null);
  const focusOnArrival = useRef(false);
  const focusStepHeading = () => {
    const heading = (
      isFullPage
        ? document.getElementById(sectionElementId(current))
        : stepRef.current
    )?.querySelector('h2');
    if (!heading) return;
    // Focusable by script only, and with no ring: it isn't a control
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  };
  const takeFocusOnArrival = useEffectEvent(() => {
    if (!focusOnArrival.current) return;
    focusOnArrival.current = false;
    focusStepHeading();
  });
  useEffect(() => {
    takeFocusOnArrival();
  }, [current.id, paging?.index]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!isStepKey(event)) return;
    const target = event.key === 'ArrowLeft' ? back : forward;
    if (target) {
      event.preventDefault();
      focusOnArrival.current = true;
      goToTarget(target);
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const choseInDrawer = useRef(false);
  /** The outline, beside the step or, `inDrawer`, in the drawer. */
  const renderOutline = (inDrawer = false) => (
    <LessonOutline
      steps={steps}
      currentId={current.id}
      answeredCount={
        version.exercises.filter((exercise) => exercise.latestAttempt).length
      }
      exerciseCount={version.exercises.length}
      onNavigate={(step) => {
        navigatingTo.current = step.id;
        // The step already shown doesn't change, so it would leave the flag
        // for a later move, such as a footer click
        focusOnArrival.current = step.id !== current.id;
        if (inDrawer) {
          choseInDrawer.current = true;
          setIsDrawerOpen(false);
        }
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

  // The tutor's state lives here, in the frame, so moving between steps
  // never resets it. Where there's room it sits beside the lesson, open to
  // start and remembered by the browser; otherwise it's a drawer, closed
  // until asked for so it doesn't cover the lesson
  const tutorBeside = useMediaQuery('(min-width: 1024px)');
  const [isTutorBesideOpen, setIsTutorBesideOpen] = useStoredFlag(
    'study-hall:tutor-open',
    true,
  );
  const [isTutorDrawerOpen, setIsTutorDrawerOpen] = useState(false);
  const isTutorOpen = tutorBeside ? isTutorBesideOpen : isTutorDrawerOpen;
  const tutorToggle = canUseAI && (
    <button
      type="button"
      aria-label="Tutor"
      aria-pressed={isTutorOpen}
      title={isTutorOpen ? 'Hide the tutor' : 'Show the tutor'}
      onClick={() =>
        tutorBeside
          ? setIsTutorBesideOpen(!isTutorBesideOpen)
          : setIsTutorDrawerOpen(!isTutorDrawerOpen)
      }
      className={`shrink-0 ${ICON_BUTTON} ${isTutorOpen ? 'bg-white/15 text-white' : ''}`}
    >
      <PanelRight className="size-5" />
    </button>
  );
  const tutorDrawer = canUseAI && !tutorBeside && (
    <Sheet open={isTutorDrawerOpen} onOpenChange={setIsTutorDrawerOpen}>
      <SheetContent
        side="right"
        className="w-96 max-w-[90vw] border-l border-white/20 bg-[oklch(0.25_0.08_230)] text-white"
      >
        <SheetTitle className="sr-only">Tutor</SheetTitle>
        <SheetDescription className="sr-only">
          Ask about {lesson.title}
        </SheetDescription>
        <TutorPanel lessonId={lesson.id} />
      </SheetContent>
    </Sheet>
  );
  const tutorPanel = canUseAI && tutorBeside && (
    <TutorPanel lessonId={lesson.id} />
  );

  const outlineToggles = (
    <>
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetTrigger
          aria-label="Open outline"
          // With the tutor beside the lesson, the outline is a drawer until
          // the screen has room for both
          className={`${tutorPanel && isTutorOpen ? 'xl:hidden' : 'md:hidden'} ${ICON_BUTTON}`}
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent
          className="border-r border-white/20 bg-[oklch(0.25_0.08_230)] text-white"
          // The drawer holds focus until it has closed, so a step chosen in
          // it takes focus to its heading then, not back to the menu button
          onCloseAutoFocus={(event) => {
            if (!choseInDrawer.current) return;
            choseInDrawer.current = false;
            event.preventDefault();
            focusStepHeading();
          }}
        >
          <SheetTitle>Lesson outline</SheetTitle>
          <SheetDescription className="sr-only">
            The steps of {lesson.title}
          </SheetDescription>
          {renderOutline(true)}
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
          tutorToggle={tutorToggle}
          views={[
            ...(isReadingStep(current)
              ? [
                  // The Examples step shows its own view; the reading view
                  // stays reachable in the ⋯ menu
                  viewChoice(
                    'Reading view',
                    READING_VIEWS,
                    readingView,
                    setReadingView,
                    { menuOnly: current.kind === 'examples' && !isFullPage },
                  ),
                ]
              : []),
            // In Full lesson the examples are all on the one page
            ...(current.kind === 'examples' && !isFullPage
              ? [
                  viewChoice(
                    'Examples view',
                    pagingViews('examples'),
                    pagingView,
                    setPagingView,
                  ),
                ]
              : []),
            ...(current.kind === 'practice'
              ? [
                  viewChoice(
                    'Practice view',
                    pagingViews('exercises'),
                    pagingView,
                    setPagingView,
                  ),
                ]
              : []),
          ]}
          practiceToggles={
            current.kind === 'practice' ? practiceToggles : undefined
          }
        />
      }
      outline={renderOutline()}
      tutor={tutorPanel || undefined}
      tutorOpen={isTutorOpen}
    >
      {tutorDrawer}
      {/* Beside the outline */}
      <div
        ref={stepRef}
        // At least as tall as the frame, so a short step's footer rests at
        // the bottom of the screen, staying put while paging through items
        className={`flex w-full flex-1 flex-col [&_h2:focus]:outline-none ${isFullPage ? 'max-w-4xl' : STEP_WIDTHS[current.kind]}`}
      >
        <div className="flex-1">
          {isFullPage ? (
            <FullLesson steps={steps} version={version} />
          ) : (
            <StepContent
              step={current}
              lesson={lesson}
              version={version}
              canUseAI={canUseAI}
              practice={practice}
              exampleIndex={
                paging?.noun === 'example' ? paging.index : undefined
              }
            />
          )}
        </div>
        {/* Two halves, so long titles wrap within them rather than
            stacking the buttons, and a row tall enough for a two-line
            button, so paging between steps and items doesn't move it. The
            buttons' tops line up */}
        <nav
          aria-label="Lesson steps"
          className="mt-10 grid auto-rows-[minmax(3.5rem,auto)] grid-cols-2 items-start gap-3 border-t border-white/20 pt-6"
        >
          {back && (
            <TargetButton
              direction="Previous"
              target={back}
              onClick={() => goToTarget(back)}
              alone={!forward}
            />
          )}
          {forward && (
            <TargetButton
              direction="Next"
              target={forward}
              onClick={() => goToTarget(forward)}
              alone={!back}
            />
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
