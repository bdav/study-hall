import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DeckListPage from './DeckListPage';
import { trpc } from '@/lib/trpc';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      deck: { list: { invalidate: vi.fn() } },
    })),
    deck: {
      list: { useQuery: vi.fn() },
      create: { useMutation: vi.fn() },
      delete: { useMutation: vi.fn() },
    },
  },
}));

const mockDecks = [
  {
    id: 'deck-1',
    name: 'World Capitals',
    description: 'Test your geography',
    cardCount: 10,
    totalAttempts: 50,
    accuracy: 0.8,
    lastStudied: '2026-03-15T12:00:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-15T12:00:00.000Z',
    userId: 'user-1',
    course: null,
  },
  {
    id: 'deck-2',
    name: 'Math Facts',
    description: null,
    cardCount: 5,
    totalAttempts: 0,
    accuracy: 0,
    lastStudied: null,
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-10T00:00:00.000Z',
    userId: 'user-1',
    course: null,
  },
];

function renderDeckListPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <DeckListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setupMocks(
  overrides?: Partial<ReturnType<typeof trpc.deck.list.useQuery>>,
) {
  vi.mocked(trpc.deck.list.useQuery).mockReturnValue({
    data: mockDecks,
    isLoading: false,
    isError: false,
    ...overrides,
  } as ReturnType<typeof trpc.deck.list.useQuery>);

  vi.mocked(trpc.deck.create.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof trpc.deck.create.useMutation>);

  vi.mocked(trpc.deck.delete.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof trpc.deck.delete.useMutation>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeckListPage', () => {
  it('renders deck list with names and card counts', () => {
    setupMocks();
    renderDeckListPage();

    expect(screen.getByText('World Capitals')).toBeInTheDocument();
    expect(screen.getByText('Math Facts')).toBeInTheDocument();
    expect(screen.getByText(/10 cards/)).toBeInTheDocument();
    expect(screen.getByText(/5 cards/)).toBeInTheDocument();
  });

  it('labels a Course Deck with its course', () => {
    setupMocks({
      data: [
        { ...mockDecks[1], course: null },
        {
          ...mockDecks[0],
          id: 'deck-3',
          name: 'Italian',
          course: { id: 'course-1', title: 'Italian: A1 to A2' },
        },
      ],
    } as Partial<ReturnType<typeof trpc.deck.list.useQuery>>);
    renderDeckListPage();

    expect(screen.getByText('Course: Italian: A1 to A2')).toBeInTheDocument();
    expect(screen.getAllByText(/^Course:/)).toHaveLength(1);
  });

  it('renders deck summary stats (accuracy and last studied)', () => {
    setupMocks();
    renderDeckListPage();

    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('renders links to study each deck', () => {
    setupMocks();
    renderDeckListPage();

    const links = screen.getAllByRole('link');
    const deckLinks = links.filter(
      (link) =>
        link.getAttribute('href') === '/decks/deck-1' ||
        link.getAttribute('href') === '/decks/deck-2',
    );
    expect(deckLinks).toHaveLength(2);
  });

  it('renders empty state when no decks exist', () => {
    setupMocks({ data: [] });
    renderDeckListPage();

    expect(screen.getByText(/no decks yet/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    setupMocks({ data: undefined, isLoading: true });
    renderDeckListPage();

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows error state', () => {
    setupMocks({ data: undefined, isError: true });
    renderDeckListPage();

    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });

  it('shows new deck card with plus icon by default', () => {
    setupMocks();
    renderDeckListPage();

    expect(screen.getByText(/new deck/i)).toBeInTheDocument();
  });

  it('shows create form when new deck card is clicked', async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDeckListPage();

    await user.click(screen.getByText(/new deck/i));

    expect(screen.getByText(/deck name/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('calls create mutation when form is submitted', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.deck.create.useMutation).mockReturnValue({
      mutate: mockMutate,
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof trpc.deck.create.useMutation>);

    const user = userEvent.setup();
    renderDeckListPage();

    await user.click(screen.getByText(/new deck/i));
    await user.type(screen.getByRole('textbox'), 'New Deck');
    await user.keyboard('{Enter}');

    expect(mockMutate).toHaveBeenCalledWith({ name: 'New Deck' });
  });

  it('navigates to new deck after successful creation', async () => {
    setupMocks();
    let onSuccessCallback: (data: { id: string }) => void;
    vi.mocked(trpc.deck.create.useMutation).mockImplementation(((
      opts: { onSuccess?: (data: { id: string }) => void } = {},
    ) => {
      onSuccessCallback = opts.onSuccess!;
      return {
        mutate: vi.fn(() => onSuccessCallback({ id: 'new-deck-123' })),
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof trpc.deck.create.useMutation>;
    }) as unknown as typeof trpc.deck.create.useMutation);

    const user = userEvent.setup();
    renderDeckListPage();

    await user.click(screen.getByText(/new deck/i));
    await user.type(screen.getByRole('textbox'), 'New Deck');
    await user.keyboard('{Enter}');

    expect(mockNavigate).toHaveBeenCalledWith('/decks/new-deck-123/cards');
  });

  it('does not submit create form with empty name', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.deck.create.useMutation).mockReturnValue({
      mutate: mockMutate,
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof trpc.deck.create.useMutation>);

    const user = userEvent.setup();
    renderDeckListPage();

    await user.click(screen.getByText(/new deck/i));
    await user.keyboard('{Enter}');

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('renders all deck tiles', () => {
    setupMocks();
    renderDeckListPage();

    expect(screen.getByText('World Capitals')).toBeInTheDocument();
    expect(screen.getByText('Math Facts')).toBeInTheDocument();
  });

  it('renders delete buttons for each deck', () => {
    setupMocks();
    renderDeckListPage();

    expect(
      screen.getByRole('button', { name: /delete world capitals/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete math facts/i }),
    ).toBeInTheDocument();
  });

  it('calls delete mutation after confirming delete', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.deck.delete.useMutation).mockReturnValue({
      mutate: mockMutate,
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof trpc.deck.delete.useMutation>);

    const user = userEvent.setup();
    renderDeckListPage();

    await user.click(
      screen.getByRole('button', { name: /delete world capitals/i }),
    );
    // The confirm button in the AlertDialog — use exact name to avoid matching triggers
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(mockMutate).toHaveBeenCalledWith({ id: 'deck-1' });
  });
});
