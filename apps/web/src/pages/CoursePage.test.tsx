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
    },
    {
      id: 'lesson-2',
      title: 'At the café',
      position: 1,
      objectives: ['Order food and drinks'],
    },
  ],
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
    it('shows the lessons in order with their objectives', () => {
      renderPage({ data: acceptedCourse } as Partial<CourseQuery>);

      expect(
        screen.getByRole('heading', { name: /^syllabus$/i }),
      ).toBeInTheDocument();
      const lessons = screen.getAllByRole('listitem', { name: /lesson/i });
      expect(
        lessons.map((lesson) => lesson.getAttribute('aria-label')),
      ).toEqual(['Lesson 1: Greetings', 'Lesson 2: At the café']);
      expect(screen.getByText('Say your name')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /accept syllabus/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /discard proposal/i }),
      ).not.toBeInTheDocument();
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

    expect(screen.getByRole('link', { name: /greetings/i })).toHaveAttribute(
      'href',
      '/lessons/lesson-1',
    );
    expect(screen.getByRole('link', { name: /at the café/i })).toHaveAttribute(
      'href',
      '/lessons/lesson-2',
    );
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
