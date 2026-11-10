import { type ReactNode } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { CenteredPage } from '@/components/CenteredPage';
import { Carousel, CarouselItem } from '@/components/Carousel';
import { CourseProgress, CourseTile } from '@/components/CourseTile';
import { DeckCard } from '@/components/DeckCard';
import { DeckTile } from '@/components/DeckTile';
import { NewTileFace } from '@/components/NewTile';
import { HomeSkeleton } from '@/components/PageSkeleton';
import { Tile } from '@/components/Tile';
import { deadlineLine, formatCalendarDay, formatDueTime } from '@/lib/format';
import { FULL_WIDTH_GUTTER } from '@/lib/layout';
import { NEW_DECK } from '@/lib/decks';

type Today = inferRouterOutputs<AppRouter>['today']['get'];

/** A deck tile's link, as Flashcards' are. */
const DECK_LINK = 'block transition-shadow hover:shadow-lg';

/** A course tile's link, as tall as its row, as Courses' are. */
const COURSE_LINK = 'flex h-full transition-shadow hover:shadow-lg';

/** A block of Home: a carousel of tiles named by its heading. */
function Block({
  id,
  title,
  action,
  note,
  footer,
  children,
}: {
  id: string;
  title: string;
  /** Beside the heading, acting on the block's tiles. */
  action?: ReactNode;
  /** Below the heading. */
  note?: ReactNode;
  /** Below the tiles, such as the way to the whole area. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <div className="flex items-baseline gap-4">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {note}
      <div className="mt-2">
        <Carousel label={title}>{children}</Carousel>
      </div>
      {footer}
    </section>
  );
}

/** "4 due · 2 new", leaving out a count that's nought. */
function reviewCounts({
  dueCount,
  newCount,
}: Today['review']['decks'][number]) {
  return [
    ...(dueCount > 0 ? [`${dueCount} due`] : []),
    ...(newCount > 0 ? [`${newCount} new`] : []),
  ].join(' · ');
}

/**
 * Saves which decks Today's Review takes (#115), showing the change at once
 * and putting it back should saving fail.
 */
function useSetDecksTicked() {
  const utils = trpc.useUtils();
  return trpc.today.setDecksTicked.useMutation({
    onMutate: async ({ deckIds, ticked }) => {
      await utils.today.get.cancel();
      const before = utils.today.get.getData();
      utils.today.get.setData(
        undefined,
        (today) =>
          today && {
            ...today,
            review: {
              ...today.review,
              decks: today.review.decks.map((deck) =>
                deckIds.includes(deck.id) ? { ...deck, ticked } : deck,
              ),
            },
          },
      );
      return { before };
    },
    onError: (_error, _input, context) => {
      utils.today.get.setData(undefined, context?.before);
      toast.error("Couldn't save which decks to review. Try again.");
    },
    // When the next card comes due follows the ticked decks
    onSettled: () => utils.today.get.invalidate(),
  });
}

/**
 * A Review tile's tickbox, a badge in its lower right corner, clear of the
 * deck's stack, beside the tile's link rather than in it. Goes inside a
 * relative wrapper of the tile.
 */
function DeckTick({
  name,
  ticked,
  onChange,
}: {
  name: string;
  ticked: boolean;
  onChange: (ticked: boolean) => void;
}) {
  return (
    <label className="touch-target absolute right-2 bottom-2 z-10 cursor-pointer">
      <input
        type="checkbox"
        checked={ticked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={`Review ${name}`}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`flex size-6 items-center justify-center rounded-full border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-white peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-transparent ${
          ticked
            ? 'border-white bg-white text-slate-900'
            : 'border-white/60 bg-black/10 hover:border-white'
        }`}
      >
        {ticked && <Check className="size-4" strokeWidth={3} />}
      </span>
    </label>
  );
}

/**
 * Review: a tile for each deck with cards due or new, each with a tickbox
 * choosing whether Today's Review takes it; an unticked one stays, so it
 * can be ticked again.
 */
function Review({
  decks,
  nextDueAt,
}: {
  decks: Today['review']['decks'];
  nextDueAt: string | null;
}) {
  const setDecksTicked = useSetDecksTicked();
  const allTicked = decks.every((deck) => deck.ticked);
  const noneTicked = !decks.some((deck) => deck.ticked);

  return (
    <Block
      id="review"
      title="Review"
      action={
        <button
          type="button"
          onClick={() =>
            setDecksTicked.mutate({
              deckIds: decks.map((deck) => deck.id),
              ticked: !allTicked,
            })
          }
          className="touch-target text-sm text-white/70 hover:text-white"
        >
          {allTicked ? 'Select none' : 'Select all'}
        </button>
      }
      note={
        <>
          <p className="mt-1 text-sm text-white/60">
            Tick the decks to review together, in one session.
          </p>
          {noneTicked && (
            <p className="mt-1 text-sm text-white/60">
              Nothing ticked to review.
              {nextDueAt && ` Next card due ${formatDueTime(nextDueAt)}`}
            </p>
          )}
        </>
      }
    >
      {decks.map((deck) => (
        <CarouselItem key={deck.id}>
          <div className="relative">
            <Link
              to={`/decks/${deck.id}`}
              className={`${DECK_LINK} transition-opacity ${deck.ticked ? '' : 'opacity-60'}`}
            >
              <DeckTile deck={deck}>
                <p className="mt-2 text-sm font-medium text-white/90">
                  {reviewCounts(deck)}
                </p>
                {deck.cramUntil && (
                  <p className="mt-0.5 text-xs text-white/50">
                    Cram until {formatCalendarDay(deck.cramUntil)}
                  </p>
                )}
              </DeckTile>
            </Link>
            <DeckTick
              name={deck.name}
              ticked={deck.ticked}
              onChange={(ticked) =>
                setDecksTicked.mutate({ deckIds: [deck.id], ticked })
              }
            />
          </div>
        </CarouselItem>
      ))}
    </Block>
  );
}

/** A course's next step, and where it opens. */
function nextStep(
  course: Today['continueLearning'][number],
  aiPaused: boolean,
) {
  if (course.next.kind === 'SYLLABUS_PROPOSAL') {
    return {
      to: `/courses/${course.id}`,
      label: 'Syllabus ready to review',
      note: null,
    };
  }
  const { lesson } = course.next;
  return {
    to: `/lessons/${lesson.id}`,
    label: `Continue: ${lesson.title}`,
    // It's written the first time it's opened, which needs AI
    note:
      aiPaused && !lesson.written
        ? 'Not written yet, and AI is paused until next month'
        : null,
  };
}

function ContinueLearning({
  courses,
  aiPaused,
}: {
  courses: Today['continueLearning'];
  aiPaused: boolean;
}) {
  return (
    <Block id="continue-learning" title="Continue learning">
      {courses.map((course) => {
        const { to, label, note } = nextStep(course, aiPaused);
        return (
          <CarouselItem key={course.id}>
            <Link to={to} className={COURSE_LINK}>
              <CourseTile course={course}>
                <p className="mt-2 line-clamp-2 text-center text-sm font-medium break-words text-white/90">
                  {label}
                </p>
                {course.deadline && (
                  <p className="mt-0.5 text-xs text-white/50">
                    {deadlineLine(course.deadline)}
                  </p>
                )}
                {note && (
                  <p className="mt-0.5 text-center text-xs text-white/50">
                    {note}
                  </p>
                )}
              </CourseTile>
            </Link>
          </CarouselItem>
        );
      })}
    </Block>
  );
}

/** The way from a preview to its whole area, below its tiles. */
function AllLink({ to, children }: { to: string; children: string }) {
  return (
    <p className="mt-2">
      <Link
        to={to}
        className="touch-target text-sm text-white/70 hover:text-white"
      >
        {children}
      </Link>
    </p>
  );
}

/** Review gives way to Flashcards' decks, most recently studied first. */
function FlashcardsPreview({
  decks,
  nextDueAt,
}: {
  decks: Today['previews']['decks'];
  nextDueAt: string | null;
}) {
  return (
    <Block
      id="flashcards"
      title="Flashcards"
      footer={<AllLink to="/flashcards">All flashcards →</AllLink>}
      note={
        nextDueAt && (
          <p className="mt-1 text-sm text-white/60">
            Nothing to review. Next card due {formatDueTime(nextDueAt)}
          </p>
        )
      }
    >
      <CarouselItem>
        <Link to="/flashcards" state={NEW_DECK} className={DECK_LINK}>
          <DeckCard stackCount={0}>
            <NewTileFace label="New deck" />
          </DeckCard>
        </Link>
      </CarouselItem>
      {decks.map((deck) => (
        <CarouselItem key={deck.id}>
          <Link to={`/decks/${deck.id}`} className={DECK_LINK}>
            <DeckTile deck={deck} />
          </Link>
        </CarouselItem>
      ))}
    </Block>
  );
}

/** Continue learning gives way to Courses, most recently active first. */
function CoursesPreview({
  courses,
}: {
  courses: Today['previews']['courses'];
}) {
  return (
    <Block
      id="courses"
      title="Courses"
      footer={<AllLink to="/courses">All courses →</AllLink>}
    >
      <CarouselItem>
        <Link to="/courses/new" className={COURSE_LINK}>
          <Tile>
            <NewTileFace label="New course" />
          </Tile>
        </Link>
      </CarouselItem>
      {courses.map((course) => (
        <CarouselItem key={course.id}>
          <Link to={`/courses/${course.id}`} className={COURSE_LINK}>
            <CourseTile course={course}>
              <CourseProgress course={course} />
            </CourseTile>
          </Link>
        </CarouselItem>
      ))}
    </Block>
  );
}

/**
 * Home: Today, what the learner has to do now (#114), as rows of tiles the
 * window's whole width, in the site navigation's gutter. Review and Continue learning each give way to a
 * preview of their area when they're empty.
 */
export default function HomePage() {
  const todayQuery = trpc.today.get.useQuery();

  if (todayQuery.isLoading) {
    return <HomeSkeleton />;
  }

  if (todayQuery.isError || !todayQuery.data) {
    return (
      <CenteredPage centered>
        <p className="text-destructive">Error loading Today.</p>
      </CenteredPage>
    );
  }

  const { review, continueLearning, aiPaused, previews } = todayQuery.data;
  // Review gives way to Flashcards only with no deck to list, ticked or
  // not; it's caught up once no ticked deck has cards due or new
  const reviewEmpty = review.decks.length === 0;
  const reviewCaughtUp = !review.decks.some((deck) => deck.ticked);
  const continueEmpty = continueLearning.length === 0;

  return (
    <main
      className={`flex min-w-0 flex-1 flex-col py-8 text-white ${FULL_WIDTH_GUTTER}`}
    >
      <h1 className="text-2xl font-bold">Today</h1>
      {reviewCaughtUp && continueEmpty && (
        <p className="mt-2 text-lg text-white/80">You're all caught up</p>
      )}

      {reviewEmpty ? (
        <FlashcardsPreview
          decks={previews.decks}
          nextDueAt={review.nextDueAt}
        />
      ) : (
        <Review decks={review.decks} nextDueAt={review.nextDueAt} />
      )}

      {continueEmpty ? (
        <CoursesPreview courses={previews.courses} />
      ) : (
        <ContinueLearning courses={continueLearning} aiPaused={aiPaused} />
      )}
    </main>
  );
}
