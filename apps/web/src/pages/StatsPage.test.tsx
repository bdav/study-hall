import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StatsPage', () => {
  it('renders overall stats when data is available', () => {
    vi.mocked(trpc.stats.overallStats.useQuery).mockReturnValue({
      data: {
        totalAttempts: 50,
        totalCorrect: 35,
        overallAccuracy: 0.7,
        deckCount: 3,
        weakCards: [
          {
            cardId: 'card-1',
            direction: 'FORWARD',
            front: 'Capital of France?',
            question: 'Capital of France?',
            deck: null,
            deckId: 'deck-1',
            deckName: 'Geography',
            avgAttemptsToCorrect: 2.5,
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof trpc.stats.overallStats.useQuery>);

    renderStatsPage();

    expect(screen.getByRole('heading', { name: /stats/i })).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('35')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders empty state when no study sessions exist', () => {
    vi.mocked(trpc.stats.overallStats.useQuery).mockReturnValue({
      data: {
        totalAttempts: 0,
        totalCorrect: 0,
        overallAccuracy: 0,
        deckCount: 0,
        weakCards: [],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof trpc.stats.overallStats.useQuery>);

    renderStatsPage();

    expect(screen.getByText(/no study data yet/i)).toBeInTheDocument();
  });

  it('renders weak cards grouped by deck in tables', () => {
    vi.mocked(trpc.stats.overallStats.useQuery).mockReturnValue({
      data: {
        totalAttempts: 50,
        totalCorrect: 35,
        overallAccuracy: 0.7,
        deckCount: 2,
        weakCards: [
          {
            cardId: 'card-1',
            direction: 'FORWARD',
            front: 'Capital of France?',
            question: 'Capital of France?',
            deck: null,
            deckId: 'deck-1',
            deckName: 'Geography',
            avgAttemptsToCorrect: 3.0,
          },
          {
            cardId: 'card-2',
            direction: 'FORWARD',
            front: 'What is 2+2?',
            question: 'What is 2+2?',
            deck: null,
            deckId: 'deck-2',
            deckName: 'Math',
            avgAttemptsToCorrect: 2.0,
          },
          {
            cardId: 'card-3',
            direction: 'FORWARD',
            front: 'Capital of Japan?',
            question: 'Capital of Japan?',
            deck: null,
            deckId: 'deck-1',
            deckName: 'Geography',
            avgAttemptsToCorrect: 1.5,
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof trpc.stats.overallStats.useQuery>);

    renderStatsPage();

    expect(screen.getByText(/needs work/i)).toBeInTheDocument();
    // Deck names appear as links to study pages
    const geoLink = screen.getByRole('link', { name: 'Geography' });
    expect(geoLink).toHaveAttribute('href', '/decks/deck-1');
    const mathLink = screen.getByRole('link', { name: 'Math' });
    expect(mathLink).toHaveAttribute('href', '/decks/deck-2');
    // Card data in tables
    expect(screen.getByText('Capital of France?')).toBeInTheDocument();
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    expect(screen.getByText('Capital of Japan?')).toBeInTheDocument();
    expect(screen.getByText('3.0')).toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
    expect(screen.getByText('1.5')).toBeInTheDocument();
    // Table headers present
    const questionHeaders = screen.getAllByText('Question');
    expect(questionHeaders).toHaveLength(2); // one per deck group
  });

  it('does not render weak cards section when none exist', () => {
    vi.mocked(trpc.stats.overallStats.useQuery).mockReturnValue({
      data: {
        totalAttempts: 10,
        totalCorrect: 10,
        overallAccuracy: 1,
        deckCount: 1,
        weakCards: [],
      },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof trpc.stats.overallStats.useQuery>);

    renderStatsPage();

    expect(screen.queryByText(/needs work/i)).not.toBeInTheDocument();
  });

  it('shows loading state', () => {
    vi.mocked(trpc.stats.overallStats.useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof trpc.stats.overallStats.useQuery>);

    renderStatsPage();

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows error state', () => {
    vi.mocked(trpc.stats.overallStats.useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof trpc.stats.overallStats.useQuery>);

    renderStatsPage();

    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });
});
