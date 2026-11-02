import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DeckCardsPage from './DeckCardsPage';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

const mockInvalidateCards = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

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
      card: { listByDeck: { invalidate: mockInvalidateCards } },
      deck: {
        list: { invalidate: vi.fn() },
        listArchived: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    })),
    auth: { me: { useQuery: vi.fn() } },
    deck: {
      getById: { useQuery: vi.fn() },
      update: { useMutation: vi.fn() },
      archive: { useMutation: vi.fn() },
      restore: { useMutation: vi.fn() },
      proposeRevision: { useMutation: vi.fn() },
      applyRevision: { useMutation: vi.fn() },
      proposeCards: { useMutation: vi.fn() },
      addGeneratedCards: { useMutation: vi.fn() },
      suggestDirectionLabels: { useMutation: vi.fn() },
    },
    card: {
      listByDeck: { useQuery: vi.fn() },
      create: { useMutation: vi.fn() },
      update: { useMutation: vi.fn() },
      delete: { useMutation: vi.fn() },
      deleteMany: { useMutation: vi.fn() },
      markKnown: { useMutation: vi.fn() },
      importCards: { useMutation: vi.fn() },
      history: { useQuery: vi.fn() },
      restoreVersion: { useMutation: vi.fn() },
    },
  },
}));

const mockCards = [
  {
    id: 'card-1',
    deckId: 'deck-1',
    front: 'Capital of France',
    position: 0,
    canonicalAnswers: [
      {
        id: 'answer-Paris',
        text: 'Paris',
        isPrimary: true,
        acceptedVariants: [{ id: 'variant-paree', text: 'Paree' }],
      },
    ],
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    reverseVariants: [] as { id: string; text: string }[],
    knownDirections: [] as ('FORWARD' | 'REVERSE')[],
  },
  {
    id: 'card-2',
    deckId: 'deck-1',
    front: 'Capital of Germany',
    position: 0,
    canonicalAnswers: [
      {
        id: 'answer-Berlin',
        text: 'Berlin',
        isPrimary: true,
        acceptedVariants: [],
      },
    ],
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    reverseVariants: [] as { id: string; text: string }[],
    knownDirections: [] as ('FORWARD' | 'REVERSE')[],
  },
];

function renderDeckCardsPage(deckId = 'deck-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const page = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/decks/${deckId}/cards`]}>
        <Routes>
          <Route path="/decks/:deckId/cards" element={<DeckCardsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(page());
  // Renders the page again, as when its queries come back with new data
  return { ...result, rerenderPage: () => result.rerender(page()) };
}

const defaultMutationReturn = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

function setupMocks(overrides?: {
  cards?: typeof mockCards | [];
  deckLoading?: boolean;
  cardsLoading?: boolean;
  deckError?: boolean;
  canUseAI?: boolean;
  deck?: {
    archivedAt?: string | null;
    course?: { id: string; title: string; archivedAt: string | null } | null;
    description?: string | null;
    reversible?: boolean;
    forwardLabel?: string | null;
    reverseLabel?: string | null;
  };
}) {
  vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
    data: {
      user: {
        id: 'user-1',
        email: 'learner@example.com',
        canUseAI: overrides?.canUseAI ?? false,
      },
    },
  } as unknown as ReturnType<typeof trpc.auth.me.useQuery>);

  vi.mocked(trpc.deck.proposeRevision.useMutation).mockReturnValue({
    ...defaultMutationReturn,
    data: undefined,
  } as unknown as ReturnType<typeof trpc.deck.proposeRevision.useMutation>);

  vi.mocked(trpc.deck.applyRevision.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.deck.applyRevision.useMutation>);

  vi.mocked(trpc.deck.proposeCards.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.deck.proposeCards.useMutation>);

  vi.mocked(trpc.deck.addGeneratedCards.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.deck.addGeneratedCards.useMutation>);

  vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
    data: overrides?.deckError
      ? undefined
      : {
          id: 'deck-1',
          name: 'World Capitals',
          cards: [],
          archivedAt: null,
          course: null,
          description: null,
          reversible: false,
          forwardLabel: null,
          reverseLabel: null,
          ...overrides?.deck,
        },
    isLoading: overrides?.deckLoading ?? false,
    isError: overrides?.deckError ?? false,
  } as ReturnType<typeof trpc.deck.getById.useQuery>);

  vi.mocked(trpc.card.listByDeck.useQuery).mockReturnValue({
    data: overrides?.cards ?? mockCards,
    isLoading: overrides?.cardsLoading ?? false,
    isError: false,
  } as ReturnType<typeof trpc.card.listByDeck.useQuery>);

  vi.mocked(trpc.card.create.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof trpc.card.create.useMutation>);

  vi.mocked(trpc.card.importCards.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.card.importCards.useMutation>);

  vi.mocked(trpc.card.update.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.card.update.useMutation>);

  vi.mocked(trpc.card.delete.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.card.delete.useMutation>);

  vi.mocked(trpc.card.deleteMany.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.card.deleteMany.useMutation>);

  vi.mocked(trpc.card.markKnown.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.card.markKnown.useMutation>);

  vi.mocked(trpc.card.restoreVersion.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.card.restoreVersion.useMutation>);

  vi.mocked(trpc.card.history.useQuery).mockReturnValue({
    data: undefined,
    isError: false,
  } as unknown as ReturnType<typeof trpc.card.history.useQuery>);

  vi.mocked(trpc.deck.update.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.deck.update.useMutation>);

  vi.mocked(trpc.deck.suggestDirectionLabels.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<
    typeof trpc.deck.suggestDirectionLabels.useMutation
  >);

  vi.mocked(trpc.deck.archive.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.deck.archive.useMutation>);

  vi.mocked(trpc.deck.restore.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.deck.restore.useMutation>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DeckCardsPage', () => {
  it('renders card tiles with front text visible', () => {
    setupMocks();
    renderDeckCardsPage();

    expect(screen.getByDisplayValue('Capital of France')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Capital of Germany')).toBeInTheDocument();
  });

  it('shows card count', () => {
    setupMocks();
    renderDeckCardsPage();

    expect(screen.getByText('2 cards')).toBeInTheDocument();
  });

  it('shows singular card count for one card', () => {
    setupMocks({ cards: [mockCards[0]] });
    renderDeckCardsPage();

    expect(screen.getByText('1 card')).toBeInTheDocument();
  });

  it('shows empty state with guidance when deck has no cards', () => {
    setupMocks({ cards: [] });
    renderDeckCardsPage();

    expect(screen.getByText(/0 cards/)).toBeInTheDocument();
    expect(
      screen.getByText(/add cards below or import a CSV/i),
    ).toBeInTheDocument();
  });

  it('shows loading state', () => {
    setupMocks({ deckLoading: true });
    renderDeckCardsPage();

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows error state when deck fails to load', () => {
    setupMocks({ deckError: true });
    renderDeckCardsPage();

    expect(screen.getByText(/error/i)).toBeInTheDocument();
  });

  it('shows New Card button that opens creation form with front input', async () => {
    setupMocks({ cards: [] });
    const user = userEvent.setup();
    renderDeckCardsPage();

    expect(screen.getByText('New Card')).toBeInTheDocument();
    await user.click(screen.getByText('New Card'));

    // Both front and back faces are in the DOM (backface-visibility hides one)
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    expect(cancelButtons.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole('button', { name: /flip to back/i })[0],
    ).toBeInTheDocument();
  });

  it('calls create mutation after entering front, flipping, and entering back', async () => {
    setupMocks({ cards: [] });
    const mockMutate = vi.fn();
    vi.mocked(trpc.card.create.useMutation).mockReturnValue({
      mutate: mockMutate,
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof trpc.card.create.useMutation>);

    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByText('New Card'));
    // Type front text and press Enter to flip
    await user.type(
      screen.getByRole('textbox', { name: /front/i }),
      'Capital of Spain',
    );
    await user.keyboard('{Enter}');

    // Type back text and press Enter to submit
    await user.type(screen.getByRole('textbox', { name: /back/i }), 'Madrid');
    await user.keyboard('{Enter}');

    expect(mockMutate).toHaveBeenCalledWith({
      deckId: 'deck-1',
      front: 'Capital of Spain',
      canonicalAnswers: ['Madrid'],
    });
  });

  it('keeps "||" in a new card\'s back as part of its one answer', async () => {
    setupMocks({ cards: [] });
    const mockMutate = vi.fn();
    vi.mocked(trpc.card.create.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.card.create.useMutation>);
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByText('New Card'));
    await user.type(
      screen.getByRole('textbox', { name: /front/i }),
      'A prime between 10 and 20{Enter}',
    );
    await user.type(
      screen.getByRole('textbox', { name: /back/i }),
      '11 || 13{Enter}',
    );

    expect(mockMutate).toHaveBeenCalledWith({
      deckId: 'deck-1',
      front: 'A prime between 10 and 20',
      canonicalAnswers: ['11 || 13'],
    });
  });

  it('does not flip to back when front is empty', async () => {
    setupMocks({ cards: [] });
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByText('New Card'));
    // Press Enter with empty front — should not flip
    await user.keyboard('{Enter}');

    // Flip button should still be disabled
    expect(
      screen.getAllByRole('button', { name: /flip to back/i })[0],
    ).toBeDisabled();
  });

  it('shows Import CSV tile that opens form with instructions', async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDeckCardsPage();

    expect(screen.getByText('Import CSV')).toBeInTheDocument();
    await user.click(screen.getByText('Import CSV'));

    expect(screen.getByText(/CSV must have/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /choose file/i }),
    ).toBeInTheDocument();
  });

  it('opens preview dialog when CSV file is uploaded', async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByText('Import CSV'));

    const csvContent = 'front,back\nCapital of Spain,Madrid\n';
    const file = new File([csvContent], 'cards.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('csv-file-input');

    await user.upload(fileInput, file);

    await vi.waitFor(() => {
      expect(screen.getByText('Import Preview')).toBeInTheDocument();
    });

    // New card should appear in preview
    expect(screen.getByDisplayValue('Capital of Spain')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Madrid')).toBeInTheDocument();
  });

  it('says which updates clear accepted variants', async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByText('Import CSV'));
    const csvContent =
      'front,back\nCapital of France,Lutetia\nCapital of Germany,Bonn\n';
    await user.upload(
      screen.getByTestId('csv-file-input'),
      new File([csvContent], 'cards.csv', { type: 'text/csv' }),
    );

    const rows = await screen.findAllByTestId('update-card-row');
    expect(rows[0]).toHaveTextContent(/clears 1 accepted variant/i);
    expect(rows[1]).not.toHaveTextContent(/variant/i);
  });

  async function previewCsv(csvContent: string) {
    const user = userEvent.setup();
    renderDeckCardsPage();
    await user.click(screen.getByText('Import CSV'));
    await user.upload(
      screen.getByTestId('csv-file-input'),
      new File([csvContent], 'cards.csv', { type: 'text/csv' }),
    );
    await screen.findByText('Import Preview');
    return user;
  }

  it('shows the answers a row splits into', async () => {
    setupMocks();
    await previewCsv('front,back\nA prime between 10 and 20,11 || 13\n');

    expect(screen.getByText('2 answers: 11 · 13')).toBeInTheDocument();
  });

  it('keeps the variants of an answer an update keeps', async () => {
    setupMocks();
    await previewCsv('front,back\nCapital of France,Paris || Lutetia\n');

    const [row] = await screen.findAllByTestId('update-card-row');
    expect(row).toHaveTextContent('2 answers: Paris · Lutetia');
    expect(row).not.toHaveTextContent(/clears/i);
  });

  it('counts a variant an update makes one of the answers as cleared', async () => {
    setupMocks();
    await previewCsv('front,back\nCapital of France,Paris || Paree\n');

    const [row] = await screen.findAllByTestId('update-card-row');
    expect(row).toHaveTextContent(/clears 1 accepted variant/i);
  });

  it('calls importCards mutation when Import button is clicked in preview', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.card.importCards.useMutation).mockImplementation(() => {
      return {
        mutate: mockMutate,
        mutateAsync: vi.fn(),
        isPending: false,
        isError: false,
        error: null,
      } as unknown as ReturnType<typeof trpc.card.importCards.useMutation>;
    });

    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByText('Import CSV'));

    const csvContent = 'front,back\nCapital of Spain,Madrid\n';
    const file = new File([csvContent], 'cards.csv', { type: 'text/csv' });
    await user.upload(screen.getByTestId('csv-file-input'), file);

    await vi.waitFor(() => {
      expect(screen.getByText('Import Preview')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(mockMutate).toHaveBeenCalledWith({
      deckId: 'deck-1',
      new: [{ front: 'Capital of Spain', canonicalAnswers: ['Madrid'] }],
      update: [],
    });
  });

  it('shows header validation error inline for bad CSV', async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByText('Import CSV'));

    const file = new File(['bad,headers\na,b\n'], 'cards.csv', {
      type: 'text/csv',
    });
    await user.upload(screen.getByTestId('csv-file-input'), file);

    await vi.waitFor(() => {
      expect(
        screen.getByText(/must have "front" and "back" headers/i),
      ).toBeInTheDocument();
    });

    // Preview dialog should NOT open
    expect(screen.queryByText('Import Preview')).not.toBeInTheDocument();
  });

  it('closes preview dialog on Cancel without importing', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.card.importCards.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.card.importCards.useMutation>);

    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByText('Import CSV'));

    const file = new File(['front,back\nNew Q,New A\n'], 'cards.csv', {
      type: 'text/csv',
    });
    await user.upload(screen.getByTestId('csv-file-input'), file);

    await vi.waitFor(() => {
      expect(screen.getByText('Import Preview')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    await vi.waitFor(() => {
      expect(screen.queryByText('Import Preview')).not.toBeInTheDocument();
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('renders deck title and Cards tab active', () => {
    setupMocks();
    renderDeckCardsPage();

    expect(screen.getByText('World Capitals')).toBeInTheDocument();
    const cardsTab = screen.getByRole('tab', { name: /cards/i });
    expect(cardsTab).toHaveAttribute('aria-selected', 'true');
  });

  it('makes deck title editable on click', async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByText('World Capitals'));

    const titleInput = screen.getByDisplayValue('World Capitals');
    expect(titleInput).toBeInTheDocument();
    expect(titleInput.tagName).toBe('INPUT');
  });

  it('debounce-saves deck name when edited', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.deck.update.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.deck.update.useMutation>);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDeckCardsPage();

    await user.click(screen.getByText('World Capitals'));
    const titleInput = screen.getByDisplayValue('World Capitals');
    await user.clear(titleInput);
    await user.type(titleInput, 'European Capitals');

    // Not called yet (debounced)
    expect(mockMutate).not.toHaveBeenCalled();

    // Advance past debounce delay
    vi.advanceTimersByTime(900);

    expect(mockMutate).toHaveBeenCalledWith({
      id: 'deck-1',
      name: 'European Capitals',
    });

    vi.useRealTimers();
  });

  it('debounce-saves card text when edited', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.card.update.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.card.update.useMutation>);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDeckCardsPage();

    const frontTextarea = screen.getByDisplayValue('Capital of France');
    await user.clear(frontTextarea);
    await user.type(frontTextarea, 'Capital of Italy');

    expect(mockMutate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(900);

    expect(mockMutate).toHaveBeenCalledWith({
      cardId: 'card-1',
      front: 'Capital of Italy',
      canonicalAnswers: [{ id: 'answer-Paris', text: 'Paris' }],
    });

    vi.useRealTimers();
  });

  it('keeps "||" in a tile\'s back as part of its primary answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.card.update.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.card.update.useMutation>);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDeckCardsPage();

    await user.type(screen.getByDisplayValue('Berlin'), ' || Bonn');
    vi.advanceTimersByTime(900);

    expect(mockMutate).toHaveBeenCalledWith({
      cardId: 'card-2',
      front: 'Capital of Germany',
      canonicalAnswers: [{ id: 'answer-Berlin', text: 'Berlin || Bonn' }],
    });
    vi.useRealTimers();
  });

  it('calls delete mutation when card delete is confirmed', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.card.delete.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.card.delete.useMutation>);

    const user = userEvent.setup();
    renderDeckCardsPage();

    const deleteButtons = screen.getAllByTitle('Delete card');
    await user.click(deleteButtons[0]);

    const confirmButton = await screen.findByRole('button', {
      name: /^delete$/i,
    });
    await user.click(confirmButton);

    expect(mockMutate).toHaveBeenCalledWith({ cardId: 'card-1' });
  });

  it('does not delete card when confirmation is cancelled', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.card.delete.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.card.delete.useMutation>);

    const user = userEvent.setup();
    renderDeckCardsPage();

    const deleteButtons = screen.getAllByTitle('Delete card');
    await user.click(deleteButtons[0]);

    const cancelButton = await screen.findByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('archives the deck after a confirmation saying what is kept, then goes to Flashcards', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.deck.archive.useMutation).mockImplementation(((opts?: {
      onSuccess?: () => void;
    }) => {
      return {
        ...defaultMutationReturn,
        mutate: vi.fn((...args: unknown[]) => {
          mockMutate(...args);
          opts?.onSuccess?.();
        }),
      } as unknown as ReturnType<typeof trpc.deck.archive.useMutation>;
    }) as unknown as typeof trpc.deck.archive.useMutation);

    const user = userEvent.setup();
    renderDeckCardsPage();

    expect(
      screen.queryByRole('button', { name: /delete deck/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /archive deck/i }));
    expect(
      screen.getByText(/its cards and their history are kept/i),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /^archive$/i }));

    expect(mockMutate).toHaveBeenCalledWith({ id: 'deck-1' });
    expect(mockNavigate).toHaveBeenCalledWith('/flashcards');
  });

  it('does not archive the deck when the confirmation is cancelled', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.deck.archive.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.deck.archive.useMutation>);

    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('button', { name: /archive deck/i }));
    await user.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('offers no Archive on a Course Deck while its course is active', () => {
    setupMocks({
      deck: { course: { id: 'course-1', title: 'Italian', archivedAt: null } },
    });
    renderDeckCardsPage();

    expect(
      screen.queryByRole('button', { name: /archive deck/i }),
    ).not.toBeInTheDocument();
  });

  describe('an archived deck', () => {
    it('shows its cards read only, saying it is archived, with Restore', () => {
      setupMocks({ deck: { archivedAt: '2026-10-01T12:00:00.000Z' } });
      renderDeckCardsPage();

      expect(screen.getByText(/this deck is archived/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Restore deck' }),
      ).toBeInTheDocument();
      const list = within(screen.getByRole('list', { name: 'Cards' }));
      expect(list.getAllByRole('listitem')).toHaveLength(2);
      expect(list.getByText('Capital of France')).toBeInTheDocument();
      expect(list.getByText('Paris')).toBeInTheDocument();
    });

    it('offers nothing that would change it', () => {
      setupMocks({
        deck: { archivedAt: '2026-10-01T12:00:00.000Z' },
        canUseAI: true,
      });
      renderDeckCardsPage();

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      // Its tiles aren't buttons
      expect(screen.queryByText(/new card/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/import csv/i)).not.toBeInTheDocument();
      for (const name of [
        /select cards/i,
        /revise cards/i,
        /archive deck/i,
        /mark known/i,
      ]) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      }
      expect(
        screen.getByRole('heading', { name: 'World Capitals' }),
      ).toBeInTheDocument();
    });
  });

  it('shows flip buttons on card tiles', () => {
    setupMocks();
    renderDeckCardsPage();

    const flipButtons = screen.getAllByTitle('Flip to back');
    expect(flipButtons.length).toBe(2);
  });

  it('reverts card changes when revert button is clicked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.card.update.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.card.update.useMutation>);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDeckCardsPage();

    const frontTextarea = screen.getByDisplayValue('Capital of France');
    await user.clear(frontTextarea);
    await user.type(frontTextarea, 'Something else');

    // Revert button should appear
    const revertButton = screen.getAllByTitle('Revert changes')[0];
    expect(revertButton).toBeInTheDocument();
    await user.click(revertButton);

    // Should revert to original value
    expect(screen.getByDisplayValue('Capital of France')).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue('Something else'),
    ).not.toBeInTheDocument();

    // Advance timers — debounced save should NOT fire since we reverted
    vi.advanceTimersByTime(900);
    expect(mockMutate).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  describe('accepted variants', () => {
    function mockUpdate() {
      const mockMutate = vi.fn();
      vi.mocked(trpc.card.update.useMutation).mockReturnValue({
        ...defaultMutationReturn,
        mutate: mockMutate,
      } as unknown as ReturnType<typeof trpc.card.update.useMutation>);
      return mockMutate;
    }

    /** Opens a card's answers below it; `dialog` is that panel. */
    async function openVariants(front: string) {
      const user = userEvent.setup();
      renderDeckCardsPage();
      await user.click(
        screen.getByRole('button', { name: `Answers of ${front}` }),
      );
      return {
        user,
        dialog: screen.getByRole('region', { name: `Answers of ${front}` }),
      };
    }

    it("lists a card's Accepted Variants and adds one, saved with Save", async () => {
      setupMocks();
      const mockMutate = mockUpdate();

      const { user, dialog } = await openVariants('Capital of France');
      const variants = within(dialog).getByRole('list', {
        name: 'Accepted variants of Paris',
      });
      expect(within(variants).getByText('Paree')).toBeInTheDocument();

      await user.type(
        within(dialog).getByLabelText('New accepted variant of Paris'),
        'City of Light',
      );
      await user.click(
        within(dialog).getByRole('button', { name: 'Add variant of Paris' }),
      );
      expect(within(variants).getByText('City of Light')).toBeInTheDocument();
      expect(
        within(dialog).getByLabelText('New accepted variant of Paris'),
      ).toHaveValue('');
      expect(mockMutate).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(mockMutate).toHaveBeenCalledWith({
        cardId: 'card-1',
        canonicalAnswers: [
          {
            id: 'answer-Paris',
            text: 'Paris',
            acceptedVariants: ['Paree', 'City of Light'],
          },
        ],
      });
    });

    it('adds a typed variant not yet added on Save', async () => {
      setupMocks();
      const mockMutate = mockUpdate();

      const { user, dialog } = await openVariants('Capital of France');
      await user.type(
        within(dialog).getByLabelText('New accepted variant of Paris'),
        'Lutetia',
      );

      expect(dialog).not.toHaveTextContent(/not added yet/i);
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(mockMutate).toHaveBeenCalledWith({
        cardId: 'card-1',
        canonicalAnswers: [
          {
            id: 'answer-Paris',
            text: 'Paris',
            acceptedVariants: ['Paree', 'Lutetia'],
          },
        ],
      });
    });

    it('removes an Accepted Variant with Save', async () => {
      setupMocks();
      const mockMutate = mockUpdate();

      const { user, dialog } = await openVariants('Capital of France');
      await user.click(
        within(dialog).getByRole('button', { name: 'Remove Paree' }),
      );
      expect(within(dialog).queryByText('Paree')).not.toBeInTheDocument();
      expect(mockMutate).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(mockMutate).toHaveBeenCalledWith({
        cardId: 'card-1',
        canonicalAnswers: [
          { id: 'answer-Paris', text: 'Paris', acceptedVariants: [] },
        ],
      });
    });

    it('says when a variant is already accepted, and leaves it out', async () => {
      setupMocks();
      const mockMutate = mockUpdate();

      const { user, dialog } = await openVariants('Capital of France');
      await user.type(
        within(dialog).getByLabelText('New accepted variant of Paris'),
        'paree!',
      );

      expect(dialog).toHaveTextContent(/already accepted/i);
      expect(
        within(dialog).getByRole('button', { name: 'Add variant of Paris' }),
      ).toBeDisabled();
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      // Nothing changed, so nothing to save
      expect(mockMutate).not.toHaveBeenCalled();
    });

    it('gives a newly added answer variants', async () => {
      setupMocks();
      const mockMutate = mockUpdate();

      const { user, dialog } = await openVariants('Capital of Germany');
      await user.click(
        within(dialog).getByRole('button', { name: 'Add answer' }),
      );
      await user.type(within(dialog).getByLabelText('Answer 2'), 'Bonn');
      await user.type(
        within(dialog).getByLabelText('New accepted variant of Bonn'),
        'Bonna{Enter}',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(mockMutate).toHaveBeenCalledWith({
        cardId: 'card-2',
        canonicalAnswers: [
          { id: 'answer-Berlin', text: 'Berlin', acceptedVariants: [] },
          { text: 'Bonn', acceptedVariants: ['Bonna'] },
        ],
      });
    });

    it("keeps a retyped answer's variants, removing those that no longer fit", async () => {
      setupMocks();
      const mockMutate = mockUpdate();

      const { user, dialog } = await openVariants('Capital of France');
      await user.clear(within(dialog).getByLabelText('Answer 1'));
      await user.type(within(dialog).getByLabelText('Answer 1'), 'Paname');
      expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
      const variants = within(dialog).getByRole('list', {
        name: 'Accepted variants of Paname',
      });
      await user.click(
        within(variants).getByRole('button', { name: 'Remove Paree' }),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(mockMutate).toHaveBeenCalledWith({
        cardId: 'card-1',
        canonicalAnswers: [
          { id: 'answer-Paris', text: 'Paname', acceptedVariants: [] },
        ],
      });
    });

    it('flags a variant that is now one of the answers, holding off Save', async () => {
      setupMocks();
      const { user, dialog } = await openVariants('Capital of France');

      await user.clear(within(dialog).getByLabelText('Answer 1'));
      await user.type(within(dialog).getByLabelText('Answer 1'), 'Paree');

      expect(dialog).toHaveTextContent(/same as an answer/i);
      expect(
        within(dialog).getByRole('button', { name: 'Save' }),
      ).toBeDisabled();
      await user.click(
        within(dialog).getByRole('button', { name: 'Remove Paree' }),
      );
      expect(
        within(dialog).getByRole('button', { name: 'Save' }),
      ).toBeEnabled();
    });

    it('drops variant changes on Cancel', async () => {
      setupMocks();
      const mockMutate = mockUpdate();

      const { user, dialog } = await openVariants('Capital of France');
      await user.click(
        within(dialog).getByRole('button', { name: 'Remove Paree' }),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await user.click(
        screen.getByRole('button', { name: 'Answers of Capital of France' }),
      );

      expect(mockMutate).not.toHaveBeenCalled();
      expect(
        screen.getByRole('list', { name: 'Accepted variants of Paris' }),
      ).toHaveTextContent('Paree');
    });

    it('says why a save was refused', async () => {
      setupMocks();
      vi.mocked(trpc.card.update.useMutation).mockImplementation(((opts?: {
        onError?: (error: unknown) => void;
      }) => ({
        ...defaultMutationReturn,
        mutate: vi.fn(() =>
          opts?.onError?.({
            message: '“Lutèce” is already accepted',
            data: { code: 'CONFLICT' },
          }),
        ),
      })) as unknown as typeof trpc.card.update.useMutation);

      const { user, dialog } = await openVariants('Capital of France');
      await user.type(
        within(dialog).getByLabelText('New accepted variant of Paris'),
        'Lutèce{Enter}',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(toast.error).toHaveBeenCalledWith('“Lutèce” is already accepted');
    });

    describe('changing an answer that has variants', () => {
      function mockUpdate() {
        const mockMutate = vi.fn();
        vi.mocked(trpc.card.update.useMutation).mockReturnValue({
          ...defaultMutationReturn,
          mutate: mockMutate,
        } as unknown as ReturnType<typeof trpc.card.update.useMutation>);
        return mockMutate;
      }

      async function changeAnswer(from: string, to: string) {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({
          advanceTimers: vi.advanceTimersByTime,
        });
        renderDeckCardsPage();
        const answer = screen.getByDisplayValue(from);
        await user.clear(answer);
        await user.type(answer, to);
        vi.advanceTimersByTime(900);
        return user;
      }

      afterEach(() => {
        vi.useRealTimers();
      });

      it('waits until you leave the answer, then asks which variants still fit', async () => {
        setupMocks();
        const mockMutate = mockUpdate();
        const user = await changeAnswer('Paris', 'Lutetia');
        expect(mockMutate).not.toHaveBeenCalled();

        await user.tab();
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent(/from “Paris” to “Lutetia”/);
        expect(
          within(dialog).getByRole('checkbox', { name: 'Paree' }),
        ).toBeChecked();
        await user.click(within(dialog).getByRole('button', { name: 'Save' }));

        expect(mockMutate).toHaveBeenCalledWith({
          cardId: 'card-1',
          front: 'Capital of France',
          canonicalAnswers: [
            {
              id: 'answer-Paris',
              text: 'Lutetia',
              acceptedVariants: ['Paree'],
            },
          ],
        });
      });

      it('puts the answer back when you cancel', async () => {
        setupMocks();
        const mockMutate = mockUpdate();
        const user = await changeAnswer('Paris', 'Lutetia');

        await user.tab();
        await user.click(await screen.findByRole('button', { name: 'Cancel' }));

        expect(mockMutate).not.toHaveBeenCalled();
        expect(screen.getByDisplayValue('Paris')).toBeInTheDocument();
      });

      it('reverts a changed answer without asking about variants', async () => {
        setupMocks();
        const mockMutate = mockUpdate();
        const user = await changeAnswer('Paris', 'Lutetia');

        const reverts = screen.getAllByTitle('Revert changes');
        await user.click(reverts[reverts.length - 1]);
        await user.tab();

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByDisplayValue('Paris')).toBeInTheDocument();
        expect(mockMutate).not.toHaveBeenCalled();
      });

      it('still saves the answer of a card with no variants as you type', async () => {
        setupMocks();
        const mockMutate = mockUpdate();
        await changeAnswer('Berlin', 'Bonn');

        expect(mockMutate).toHaveBeenCalledWith({
          cardId: 'card-2',
          front: 'Capital of Germany',
          canonicalAnswers: [{ id: 'answer-Berlin', text: 'Bonn' }],
        });
      });
    });
  });

  describe("a card's answers, below it", () => {
    const primes = {
      id: 'card-3',
      deckId: 'deck-1',
      front: 'A prime between 10 and 20',
      position: 2,
      canonicalAnswers: [
        { id: 'answer-11', text: '11', isPrimary: true, acceptedVariants: [] },
        {
          id: 'answer-13',
          text: '13',
          isPrimary: false,
          acceptedVariants: [],
        },
      ],
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      reverseVariants: [],
      knownDirections: [],
    };

    function mockUpdate() {
      const mockMutate = vi.fn();
      vi.mocked(trpc.card.update.useMutation).mockReturnValue({
        ...defaultMutationReturn,
        mutate: mockMutate,
      } as unknown as ReturnType<typeof trpc.card.update.useMutation>);
      return mockMutate;
    }

    async function openAnswers(front: string) {
      const user = userEvent.setup();
      renderDeckCardsPage();
      await user.click(
        screen.getByRole('button', { name: `Answers of ${front}` }),
      );
      return {
        user,
        panel: screen.getByRole('region', { name: `Answers of ${front}` }),
      };
    }

    it("sums up each card's answers and variants below it", () => {
      setupMocks({ cards: [...mockCards, primes] });
      renderDeckCardsPage();

      expect(
        screen.getByRole('button', { name: 'Answers of Capital of France' }),
      ).toHaveTextContent('ParisVariants: Paree');
      expect(
        screen.getByRole('button', {
          name: 'Answers of A prime between 10 and 20',
        }),
      ).toHaveTextContent('11, 13');
    });

    it("opens one card's answers at a time", async () => {
      setupMocks();
      const { user } = await openAnswers('Capital of France');

      await user.click(
        screen.getByRole('button', { name: 'Answers of Capital of Germany' }),
      );

      expect(
        screen.queryByRole('region', { name: 'Answers of Capital of France' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('region', { name: 'Answers of Capital of Germany' }),
      ).toBeInTheDocument();
    });

    it('adds an answer, saved with Save', async () => {
      setupMocks();
      const mockMutate = mockUpdate();
      const { user, panel } = await openAnswers('Capital of Germany');

      await user.click(
        within(panel).getByRole('button', { name: 'Add answer' }),
      );
      await user.type(within(panel).getByLabelText('Answer 2'), 'Bonn');
      expect(mockMutate).not.toHaveBeenCalled();
      await user.click(within(panel).getByRole('button', { name: 'Save' }));

      expect(mockMutate).toHaveBeenCalledWith({
        cardId: 'card-2',
        canonicalAnswers: [
          { id: 'answer-Berlin', text: 'Berlin', acceptedVariants: [] },
          { text: 'Bonn', acceptedVariants: [] },
        ],
      });
    });

    it('explains answers where they are added, and variants where they are added', async () => {
      setupMocks();
      const { panel } = await openAnswers('Capital of Germany');

      expect(
        within(panel).getByRole('button', { name: 'Add answer' }),
      ).toHaveAccessibleDescription(
        'Answers are different correct answers, each right on its own, like 11, 13 and 17 for “a prime between 10 and 20”. Changing them starts the card’s progress over.',
      );
      expect(
        within(panel).getByLabelText('New accepted variant of Berlin'),
      ).toHaveAccessibleDescription(
        'Variants are other ways to write one answer, such as spellings or forms, like “color” for “colour”. They never reset progress.',
      );
      expect(panel).not.toHaveTextContent('||');
    });

    it('shows only the box to add one for an answer without variants', async () => {
      setupMocks();
      const { panel } = await openAnswers('Capital of Germany');

      expect(panel).not.toHaveTextContent(/none yet/i);
      expect(
        within(panel).getByLabelText('New accepted variant of Berlin'),
      ).toHaveAttribute('placeholder', 'Add variant');
    });

    it('keeps "||" typed into an answer as plain text', async () => {
      setupMocks();
      const mockMutate = mockUpdate();
      const { user, panel } = await openAnswers('Capital of Germany');

      await user.type(within(panel).getByLabelText('Answer 1'), ' || Bonn');

      expect(within(panel).getByLabelText('Answer 1')).toHaveValue(
        'Berlin || Bonn',
      );
      expect(
        within(panel).queryByLabelText('Answer 2'),
      ).not.toBeInTheDocument();
      await user.click(within(panel).getByRole('button', { name: 'Save' }));
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          canonicalAnswers: [
            {
              id: 'answer-Berlin',
              text: 'Berlin || Bonn',
              acceptedVariants: [],
            },
          ],
        }),
      );
    });

    it('chooses the primary answer and removes one', async () => {
      setupMocks({ cards: [...mockCards, primes] });
      const mockMutate = mockUpdate();
      const { user, panel } = await openAnswers('A prime between 10 and 20');

      await user.click(
        within(panel).getByRole('radio', { name: 'Answer 2 is primary' }),
      );
      expect(within(panel).getByLabelText('Answer 1')).toHaveValue('13');
      await user.click(
        within(panel).getByRole('button', { name: 'Add answer' }),
      );
      await user.type(within(panel).getByLabelText('Answer 3'), '17');
      await user.click(
        within(panel).getByRole('button', { name: 'Remove answer 2' }),
      );
      await user.click(within(panel).getByRole('button', { name: 'Save' }));

      expect(mockMutate).toHaveBeenCalledWith({
        cardId: 'card-3',
        canonicalAnswers: [
          { id: 'answer-13', text: '13', acceptedVariants: [] },
          { text: '17', acceptedVariants: [] },
        ],
      });
    });

    it("won't remove a card's only answer", async () => {
      setupMocks();
      const { panel } = await openAnswers('Capital of Germany');

      expect(
        within(panel).getByRole('button', { name: 'Remove answer 1' }),
      ).toBeDisabled();
    });

    it('discards the changes on Cancel', async () => {
      setupMocks();
      const mockMutate = mockUpdate();
      const { user, panel } = await openAnswers('Capital of Germany');

      await user.type(within(panel).getByLabelText('Answer 1'), 'er');
      await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
      await user.click(
        screen.getByRole('button', { name: 'Answers of Capital of Germany' }),
      );

      expect(mockMutate).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Answer 1')).toHaveValue('Berlin');
    });
  });

  describe('revising cards', () => {
    const proposal = {
      model: 'claude-sonnet-5-5',
      promptVersion: 'card-revision-v1',
      changes: [
        {
          action: 'EDIT' as const,
          cardId: 'card-1',
          before: {
            front: 'Capital of France',
            canonicalAnswer: 'Paris',
            acceptedVariants: ['Paree'],
          },
          after: { front: 'The capital of France', canonicalAnswer: 'Paris' },
        },
        {
          action: 'DELETE' as const,
          cardId: 'card-2',
          before: {
            front: 'Capital of Germany',
            canonicalAnswer: 'Berlin',
            acceptedVariants: [],
          },
        },
      ],
      note: null,
    };

    it('is offered to a learner who can use AI', () => {
      setupMocks({ canUseAI: true });
      renderDeckCardsPage();

      expect(
        screen.getByRole('button', { name: /revise cards/i }),
      ).toBeInTheDocument();
    });

    it("isn't offered to a learner who can't use AI, or on a deck with no cards", () => {
      setupMocks({ canUseAI: false });
      const { unmount } = renderDeckCardsPage();
      expect(
        screen.queryByRole('button', { name: /revise cards/i }),
      ).not.toBeInTheDocument();
      unmount();

      setupMocks({ canUseAI: true, cards: [] });
      renderDeckCardsPage();
      expect(
        screen.queryByRole('button', { name: /revise cards/i }),
      ).not.toBeInTheDocument();
    });

    it('proposes changes from the instruction the learner writes', async () => {
      const user = userEvent.setup();
      setupMocks({ canUseAI: true });
      const propose = vi.fn();
      vi.mocked(trpc.deck.proposeRevision.useMutation).mockReturnValue({
        ...defaultMutationReturn,
        mutate: propose,
      } as unknown as ReturnType<typeof trpc.deck.proposeRevision.useMutation>);
      renderDeckCardsPage();

      await user.click(screen.getByRole('button', { name: /revise cards/i }));
      const dialog = screen.getByRole('dialog');
      expect(
        within(dialog).getByRole('button', { name: 'Propose changes' }),
      ).toBeDisabled();
      await user.type(
        within(dialog).getByLabelText('Instruction'),
        'Remove the hints from the fronts',
      );
      await user.click(
        within(dialog).getByRole('button', { name: 'Propose changes' }),
      );

      expect(propose).toHaveBeenCalledWith(
        { deckId: 'deck-1', instruction: 'Remove the hints from the fronts' },
        expect.anything(),
      );
    });

    it('starts each revision with a blank instruction', async () => {
      const user = userEvent.setup();
      setupMocks({ canUseAI: true });
      renderDeckCardsPage();

      await user.click(screen.getByRole('button', { name: /revise cards/i }));
      await user.type(screen.getByLabelText('Instruction'), 'Remove the hints');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await user.click(screen.getByRole('button', { name: /revise cards/i }));

      expect(screen.getByLabelText('Instruction')).toHaveValue('');
    });

    it('shows why proposing failed', async () => {
      const user = userEvent.setup();
      setupMocks({ canUseAI: true });
      vi.mocked(trpc.deck.proposeRevision.useMutation).mockReturnValue({
        ...defaultMutationReturn,
        isError: true,
        error: { message: 'Revising works on decks of up to 200 cards' },
      } as unknown as ReturnType<typeof trpc.deck.proposeRevision.useMutation>);
      renderDeckCardsPage();

      await user.click(screen.getByRole('button', { name: /revise cards/i }));

      expect(
        within(screen.getByRole('dialog')).getByText(/up to 200 cards/),
      ).toBeInTheDocument();
    });

    /** proposeRevision's mutate, answering each call with the next proposal. */
    function proposeReplying(...proposals: unknown[]) {
      const propose = vi.fn(
        (
          _input: unknown,
          options?: { onSuccess?: (data: unknown) => void },
        ) => {
          options?.onSuccess?.(proposals[propose.mock.calls.length - 1]);
        },
      );
      vi.mocked(trpc.deck.proposeRevision.useMutation).mockReturnValue({
        ...defaultMutationReturn,
        mutate: propose,
      } as unknown as ReturnType<typeof trpc.deck.proposeRevision.useMutation>);
      return propose;
    }

    async function proposeFrom(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: /revise cards/i }));
      await user.type(screen.getByLabelText('Instruction'), 'Tidy the fronts');
      await user.click(screen.getByRole('button', { name: 'Propose changes' }));
      return screen.getByRole('dialog');
    }

    it('opens the proposal in the preview and applies the approved changes', async () => {
      const user = userEvent.setup();
      setupMocks({ canUseAI: true });
      proposeReplying(proposal);
      const apply = vi.fn();
      vi.mocked(trpc.deck.applyRevision.useMutation).mockReturnValue({
        ...defaultMutationReturn,
        mutate: apply,
      } as unknown as ReturnType<typeof trpc.deck.applyRevision.useMutation>);
      renderDeckCardsPage();

      const preview = await proposeFrom(user);
      expect(within(preview).getByText('Tidy the fronts')).toBeInTheDocument();
      expect(within(preview).getByLabelText('Change 1 front')).toHaveValue(
        'The capital of France',
      );
      await user.click(
        within(preview).getByRole('button', { name: 'Apply 2 changes' }),
      );

      expect(apply).toHaveBeenCalledWith({
        deckId: 'deck-1',
        model: 'claude-sonnet-5-5',
        promptVersion: 'card-revision-v1',
        edits: [{ cardId: 'card-1', front: 'The capital of France' }],
        deletions: ['card-2'],
      });
    });

    it('refines the proposal, showing the new one with every instruction', async () => {
      const user = userEvent.setup();
      setupMocks({ canUseAI: true });
      const propose = proposeReplying(proposal, {
        ...proposal,
        changes: [
          {
            action: 'EDIT' as const,
            cardId: 'card-2',
            before: proposal.changes[1].before,
            after: {
              front: 'The capital of Germany',
              canonicalAnswer: 'Berlin',
            },
          },
        ],
      });
      renderDeckCardsPage();

      const preview = await proposeFrom(user);
      await user.click(within(preview).getByLabelText('Include change 1'));
      await user.click(within(preview).getByRole('button', { name: 'Refine' }));
      await user.type(
        within(preview).getByLabelText('Refinement'),
        'Keep Germany, reworded',
      );
      await user.click(
        within(preview).getByRole('button', { name: 'Propose again' }),
      );

      expect(propose).toHaveBeenLastCalledWith(
        {
          deckId: 'deck-1',
          instruction: 'Keep Germany, reworded',
          refining: {
            instructions: ['Tidy the fronts'],
            changes: [
              {
                cardId: 'card-1',
                action: 'EDIT',
                front: 'The capital of France',
                canonicalAnswer: 'Paris',
                included: false,
              },
              { cardId: 'card-2', action: 'DELETE', included: true },
            ],
          },
        },
        expect.anything(),
      );
      const refined = screen.getByRole('dialog');
      expect(
        within(within(refined).getByRole('list', { name: 'Your instructions' }))
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['Tidy the fronts', 'Keep Germany, reworded']);
      expect(within(refined).getAllByTestId('card-change')).toHaveLength(1);
      expect(within(refined).getByLabelText('Change 1 front')).toHaveValue(
        'The capital of Germany',
      );
      expect(
        within(refined).queryByLabelText('Refinement'),
      ).not.toBeInTheDocument();
    });
  });

  describe('generating cards', () => {
    it('is offered beside the deck’s actions to a learner who can use AI', () => {
      setupMocks({ canUseAI: true });
      renderDeckCardsPage();

      expect(
        screen.getByRole('button', { name: 'Generate cards' }),
      ).toBeInTheDocument();
    });

    it('is offered as a tile beside New Card and Import CSV on an empty deck', () => {
      setupMocks({ canUseAI: true, cards: [] });
      renderDeckCardsPage();

      const tiles = screen
        .getAllByRole('button')
        .map((button) => button.textContent)
        .filter((text) =>
          ['New Card', 'Import CSV', 'Generate cards'].includes(text ?? ''),
        );
      expect(tiles).toEqual(['New Card', 'Import CSV', 'Generate cards']);
    });

    it("isn't offered to a learner who can't use AI", () => {
      setupMocks({ canUseAI: false });
      const { unmount } = renderDeckCardsPage();
      expect(
        screen.queryByRole('button', { name: /generate cards/i }),
      ).not.toBeInTheDocument();
      unmount();

      setupMocks({ canUseAI: false, cards: [] });
      renderDeckCardsPage();
      expect(
        screen.queryByRole('button', { name: /generate cards/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('marking cards known, and acting on a selection', () => {
    function mockMutation(
      procedure: typeof trpc.card.markKnown | typeof trpc.card.deleteMany,
    ) {
      const mutate = vi.fn();
      vi.mocked(procedure.useMutation).mockReturnValue({
        ...defaultMutationReturn,
        mutate,
      } as never);
      return mutate;
    }

    it('marks one card known from its tile', async () => {
      setupMocks();
      const markKnown = mockMutation(trpc.card.markKnown);
      const user = userEvent.setup();
      renderDeckCardsPage();

      await user.click(screen.getAllByTitle('Mark known')[0]);

      expect(markKnown).toHaveBeenCalledWith({ cardIds: ['card-1'] });
    });

    it("doesn't offer Mark known on a card already known", async () => {
      setupMocks({
        cards: [
          mockCards[0],
          { ...mockCards[1], knownDirections: ['FORWARD'] },
        ],
      });
      renderDeckCardsPage();

      // Once on each face of the one card not yet known
      expect(screen.getAllByTitle('Mark known')).toHaveLength(2);
    });

    it('marks the selected cards known, after a confirmation that says how many', async () => {
      setupMocks();
      const markKnown = mockMutation(trpc.card.markKnown);
      const user = userEvent.setup();
      renderDeckCardsPage();

      await user.click(screen.getByRole('button', { name: 'Select cards' }));
      await user.click(screen.getByLabelText('Select “Capital of France”'));
      await user.click(screen.getByLabelText('Select “Capital of Germany”'));
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Mark selected known' }),
      );

      const dialog = screen.getByRole('alertdialog');
      expect(
        within(dialog).getByText('Mark 2 cards known?'),
      ).toBeInTheDocument();
      expect(markKnown).not.toHaveBeenCalled();
      await user.click(
        within(dialog).getByRole('button', { name: 'Mark known' }),
      );

      expect(markKnown).toHaveBeenCalledWith({
        cardIds: ['card-1', 'card-2'],
      });
    });

    it('deletes every card, selected all at once, after a confirmation', async () => {
      setupMocks();
      const deleteMany = mockMutation(trpc.card.deleteMany);
      const user = userEvent.setup();
      renderDeckCardsPage();

      await user.click(screen.getByRole('button', { name: 'Select cards' }));
      await user.click(screen.getByRole('button', { name: 'Select all' }));
      await user.click(screen.getByRole('button', { name: 'Delete selected' }));

      const dialog = screen.getByRole('alertdialog');
      expect(
        within(dialog).getByText(`Delete ${mockCards.length} cards?`),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(deleteMany).toHaveBeenCalledWith({
        cardIds: mockCards.map((card) => card.id),
      });
    });

    it("hides the tiles' own buttons while selecting", async () => {
      setupMocks();
      const user = userEvent.setup();
      renderDeckCardsPage();
      expect(screen.getAllByTitle('Flip to back')).toHaveLength(
        mockCards.length,
      );

      await user.click(screen.getByRole('button', { name: 'Select cards' }));

      for (const title of [
        'Flip to back',
        'Flip to front',
        'Mark known',
        'Delete card',
      ]) {
        expect(screen.queryAllByTitle(title)).toHaveLength(0);
      }
    });

    it('holds off acting on a selection until a card is selected', async () => {
      setupMocks();
      const user = userEvent.setup();
      renderDeckCardsPage();

      await user.click(screen.getByRole('button', { name: 'Select cards' }));

      expect(
        screen.getByRole('button', { name: 'Mark selected known' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Delete selected' }),
      ).toBeDisabled();
    });

    it('stops selecting with Done, clearing the selection', async () => {
      setupMocks();
      const user = userEvent.setup();
      renderDeckCardsPage();

      await user.click(screen.getByRole('button', { name: 'Select cards' }));
      await user.click(screen.getByLabelText('Select “Capital of France”'));
      await user.click(screen.getByRole('button', { name: 'Done' }));

      expect(
        screen.queryByLabelText('Select “Capital of France”'),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Select cards' }));
      expect(screen.getByText('0 selected')).toBeInTheDocument();
    });
  });

  describe('cards shown in full, with edit pencils', () => {
    it("shows a pencil by each face's text at rest", () => {
      setupMocks();
      renderDeckCardsPage();

      expect(
        screen.getAllByRole('button', { name: 'Edit card front' }),
      ).toHaveLength(mockCards.length);
      expect(
        screen.getAllByRole('button', { name: 'Edit card answer' }),
      ).toHaveLength(mockCards.length);
    });

    it("hides a face's pencil and underlines its text while it has focus", async () => {
      setupMocks();
      const user = userEvent.setup();
      renderDeckCardsPage();
      const [front] = screen.getAllByLabelText('Card front');

      await user.click(front);

      expect(
        screen.getAllByRole('button', { name: 'Edit card front' }),
      ).toHaveLength(mockCards.length - 1);
      expect(front).toHaveClass('border-white/60');

      await user.tab();

      expect(
        screen.getAllByRole('button', { name: 'Edit card front' }),
      ).toHaveLength(mockCards.length);
      expect(front).not.toHaveClass('border-white/60');
    });

    it("puts the cursor in a face's text from its pencil", async () => {
      setupMocks();
      const user = userEvent.setup();
      renderDeckCardsPage();

      await user.click(
        screen.getAllByRole('button', { name: 'Edit card front' })[0],
      );

      expect(screen.getAllByLabelText('Card front')[0]).toHaveFocus();
    });

    it("puts the cursor in a face's text from anywhere around it", async () => {
      setupMocks();
      const user = userEvent.setup();
      renderDeckCardsPage();
      const [front] = screen.getAllByLabelText('Card front');

      await user.click(front.closest('[data-tile-field]')!);

      expect(front).toHaveFocus();
    });

    it('takes the answers below each card out of reach while selecting', async () => {
      setupMocks();
      const user = userEvent.setup();
      renderDeckCardsPage();

      await user.click(screen.getByRole('button', { name: 'Select cards' }));

      const summary = screen.getByRole('button', {
        name: 'Answers of Capital of France',
      });
      expect(summary).toBeDisabled();
      expect(summary.querySelector('svg')).toBeNull();
      expect(
        screen.queryAllByRole('button', { name: 'Edit card front' }),
      ).toHaveLength(0);
    });

    it('shows a pencil on the answers below each card', () => {
      setupMocks();
      renderDeckCardsPage();

      expect(
        screen
          .getByRole('button', { name: 'Answers of Capital of France' })
          .querySelector('svg'),
      ).not.toBeNull();
    });

    it('shows a long front, answer and answers list in full', () => {
      const longFront =
        'Which Italian adjective, in its feminine form, means long, as in "La strada è ___"?';
      const answers = ['lunga', 'lunghissima', 'allungata', 'distesa'];
      setupMocks({
        cards: [
          {
            ...mockCards[0],
            front: longFront,
            canonicalAnswers: answers.map((text, i) => ({
              id: `answer-${i}`,
              text,
              isPrimary: i === 0,
              acceptedVariants: [],
            })),
          },
        ],
      });
      renderDeckCardsPage();

      const front = screen.getByLabelText('Card front');
      expect(front).toHaveValue(longFront);
      // Grows to its text instead of a fixed two rows
      expect(front).toHaveClass('field-sizing-content');
      expect(screen.getByLabelText('Card answer')).toHaveClass(
        'field-sizing-content',
      );
      const summary = screen.getByRole('button', {
        name: `Answers of ${longFront}`,
      });
      expect(summary).toHaveTextContent(answers.join(', '));
      for (const line of summary.querySelectorAll('p')) {
        expect(line).not.toHaveClass('truncate');
      }
    });
  });

  describe("a card's version history", () => {
    it("opens a card's history from its tile", async () => {
      setupMocks();
      const user = userEvent.setup();
      renderDeckCardsPage();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(screen.getAllByTitle('History')[0]);

      expect(
        within(screen.getByRole('dialog')).getByText('Card history'),
      ).toBeInTheDocument();
      expect(trpc.card.history.useQuery).toHaveBeenCalledWith({
        cardId: 'card-1',
        direction: 'FORWARD',
      });
    });

    it('hides the History action while selecting cards', async () => {
      setupMocks();
      const user = userEvent.setup();
      renderDeckCardsPage();

      await user.click(screen.getByRole('button', { name: 'Select cards' }));

      expect(screen.queryByTitle('History')).not.toBeInTheDocument();
    });
  });
});

describe('a reversible deck on the Cards tab (#82)', () => {
  function mockDeckUpdate() {
    const mutate = vi.fn();
    vi.mocked(trpc.deck.update.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate,
    } as unknown as ReturnType<typeof trpc.deck.update.useMutation>);
    return mutate;
  }

  const reversible = {
    reversible: true,
    forwardLabel: 'Capitals from countries',
    reverseLabel: null,
  };

  it("edits the deck's description in place below its title", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMocks();
    const update = mockDeckUpdate();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDeckCardsPage();

    await user.click(screen.getByRole('button', { name: 'Add a description' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Deck description' }),
      'Every capital in Europe',
    );
    vi.advanceTimersByTime(900);

    expect(update).toHaveBeenCalledWith({
      id: 'deck-1',
      description: 'Every capital in Europe',
    });
    vi.useRealTimers();
  });

  it('turns Study both ways on', async () => {
    setupMocks();
    const update = mockDeckUpdate();
    const user = userEvent.setup();
    renderDeckCardsPage();

    const toggle = screen.getByRole('switch', { name: 'Study both ways' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    // Its labels show only while it's on
    expect(screen.queryByRole('button', { name: /label/i })).toBeNull();
    await user.click(toggle);

    expect(update).toHaveBeenCalledWith({ id: 'deck-1', reversible: true });
  });

  it('turns it off', async () => {
    setupMocks({ deck: reversible });
    const update = mockDeckUpdate();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('switch', { name: 'Study both ways' }));

    expect(update).toHaveBeenCalledWith({ id: 'deck-1', reversible: false });
  });

  it('edits the Direction Labels in place beside it, Reverse standing in for a blank one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMocks({ deck: reversible });
    const update = mockDeckUpdate();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderDeckCardsPage();

    expect(screen.getByText('Capitals from countries')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Edit the Reverse label' }),
    );
    const label = screen.getByRole('textbox', { name: 'Reverse label' });
    expect(label).toHaveAttribute('placeholder', 'Reverse');
    expect(label).toHaveAttribute('maxLength', '40');
    await user.type(label, 'Countries from capitals');
    vi.advanceTimersByTime(900);

    expect(update).toHaveBeenCalledWith({
      id: 'deck-1',
      reverseLabel: 'Countries from capitals',
    });
    vi.useRealTimers();
  });

  it("warns about cards Reverse can't tell apart, naming them", () => {
    const sharing = {
      ...mockCards[1],
      id: 'card-3',
      front: 'Capital of the French Republic',
      canonicalAnswers: [
        {
          ...mockCards[0].canonicalAnswers[0],
          id: 'answer-paris-2',
          text: 'paris',
        },
      ],
    };
    setupMocks({ deck: reversible, cards: [...mockCards, sharing] });
    renderDeckCardsPage();

    const warning = screen.getByRole('status', { name: /can.t tell apart/i });
    expect(warning).toHaveTextContent('Capital of France');
    expect(warning).toHaveTextContent('Capital of the French Republic');
    expect(warning).not.toHaveTextContent('Capital of Germany');
  });

  it("doesn't warn on a deck studied one way", () => {
    setupMocks({
      cards: [
        mockCards[0],
        { ...mockCards[1], canonicalAnswers: mockCards[0].canonicalAnswers },
      ],
    });
    renderDeckCardsPage();

    expect(
      screen.queryByRole('status', { name: /can.t tell apart/i }),
    ).toBeNull();
  });

  it('asks which direction to mark a card known', async () => {
    setupMocks({ deck: reversible });
    const markKnown = vi.fn();
    vi.mocked(trpc.card.markKnown.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: markKnown,
    } as never);
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getAllByTitle('Mark known')[0]);
    const dialog = screen.getByRole('alertdialog');
    expect(markKnown).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Reverse' }));

    expect(markKnown).toHaveBeenCalledWith({
      cardIds: ['card-1'],
      directions: ['REVERSE'],
    });
  });

  it('asks which direction to mark a selection known, offering both', async () => {
    setupMocks({ deck: reversible });
    const markKnown = vi.fn();
    vi.mocked(trpc.card.markKnown.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: markKnown,
    } as never);
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('button', { name: 'Select cards' }));
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await user.click(
      screen.getByRole('button', { name: 'Mark selected known' }),
    );
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Both ways',
      }),
    );

    expect(markKnown).toHaveBeenCalledWith({
      cardIds: ['card-1', 'card-2'],
      directions: ['FORWARD', 'REVERSE'],
    });
  });

  it("shows a card's Reverse Variants below it and adds one, saved with Save", async () => {
    setupMocks({
      deck: reversible,
      cards: [
        { ...mockCards[0], reverseVariants: [{ id: 'rv-1', text: 'France!' }] },
      ],
    });
    const update = vi.fn();
    vi.mocked(trpc.card.update.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: update,
    } as unknown as ReturnType<typeof trpc.card.update.useMutation>);
    const user = userEvent.setup();
    renderDeckCardsPage();

    const summary = screen.getByRole('button', {
      name: 'Answers of Capital of France',
    });
    expect(summary).toHaveTextContent('Reverse variants: France!');
    await user.click(summary);
    await user.type(
      screen.getByLabelText('New Reverse variant of Capital of France'),
      'French Republic',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId: 'card-1',
        reverseVariants: ['France!', 'French Republic'],
      }),
    );
  });
});

describe('the glow on what Enter will press (#94)', () => {
  it("glows the new card's arrows only while their side's box has focus", async () => {
    setupMocks({ cards: [] });
    const user = userEvent.setup();
    renderDeckCardsPage();
    await user.click(screen.getByText('New Card'));
    const front = screen.getByRole('textbox', { name: 'Front' });
    // The front's arrow, beside its box, flips to the back
    const [flip] = screen
      .getAllByRole('button', { name: /flip to back/i })
      .filter((button) => button.querySelector('.lucide-corner-down-left'));

    await user.type(front, 'Capital of Spain');
    expect(flip).toHaveClass('animate-pulse-halo');
    act(() => front.blur());
    expect(flip).not.toHaveClass('animate-pulse-halo');

    act(() => front.focus());
    await user.keyboard('{Enter}');
    const back = screen.getByRole('textbox', { name: 'Back' });
    act(() => back.focus());
    await user.type(back, 'Madrid');
    const create = screen.getByRole('button', { name: 'Create card' });
    expect(create).toHaveClass('animate-pulse-halo');
    act(() => back.blur());
    expect(create).not.toHaveClass('animate-pulse-halo');
  });
});

describe('AI-suggested Direction Labels (#83)', () => {
  const reversible = {
    reversible: true,
    forwardLabel: null,
    reverseLabel: null,
  };

  /** Deck saves that succeed, as the API's would. */
  function mockDeckUpdates() {
    const mutate = vi.fn(
      (_input: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    vi.mocked(trpc.deck.update.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate,
    } as unknown as ReturnType<typeof trpc.deck.update.useMutation>);
    return mutate;
  }

  /** Suggestions that answer with `outcome`, as the API would. */
  function mockSuggestions(
    outcome: { labels: object } | { error: string } = {
      labels: {
        forwardLabel: 'Capitals from countries',
        reverseLabel: 'Countries from capitals',
      },
    },
  ) {
    const mutate = vi.fn();
    vi.mocked(trpc.deck.suggestDirectionLabels.useMutation).mockImplementation(
      ((opts?: {
        onSuccess?: (labels: object) => void;
        onError?: (error: { message: string }) => void;
      }) => ({
        ...defaultMutationReturn,
        mutate: mutate.mockImplementation(() =>
          'labels' in outcome
            ? opts?.onSuccess?.(outcome.labels)
            : opts?.onError?.({ message: outcome.error }),
        ),
      })) as unknown as typeof trpc.deck.suggestDirectionLabels.useMutation,
    );
    return mutate;
  }

  it('asks for labels once Study both ways is turned on, for a learner who can use AI', async () => {
    setupMocks({ canUseAI: true });
    const update = mockDeckUpdates();
    const suggest = mockSuggestions();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('switch', { name: 'Study both ways' }));

    expect(update).toHaveBeenCalledWith(
      { id: 'deck-1', reversible: true },
      expect.anything(),
    );
    expect(suggest).toHaveBeenCalledWith({ deckId: 'deck-1' });
  });

  it("doesn't ask when Study both ways is turned off", async () => {
    setupMocks({ canUseAI: true, deck: reversible });
    mockDeckUpdates();
    const suggest = mockSuggestions();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('switch', { name: 'Study both ways' }));

    expect(suggest).not.toHaveBeenCalled();
  });

  it('asks nothing and offers nothing to a learner who can’t use AI', async () => {
    setupMocks({ canUseAI: false });
    mockDeckUpdates();
    const suggest = mockSuggestions();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('switch', { name: 'Study both ways' }));

    expect(suggest).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Suggest labels' })).toBeNull();
  });

  it('asks again with Suggest labels beside the fields', async () => {
    setupMocks({ canUseAI: true, deck: reversible });
    const suggest = mockSuggestions();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('button', { name: 'Suggest labels' }));

    expect(suggest).toHaveBeenCalledWith({ deckId: 'deck-1' });
  });

  it('fills the fields with the suggestions once saved', async () => {
    setupMocks({ canUseAI: true, deck: reversible });
    mockSuggestions();
    const user = userEvent.setup();
    const { rerenderPage } = renderDeckCardsPage();
    await user.click(screen.getByRole('button', { name: 'Suggest labels' }));

    // The deck as the API saved it, refetched
    setupMocks({
      canUseAI: true,
      deck: {
        ...reversible,
        forwardLabel: 'Capitals from countries',
        reverseLabel: 'Countries from capitals',
      },
    });
    rerenderPage();

    expect(screen.getByText('Capitals from countries')).toBeInTheDocument();
    expect(screen.getByText('Countries from capitals')).toBeInTheDocument();
  });

  it('keeps a label the learner is typing when the suggestions arrive', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setupMocks({ canUseAI: true, deck: reversible });
    const update = mockDeckUpdates();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rerenderPage } = renderDeckCardsPage();
    await user.click(
      screen.getByRole('button', { name: 'Edit the Reverse label' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Reverse label' }),
      'Countries',
    );

    setupMocks({
      canUseAI: true,
      deck: { ...reversible, reverseLabel: 'Countries from capitals' },
    });
    mockDeckUpdates().mockImplementation(update);
    rerenderPage();
    vi.advanceTimersByTime(900);

    expect(screen.getByRole('textbox', { name: 'Reverse label' })).toHaveValue(
      'Countries',
    );
    expect(update).toHaveBeenLastCalledWith({
      id: 'deck-1',
      reverseLabel: 'Countries',
    });
    vi.useRealTimers();
  });

  it("doesn't ask when turned on with both labels the learner's own", async () => {
    setupMocks({
      canUseAI: true,
      deck: {
        reversible: false,
        forwardLabel: 'Capitals',
        reverseLabel: 'Countries',
      },
    });
    mockDeckUpdates();
    const suggest = mockSuggestions();
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('switch', { name: 'Study both ways' }));

    expect(suggest).not.toHaveBeenCalled();
  });

  it('says the labels are kept when both are the learner’s own', async () => {
    setupMocks({
      canUseAI: true,
      deck: {
        ...reversible,
        forwardLabel: 'Capitals',
        reverseLabel: 'Countries',
      },
    });
    mockSuggestions({
      labels: {
        forwardLabel: 'Capitals',
        reverseLabel: 'Countries',
        suggested: false,
      },
    });
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('button', { name: 'Suggest labels' }));

    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/your own/i),
    );
  });

  it('shows a suggestion that lands while a label is open but untyped, once it closes', async () => {
    setupMocks({ canUseAI: true, deck: reversible });
    const user = userEvent.setup();
    const { rerenderPage } = renderDeckCardsPage();
    await user.click(
      screen.getByRole('button', { name: 'Edit the Forward label' }),
    );

    setupMocks({
      canUseAI: true,
      deck: { ...reversible, forwardLabel: 'Capitals from countries' },
    });
    rerenderPage();
    await user.keyboard('{Enter}');

    expect(
      screen.getByRole('button', { name: 'Edit the Forward label' }),
    ).toHaveTextContent('Capitals from countries');
  });

  it('says why a suggestion failed, leaving the fields as they were', async () => {
    setupMocks({ canUseAI: true, deck: reversible });
    mockSuggestions({ error: 'AI is paused for the rest of the month' });
    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('button', { name: 'Suggest labels' }));

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('AI is paused for the rest of the month'),
    );
    expect(
      screen.getByRole('button', { name: 'Edit the Forward label' }),
    ).toHaveTextContent('Forward');
  });
});
