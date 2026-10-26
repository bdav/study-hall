import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
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
      addVariant: { useMutation: vi.fn() },
      removeVariant: { useMutation: vi.fn() },
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

  vi.mocked(trpc.card.addVariant.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.card.addVariant.useMutation>);

  vi.mocked(trpc.card.removeVariant.useMutation).mockReturnValue({
    ...defaultMutationReturn,
  } as unknown as ReturnType<typeof trpc.card.removeVariant.useMutation>);
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
      canonicalAnswer: 'Madrid',
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
      new: [{ front: 'Capital of Spain', canonicalAnswer: 'Madrid' }],
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
      canonicalAnswer: 'Paris',
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
    type AddVariantOptions = Parameters<
      typeof trpc.card.addVariant.useMutation
    >[0];

    async function openVariants(front: string) {
      const user = userEvent.setup();
      renderDeckCardsPage();
      await user.click(
        screen.getByRole('button', { name: `Accepted variants for ${front}` }),
      );
      return { user, dialog: await screen.findByRole('dialog') };
    }

    it("lists a card's Accepted Variants and adds one", async () => {
      setupMocks();
      const mockAdd = vi.fn();
      vi.mocked(trpc.card.addVariant.useMutation).mockImplementation(((
        opts?: AddVariantOptions,
      ) => ({
        ...defaultMutationReturn,
        mutate: mockAdd.mockImplementation((input) =>
          opts?.onSuccess?.(
            {
              ...mockCards[0],
              canonicalAnswers: [
                {
                  ...mockCards[0].canonicalAnswers[0],
                  acceptedVariants: [
                    { id: 'variant-paree', text: 'Paree' },
                    { id: 'variant-new', text: input.text },
                  ],
                },
              ],
            } as never,
            input as never,
            undefined,
            {} as never,
          ),
        ),
      })) as unknown as typeof trpc.card.addVariant.useMutation);

      const { user, dialog } = await openVariants('Capital of France');
      const variants = within(dialog).getByRole('list', {
        name: 'Accepted variants',
      });
      expect(within(variants).getByText('Paree')).toBeInTheDocument();

      await user.type(
        within(dialog).getByLabelText('New accepted variant'),
        'City of Light',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Add' }));

      expect(mockAdd).toHaveBeenCalledWith({
        canonicalAnswerId: 'answer-Paris',
        text: 'City of Light',
      });
      expect(mockInvalidateCards).toHaveBeenCalledWith({ deckId: 'deck-1' });
    });

    it('removes an Accepted Variant', async () => {
      setupMocks();
      const mockRemove = vi.fn();
      vi.mocked(trpc.card.removeVariant.useMutation).mockReturnValue({
        ...defaultMutationReturn,
        mutate: mockRemove,
      } as unknown as ReturnType<typeof trpc.card.removeVariant.useMutation>);

      const { user, dialog } = await openVariants('Capital of France');
      await user.click(
        within(dialog).getByRole('button', { name: 'Remove Paree' }),
      );

      expect(mockRemove).toHaveBeenCalledWith({ variantId: 'variant-paree' });
    });

    it('says when a variant is already accepted', async () => {
      setupMocks();
      vi.mocked(trpc.card.addVariant.useMutation).mockImplementation(((
        opts?: AddVariantOptions,
      ) => ({
        ...defaultMutationReturn,
        mutate: vi.fn((input) =>
          opts?.onError?.(
            {
              message: 'That answer is already accepted',
              data: { code: 'CONFLICT' },
            } as never,
            input as never,
            undefined,
            {} as never,
          ),
        ),
      })) as unknown as typeof trpc.card.addVariant.useMutation);

      const { user, dialog } = await openVariants('Capital of Germany');
      expect(dialog).toHaveTextContent(/none yet/i);
      await user.type(
        within(dialog).getByLabelText('New accepted variant'),
        'berlin{Enter}',
      );

      expect(toast.error).toHaveBeenCalledWith(
        'That answer is already accepted',
      );
      expect(within(dialog).getByLabelText('New accepted variant')).toHaveValue(
        'berlin',
      );
    });
  });
});
