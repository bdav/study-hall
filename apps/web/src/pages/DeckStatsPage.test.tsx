import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DeckStatsPage from './DeckStatsPage';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({})),
    deck: {
      getById: { useQuery: vi.fn() },
      restore: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
    stats: {
      deckStats: { useQuery: vi.fn() },
    },
  },
}));

function renderDeckStatsPage(deckId = 'deck-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/decks/${deckId}/stats`]}>
        <Routes>
          <Route path="/decks/:deckId/stats" element={<DeckStatsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setupMocks(
  overrides?: Partial<ReturnType<typeof trpc.stats.deckStats.useQuery>>,
) {
  vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
    data: { id: 'deck-1', name: 'World Capitals', cards: [] },
    isLoading: false,
    isError: false,
  } as ReturnType<typeof trpc.deck.getById.useQuery>);

  vi.mocked(trpc.stats.deckStats.useQuery).mockReturnValue({
    data: {
      totalAttempts: 30,
      uniqueCardsStudied: 10,
      firstTryAccuracy: 0.6,
      overallAccuracy: 0.8,
      cardStats: [
        { cardId: 'card-1', totalAttempts: 5, avgAttemptsToCorrect: 2.5 },
        { cardId: 'card-2', totalAttempts: 3, avgAttemptsToCorrect: 1.0 },
      ],
    },
    isLoading: false,
    isError: false,
    ...overrides,
  } as ReturnType<typeof trpc.stats.deckStats.useQuery>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeckStatsPage', () => {
  it('renders deck stats with totals and accuracy', () => {
    setupMocks();
    renderDeckStatsPage();

    expect(
      screen.getByRole('heading', { name: /world capitals/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('renders per-card stats', () => {
    setupMocks();
    renderDeckStatsPage();

    expect(screen.getByText('2.5')).toBeInTheDocument();
    expect(screen.getByText('1.0')).toBeInTheDocument();
  });

  it('renders empty state when no attempts exist', () => {
    setupMocks({
      data: {
        totalAttempts: 0,
        uniqueCardsStudied: 0,
        firstTryAccuracy: 0,
        overallAccuracy: 0,
        cardStats: [],
      },
    });
    renderDeckStatsPage();

    expect(screen.getByText(/no study data yet/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    setupMocks({ data: undefined, isLoading: true });
    renderDeckStatsPage();

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows error state', () => {
    setupMocks({ data: undefined, isError: true });
    renderDeckStatsPage();

    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });

  it('says an archived deck is archived, with Restore, its stats still shown', () => {
    setupMocks();
    vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
      data: {
        id: 'deck-1',
        name: 'World Capitals',
        cards: [],
        archivedAt: '2026-10-01T12:00:00.000Z',
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof trpc.deck.getById.useQuery>);
    renderDeckStatsPage();

    expect(screen.getByText(/this deck is archived/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Restore deck' }),
    ).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });
});
