import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CoursesPage from './CoursesPage';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { me: { useQuery: vi.fn() } },
    aiUsage: { summary: { useQuery: vi.fn() } },
    course: {
      list: { useQuery: vi.fn() },
      listArchived: { useQuery: vi.fn() },
    },
  },
}));

type ListQuery = ReturnType<typeof trpc.course.list.useQuery>;
type SummaryQuery = ReturnType<typeof trpc.aiUsage.summary.useQuery>;

const courses = [
  {
    id: 'course-2',
    title: 'Spanish',
    goal: 'Order dinner in Madrid',
    createdAt: '2026-10-20T00:00:00.000Z',
    lessonCount: 0,
    completedLessonCount: 0,
    syllabusAccepted: false,
  },
  {
    id: 'course-1',
    title: 'Italian',
    goal: 'A2 by summer',
    createdAt: '2026-10-01T00:00:00.000Z',
    lessonCount: 12,
    completedLessonCount: 3,
    syllabusAccepted: true,
  },
];

function renderPage(
  query: Partial<ListQuery>,
  {
    canUseAI = false,
    summary,
    archived = [],
  }: {
    canUseAI?: boolean;
    summary?: SummaryQuery['data'];
    archived?: { id: string; title: string; archivedAt: string }[];
  } = {},
) {
  vi.mocked(trpc.course.listArchived.useQuery).mockReturnValue({
    data: archived,
  } as unknown as ReturnType<typeof trpc.course.listArchived.useQuery>);
  vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
    data: { user: { id: 'user-1', email: 'me@example.com', canUseAI } },
  } as ReturnType<typeof trpc.auth.me.useQuery>);
  vi.mocked(trpc.aiUsage.summary.useQuery).mockReturnValue({
    data: summary,
  } as SummaryQuery);
  vi.mocked(trpc.course.list.useQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    ...query,
  } as ListQuery);

  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<CoursesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CoursesPage', () => {
  it('shows each course as a tile linking to it, with its title, goal and lessons complete', () => {
    renderPage({ data: courses } as Partial<ListQuery>);

    const tile = screen.getByRole('link', { name: /italian/i });
    expect(tile).toHaveAttribute('href', '/courses/course-1');
    expect(within(tile).getByText('Italian')).toBeInTheDocument();
    expect(within(tile).getByText('A2 by summer')).toBeInTheDocument();
    expect(
      within(tile).getByText('3 of 12 lessons complete'),
    ).toBeInTheDocument();
  });

  it("says on a course's tile when its Syllabus is still a proposal", () => {
    renderPage({ data: courses } as Partial<ListQuery>);

    const tile = screen.getByRole('link', { name: /spanish/i });
    expect(tile).toHaveAttribute('href', '/courses/course-2');
    expect(
      within(tile).getByText('Order dinner in Madrid'),
    ).toBeInTheDocument();
    expect(
      within(tile).getByText('Syllabus proposal ready'),
    ).toBeInTheDocument();
    expect(within(tile).queryByText(/lessons complete/i)).toBeNull();
  });

  it('leads to a new course from the first tile, before the courses', () => {
    renderPage({ data: courses } as Partial<ListQuery>);

    const tiles = within(
      screen.getByRole('list', { name: /active courses/i }),
    ).getAllByRole('link');
    expect(tiles.map((tile) => tile.getAttribute('href'))).toEqual([
      '/courses/new',
      '/courses/course-2',
      '/courses/course-1',
    ]);
    expect(tiles[0]).toHaveAccessibleName(/new course/i);
  });

  describe('archived courses', () => {
    const archived = [
      {
        id: 'course-3',
        title: 'German',
        archivedAt: '2026-10-28T00:00:00.000Z',
      },
      {
        id: 'course-4',
        title: 'French',
        archivedAt: '2026-09-02T12:00:00.000Z',
      },
    ];

    it('lists them out of the way, collapsed to start, each linking to its page', async () => {
      renderPage({ data: courses } as Partial<ListQuery>, { archived });
      const user = userEvent.setup();
      const toggle = screen.getByRole('button', { name: /archived \(2\)/i });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('link', { name: /german/i })).toBeNull();

      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('link', { name: /german/i })).toHaveAttribute(
        'href',
        '/courses/course-3',
      );
      expect(screen.getByRole('link', { name: /french/i })).toHaveTextContent(
        /archived sep 2, 2026/i,
      );
    });

    it('leaves the section out when nothing is archived', () => {
      renderPage({ data: courses } as Partial<ListQuery>);

      expect(
        screen.queryByRole('button', { name: /archived/i }),
      ).not.toBeInTheDocument();
    });

    it('shows them even with no active courses, saying none are active', () => {
      renderPage({ data: [] } as Partial<ListQuery>, { archived });

      expect(
        screen.getByRole('button', { name: /archived \(2\)/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/no active courses/i)).toBeInTheDocument();
      expect(screen.queryByText(/no courses yet/i)).not.toBeInTheDocument();
    });
  });

  it('shows an empty state that leads to creating a course', () => {
    renderPage({ data: [] } as Partial<ListQuery>);

    expect(screen.getByText(/no courses yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new course/i })).toHaveAttribute(
      'href',
      '/courses/new',
    );
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

  it("leaves AI spend to the site's navigation, not asking for it (#119)", () => {
    renderPage({ data: courses } as Partial<ListQuery>, {
      canUseAI: true,
      summary: { spentUsd: 1.2, capUsd: 10, paused: false },
    });

    expect(screen.queryByText(/ai this month/i)).not.toBeInTheDocument();
    expect(trpc.aiUsage.summary.useQuery).not.toHaveBeenCalled();
  });
});
