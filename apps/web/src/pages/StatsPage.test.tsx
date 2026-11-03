import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import StatsPage from './StatsPage';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    stats: {
      overallStats: {
        useQuery: vi.fn(),
      },
    },
  },
}));

type OverallStats = inferRouterOutputs<AppRouter>['stats']['overallStats'];

const geography = {
  id: 'deck-1',
  name: 'Geography',
  reversible: true,
  forwardLabel: 'Capitals',
  reverseLabel: 'Countries',
  course: null,
};
const italian = {
  id: 'deck-2',
  name: 'Italian',
  reversible: false,
  forwardLabel: null,
  reverseLabel: null,
  course: { id: 'course-1', title: 'Italian for travel' },
};

/** The learner's stats, as the API returns them. */
function overallStats(overrides: Partial<OverallStats> = {}): OverallStats {
  return {
    answers: { MISSED: 15, PARTIALLY_CORRECT: 0, GOOD: 5, NAILED: 30 },
    answerCount: 50,
    accuracy: 0.7,
    lifecycle: { NEW: 20, LEARNING: 6, REINFORCING: 14, RETIRED: 0 },
    bands: { fragile: 5, developing: 7, solid: 6, mastered: 2 },
    weakCount: 2,
    deckCount: 3,
    weakCards: [
      {
        cardId: 'card-1',
        direction: 'REVERSE',
        question: 'Paris',
        recentMisses: 2,
        deck: geography,
      },
      {
        cardId: 'card-2',
        direction: 'FORWARD',
        question: 'Hello',
        recentMisses: 1,
        deck: italian,
      },
    ],
    sessions: [
      {
        id: 'session-1',
        startedAt: '2026-11-01T12:00:00.000Z',
        endedAt: '2026-11-01T12:10:00.000Z',
        sessionType: 'QUICK',
        studyMode: 'DRILL_WEAKEST',
        direction: 'FORWARD',
        status: 'COMPLETED',
        deck: { id: 'deck-2', name: 'Italian', course: italian.course },
        answered: 6,
        right: 4,
      },
    ],
    ...overrides,
  };
}

function mockStats(data: OverallStats | undefined, state = {}) {
  vi.mocked(trpc.stats.overallStats.useQuery).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    ...state,
  } as ReturnType<typeof trpc.stats.overallStats.useQuery>);
}

function renderStatsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/stats']}>
        <StatsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const region = (name: string) => screen.getByRole('region', { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StatsPage', () => {
  it('shows how many answers count, their accuracy, and how many decks they span', () => {
    mockStats(overallStats());
    renderStatsPage();

    expect(screen.getByRole('heading', { name: 'Stats' })).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('Decks studied').previousSibling).toHaveTextContent(
      '3',
    );
  });

  it('shows answers by Recall Grade', () => {
    mockStats(overallStats());
    renderStatsPage();

    expect(
      within(region('Answers by grade'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['15Needs review', '5Good', '30Nailed it']);
  });

  it('shows how many cards are in each Lifecycle State and Mastery Band', () => {
    mockStats(overallStats());
    renderStatsPage();

    const items = (name: string) =>
      within(region(name))
        .getAllByRole('listitem')
        .map((item) => item.textContent);
    expect(items('Cards')).toEqual([
      '20New',
      '6Still learning',
      '14Reinforcing',
      '0Retired',
    ]);
    expect(items('Mastery')).toEqual([
      '5Fragile',
      '7Developing',
      '6Solid',
      '2Mastered',
    ]);
  });

  it("lists the Weak cards by deck, naming a deck's course and a Reversible Deck's direction", () => {
    mockStats(overallStats());
    renderStatsPage();
    const weak = region('Weak cards');

    expect(
      within(weak).getByRole('link', { name: 'Geography' }),
    ).toHaveAttribute('href', '/decks/deck-1');
    expect(within(weak).getByRole('link', { name: 'Italian' })).toHaveAttribute(
      'href',
      '/decks/deck-2',
    );
    expect(within(weak).getByText('Italian for travel')).toBeInTheDocument();
    expect(
      within(weak)
        .getAllByRole('row')
        .filter((row) => within(row).queryAllByRole('cell').length > 0)
        .map((row) => row.textContent),
    ).toEqual(['ParisCountries2', 'Hello1']);
  });

  it('says when no card is Weak', () => {
    mockStats(overallStats({ weakCards: [], weakCount: 0 }));
    renderStatsPage();

    expect(
      within(region('Weak cards')).getByText(/no weak cards right now/i),
    ).toBeInTheDocument();
  });

  it('lists recent Study Sessions, each naming its deck and course', () => {
    mockStats(overallStats());
    renderStatsPage();

    const [, row] = within(region('Recent sessions')).getAllByRole('row');
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Nov 1, 2026',
      'Italian · Italian for travel',
      'Quick',
      'Drill weakest',
      '6',
      '4',
      'Finished',
    ]);
  });

  it('says when no session has finished yet', () => {
    mockStats(overallStats({ sessions: [] }));
    renderStatsPage();

    expect(
      within(region('Recent sessions')).getByText(/no finished sessions yet/i),
    ).toBeInTheDocument();
  });

  it('renders empty state when nothing has been studied', () => {
    mockStats(
      overallStats({
        answers: { MISSED: 0, PARTIALLY_CORRECT: 0, GOOD: 0, NAILED: 0 },
        answerCount: 0,
        accuracy: 0,
        lifecycle: { NEW: 4, LEARNING: 0, REINFORCING: 0, RETIRED: 0 },
        bands: { fragile: 0, developing: 0, solid: 0, mastered: 0 },
        weakCount: 0,
        deckCount: 0,
        weakCards: [],
        sessions: [],
      }),
    );
    renderStatsPage();

    expect(screen.getByText(/no study data yet/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockStats(undefined, { isLoading: true });
    renderStatsPage();

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockStats(undefined, { isError: true });
    renderStatsPage();

    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });
});
