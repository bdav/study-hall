import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CoursePage from './CoursePage';
import { trpc } from '@/lib/trpc';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      course: {
        getById: { invalidate: vi.fn() },
        list: { invalidate: vi.fn() },
      },
    })),
    course: {
      getById: { useQuery: vi.fn() },
      acceptProposal: { useMutation: vi.fn() },
      discardProposal: { useMutation: vi.fn() },
    },
  },
}));

type CourseQuery = ReturnType<typeof trpc.course.getById.useQuery>;
type AcceptMutation = ReturnType<typeof trpc.course.acceptProposal.useMutation>;
type DiscardMutation = ReturnType<
  typeof trpc.course.discardProposal.useMutation
>;

const proposedLessons = [
  {
    title: 'Greetings',
    objectives: ['Greet someone formally and informally', 'Say your name'],
  },
  { title: 'At the café', objectives: ['Order food and drinks'] },
];

const baseCourse = {
  id: 'course-1',
  title: 'Italian',
  topic: 'Italian',
  goal: 'A2 by summer',
  deckId: 'deck-1',
  lessons: [],
  continueLesson: null,
  review: null,
  proposal: {
    lessons: proposedLessons,
    model: 'claude-sonnet-5-5',
    promptVersion: 'syllabus-v1',
    acceptedAt: null,
  },
};

const acceptedCourse = {
  ...baseCourse,
  proposal: { ...baseCourse.proposal, acceptedAt: '2026-10-22T00:00:00Z' },
  lessons: [
    {
      id: 'lesson-1',
      title: 'Greetings',
      position: 0,
      objectives: ['Greet someone formally and informally', 'Say your name'],
      status: 'OPENED',
    },
    {
      id: 'lesson-2',
      title: 'At the café',
      position: 1,
      objectives: ['Order food and drinks'],
      status: 'NOT_STARTED',
    },
  ],
  continueLesson: { id: 'lesson-1', title: 'Greetings' },
  review: { deckId: 'deck-1', dueCount: 0, newCount: 0 },
};

const mockAccept = vi.fn();
const mockDiscard = vi.fn();

function renderPage(
  query: Partial<CourseQuery>,
  mutation: Partial<AcceptMutation> = {},
) {
  vi.mocked(trpc.course.getById.useQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    ...query,
  } as CourseQuery);
  vi.mocked(trpc.course.acceptProposal.useMutation).mockReturnValue({
    mutate: mockAccept,
    isPending: false,
    ...mutation,
  } as unknown as AcceptMutation);
  vi.mocked(trpc.course.discardProposal.useMutation).mockReturnValue({
    mutate: mockDiscard,
    isPending: false,
  } as unknown as DiscardMutation);

  return render(
    <MemoryRouter initialEntries={['/courses/course-1']}>
      <Routes>
        <Route path="/courses/:courseId" element={<CoursePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CoursePage', () => {
  it('loads the course from the route', () => {
    renderPage({ data: baseCourse } as Partial<CourseQuery>);

    expect(trpc.course.getById.useQuery).toHaveBeenCalledWith({
      id: 'course-1',
    });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Italian' }),
    ).toBeInTheDocument();
    expect(screen.getByText('A2 by summer')).toBeInTheDocument();
  });

  describe('the pinned header', () => {
    const header = () => within(screen.getByRole('banner'));

    it('holds the way back to Courses, the title, the goal and Continue', () => {
      renderPage({ data: acceptedCourse } as Partial<CourseQuery>);

      expect(header().getByRole('link', { name: 'Courses' })).toHaveAttribute(
        'href',
        '/courses',
      );
      expect(
        header().getByRole('heading', { level: 1, name: 'Italian' }),
      ).toBeInTheDocument();
      expect(header().getByText('A2 by summer')).toBeInTheDocument();
      expect(
        header().getByRole('link', { name: 'Continue: Greetings' }),
      ).toHaveAttribute('href', '/lessons/lesson-1');
    });

    it('says when every lesson is complete, in place of Continue', () => {
      renderPage({
        data: {
          ...acceptedCourse,
          lessons: acceptedCourse.lessons.map((lesson) => ({
            ...lesson,
            status: 'COMPLETE',
          })),
          continueLesson: null,
        },
      } as Partial<CourseQuery>);

      expect(
        header().getByText(/every lesson is complete/i),
      ).toBeInTheDocument();
      expect(
        header().queryByRole('link', { name: /^continue/i }),
      ).not.toBeInTheDocument();
    });

    it('has no ⋯ menu while it would have nothing in it', () => {
      renderPage({ data: acceptedCourse } as Partial<CourseQuery>);

      expect(
        screen.queryByRole('button', { name: 'More actions' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('with a Syllabus Proposal', () => {
    it("shows each lesson's title and learning objectives", () => {
      renderPage({ data: baseCourse } as Partial<CourseQuery>);

      expect(
        screen.getByRole('heading', { name: /syllabus proposal/i }),
      ).toBeInTheDocument();
      const lessons = screen.getAllByRole('listitem', { name: /lesson/i });
      expect(lessons).toHaveLength(2);
      expect(within(lessons[0]).getByText('Greetings')).toBeInTheDocument();
      expect(
        within(lessons[0]).getByText('Greet someone formally and informally'),
      ).toBeInTheDocument();
      expect(
        within(lessons[1]).getByText('Order food and drinks'),
      ).toBeInTheDocument();
    });

    it('accepts the proposal', async () => {
      renderPage({ data: baseCourse } as Partial<CourseQuery>);
      const user = userEvent.setup();

      await user.click(
        screen.getByRole('button', { name: /accept syllabus/i }),
      );

      expect(mockAccept).toHaveBeenCalledWith({ courseId: 'course-1' });
    });

    it('discards the proposal after confirmation', async () => {
      renderPage({ data: baseCourse } as Partial<CourseQuery>);
      const user = userEvent.setup();

      await user.click(
        screen.getByRole('button', { name: /discard proposal/i }),
      );
      await user.click(
        await screen.findByRole('button', { name: /^discard$/i }),
      );

      expect(mockDiscard).toHaveBeenCalledWith({ courseId: 'course-1' });
    });

    it('returns to Courses once the proposal is discarded', () => {
      renderPage({ data: baseCourse } as Partial<CourseQuery>);

      const options = vi.mocked(trpc.course.discardProposal.useMutation).mock
        .calls[0][0] as { onSuccess: () => void };
      options.onSuccess();

      expect(mockNavigate).toHaveBeenCalledWith('/courses');
    });

    it('disables accepting while it is in progress', () => {
      renderPage({ data: baseCourse } as Partial<CourseQuery>, {
        isPending: true,
      });

      expect(screen.getByRole('button', { name: /accepting/i })).toBeDisabled();
    });
  });

  describe('with an accepted Syllabus', () => {
    const rows = () => screen.getAllByRole('listitem', { name: /lesson/i });

    it('lists the lessons in order, one row each', () => {
      renderPage({ data: acceptedCourse } as Partial<CourseQuery>);

      expect(
        screen.getByRole('heading', { name: /^syllabus$/i }),
      ).toBeInTheDocument();
      expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual([
        'Lesson 1: Greetings',
        'Lesson 2: At the café',
      ]);
      expect(
        screen.queryByRole('button', { name: /accept syllabus/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /discard proposal/i }),
      ).not.toBeInTheDocument();
    });

    it('marks the lesson Continue goes to as up next', () => {
      renderPage({ data: acceptedCourse } as Partial<CourseQuery>);

      expect(within(rows()[0]).getByText('Up next')).toBeInTheDocument();
      expect(within(rows()[1]).queryByText('Up next')).not.toBeInTheDocument();
    });

    it("keeps each lesson's objectives collapsed until opened", async () => {
      const user = userEvent.setup();
      renderPage({ data: acceptedCourse } as Partial<CourseQuery>);
      const toggle = (row: HTMLElement) =>
        within(row).getByRole('button', { name: /objectives/i });

      expect(screen.queryByText('Say your name')).not.toBeInTheDocument();
      expect(toggle(rows()[0])).toHaveAttribute('aria-expanded', 'false');

      await user.click(toggle(rows()[0]));
      expect(within(rows()[0]).getByText('Say your name')).toBeInTheDocument();
      expect(toggle(rows()[0])).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.queryByText('Order food and drinks'),
      ).not.toBeInTheDocument();

      await user.click(toggle(rows()[0]));
      expect(screen.queryByText('Say your name')).not.toBeInTheDocument();
    });

    it("shows one lesson's objectives at a time: opening another closes the first", async () => {
      const user = userEvent.setup();
      renderPage({ data: acceptedCourse } as Partial<CourseQuery>);
      const toggle = (row: HTMLElement) =>
        within(row).getByRole('button', { name: /objectives/i });

      await user.click(toggle(rows()[0]));
      await user.click(toggle(rows()[1]));

      expect(
        within(rows()[1]).getByText('Order food and drinks'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Say your name')).not.toBeInTheDocument();
      expect(toggle(rows()[0])).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('Review', () => {
    function renderReview(review: { dueCount: number; newCount: number }) {
      renderPage({
        data: { ...acceptedCourse, review: { deckId: 'deck-1', ...review } },
      } as Partial<CourseQuery>);
      return within(screen.getByRole('region', { name: /^review$/i }));
    }

    it('shows how many Course Deck cards are due and new', () => {
      const review = renderReview({ dueCount: 3, newCount: 1 });

      expect(review.getByText('3 cards due')).toBeInTheDocument();
      expect(review.getByText('1 new card')).toBeInTheDocument();
    });

    it('starts a Study Session on the Course Deck in the study flow', () => {
      const review = renderReview({ dueCount: 1, newCount: 0 });

      expect(review.getByRole('link', { name: 'Study now' })).toHaveAttribute(
        'href',
        '/decks/deck-1',
      );
    });

    it('says when there is nothing to review', () => {
      const review = renderReview({ dueCount: 0, newCount: 0 });

      expect(review.getByText(/nothing to review/i)).toBeInTheDocument();
      expect(
        review.queryByRole('link', { name: 'Study now' }),
      ).not.toBeInTheDocument();
    });

    it("isn't shown while the syllabus is a proposal", () => {
      renderPage({ data: baseCourse } as Partial<CourseQuery>);

      expect(
        screen.queryByRole('region', { name: /^review$/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('Lesson Completion', () => {
    const inProgress = {
      ...acceptedCourse,
      lessons: [
        { ...acceptedCourse.lessons[0], status: 'COMPLETE' },
        { ...acceptedCourse.lessons[1], status: 'OPENED' },
        {
          id: 'lesson-3',
          title: 'Numbers',
          position: 2,
          objectives: ['Count to one hundred'],
          status: 'NOT_STARTED',
        },
      ],
      continueLesson: { id: 'lesson-2', title: 'At the café' },
    };

    it('shows each lesson as not started, opened or complete', () => {
      renderPage({ data: inProgress } as Partial<CourseQuery>);

      const lessons = screen.getAllByRole('listitem', { name: /lesson/i });
      expect(within(lessons[0]).getByText('Complete')).toBeInTheDocument();
      expect(within(lessons[1]).getByText('Opened')).toBeInTheDocument();
      expect(within(lessons[2]).getByText('Not started')).toBeInTheDocument();
    });

    it('continues at the lesson the course says is next', () => {
      renderPage({ data: inProgress } as Partial<CourseQuery>);

      const link = screen.getByRole('link', { name: /^continue/i });
      expect(link).toHaveAttribute('href', '/lessons/lesson-2');
      expect(link).toHaveTextContent('At the café');
    });

    it('says when every lesson is complete, with nowhere to continue', () => {
      renderPage({
        data: {
          ...inProgress,
          lessons: inProgress.lessons.map((lesson) => ({
            ...lesson,
            status: 'COMPLETE',
          })),
          continueLesson: null,
        },
      } as Partial<CourseQuery>);

      expect(
        screen.queryByRole('link', { name: /^continue/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/every lesson is complete/i)).toBeInTheDocument();
    });

    it('shows no progress while the syllabus is a proposal', () => {
      renderPage({ data: baseCourse } as Partial<CourseQuery>);

      expect(
        screen.queryByRole('link', { name: /^continue/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Not started')).not.toBeInTheDocument();
    });
  });

  it.each([
    ['a Syllabus Proposal', baseCourse],
    ['an accepted Syllabus', acceptedCourse],
  ])('links back to Courses from %s', (_, course) => {
    renderPage({ data: course } as Partial<CourseQuery>);

    expect(screen.getByRole('link', { name: /^courses$/i })).toHaveAttribute(
      'href',
      '/courses',
    );
  });

  it('links each syllabus lesson to its lesson page', () => {
    renderPage({ data: acceptedCourse } as Partial<CourseQuery>);
    const syllabus = within(screen.getByRole('list', { name: /^syllabus$/i }));

    expect(syllabus.getByRole('link', { name: /greetings/i })).toHaveAttribute(
      'href',
      '/lessons/lesson-1',
    );
    expect(
      syllabus.getByRole('link', { name: /at the café/i }),
    ).toHaveAttribute('href', '/lessons/lesson-2');
  });

  it("doesn't link proposed lessons, which don't exist until accepted", () => {
    renderPage({ data: baseCourse } as Partial<CourseQuery>);

    for (const lesson of screen.getAllByRole('listitem', { name: /lesson/i })) {
      expect(within(lesson).queryByRole('link')).not.toBeInTheDocument();
    }
  });

  it('shows a loading state', () => {
    renderPage({ isLoading: true });

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows when the course cannot be found', () => {
    renderPage({
      isError: true,
      error: { data: { code: 'NOT_FOUND' } },
    } as unknown as Partial<CourseQuery>);

    expect(screen.getByText(/course not found/i)).toBeInTheDocument();
  });
});
