import { render, screen, within } from '@testing-library/react';
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
      deck: {
        list: { invalidate: vi.fn() },
        listArchived: { invalidate: vi.fn() },
      },
    })),
    deck: {
      list: { useQuery: vi.fn() },
      listArchived: { useQuery: vi.fn() },
      create: { useMutation: vi.fn() },
      archive: { useMutation: vi.fn() },
      restore: { useMutation: vi.fn() },
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

const archivedDecks = [
  {
    id: 'deck-9',
    name: 'Old Verbs',
    cardCount: 12,
    archivedAt: '2026-10-01T12:00:00.000Z',
    course: null,
  },
  {
    id: 'deck-8',
    name: 'Spanish',
    cardCount: 1,
    archivedAt: '2026-09-01T12:00:00.000Z',
    course: { id: 'course-2', title: 'Spanish', archivedAt: '2026-09-01' },
  },
];

const mockArchive = vi.fn();
const mockRestore = vi.fn();
const mockDelete = vi.fn();

function setupMocks(
  overrides?: Partial<ReturnType<typeof trpc.deck.list.useQuery>>,
  archived: unknown[] = [],
) {
  vi.mocked(trpc.deck.listArchived.useQuery).mockReturnValue({
    data: archived,
  } as ReturnType<typeof trpc.deck.listArchived.useQuery>);
  for (const [procedure, mutate] of [
    [trpc.deck.archive, mockArchive],
    [trpc.deck.restore, mockRestore],
  ] as const) {
    vi.mocked(procedure.useMutation).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof procedure.useMutation>);
  }

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
    mutate: mockDelete,
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

  it('offers Archive on each deck, but not on a Course Deck whose course is active', () => {
    setupMocks({
      data: [
        ...mockDecks,
        {
          ...mockDecks[0],
          id: 'deck-3',
          name: 'Italian',
          course: { id: 'course-1', title: 'Italian', archivedAt: null },
        },
        {
          ...mockDecks[0],
          id: 'deck-4',
          name: 'French',
          course: { id: 'course-3', title: 'French', archivedAt: '2026-10-01' },
        },
      ],
    } as Partial<ReturnType<typeof trpc.deck.list.useQuery>>);
    renderDeckListPage();

    for (const name of ['World Capitals', 'Math Facts', 'French']) {
      expect(
        screen.getByRole('button', { name: `Archive ${name}` }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole('button', { name: 'Archive Italian' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^delete/i }),
    ).not.toBeInTheDocument();
  });

  it('archives a deck after a confirmation that says what is kept', async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDeckListPage();

    await user.click(
      screen.getByRole('button', { name: 'Archive World Capitals' }),
    );
    expect(
      screen.getByText(/its cards and their history are kept/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    expect(mockArchive).toHaveBeenCalledWith({ id: 'deck-1' });
  });

  it('leaves out the Archived section when no deck is archived', () => {
    setupMocks();
    renderDeckListPage();

    expect(
      screen.queryByRole('button', { name: /archived/i }),
    ).not.toBeInTheDocument();
  });

  it('lists archived decks below, collapsed to start, each with when it was archived', async () => {
    setupMocks({}, archivedDecks);
    const user = userEvent.setup();
    renderDeckListPage();

    const toggle = screen.getByRole('button', { name: 'Archived (2)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Old Verbs')).not.toBeVisible();

    await user.click(toggle);

    const list = within(screen.getByRole('list', { name: 'Archived decks' }));
    const rows = list.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Old Verbs');
    expect(rows[0]).toHaveTextContent(/archived/i);
    expect(rows[1]).toHaveTextContent('Course: Spanish');
  });

  it('restores an archived deck without a confirmation', async () => {
    setupMocks({}, archivedDecks);
    const user = userEvent.setup();
    renderDeckListPage();
    await user.click(screen.getByRole('button', { name: 'Archived (2)' }));

    await user.click(screen.getByRole('button', { name: 'Restore Old Verbs' }));

    expect(mockRestore).toHaveBeenCalledWith({ id: 'deck-9' });
  });

  it('deletes an archived deck permanently after a confirmation naming what goes', async () => {
    setupMocks({}, archivedDecks);
    const user = userEvent.setup();
    renderDeckListPage();
    await user.click(screen.getByRole('button', { name: 'Archived (2)' }));

    await user.click(
      screen.getByRole('button', { name: 'Delete Old Verbs permanently' }),
    );
    expect(
      screen.getByText(/its 12 cards and their whole history/i),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Delete permanently' }),
    );

    expect(mockDelete).toHaveBeenCalledWith({ id: 'deck-9' });
  });
});
