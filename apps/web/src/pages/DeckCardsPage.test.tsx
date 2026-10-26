import { render, screen, within } from '@testing-library/react';
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
      deck: { list: { invalidate: vi.fn() }, getById: { invalidate: vi.fn() } },
    })),
    deck: {
      getById: { useQuery: vi.fn() },
      update: { useMutation: vi.fn() },
      delete: { useMutation: vi.fn() },
    },
    card: {
      listByDeck: { useQuery: vi.fn() },
      create: { useMutation: vi.fn() },
      update: { useMutation: vi.fn() },
      delete: { useMutation: vi.fn() },
      importCards: { useMutation: vi.fn() },
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
  },
];

function renderDeckCardsPage(deckId = 'deck-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/decks/${deckId}/cards`]}>
        <Routes>
          <Route path="/decks/:deckId/cards" element={<DeckCardsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const defaultMutationReturn = {
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

function setupMocks(overrides?: {
  cards?: typeof mockCards | [];
  deckLoading?: boolean;
  cardsLoading?: boolean;
  deckError?: boolean;
}) {
  vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
    data: overrides?.deckError
      ? undefined
      : { id: 'deck-1', name: 'World Capitals', cards: [] },
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

  vi.mocked(trpc.deck.update.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.deck.update.useMutation>);

  vi.mocked(trpc.deck.delete.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.deck.delete.useMutation>);
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

  it('calls deck delete and navigates to Flashcards when confirmed', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.deck.delete.useMutation).mockImplementation(((opts?: {
      onSuccess?: () => void;
    }) => {
      return {
        ...defaultMutationReturn,
        mutate: vi.fn((...args: unknown[]) => {
          mockMutate(...args);
          opts?.onSuccess?.();
        }),
      } as unknown as ReturnType<typeof trpc.deck.delete.useMutation>;
    }) as unknown as typeof trpc.deck.delete.useMutation);

    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('button', { name: /delete deck/i }));

    const confirmButton = await screen.findByRole('button', {
      name: /^delete$/i,
    });
    await user.click(confirmButton);

    expect(mockMutate).toHaveBeenCalledWith({ id: 'deck-1' });
    expect(mockNavigate).toHaveBeenCalledWith('/flashcards');
  });

  it('does not delete deck when confirmation is cancelled', async () => {
    setupMocks();
    const mockMutate = vi.fn();
    vi.mocked(trpc.deck.delete.useMutation).mockReturnValue({
      ...defaultMutationReturn,
      mutate: mockMutate,
    } as unknown as ReturnType<typeof trpc.deck.delete.useMutation>);

    const user = userEvent.setup();
    renderDeckCardsPage();

    await user.click(screen.getByRole('button', { name: /delete deck/i }));

    const cancelButton = await screen.findByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(mockMutate).not.toHaveBeenCalled();
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
      ).toHaveTextContent('11 · also 13');
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
});
