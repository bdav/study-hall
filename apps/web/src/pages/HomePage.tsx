import { type ReactNode } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { CenteredPage } from '@/components/CenteredPage';
import { DeckCard } from '@/components/DeckCard';
import { HomeSkeleton } from '@/components/PageSkeleton';
import { Tile } from '@/components/Tile';
import {
  countOf,
  deadlineLine,
  formatCalendarDay,
  formatDueTime,
} from '@/lib/format';
import { TILE_GRID } from '@/lib/layout';
import { NEW_DECK } from '@/lib/decks';

type Today = inferRouterOutputs<AppRouter>['today']['get'];

/** How many of an area's tiles a preview shows, after its New tile. */
const PREVIEW_TILES = 2;

/** A row of Today's: one thing to start, opening where it's done. */
const ROW =
  'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border pointer-coarse:min-h-touch border-white/20 bg-white/5 px-4 py-3 hover:bg-white/10';

/** A block of Home, named by its heading. */
function Block({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
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

function Review({ decks }: { decks: Today['review']['decks'] }) {
  return (
    <Block id="review" title="Review">
      <ul className="mt-3 space-y-2">
        {decks.map((deck) => (
          <li key={deck.id}>
            <Link to={`/decks/${deck.id}`} className={ROW}>
              <span className="min-w-0">
                <span className="font-medium break-words">{deck.name}</span>
                {deck.course && (
                  <span className="block text-xs text-white/50">
                    Course: {deck.course.title}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-right text-sm text-white/70">
                {reviewCounts(deck)}
                {deck.cramUntil && (
                  <span className="block text-xs text-white/50">
                    Cram until {formatCalendarDay(deck.cramUntil)}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
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
      <ul className="mt-3 space-y-2">
        {courses.map((course) => {
          const { to, label, note } = nextStep(course, aiPaused);
          return (
            <li key={course.id}>
              <Link to={to} className={ROW}>
                <span className="min-w-0">
                  <span className="block font-medium break-words">{label}</span>
                  <span className="block text-xs text-white/50">
                    {course.title}
                  </span>
                  {note && (
                    <span className="block text-xs text-white/50">{note}</span>
                  )}
                </span>
                {course.deadline && (
                  <span className="shrink-0 text-sm text-white/70">
                    {deadlineLine(course.deadline)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Block>
  );
}

/** A preview's New tile, as its area's own. */
function NewTile({
  to,
  state,
  label,
}: {
  to: string;
  state?: unknown;
  label: string;
}) {
  return (
    <li>
      <Link
        to={to}
        state={state}
        className="flex h-full transition-shadow hover:shadow-lg"
      >
        <Tile wideOnPhones>
          <Plus className="h-10 w-10 text-white/60" aria-hidden />
          <p className="mt-2 text-sm font-medium text-white/60">{label}</p>
        </Tile>
      </Link>
    </li>
  );
}

/** The way from a preview to its whole area. */
function AllLink({ to, children }: { to: string; children: string }) {
  return (
    <p className="mt-3 text-right">
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
    <Block id="flashcards" title="Flashcards">
      {nextDueAt && (
        <p className="mt-1 text-sm text-white/60">
          Nothing to review. Next card due {formatDueTime(nextDueAt)}
        </p>
      )}
      <ul className={`mt-3 ${TILE_GRID}`}>
        <NewTile to="/flashcards" state={NEW_DECK} label="New deck" />
        {decks.slice(0, PREVIEW_TILES).map((deck) => (
          <li key={deck.id}>
            <Link
              to={`/decks/${deck.id}`}
              className="block transition-shadow hover:shadow-lg"
            >
              <DeckCard stackCount={Math.min(deck.cardCount, 3)} wideOnPhones>
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
              </DeckCard>
            </Link>
          </li>
        ))}
      </ul>
      <AllLink to="/flashcards">All flashcards →</AllLink>
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
    <Block id="courses" title="Courses">
      <ul className={`mt-3 ${TILE_GRID}`}>
        <NewTile to="/courses/new" label="New course" />
        {courses.slice(0, PREVIEW_TILES).map((course) => (
          <li key={course.id}>
            <Link
              to={`/courses/${course.id}`}
              className="flex h-full transition-shadow hover:shadow-lg"
            >
              <Tile wideOnPhones>
                <p className="line-clamp-4 text-center text-lg font-bold break-words">
                  {course.title}
                </p>
                <p className="mt-1 line-clamp-2 text-center text-sm break-words text-white/70">
                  {course.goal}
                </p>
                <p className="mt-2 text-xs text-white/50">
                  {course.syllabusAccepted
                    ? `${course.completedLessonCount} of ${course.lessonCount} lessons complete`
                    : 'Syllabus proposal ready'}
                </p>
              </Tile>
            </Link>
          </li>
        ))}
      </ul>
      <AllLink to="/courses">All courses →</AllLink>
    </Block>
  );
}

/**
 * Home: Today, what the learner has to do now (#114). Review and Continue
 * learning each give way to a preview of their area when they're empty.
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
  const reviewEmpty = review.decks.length === 0;
  const continueEmpty = continueLearning.length === 0;

  return (
    <CenteredPage>
      <div className="w-full max-w-4xl text-white">
        <h1 className="text-2xl font-bold">Today</h1>
        {reviewEmpty && continueEmpty && (
          <p className="mt-2 text-lg text-white/80">You're all caught up</p>
        )}

        {reviewEmpty ? (
          <FlashcardsPreview
            decks={previews.decks}
            nextDueAt={review.nextDueAt}
          />
        ) : (
          <Review decks={review.decks} />
        )}

        {continueEmpty ? (
          <CoursesPreview courses={previews.courses} />
        ) : (
          <ContinueLearning courses={continueLearning} aiPaused={aiPaused} />
        )}
      </div>
    </CenteredPage>
  );
}
