import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: { today: { get: { useQuery: vi.fn() } } },
}));

type TodayQuery = ReturnType<typeof trpc.today.get.useQuery>;
type Today = inferRouterOutputs<AppRouter>['today']['get'];

const day = 24 * 60 * 60 * 1000;
/** A date with no time, as the API sends one, so many days from today. */
const dateIn = (days: number) =>
  `${new Date(Date.now() + days * day).toISOString().slice(0, 10)}T00:00:00.000Z`;

const nothing: Today = {
  review: { decks: [], nextDueAt: null },
  continueLearning: [],
  aiPaused: false,
  previews: { decks: [], courses: [] },
};

const decksToReview: Today['review']['decks'] = [
  {
    id: 'deck-1',
    name: 'Capitals',
    course: null,
    cardCount: 30,
    dueCount: 4,
    newCount: 2,
    cramUntil: null,
  },
  {
    id: 'deck-2',
    name: 'Italian',
    course: { title: 'Italian for travel' },
    cardCount: 7,
    dueCount: 0,
    newCount: 7,
    cramUntil: '2099-06-01T00:00:00.000Z',
  },
];

const coursesToContinue: Today['continueLearning'] = [
  {
    id: 'course-1',
    title: 'Italian for travel',
    goal: 'Get by on holiday',
    deadline: dateIn(21),
    next: {
      kind: 'LESSON',
      lesson: { id: 'lesson-3', title: 'Ordering food', written: true },
    },
  },
  {
    id: 'course-2',
    title: 'Spanish',
    goal: 'Talk to my neighbours',
    deadline: null,
    next: { kind: 'SYLLABUS_PROPOSAL' },
  },
];

const deckTiles: Today['previews']['decks'] = [
  { id: 'deck-9', name: 'Recent', course: null, cardCount: 12 },
  { id: 'deck-8', name: 'Older', course: { title: 'Italian' }, cardCount: 3 },
  { id: 'deck-7', name: 'Oldest', course: null, cardCount: 1 },
];

const courseTiles: Today['previews']['courses'] = [
  {
    id: 'course-9',
    title: 'Recent course',
    goal: 'Get somewhere',
    syllabusAccepted: true,
    lessonCount: 10,
    completedLessonCount: 10,
  },
  {
    id: 'course-8',
    title: 'Older course',
    goal: 'Get elsewhere',
    syllabusAccepted: false,
    lessonCount: 0,
    completedLessonCount: 0,
  },
  {
    id: 'course-7',
    title: 'Oldest course',
    goal: 'Long ago',
    syllabusAccepted: true,
    lessonCount: 4,
    completedLessonCount: 1,
  },
];

function renderHome(
  today: Partial<Today> = {},
  query: Partial<TodayQuery> = {},
) {
  vi.mocked(trpc.today.get.useQuery).mockReturnValue({
    data: { ...nothing, ...today },
    isLoading: false,
    isError: false,
    ...query,
  } as TodayQuery);

  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

function block(name: string) {
  return screen.getByRole('region', { name });
}

/** The links in a block, by their names, in order. */
function linksIn(region: HTMLElement) {
  return within(region)
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);
}

describe('HomePage', () => {
  it('heads the page Today', () => {
    renderHome({ review: { decks: decksToReview, nextDueAt: null } });

    expect(
      screen.getByRole('heading', { level: 1, name: 'Today' }),
    ).toBeInTheDocument();
  });

  describe('Review', () => {
    it('shows each deck to review as its tile, in order, opening its study page, with its due and new counts', () => {
      renderHome({ review: { decks: decksToReview, nextDueAt: null } });

      const rows = within(block('Review')).getAllByRole('link');
      expect(rows.map((row) => row.getAttribute('href'))).toEqual([
        '/decks/deck-1',
        '/decks/deck-2',
      ]);
      expect(rows[0]).toHaveTextContent('Capitals');
      expect(rows[0]).toHaveTextContent('30 cards');
      expect(rows[0]).toHaveTextContent('4 due · 2 new');
      // Nothing of a count that's nought
      expect(rows[1]).toHaveTextContent('7 new');
      expect(rows[1]).not.toHaveTextContent('due');
    });

    it("labels a Course Deck with its course, and shows a deck's Cram Date", () => {
      renderHome({ review: { decks: decksToReview, nextDueAt: null } });

      const italian = within(block('Review')).getAllByRole('link')[1];
      expect(italian).toHaveTextContent('Course: Italian for travel');
      expect(italian).toHaveTextContent('Cram until 1 Jun');
    });

    it('gives way to the Flashcards preview when nothing is due or new, saying when the next card comes due', () => {
      renderHome({
        review: { decks: [], nextDueAt: '2099-11-12T15:30:00.000Z' },
        continueLearning: coursesToContinue,
        previews: { decks: deckTiles, courses: courseTiles },
      });

      expect(
        screen.queryByRole('region', { name: 'Review' }),
      ).not.toBeInTheDocument();
      const flashcards = block('Flashcards');
      expect(flashcards).toHaveTextContent(/Next card due \w+, Nov 12/);
      // The way to them all beside its heading, then New deck and every
      // deck, most recent first
      expect(linksIn(flashcards)).toEqual([
        ['All flashcards →', '/flashcards'],
        ['New deck', '/flashcards'],
        [expect.stringContaining('Recent'), '/decks/deck-9'],
        [expect.stringContaining('Older'), '/decks/deck-8'],
        [expect.stringContaining('Oldest'), '/decks/deck-7'],
      ]);
      expect(flashcards).toHaveTextContent('12 cards');
      // Continue learning is still there, and nobody's caught up
      expect(block('Continue learning')).toBeInTheDocument();
      expect(
        screen.queryByText("You're all caught up"),
      ).not.toBeInTheDocument();
    });
  });

  describe('Continue learning', () => {
    it('shows each course as its tile with its next lesson, opening it, and its deadline', () => {
      renderHome({ continueLearning: coursesToContinue });

      const rows = within(block('Continue learning')).getAllByRole('link');
      expect(rows[0]).toHaveAttribute('href', '/lessons/lesson-3');
      expect(rows[0]).toHaveTextContent('Italian for travel');
      expect(rows[0]).toHaveTextContent('Get by on holiday');
      expect(rows[0]).toHaveTextContent('Continue: Ordering food');
      expect(rows[0]).toHaveTextContent('Deadline in 3 weeks');
    });

    it('opens a waiting Syllabus Proposal on its course page', () => {
      renderHome({ continueLearning: coursesToContinue });

      const spanish = within(block('Continue learning')).getAllByRole(
        'link',
      )[1];
      expect(spanish).toHaveAttribute('href', '/courses/course-2');
      expect(spanish).toHaveTextContent('Syllabus ready to review');
      expect(spanish).not.toHaveTextContent('Deadline');
    });

    it("says, while AI is paused, that a next lesson not yet written can't be written", () => {
      const unwritten: Today['continueLearning'][number] = {
        ...coursesToContinue[0],
        id: 'course-3',
        next: {
          kind: 'LESSON',
          lesson: { id: 'lesson-9', title: 'Directions', written: false },
        },
      };
      renderHome({
        continueLearning: [coursesToContinue[0], unwritten],
        aiPaused: true,
      });

      const [written, notWritten] = within(
        block('Continue learning'),
      ).getAllByRole('link');
      expect(notWritten).toHaveTextContent(
        'Not written yet, and AI is paused until next month',
      );
      expect(written).not.toHaveTextContent('paused');
    });

    it('says nothing of AI for a lesson not yet written while AI is running', () => {
      renderHome({
        continueLearning: [
          {
            ...coursesToContinue[0],
            next: {
              kind: 'LESSON',
              lesson: { id: 'lesson-9', title: 'Directions', written: false },
            },
          },
        ],
      });

      expect(block('Continue learning')).not.toHaveTextContent('paused');
    });

    it('gives way to the Courses preview when no course has a next step', () => {
      renderHome({
        review: { decks: decksToReview, nextDueAt: null },
        previews: { decks: deckTiles, courses: courseTiles },
      });

      expect(
        screen.queryByRole('region', { name: 'Continue learning' }),
      ).not.toBeInTheDocument();
      expect(linksIn(block('Courses'))).toEqual([
        ['All courses →', '/courses'],
        ['New course', '/courses/new'],
        [expect.stringContaining('Recent course'), '/courses/course-9'],
        [expect.stringContaining('Older course'), '/courses/course-8'],
        [expect.stringContaining('Oldest course'), '/courses/course-7'],
      ]);
      expect(block('Courses')).toHaveTextContent('10 of 10 lessons complete');
      expect(block('Courses')).toHaveTextContent('Syllabus proposal ready');
      expect(
        screen.queryByText("You're all caught up"),
      ).not.toBeInTheDocument();
    });
  });

  it("says you're all caught up above both previews when both blocks are empty", () => {
    renderHome({ previews: { decks: deckTiles, courses: courseTiles } });

    const caughtUp = screen.getByText("You're all caught up");
    const flashcards = block('Flashcards');
    const courses = block('Courses');
    expect(
      caughtUp.compareDocumentPosition(flashcards) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      caughtUp.compareDocumentPosition(courses) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows a new learner both previews holding only their New tiles', () => {
    renderHome();

    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    expect(linksIn(block('Flashcards'))).toEqual([
      ['All flashcards →', '/flashcards'],
      ['New deck', '/flashcards'],
    ]);
    expect(linksIn(block('Courses'))).toEqual([
      ['All courses →', '/courses'],
      ['New course', '/courses/new'],
    ]);
    // No card is due at any time
    expect(block('Flashcards')).not.toHaveTextContent('Next card due');
  });

  it('shows a skeleton while Today loads, and says so if it fails', () => {
    const { unmount } = renderHome({}, { data: undefined, isLoading: true });
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    unmount();

    renderHome({}, { data: undefined, isError: true });
    expect(screen.getByText('Error loading Today.')).toBeInTheDocument();
  });
});
