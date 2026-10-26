import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudyPage from './StudyPage';
import { trpc } from '@/lib/trpc';

// Mock tRPC hooks
const mockInvalidateDeck = vi.fn();
const mockInvalidateCards = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      deck: { getById: { invalidate: mockInvalidateDeck } },
      card: { listByDeck: { invalidate: mockInvalidateCards } },
    })),
    card: {
      update: { useMutation: vi.fn() },
      delete: { useMutation: vi.fn() },
      addVariant: { useMutation: vi.fn() },
      removeVariant: { useMutation: vi.fn() },
    },
    deck: {
      getById: {
        useQuery: vi.fn(),
      },
    },
    study: {
      startSession: { useMutation: vi.fn() },
      submitAnswer: { useMutation: vi.fn() },
      dontKnow: { useMutation: vi.fn() },
      finishSession: { useMutation: vi.fn() },
      acceptAnswer: { useMutation: vi.fn() },
    },
  },
}));

const mockDeck = {
  id: 'deck-1',
  name: 'Test Deck',
  userId: 'user-1',
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  cards: [
    {
      id: 'card-1',
      deckId: 'deck-1',
      front: 'What is 2+2?',
      canonicalAnswers: [
        {
          id: 'answer-4',
          text: '4',
          isPrimary: true,
          acceptedVariants: [] as { id: string; text: string }[],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'card-2',
      deckId: 'deck-1',
      front: 'Capital of France?',
      canonicalAnswers: [
        {
          id: 'answer-Paris',
          text: 'Paris',
          isPrimary: true,
          acceptedVariants: [],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
};

// The session startSession hands back: one item per deck card, in order.
const mockSession = {
  id: 'session-1',
  items: mockDeck.cards.map((card, i) => ({ id: `item-${i + 1}`, card })),
};

function renderStudyPage(deckId = 'deck-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/decks/${deckId}`]}>
        <Routes>
          <Route path="/decks/:deckId" element={<StudyPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setupMocksWithStartSession(resultOverride?: 'correct' | 'incorrect') {
  vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
    data: mockDeck,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof trpc.deck.getById.useQuery>);

  vi.mocked(trpc.study.startSession.useMutation).mockImplementation(((opts?: {
    onSuccess?: (data: typeof mockSession | null) => void;
  }) => {
    return {
      mutate: vi.fn(() => {
        opts?.onSuccess?.(mockSession);
      }),
      mutateAsync: vi.fn(),
    } as unknown as ReturnType<typeof trpc.study.startSession.useMutation>;
  }) as unknown as typeof trpc.study.startSession.useMutation);

  vi.mocked(trpc.study.submitAnswer.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn((args) => {
      return Promise.resolve({
        id: 'attempt-1',
        userAnswer: args.userAnswer,
        recallGrade: resultOverride === 'incorrect' ? 'MISSED' : 'NAILED',
      });
    }),
  } as unknown as ReturnType<typeof trpc.study.submitAnswer.useMutation>);

  vi.mocked(trpc.study.dontKnow.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(() =>
      Promise.resolve({
        id: 'attempt-1',
        userAnswer: null,
        recallGrade: 'MISSED',
      }),
    ),
  } as unknown as ReturnType<typeof trpc.study.dontKnow.useMutation>);

  vi.mocked(trpc.study.finishSession.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn((args) => {
      return Promise.resolve({
        id: args.id,
        endedAt: new Date(),
        userId: 'user-1',
        deckId: 'deck-1',
        startedAt: new Date(),
      });
    }),
  } as unknown as ReturnType<typeof trpc.study.finishSession.useMutation>);
}

function setupBasicMocks() {
  vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
    data: mockDeck,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof trpc.deck.getById.useQuery>);

  vi.mocked(trpc.study.startSession.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof trpc.study.startSession.useMutation>);

  vi.mocked(trpc.study.submitAnswer.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof trpc.study.submitAnswer.useMutation>);

  vi.mocked(trpc.study.dontKnow.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof trpc.study.dontKnow.useMutation>);

  vi.mocked(trpc.study.finishSession.useMutation).mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof trpc.study.finishSession.useMutation>);
}

const mockUpdateCard = vi.fn();
const mockDeleteCard = vi.fn();
const mockAddVariant = vi.fn();
const mockRemoveVariant = vi.fn();

type UpdateOptions = Parameters<typeof trpc.card.update.useMutation>[0];
type DeleteOptions = Parameters<typeof trpc.card.delete.useMutation>[0];
type AddVariantOptions = Parameters<typeof trpc.card.addVariant.useMutation>[0];
type RemoveVariantOptions = Parameters<
  typeof trpc.card.removeVariant.useMutation
>[0];

/** card-1, the "What is 2+2?" card, with the given variants of its answer. */
function cardOneWithVariants(variants: { id: string; text: string }[]) {
  const [card] = mockDeck.cards;
  return {
    ...card,
    canonicalAnswers: [
      { ...card.canonicalAnswers[0], acceptedVariants: variants },
    ],
  };
}

/**
 * Card edits and deletions that succeed straight away, answering the way
 * the API does.
 */
function mockCardMutations() {
  vi.mocked(trpc.card.update.useMutation).mockImplementation(((
    opts?: UpdateOptions,
  ) => ({
    mutate: mockUpdateCard.mockImplementation(
      (input: { cardId: string; front: string; canonicalAnswer: string }) =>
        opts?.onSuccess?.(
          {
            id: input.cardId,
            front: input.front,
            canonicalAnswers: [
              {
                id: 'answer-new',
                text: input.canonicalAnswer,
                isPrimary: true,
                acceptedVariants: [],
              },
            ],
          } as never,
          input as never,
          undefined,
          {} as never,
        ),
    ),
    isPending: false,
  })) as unknown as typeof trpc.card.update.useMutation);
  vi.mocked(trpc.card.delete.useMutation).mockImplementation(((
    opts?: DeleteOptions,
  ) => ({
    mutate: mockDeleteCard.mockImplementation((input: { cardId: string }) =>
      opts?.onSuccess?.(
        { success: true } as never,
        input as never,
        undefined,
        {} as never,
      ),
    ),
    isPending: false,
  })) as unknown as typeof trpc.card.delete.useMutation);
  vi.mocked(trpc.card.addVariant.useMutation).mockImplementation(((
    opts?: AddVariantOptions,
  ) => ({
    mutate: mockAddVariant.mockImplementation(
      (input: { canonicalAnswerId: string; text: string }) =>
        opts?.onSuccess?.(
          cardOneWithVariants([
            { id: 'variant-four', text: 'four' },
            { id: 'variant-new', text: input.text },
          ]) as never,
          input as never,
          undefined,
          {} as never,
        ),
    ),
    isPending: false,
  })) as unknown as typeof trpc.card.addVariant.useMutation);
  vi.mocked(trpc.card.removeVariant.useMutation).mockImplementation(((
    opts?: RemoveVariantOptions,
  ) => ({
    mutate: mockRemoveVariant.mockImplementation(
      (input: { variantId: string }) =>
        opts?.onSuccess?.(
          cardOneWithVariants([]) as never,
          input as never,
          undefined,
          {} as never,
        ),
    ),
    isPending: false,
  })) as unknown as typeof trpc.card.removeVariant.useMutation);
}

const mockAcceptAnswer = vi.fn();

/** "My answer was correct" succeeding, regraded through a new variant. */
function mockAcceptAnswerMutation() {
  vi.mocked(trpc.study.acceptAnswer.useMutation).mockReturnValue({
    mutateAsync: mockAcceptAnswer.mockImplementation(() =>
      Promise.resolve({
        recallGrade: 'NAILED',
        accentMismatch: false,
        matchedVariant: 'four',
        card: cardOneWithVariants([{ id: 'variant-four', text: 'four' }]),
      }),
    ),
    isPending: false,
  } as unknown as ReturnType<typeof trpc.study.acceptAnswer.useMutation>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCardMutations();
  mockAcceptAnswerMutation();
});

describe('StudyPage', () => {
  it('shows deck name and start button before studying', () => {
    setupBasicMocks();
    renderStudyPage();
    expect(
      screen.getByRole('heading', { name: /test deck/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /test deck/i }),
    ).toBeInTheDocument();
  });

  it('shows card front and answer input after starting', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));

    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
    // Correct answer should not be visible yet
    expect(screen.queryByTestId('correct-answer')).not.toBeInTheDocument();
  });

  it('shows correct result with question and answer on card', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), '4');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('Nailed it');
    });
    // Card shows both question and correct answer
    const answerArea = screen.getByTestId('correct-answer');
    expect(answerArea).toHaveTextContent('What is 2+2?');
    expect(answerArea).toHaveTextContent('4');
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('shows incorrect result after submitting wrong answer', async () => {
    setupMocksWithStartSession('incorrect');

    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), '5');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('Needs review');
    });
    const answerArea = screen.getByTestId('correct-answer');
    expect(answerArea).toHaveTextContent('4');
  });

  it('submits answer on Enter key press', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), '4{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('Nailed it');
    });
  });

  it('advances to next card on Enter key during result phase', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), '4');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('Nailed it');
    });

    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Capital of France?')).toBeInTheDocument();
    });
    expect(screen.getByText('Card 2 of 2')).toBeInTheDocument();
  });

  it('shows progress indicator during study', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));

    expect(screen.getByText('Card 1 of 2')).toBeInTheDocument();
  });

  it('advances to next card after clicking Next', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), '4');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText('Capital of France?')).toBeInTheDocument();
    });
    expect(screen.getByText('Card 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows session complete after answering all cards', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    // Card 1
    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), '4');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /next/i }));

    // Card 2
    await waitFor(() => {
      expect(screen.getByText('Capital of France?')).toBeInTheDocument();
    });
    await user.type(screen.getByRole('textbox'), 'Paris');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /session complete/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/you answered 2 of 2 cards/i)).toBeInTheDocument();
  });

  it('moves on after a miss without bringing the card back', async () => {
    setupMocksWithStartSession('incorrect');
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    for (const answer of ['5', 'Lyon']) {
      await user.type(screen.getByRole('textbox'), answer);
      await user.click(screen.getByRole('button', { name: /submit/i }));
      await waitFor(() => {
        expect(screen.getByTestId('result')).toHaveTextContent('Needs review');
      });
      await user.click(screen.getByRole('button', { name: /next/i }));
    }

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /session complete/i }),
      ).toBeInTheDocument();
    });
  });

  it("records I don't know as a miss and shows the answer", async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.click(screen.getByRole('button', { name: /i don't know/i }));

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('Needs review');
    });
    expect(screen.getByTestId('correct-answer')).toHaveTextContent('4');
    expect(
      vi.mocked(trpc.study.dontKnow.useMutation).mock.results[0]?.value
        .mutateAsync,
    ).toHaveBeenCalledWith({ itemId: 'item-1' });
  });

  it('finishes the session early and summarises the cards answered', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), '4{Enter}');
    await waitFor(() => {
      expect(screen.getByTestId('result')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /finish session/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /session complete/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/you answered 1 of 2 cards/i)).toBeInTheDocument();
    expect(
      vi.mocked(trpc.study.finishSession.useMutation).mock.results[0]?.value
        .mutateAsync,
    ).toHaveBeenCalledWith({ id: 'session-1' });
  });

  it('shows an error and stays on the card when finishing fails', async () => {
    setupMocksWithStartSession();
    vi.mocked(trpc.study.finishSession.useMutation).mockReturnValue({
      mutateAsync: vi.fn(() => Promise.reject(new Error('network'))),
    } as unknown as ReturnType<typeof trpc.study.finishSession.useMutation>);
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.click(screen.getByRole('button', { name: /finish session/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to finish/i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('heading', { name: /session complete/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
  });

  it('shows the accented answer and flags the accents after an Accent Mismatch', async () => {
    setupMocksWithStartSession();
    vi.mocked(trpc.study.submitAnswer.useMutation).mockReturnValue({
      mutateAsync: vi.fn((args) =>
        Promise.resolve({
          id: 'attempt-1',
          userAnswer: args.userAnswer,
          recallGrade: 'GOOD',
          accentMismatch: true,
        }),
      ),
    } as unknown as ReturnType<typeof trpc.study.submitAnswer.useMutation>);
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), '4{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('Good');
    });
    expect(screen.getByTestId('accent-note')).toHaveTextContent(
      /check the accents/i,
    );
    expect(screen.getByTestId('correct-answer')).toHaveTextContent('4');
  });

  it('labels your answer below the graded card', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), 'Four{Enter}');

    expect(
      await screen.findByRole('group', { name: 'Your answer' }),
    ).toHaveTextContent('Four');
  });

  it('says when the answer matched an Accepted Variant', async () => {
    setupMocksWithStartSession();
    vi.mocked(trpc.study.submitAnswer.useMutation).mockReturnValue({
      mutateAsync: vi.fn((args) =>
        Promise.resolve({
          id: 'attempt-1',
          userAnswer: args.userAnswer,
          recallGrade: 'NAILED',
          accentMismatch: false,
          matchedVariant: 'four',
        }),
      ),
    } as unknown as ReturnType<typeof trpc.study.submitAnswer.useMutation>);
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), 'Four{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('Nailed it');
    });
    expect(screen.getByTestId('variant-note')).toHaveTextContent(
      /accepted variant .*four/i,
    );
  });

  it('says nothing about variants when the Canonical Answer matched', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.type(screen.getByRole('textbox'), '4{Enter}');

    await screen.findByTestId('result');
    expect(screen.queryByTestId('variant-note')).not.toBeInTheDocument();
  });

  it('summarises the session by grade and offers another session', async () => {
    setupMocksWithStartSession();
    const grades = ['NAILED', 'MISSED'];
    vi.mocked(trpc.study.submitAnswer.useMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn((args) =>
        Promise.resolve({
          id: 'attempt',
          userAnswer: args.userAnswer,
          recallGrade: grades.shift(),
        }),
      ),
    } as unknown as ReturnType<typeof trpc.study.submitAnswer.useMutation>);
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    for (const answer of ['4', 'Lyon']) {
      await user.type(screen.getByRole('textbox'), `${answer}{Enter}`);
      await waitFor(() => {
        expect(screen.getByTestId('result')).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /next/i }));
    }

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /session complete/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('1 Nailed it')).toBeInTheDocument();
    expect(screen.getByText('1 Needs review')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /start another session/i }),
    );

    await waitFor(() => {
      expect(screen.getByText('Card 1 of 2')).toBeInTheDocument();
    });
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
  });

  it('says there is nothing to study when no session starts', async () => {
    setupMocksWithStartSession();
    vi.mocked(trpc.study.startSession.useMutation).mockImplementation(
      ((opts?: { onSuccess?: (data: null) => void }) =>
        ({
          mutate: vi.fn(() => opts?.onSuccess?.(null)),
        }) as unknown as ReturnType<
          typeof trpc.study.startSession.useMutation
        >) as unknown as typeof trpc.study.startSession.useMutation,
    );
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));

    expect(screen.getByText(/nothing is due right now/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('does not submit when answer is empty', async () => {
    setupMocksWithStartSession();
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    // Should still be on the same card, no result shown
    expect(screen.queryByTestId('result')).not.toBeInTheDocument();
    expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    expect(
      vi.mocked(trpc.study.submitAnswer.useMutation).mock.results[0]?.value
        .mutateAsync,
    ).not.toHaveBeenCalled();
  });

  it('shows error state when deck query fails', () => {
    setupBasicMocks();
    vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as ReturnType<typeof trpc.deck.getById.useQuery>);

    renderStudyPage();
    expect(screen.getByText(/error loading deck/i)).toBeInTheDocument();
  });

  it('shows empty deck message when deck has no cards', () => {
    setupBasicMocks();
    vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
      data: { ...mockDeck, cards: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof trpc.deck.getById.useQuery>);

    renderStudyPage();
    expect(screen.getByText(/this deck has no cards/i)).toBeInTheDocument();
    const addCardsLink = screen.getByRole('link', { name: /add cards/i });
    expect(addCardsLink).toHaveAttribute('href', '/decks/deck-1/cards');
  });

  it('shows loading state while deck is loading', () => {
    setupBasicMocks();
    vi.mocked(trpc.deck.getById.useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as ReturnType<typeof trpc.deck.getById.useQuery>);

    renderStudyPage();
    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  describe('"My answer was correct"', () => {
    async function answerFirstCard(
      answer: string,
      grade: 'correct' | 'incorrect' = 'incorrect',
    ) {
      setupMocksWithStartSession(grade);
      const user = userEvent.setup();
      renderStudyPage();
      await user.click(screen.getByRole('button', { name: /test deck/i }));
      await user.type(screen.getByRole('textbox'), `${answer}{Enter}`);
      await screen.findByTestId('result');
      return user;
    }

    const myAnswerWasCorrect = { name: 'My answer was correct' };

    it('accepts a missed answer and shows it graded again', async () => {
      const user = await answerFirstCard('four');
      expect(screen.getByTestId('result')).toHaveTextContent('Needs review');

      await user.click(screen.getByRole('button', myAnswerWasCorrect));

      expect(mockAcceptAnswer).toHaveBeenCalledWith({ attemptId: 'attempt-1' });
      await waitFor(() => {
        expect(screen.getByTestId('result')).toHaveTextContent('Nailed it');
      });
      expect(screen.getByTestId('variant-note')).toHaveTextContent('four');
      expect(
        screen.queryByRole('button', myAnswerWasCorrect),
      ).not.toBeInTheDocument();
    });

    it('counts the accepted answer in the session summary', async () => {
      const user = await answerFirstCard('four');
      await user.click(screen.getByRole('button', myAnswerWasCorrect));
      await waitFor(() => {
        expect(screen.getByTestId('result')).toHaveTextContent('Nailed it');
      });

      await user.click(screen.getByRole('button', { name: /finish session/i }));

      expect(await screen.findByText('1 Nailed it')).toBeInTheDocument();
      expect(screen.queryByText(/needs review/i)).not.toBeInTheDocument();
    });

    it('is not offered after "I don\'t know"', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();
      await user.click(screen.getByRole('button', { name: /test deck/i }));
      await user.click(screen.getByRole('button', { name: "I don't know" }));
      await screen.findByTestId('result');

      expect(
        screen.queryByRole('button', myAnswerWasCorrect),
      ).not.toBeInTheDocument();
    });

    it('is not offered after an answer graded right', async () => {
      await answerFirstCard('4', 'correct');

      expect(
        screen.queryByRole('button', myAnswerWasCorrect),
      ).not.toBeInTheDocument();
    });

    it('is not offered once the card was edited after the answer', async () => {
      const user = await answerFirstCard('four');
      await user.click(screen.getByRole('button', { name: 'Card options' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
      await user.type(screen.getByLabelText('Front'), ' exactly{Enter}');

      expect(
        screen.queryByRole('button', myAnswerWasCorrect),
      ).not.toBeInTheDocument();
    });

    it('says so when accepting fails, keeping the miss', async () => {
      const user = await answerFirstCard('four');
      mockAcceptAnswer.mockImplementation(() =>
        Promise.reject(new Error('Network error')),
      );

      await user.click(screen.getByRole('button', myAnswerWasCorrect));

      expect(
        await screen.findByText(/couldn't accept your answer/i),
      ).toBeInTheDocument();
      expect(screen.getByTestId('result')).toHaveTextContent('Needs review');
    });
  });

  describe('editing and deleting cards', () => {
    async function startStudying() {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();
      await user.click(screen.getByRole('button', { name: /test deck/i }));
      return user;
    }

    /** Starts studying with card-1's answer, "4", accepting "four". */
    async function startStudyingWithVariants() {
      setupMocksWithStartSession();
      const session = {
        ...mockSession,
        items: [
          {
            id: 'item-1',
            card: cardOneWithVariants([{ id: 'variant-four', text: 'four' }]),
          },
          mockSession.items[1],
        ],
      };
      vi.mocked(trpc.study.startSession.useMutation).mockImplementation(
        ((opts?: { onSuccess?: (data: typeof session) => void }) => ({
          mutate: vi.fn(() => opts?.onSuccess?.(session)),
          mutateAsync: vi.fn(),
        })) as unknown as typeof trpc.study.startSession.useMutation,
      );
      const user = userEvent.setup();
      renderStudyPage();
      await user.click(screen.getByRole('button', { name: /test deck/i }));
      return user;
    }

    async function chooseFromCardMenu(
      user: ReturnType<typeof userEvent.setup>,
      item: 'Edit' | 'Delete',
    ) {
      await user.click(screen.getByRole('button', { name: 'Card options' }));
      await user.click(await screen.findByRole('menuitem', { name: item }));
    }

    it('offers no card menu before the session starts', () => {
      setupBasicMocks();
      renderStudyPage();

      expect(
        screen.queryByRole('button', { name: 'Card options' }),
      ).not.toBeInTheDocument();
    });

    it('edits the card and goes on studying the edited card', async () => {
      const user = await startStudying();

      await chooseFromCardMenu(user, 'Edit');
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByLabelText('Front')).toHaveValue(
        'What is 2+2?',
      );
      expect(within(dialog).getByLabelText('Answer')).toHaveValue('4');
      expect(dialog).toHaveTextContent(/progress starts over/i);
      await user.clear(within(dialog).getByLabelText('Front'));
      await user.type(within(dialog).getByLabelText('Front'), 'What is 2+3?');
      await user.clear(within(dialog).getByLabelText('Answer'));
      await user.type(within(dialog).getByLabelText('Answer'), '5');
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+3?',
        canonicalAnswer: '5',
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('What is 2+3?')).toBeInTheDocument();
      expect(mockInvalidateDeck).toHaveBeenCalledWith({ id: 'deck-1' });
    });

    it("won't save a blank front or answer", async () => {
      const user = await startStudying();

      await chooseFromCardMenu(user, 'Edit');
      await user.clear(screen.getByLabelText('Answer'));

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('saves an edit with Enter without moving on from an answered card', async () => {
      const user = await startStudying();
      await user.type(screen.getByRole('textbox'), '4');
      await user.click(screen.getByRole('button', { name: /submit/i }));
      await screen.findByTestId('result');

      await chooseFromCardMenu(user, 'Edit');
      await user.type(screen.getByLabelText('Front'), ' exactly{Enter}');

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2? exactly',
        canonicalAnswer: '4',
      });
      // Still on the answered card, not the next one
      expect(screen.queryByText('Capital of France?')).not.toBeInTheDocument();
      expect(screen.getByTestId('correct-answer')).toHaveTextContent(
        'What is 2+2? exactly',
      );
    });

    it('says an answered card was graded before it was edited', async () => {
      const user = await startStudying();
      await user.type(screen.getByRole('textbox'), '4');
      await user.click(screen.getByRole('button', { name: /submit/i }));
      await screen.findByTestId('result');
      expect(screen.queryByText(/graded before/i)).not.toBeInTheDocument();

      await chooseFromCardMenu(user, 'Edit');
      await user.clear(screen.getByLabelText('Answer'));
      await user.type(screen.getByLabelText('Answer'), 'four{Enter}');

      expect(screen.getByTestId('correct-answer')).toHaveTextContent('four');
      expect(
        screen.getByText(
          "Graded before you edited this card. It doesn't count toward the card's progress.",
        ),
      ).toBeInTheDocument();
    });

    it("adds and removes the answer's Accepted Variants without saying the card was edited", async () => {
      const user = await startStudyingWithVariants();
      await user.type(screen.getByRole('textbox'), 'four');
      await user.click(screen.getByRole('button', { name: /submit/i }));
      await screen.findByTestId('result');

      await chooseFromCardMenu(user, 'Edit');
      const variants = within(screen.getByRole('dialog')).getByRole('list', {
        name: 'Accepted variants',
      });
      expect(within(variants).getByText('four')).toBeInTheDocument();

      await user.type(
        screen.getByLabelText('New accepted variant'),
        ' IV {Enter}',
      );
      expect(mockAddVariant).toHaveBeenCalledWith({
        canonicalAnswerId: 'answer-4',
        text: 'IV',
      });
      expect(within(variants).getByText('IV')).toBeInTheDocument();
      expect(screen.getByLabelText('New accepted variant')).toHaveValue('');
      // Adding a variant saves it without saving the card form
      expect(mockUpdateCard).not.toHaveBeenCalled();
      expect(mockInvalidateCards).toHaveBeenCalledWith({ deckId: 'deck-1' });

      await user.click(
        within(variants).getByRole('button', { name: 'Remove four' }),
      );
      expect(mockRemoveVariant).toHaveBeenCalledWith({
        variantId: 'variant-four',
      });
      expect(within(variants).queryByText('four')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText(/graded before/i)).not.toBeInTheDocument();
    });

    it('closes without saving or calling the card edited when Save follows only a variant change', async () => {
      const user = await startStudyingWithVariants();
      await user.type(screen.getByRole('textbox'), 'IV{Enter}');
      await screen.findByTestId('result');

      await chooseFromCardMenu(user, 'Edit');
      await user.type(
        screen.getByLabelText('New accepted variant'),
        'IV{Enter}',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByText(/graded before/i)).not.toBeInTheDocument();
    });

    it("won't save the card while a typed variant hasn't been added", async () => {
      const user = await startStudyingWithVariants();

      await chooseFromCardMenu(user, 'Edit');
      await user.type(screen.getByLabelText('New accepted variant'), 'IV');

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      expect(screen.getByRole('dialog')).toHaveTextContent(/not added yet/i);

      await user.click(screen.getByRole('button', { name: 'Add' }));
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(screen.getByRole('dialog')).not.toHaveTextContent(
        /not added yet/i,
      );
    });

    it('asks which variants still fit when the answer changes, all kept unless unticked', async () => {
      const user = await startStudyingWithVariants();

      await chooseFromCardMenu(user, 'Edit');
      await user.clear(screen.getByLabelText('Answer'));
      await user.type(screen.getByLabelText('Answer'), 'IV');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent(/from “4” to “IV”/);
      const four = within(dialog).getByRole('checkbox', { name: 'four' });
      expect(four).toBeChecked();
      await user.click(four);
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswer: 'IV',
        keepVariantIds: [],
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('unticks a variant the new answer has become', async () => {
      const user = await startStudyingWithVariants();

      await chooseFromCardMenu(user, 'Edit');
      await user.clear(screen.getByLabelText('Answer'));
      await user.type(screen.getByLabelText('Answer'), 'Four{Enter}');

      const dialog = screen.getByRole('dialog');
      const four = within(dialog).getByRole('checkbox', { name: /four/ });
      expect(four).not.toBeChecked();
      expect(four).toBeDisabled();
      expect(dialog).toHaveTextContent(/same as the new answer/i);
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswer: 'Four',
        keepVariantIds: [],
      });
    });

    it('keeps the ticked variants of a changed answer', async () => {
      const user = await startStudyingWithVariants();

      await chooseFromCardMenu(user, 'Edit');
      await user.type(screen.getByLabelText('Answer'), ' exactly{Enter}');
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Save',
        }),
      );

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswer: '4 exactly',
        keepVariantIds: ['variant-four'],
      });
    });

    it('goes back to the edit from the question about variants, saving nothing', async () => {
      const user = await startStudyingWithVariants();

      await chooseFromCardMenu(user, 'Edit');
      await user.type(screen.getByLabelText('Answer'), '!{Enter}');
      await user.click(screen.getByRole('button', { name: 'Back' }));

      expect(mockUpdateCard).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Answer')).toHaveValue('4!');
    });

    it("doesn't ask about variants when only the front changes", async () => {
      const user = await startStudyingWithVariants();

      await chooseFromCardMenu(user, 'Edit');
      await user.type(screen.getByLabelText('Front'), ' exactly{Enter}');

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2? exactly',
        canonicalAnswer: '4',
      });
    });

    it('deletes the card once confirmed and moves on to the next', async () => {
      const user = await startStudying();

      await chooseFromCardMenu(user, 'Delete');
      const dialog = screen.getByRole('alertdialog');
      expect(mockDeleteCard).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(mockDeleteCard).toHaveBeenCalledWith({ cardId: 'card-1' });
      expect(await screen.findByText('Capital of France?')).toBeInTheDocument();
      expect(screen.getByText('Card 1 of 1')).toBeInTheDocument();
    });

    it('leaves a deleted card out of the session summary', async () => {
      const user = await startStudying();
      await user.type(screen.getByRole('textbox'), '4');
      await user.click(screen.getByRole('button', { name: /submit/i }));
      await screen.findByTestId('result');

      await chooseFromCardMenu(user, 'Delete');
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Delete',
        }),
      );
      await screen.findByText('Capital of France?');
      await user.click(screen.getByRole('button', { name: /finish session/i }));

      expect(
        await screen.findByRole('heading', { name: /session complete/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/you answered 0 of 1 cards/i),
      ).toBeInTheDocument();
    });

    /** Answers the first card, moves on, then goes Back to review it. */
    async function reviewFirstCard(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByRole('textbox'), '4');
      await user.click(screen.getByRole('button', { name: /submit/i }));
      await screen.findByTestId('result');
      await user.click(screen.getByRole('button', { name: /next/i }));
      await screen.findByText('Capital of France?');
      await user.click(screen.getByRole('button', { name: /previous/i }));
      await waitFor(() =>
        expect(
          screen.queryByText('Capital of France?'),
        ).not.toBeInTheDocument(),
      );
    }

    it('edits a card reviewed with Back', async () => {
      const user = await startStudying();
      await reviewFirstCard(user);

      await chooseFromCardMenu(user, 'Edit');
      expect(screen.getByLabelText('Front')).toHaveValue('What is 2+2?');
      await user.type(screen.getByLabelText('Front'), ' exactly{Enter}');

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2? exactly',
        canonicalAnswer: '4',
      });
      expect(screen.getByTestId('correct-answer')).toHaveTextContent(
        'What is 2+2? exactly',
      );
      expect(
        screen.getByText(
          "Graded before you edited this card. It doesn't count toward the card's progress.",
        ),
      ).toBeInTheDocument();
    });

    it('deletes a card reviewed with Back, and the session goes on without it', async () => {
      const user = await startStudying();
      await reviewFirstCard(user);

      await chooseFromCardMenu(user, 'Delete');
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Delete',
        }),
      );
      expect(mockDeleteCard).toHaveBeenCalledWith({ cardId: 'card-1' });

      // No answered cards are left to review, so forward returns to the
      // card in play
      await user.click(screen.getByRole('button', { name: /next/i }));
      expect(await screen.findByText('Capital of France?')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getAllByText('Card 1 of 1').length).toBeGreaterThan(0),
      );
      expect(screen.queryByText('What is 2+2?')).not.toBeInTheDocument();
    });

    it('finishes the session when its last card is deleted', async () => {
      const user = await startStudying();

      for (const front of ['What is 2+2?', 'Capital of France?']) {
        await screen.findByText(front);
        await chooseFromCardMenu(user, 'Delete');
        await user.click(
          within(screen.getByRole('alertdialog')).getByRole('button', {
            name: 'Delete',
          }),
        );
      }

      expect(
        await screen.findByRole('heading', { name: /session complete/i }),
      ).toBeInTheDocument();
    });
  });

  describe('review navigation', () => {
    async function startAndAnswerCard(
      user: ReturnType<typeof userEvent.setup>,
      answer: string,
    ) {
      await user.type(screen.getByRole('textbox'), answer);
      await user.click(screen.getByRole('button', { name: /submit/i }));
      await waitFor(() => {
        expect(screen.getByTestId('result')).toBeInTheDocument();
      });
    }

    async function advanceToNextCard(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument();
      });
    }

    it('navigates back from answering phase to review previous card', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));

      // Answer card 1 and advance to card 2
      await startAndAnswerCard(user, '4');
      await advanceToNextCard(user);
      expect(screen.getByText('Capital of France?')).toBeInTheDocument();

      // Back button should be enabled — click it to review card 1
      const backButton = screen.getByRole('button', { name: /previous/i });
      expect(backButton).not.toBeDisabled();
      await user.click(backButton);

      // Should see card 1's result in review mode
      await waitFor(() => {
        const answerArea = screen.getByTestId('correct-answer');
        expect(answerArea).toHaveTextContent('What is 2+2?');
        expect(answerArea).toHaveTextContent('4');
      });
    });

    it('navigates back from result phase to review earlier card', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));

      // Answer card 1, advance, answer card 2
      await startAndAnswerCard(user, '4');
      await advanceToNextCard(user);
      await startAndAnswerCard(user, 'Paris');

      // Now in result phase for card 2 — back should show card 1
      const backButton = screen.getByRole('button', { name: /previous/i });
      await user.click(backButton);

      await waitFor(() => {
        const answerArea = screen.getByTestId('correct-answer');
        expect(answerArea).toHaveTextContent('What is 2+2?');
        expect(answerArea).toHaveTextContent('4');
      });
    });

    it('navigates forward from review to resume answering', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));

      // Answer card 1, advance to card 2
      await startAndAnswerCard(user, '4');
      await advanceToNextCard(user);

      // Go back to review card 1
      await user.click(screen.getByRole('button', { name: /previous/i }));
      await waitFor(() => {
        expect(screen.getByTestId('correct-answer')).toHaveTextContent(
          'What is 2+2?',
        );
      });

      // Go forward to resume answering card 2
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => {
        expect(screen.getByText('Capital of France?')).toBeInTheDocument();
      });
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('navigates forward from review to resume result phase', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));

      // Answer card 1, advance, answer card 2 (stay on result)
      await startAndAnswerCard(user, '4');
      await advanceToNextCard(user);
      await startAndAnswerCard(user, 'Paris');

      // Go back to card 1
      await user.click(screen.getByRole('button', { name: /previous/i }));
      await waitFor(() => {
        expect(screen.getByTestId('correct-answer')).toHaveTextContent(
          'What is 2+2?',
        );
      });

      // Go forward to return to card 2's result
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => {
        const answerArea = screen.getByTestId('correct-answer');
        expect(answerArea).toHaveTextContent('Capital of France?');
        expect(answerArea).toHaveTextContent('Paris');
      });
    });

    it('back button is always enabled so user can return to the title card', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));

      // On the first card with no history — back is still enabled (goes to title)
      const backButton = screen.getByRole('button', { name: /previous/i });
      expect(backButton).not.toBeDisabled();
    });

    it('shows title card when backing from first card before answering', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();

      // Back from first card with no answers — should show title card
      await user.click(screen.getByRole('button', { name: /previous/i }));

      await waitFor(() => {
        expect(
          screen.getByText(`${mockDeck.cards.length} cards`),
        ).toBeInTheDocument();
      });
    });

    it('resumes the same session going forward from the title card before any answer', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));
      await user.click(screen.getByRole('button', { name: /previous/i }));
      await waitFor(() => {
        expect(
          screen.getByText(`${mockDeck.cards.length} cards`),
        ).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
      });
      const startSession = vi.mocked(trpc.study.startSession.useMutation).mock
        .results;
      const starts = startSession.reduce(
        (total, r) => total + r.value.mutate.mock.calls.length,
        0,
      );
      expect(starts).toBe(1);
    });

    it('shows title card when backing past first history entry', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));

      // Answer card 1 and stay on result
      await startAndAnswerCard(user, '4');

      // Back from result with only 1 history entry goes to title card (reviewIndex: -1)
      await user.click(screen.getByRole('button', { name: /previous/i }));

      // Title card should show deck name and card count
      await waitFor(() => {
        expect(
          screen.getByText(`${mockDeck.cards.length} cards`),
        ).toBeInTheDocument();
      });
      // Previous button should be hidden on title card
      expect(
        screen.queryByRole('button', { name: /previous/i }),
      ).not.toBeInTheDocument();
    });

    it('forward from title card resumes session', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));

      // Answer card 1 and stay on result
      await startAndAnswerCard(user, '4');

      // Back to title card
      await user.click(screen.getByRole('button', { name: /previous/i }));
      await waitFor(() => {
        expect(
          screen.getByText(`${mockDeck.cards.length} cards`),
        ).toBeInTheDocument();
      });

      // Forward should go to card 1's review entry
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => {
        expect(screen.getByTestId('correct-answer')).toHaveTextContent(
          'What is 2+2?',
        );
      });
    });

    it('forward from last review entry advances to next card', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));

      // Answer card 1, advance, answer card 2 (stay on result)
      await startAndAnswerCard(user, '4');
      await advanceToNextCard(user);
      await startAndAnswerCard(user, 'Paris');

      // Go back to card 2's review (last entry)
      await user.click(screen.getByRole('button', { name: /previous/i }));
      await waitFor(() => {
        expect(screen.getByTestId('correct-answer')).toHaveTextContent(
          'What is 2+2?',
        );
      });

      // Go forward to card 2's review (now at last review entry)
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => {
        expect(screen.getByTestId('correct-answer')).toHaveTextContent(
          'Capital of France?',
        );
      });

      // Forward again from the last review entry — should advance past
      // the already-answered card and complete the session
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => {
        expect(
          screen.getByRole('heading', { name: /session complete/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe('card flip', () => {
    it('shows flip button after submitting an answer', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));

      // No flip button during answering phase
      expect(
        screen.queryByRole('button', { name: /flip to back/i }),
      ).not.toBeInTheDocument();

      // Submit an answer
      await user.type(screen.getByRole('textbox'), '4');
      await user.click(screen.getByRole('button', { name: /submit/i }));

      await waitFor(() => {
        expect(screen.getByTestId('result')).toBeInTheDocument();
      });

      // Flip button should now be visible on the back face
      expect(
        screen.getByRole('button', { name: /flip to front/i }),
      ).toBeInTheDocument();
    });

    it('toggles between front and back when flip button is clicked', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      await user.click(screen.getByRole('button', { name: /test deck/i }));
      await user.type(screen.getByRole('textbox'), '4');
      await user.click(screen.getByRole('button', { name: /submit/i }));

      await waitFor(() => {
        expect(screen.getByTestId('result')).toBeInTheDocument();
      });

      // Initially showing back (result) — flip to front should show the question
      await user.click(screen.getByRole('button', { name: /flip to front/i }));

      // After flipping to front, the "flip to back" button should appear
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /flip to back/i }),
        ).toBeInTheDocument();
      });

      // Flip back to the result side
      await user.click(screen.getByRole('button', { name: /flip to back/i }));
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /flip to front/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe('keyboard shortcuts', () => {
    it('starts session on Enter key during idle phase', async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();

      // Should be in idle phase with start button
      expect(
        screen.getByRole('button', { name: /test deck/i }),
      ).toBeInTheDocument();

      // Press Enter to start
      await user.keyboard('{Enter}');

      // Should now be in answering phase
      await waitFor(() => {
        expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
      });
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });
});
