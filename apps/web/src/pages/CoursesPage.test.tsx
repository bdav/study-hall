import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CoursesPage from './CoursesPage';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    course: {
      list: { useQuery: vi.fn() },
    },
  },
}));

type ListQuery = ReturnType<typeof trpc.course.list.useQuery>;

const courses = [
  {
    id: 'course-2',
    title: 'Spanish',
    goal: 'Order dinner in Madrid',
    createdAt: '2026-10-20T00:00:00.000Z',
    lessonCount: 0,
    syllabusAccepted: false,
  },
  {
    id: 'course-1',
    title: 'Italian',
    goal: 'A2 by summer',
    createdAt: '2026-10-01T00:00:00.000Z',
    lessonCount: 12,
    syllabusAccepted: true,
  },
];

function renderPage(query: Partial<ListQuery>) {
  vi.mocked(trpc.course.list.useQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    ...query,
  } as ListQuery);

  return render(
    <MemoryRouter>
      <CoursesPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CoursesPage', () => {
  it("lists the learner's courses, linking to each", () => {
    renderPage({ data: courses } as Partial<ListQuery>);

    expect(screen.getByRole('link', { name: /italian/i })).toHaveAttribute(
      'href',
      '/courses/course-1',
    );
    expect(screen.getByRole('link', { name: /spanish/i })).toHaveAttribute(
      'href',
      '/courses/course-2',
    );
    expect(screen.getByText('A2 by summer')).toBeInTheDocument();
  });

  it('shows the lesson count, or that a proposal awaits review', () => {
    renderPage({ data: courses } as Partial<ListQuery>);

    expect(screen.getByText('12 lessons')).toBeInTheDocument();
    expect(screen.getByText('Syllabus proposal ready')).toBeInTheDocument();
  });

  it('shows an empty state that leads to creating a course', () => {
    renderPage({ data: [] } as Partial<ListQuery>);

    expect(screen.getByText(/no courses yet/i)).toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: /new course/i })[0],
    ).toHaveAttribute('href', '/courses/new');
  });

  it('shows a loading state', () => {
    renderPage({ isLoading: true });

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows an error state', () => {
    renderPage({ isError: true });

    expect(screen.getByText(/error loading courses/i)).toBeInTheDocument();
  });
});
