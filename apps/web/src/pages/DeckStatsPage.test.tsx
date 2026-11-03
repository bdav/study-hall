import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
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

type DeckStats = inferRouterOutputs<AppRouter>['stats']['deckStats'];

/** A deck's stats, as the API returns them. */
function deckStats(overrides: Partial<DeckStats> = {}): DeckStats {
  return {
    answers: { MISSED: 3, PARTIALLY_CORRECT: 0, GOOD: 1, NAILED: 8 },
    answerCount: 12,
    accuracy: 0.75,
    lifecycle: { NEW: 4, LEARNING: 3, REINFORCING: 5, RETIRED: 0 },
    bands: { fragile: 2, developing: 3, solid: 2, mastered: 1 },
    weakCount: 1,
    weakCards: [
      {
        cardId: 'card-1',
        direction: 'FORWARD',
        question: 'Capital of Peru',
        recentMisses: 2,
        deck: {
          id: 'deck-1',
          name: 'World Capitals',
          reversible: false,
          forwardLabel: null,
          reverseLabel: null,
          course: null,
        },
      },
    ],
    sessions: [
      {
        id: 'session-2',
        startedAt: '2026-11-01T12:00:00.000Z',
        endedAt: '2026-11-01T12:10:00.000Z',
        sessionType: 'QUICK',
        studyMode: 'CRAM',
        direction: 'FORWARD',
        status: 'ABANDONED',
        deck: { id: 'deck-1', name: 'World Capitals', course: null },
        answered: 3,
        right: 1,
      },
      {
        id: 'session-1',
        startedAt: '2026-10-30T12:00:00.000Z',
        endedAt: '2026-10-30T12:20:00.000Z',
        sessionType: 'STANDARD',
        studyMode: 'STUDY',
        direction: 'FORWARD',
        status: 'COMPLETED',
        deck: { id: 'deck-1', name: 'World Capitals', course: null },
        answered: 10,
        right: 8,
      },
    ],
    ...overrides,
  };
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
    data: deckStats(),
    isLoading: false,
    isError: false,
    ...overrides,
  } as ReturnType<typeof trpc.stats.deckStats.useQuery>);
}

/** Each item of a section's list, as its text reads. */
function itemsOf(name: string) {
  return within(screen.getByRole('region', { name }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

/** Each row of a section's table below its header, cell by cell. */
function rowsOf(name: string) {
  return within(screen.getByRole('region', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeckStatsPage', () => {
  it('shows how many answers count, and their accuracy', () => {
    setupMocks();
    renderDeckStatsPage();

    expect(
      screen.getByRole('heading', { name: /world capitals/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows answers by Recall Grade, Partially correct only once there are any', () => {
    setupMocks();
    renderDeckStatsPage();

    expect(itemsOf('Answers by grade')).toEqual([
      '3Needs review',
      '1Good',
      '8Nailed it',
    ]);
  });

  it('shows Partially correct answers when there are some', () => {
    setupMocks({
      data: deckStats({
        answers: { MISSED: 1, PARTIALLY_CORRECT: 2, GOOD: 0, NAILED: 1 },
      }),
    });
    renderDeckStatsPage();

    expect(itemsOf('Answers by grade')).toEqual([
      '1Needs review',
      '2Partially correct',
      '0Good',
      '1Nailed it',
    ]);
  });

  it('shows how many cards are in each Lifecycle State', () => {
    setupMocks();
    renderDeckStatsPage();

    expect(itemsOf('Cards')).toEqual([
      '4New',
      '3Still learning',
      '5Reinforcing',
      '0Retired',
    ]);
  });

  it("shows how many answered cards are in each mastery band, never a card's score", () => {
    setupMocks();
    renderDeckStatsPage();

    expect(itemsOf('Mastery')).toEqual([
      '2Fragile',
      '3Developing',
      '2Solid',
      '1Mastered',
    ]);
  });

  it('says when no card has been answered yet to have a mastery band', () => {
    setupMocks({
      data: deckStats({
        bands: { fragile: 0, developing: 0, solid: 0, mastered: 0 },
      }),
    });
    renderDeckStatsPage();

    expect(
      within(screen.getByRole('region', { name: 'Mastery' })).getByText(
        /no cards answered yet/i,
      ),
    ).toBeInTheDocument();
  });

  it('lists the Weak cards with their recent misses', () => {
    setupMocks();
    renderDeckStatsPage();

    expect(rowsOf('Weak cards')).toEqual([['Capital of Peru', '2']]);
  });

  it('says when only the weakest of more Weak cards are listed', () => {
    setupMocks({ data: deckStats({ weakCount: 25 }) });
    renderDeckStatsPage();

    expect(
      within(screen.getByRole('region', { name: 'Weak cards' })).getByText(
        'The weakest 1 of 25',
      ),
    ).toBeInTheDocument();
  });

  it('says when no card is Weak', () => {
    setupMocks({ data: deckStats({ weakCards: [], weakCount: 0 }) });
    renderDeckStatsPage();

    expect(
      within(screen.getByRole('region', { name: 'Weak cards' })).getByText(
        /no weak cards right now/i,
      ),
    ).toBeInTheDocument();
  });

  it('lists recent Study Sessions: when, type, mode, answered, right and how they ended', () => {
    setupMocks();
    renderDeckStatsPage();

    expect(rowsOf('Recent sessions')).toEqual([
      ['Nov 1, 2026', 'Quick', 'Cram', '3', '1', 'Abandoned'],
      ['Oct 30, 2026', 'Standard', 'Study', '10', '8', 'Finished'],
    ]);
  });

  it('says when no session has finished yet', () => {
    setupMocks({ data: deckStats({ sessions: [] }) });
    renderDeckStatsPage();

    expect(
      within(screen.getByRole('region', { name: 'Recent sessions' })).getByText(
        /no finished sessions yet/i,
      ),
    ).toBeInTheDocument();
  });

  it('renders empty state when nothing has been studied', () => {
    setupMocks({
      data: deckStats({
        answers: { MISSED: 0, PARTIALLY_CORRECT: 0, GOOD: 0, NAILED: 0 },
        answerCount: 0,
        accuracy: 0,
        weakCards: [],
        sessions: [],
      }),
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
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});

describe('a reversible deck (#82)', () => {
  function setupReversible() {
    setupMocks();
    vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
      data: {
        id: 'deck-1',
        name: 'World Capitals',
        cards: [],
        reversible: true,
        forwardLabel: 'Capitals from countries',
        reverseLabel: null,
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof trpc.deck.getById.useQuery>);
  }

  it('shows each direction’s stats on its own, Forward to start', async () => {
    setupReversible();
    const user = userEvent.setup();
    renderDeckStatsPage();

    const directions = within(screen.getByRole('group', { name: 'Direction' }));
    expect(
      directions.getByRole('button', { name: 'Capitals from countries' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(trpc.stats.deckStats.useQuery).toHaveBeenLastCalledWith(
      { deckId: 'deck-1', direction: 'FORWARD' },
      expect.anything(),
    );

    await user.click(directions.getByRole('button', { name: 'Reverse' }));

    expect(trpc.stats.deckStats.useQuery).toHaveBeenLastCalledWith(
      { deckId: 'deck-1', direction: 'REVERSE' },
      expect.anything(),
    );
  });

  it('offers the choice even before a direction has been studied', () => {
    setupReversible();
    vi.mocked(trpc.stats.deckStats.useQuery).mockReturnValue({
      data: deckStats({ answerCount: 0, weakCards: [], sessions: [] }),
      isLoading: false,
      isError: false,
    } as ReturnType<typeof trpc.stats.deckStats.useQuery>);
    renderDeckStatsPage();

    expect(
      screen.getByRole('group', { name: 'Direction' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no study data yet/i)).toBeInTheDocument();
  });

  it("keeps the shown direction's stats, marked busy, while the other loads", () => {
    setupReversible();
    vi.mocked(trpc.stats.deckStats.useQuery).mockReturnValue({
      data: deckStats(),
      isLoading: false,
      isError: false,
      isPlaceholderData: true,
    } as ReturnType<typeof trpc.stats.deckStats.useQuery>);
    renderDeckStatsPage();

    expect(screen.queryByRole('status', { name: /loading/i })).toBeNull();
    expect(screen.getByTestId('deck-stats')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(trpc.stats.deckStats.useQuery).toHaveBeenLastCalledWith(
      { deckId: 'deck-1', direction: 'FORWARD' },
      expect.objectContaining({ placeholderData: expect.any(Function) }),
    );
  });

  it('offers no choice on a deck studied one way', () => {
    setupMocks();
    renderDeckStatsPage();

    expect(screen.queryByRole('group', { name: 'Direction' })).toBeNull();
  });
});
