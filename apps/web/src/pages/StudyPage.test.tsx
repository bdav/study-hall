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
const mockInvalidateHistory = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      deck: { getById: { invalidate: mockInvalidateDeck } },
      card: {
        listByDeck: { invalidate: mockInvalidateCards },
        history: { invalidate: mockInvalidateHistory },
      },
    })),
    card: {
      update: { useMutation: vi.fn() },
      delete: { useMutation: vi.fn() },
      markKnown: { useMutation: vi.fn() },
      restoreVersion: { useMutation: vi.fn() },
      history: { useQuery: vi.fn() },
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
      queuePreview: { useQuery: vi.fn() },
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
const mockMarkKnown = vi.fn();
const mockRestoreVersion = vi.fn();

type UpdateOptions = Parameters<typeof trpc.card.update.useMutation>[0];
type DeleteOptions = Parameters<typeof trpc.card.delete.useMutation>[0];
type MarkKnownOptions = Parameters<typeof trpc.card.markKnown.useMutation>[0];
type RestoreOptions = Parameters<
  typeof trpc.card.restoreVersion.useMutation
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

/** Card edits and deletions that succeed, answering the way the API does. */
function mockCardMutations() {
  vi.mocked(trpc.card.update.useMutation).mockImplementation(((
    opts?: UpdateOptions,
  ) => ({
    mutate: mockUpdateCard.mockImplementation(
      (input: {
        cardId: string;
        front?: string;
        canonicalAnswers: {
          id?: string;
          text: string;
          acceptedVariants?: string[];
        }[];
      }) =>
        opts?.onSuccess?.(
          {
            id: input.cardId,
            // An update without a front keeps the card's
            front:
              input.front ??
              mockDeck.cards.find((card) => card.id === input.cardId)?.front,
            canonicalAnswers: input.canonicalAnswers.map((answer, i) => ({
              id: answer.id ?? `answer-new-${i}`,
              text: answer.text,
              isPrimary: i === 0,
              acceptedVariants: (answer.acceptedVariants ?? []).map((text) => ({
                id: `variant-${text}`,
                text,
              })),
            })),
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
  vi.mocked(trpc.card.markKnown.useMutation).mockImplementation(((
    opts?: MarkKnownOptions,
  ) => ({
    mutate: mockMarkKnown.mockImplementation((input: { cardIds: string[] }) =>
      opts?.onSuccess?.(
        { markedCount: input.cardIds.length } as never,
        input as never,
        undefined,
        {} as never,
      ),
    ),
    isPending: false,
  })) as unknown as typeof trpc.card.markKnown.useMutation);
  // Restores card-1's version 1, "What is two plus two?", answers 4 and four
  vi.mocked(trpc.card.restoreVersion.useMutation).mockImplementation(((
    opts?: RestoreOptions,
  ) => ({
    mutate: mockRestoreVersion.mockImplementation(
      (input: { cardId: string; versionId: string }) =>
        opts?.onSuccess?.(
          {
            id: input.cardId,
            front: 'What is two plus two?',
            canonicalAnswers: [
              {
                id: 'answer-4',
                text: '4',
                isPrimary: true,
                acceptedVariants: [],
              },
              {
                id: 'answer-four',
                text: 'four',
                isPrimary: false,
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
  })) as unknown as typeof trpc.card.restoreVersion.useMutation);
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

type QueuePreview = {
  sessionSize: number;
  dueCount: number;
  newCount: number;
  nextDueAt: string | null;
};

/** What a session started now would hold; both cards, NEW, by default. */
function mockQueuePreview(
  preview: QueuePreview = {
    sessionSize: 2,
    dueCount: 0,
    newCount: 2,
    nextDueAt: null,
  },
) {
  vi.mocked(trpc.study.queuePreview.useQuery).mockReturnValue({
    data: preview,
  } as unknown as ReturnType<typeof trpc.study.queuePreview.useQuery>);
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
  vi.mocked(trpc.study.startSession.useMutation).mockImplementation(((opts?: {
    onSuccess?: (data: typeof session) => void;
  }) => ({
    mutate: vi.fn(() => opts?.onSuccess?.(session)),
    mutateAsync: vi.fn(),
  })) as unknown as typeof trpc.study.startSession.useMutation);
  const user = userEvent.setup();
  renderStudyPage();
  await user.click(screen.getByRole('button', { name: /test deck/i }));
  return user;
}

const DAY = 24 * 60 * 60 * 1000;

type CardHistory = {
  progress: {
    lifecycleState: string;
    dueAt: string | null;
    isKnown: boolean;
  } | null;
  versions: {
    id: string;
    number: number;
    front: string;
    canonicalAnswers: string[];
    acceptedVariants: string[][] | null;
    sourceModel: string | null;
    restoredFromNumber: number | null;
    startedAt: string;
    endedAt: string | null;
    isCurrent: boolean;
    canRestore: boolean;
    attempts: {
      id: string;
      userAnswer: string | null;
      recallGrade: string;
      createdAt: string;
    }[];
    answeredCount: number;
    rightCount: number;
  }[];
  unversioned: {
    attempts: CardHistory['versions'][number]['attempts'];
    answeredCount: number;
    rightCount: number;
  } | null;
};

/** card-1's history: three answers to its current version, two right. */
function historyOfCardOne(): CardHistory {
  return {
    progress: {
      lifecycleState: 'LEARNING',
      isKnown: false,
      dueAt: new Date(Date.now() + 2 * DAY + 60 * 60 * 1000).toISOString(),
    },
    versions: [
      {
        id: 'version-2',
        number: 2,
        front: 'What is 2+2?',
        canonicalAnswers: ['4'],
        acceptedVariants: [[]],
        sourceModel: null,
        restoredFromNumber: null,
        startedAt: '2026-10-20T12:00:00.000Z',
        endedAt: null,
        isCurrent: true,
        canRestore: false,
        attempts: [
          {
            id: 'attempt-3',
            userAnswer: '4',
            recallGrade: 'NAILED',
            createdAt: '2026-10-24T12:00:00.000Z',
          },
          {
            id: 'attempt-2',
            userAnswer: null,
            recallGrade: 'MISSED',
            createdAt: '2026-10-22T12:00:00.000Z',
          },
          {
            id: 'attempt-1',
            userAnswer: 'four',
            recallGrade: 'NAILED',
            createdAt: '2026-10-21T12:00:00.000Z',
          },
        ],
        answeredCount: 3,
        rightCount: 2,
      },
      {
        id: 'version-1',
        number: 1,
        front: 'What is two plus two?',
        canonicalAnswers: ['4', 'four'],
        acceptedVariants: [['IV'], []],
        sourceModel: null,
        restoredFromNumber: null,
        startedAt: '2026-10-01T12:00:00.000Z',
        endedAt: '2026-10-20T12:00:00.000Z',
        isCurrent: false,
        canRestore: true,
        attempts: [
          {
            id: 'attempt-0',
            userAnswer: 'five',
            recallGrade: 'MISSED',
            createdAt: '2026-10-02T12:00:00.000Z',
          },
        ],
        answeredCount: 1,
        rightCount: 0,
      },
    ],
    unversioned: null,
  };
}

/** Each card's history; card-1's by default, others with no answers. */
function mockCardHistory(
  history: (cardId: string) => CardHistory = (cardId) =>
    cardId === 'card-1'
      ? historyOfCardOne()
      : {
          progress: { lifecycleState: 'NEW', dueAt: null, isKnown: false },
          versions: [
            {
              ...historyOfCardOne().versions[0],
              front: 'Capital of France?',
              canonicalAnswers: ['Paris'],
              attempts: [],
              answeredCount: 0,
              rightCount: 0,
            },
          ],
          unversioned: null,
        },
) {
  vi.mocked(trpc.card.history.useQuery).mockImplementation(((input: {
    cardId: string;
  }) => ({
    data: history(input.cardId),
    isLoading: false,
    isError: false,
  })) as unknown as typeof trpc.card.history.useQuery);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCardMutations();
  mockAcceptAnswerMutation();
  mockQueuePreview();
  mockCardHistory();
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

  it('says how many cards a session would hold before it starts', () => {
    setupBasicMocks();
    mockQueuePreview({
      sessionSize: 1,
      dueCount: 1,
      newCount: 0,
      nextDueAt: null,
    });
    renderStudyPage();

    expect(
      screen.getByRole('button', { name: /test deck/i }),
    ).toHaveTextContent('1 to study · 2 in deck');
  });

  it('says when nothing is due, and when the next card is', () => {
    setupBasicMocks();
    mockQueuePreview({
      sessionSize: 0,
      dueCount: 0,
      newCount: 0,
      nextDueAt: '2026-10-28T17:30:00.000Z',
    });
    renderStudyPage();

    const title = screen.getByRole('button', { name: /test deck/i });
    expect(title).toHaveTextContent('Nothing due · 2 in deck');
    expect(title).toHaveTextContent(/next card due .*oct 28/i);
  });

  it("shows the session's size on the title card once it has started", async () => {
    setupMocksWithStartSession();
    const oneCardSession = { ...mockSession, items: [mockSession.items[0]] };
    vi.mocked(trpc.study.startSession.useMutation).mockImplementation(((opts?: {
      onSuccess?: (data: typeof oneCardSession) => void;
    }) => ({
      mutate: vi.fn(() => opts?.onSuccess?.(oneCardSession)),
      mutateAsync: vi.fn(),
    })) as unknown as typeof trpc.study.startSession.useMutation);
    const user = userEvent.setup();
    renderStudyPage();

    await user.click(screen.getByRole('button', { name: /test deck/i }));
    await user.click(screen.getByRole('button', { name: /previous/i }));

    expect(await screen.findByText('1 card')).toBeInTheDocument();
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
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit card' })).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'Edit card' }));
      await user.type(
        screen.getByRole('textbox', { name: 'Front' }),
        ' exactly{Enter}',
      );

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

  describe("a card's answers below yours", () => {
    async function answerWithVariants(answer: string) {
      const user = await startStudyingWithVariants();
      await user.type(screen.getByRole('textbox'), `${answer}{Enter}`);
      await screen.findByTestId('result');
      // Once the card has slid in, so it can be edited
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit card' })).toBeEnabled(),
      );
      return user;
    }

    const answersOfCard = { name: 'Answers of What is 2+2?' };

    it('sums up the answers and variants once the card is graded', async () => {
      await answerWithVariants('4');

      expect(screen.getByRole('button', answersOfCard)).toHaveTextContent(
        /4Variants: four$/,
      );
    });

    it('is captioned as the accepted answers, to edit', async () => {
      await answerWithVariants('4');

      expect(screen.getByRole('button', answersOfCard)).toHaveTextContent(
        /^Accepted answers4Variants: four$/,
      );
    });

    it('shows its edit pencil only while edit mode is off', async () => {
      const user = await answerWithVariants('4');
      const summary = screen.getByRole('button', answersOfCard);
      expect(summary.querySelector('svg')).not.toBeNull();

      await user.click(screen.getByRole('button', { name: 'Edit card' }));

      expect(summary).toBeDisabled();
      expect(summary.querySelector('svg')).toBeNull();
    });

    it("isn't there before you answer", async () => {
      await startStudyingWithVariants();

      expect(
        screen.queryByRole('button', answersOfCard),
      ).not.toBeInTheDocument();
    });

    it("turns on edit mode on the card's back when chosen", async () => {
      const user = await answerWithVariants('IV');
      await user.click(screen.getByRole('button', { name: 'Flip to front' }));

      await user.click(screen.getByRole('button', answersOfCard));

      // In edit mode, with its toggle gone
      expect(
        screen.queryByRole('button', { name: 'Edit card' }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText('Answer 1')).toHaveValue('4');
      // The back is in view: its face is the one not inert
      expect(screen.getByLabelText('Answer 1').closest('[inert]')).toBeNull();
      // The summary stays, read only, and can't open edit mode again
      expect(screen.getByRole('button', answersOfCard)).toBeDisabled();
      expect(
        screen.queryByRole('region', answersOfCard),
      ).not.toBeInTheDocument();
    });

    it('adds a variant on the card, saved with Save, without calling the card edited or moving on', async () => {
      const user = await answerWithVariants('IV');

      await user.click(screen.getByRole('button', answersOfCard));
      await user.type(
        screen.getByLabelText('New accepted variant of 4'),
        'IV{Enter}',
      );
      expect(mockUpdateCard).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswers: [
          { id: 'answer-4', text: '4', acceptedVariants: ['four', 'IV'] },
        ],
      });
      // Still on the graded card, not the next one
      expect(screen.queryByText('Capital of France?')).not.toBeInTheDocument();
      expect(screen.queryByText(/graded before/i)).not.toBeInTheDocument();
      expect(screen.getByRole('button', answersOfCard)).toHaveTextContent(
        'Variants: four, IV',
      );
    });

    it('saves added answers, saying the answer was graded before', async () => {
      const user = await answerWithVariants('IV');

      await user.click(screen.getByRole('button', answersOfCard));
      await user.click(screen.getByRole('button', { name: 'Add answer' }));
      await user.type(screen.getByLabelText('Answer 2'), 'IV');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswers: [
          { id: 'answer-4', text: '4', acceptedVariants: ['four'] },
          { text: 'IV', acceptedVariants: [] },
        ],
      });
      expect(screen.queryByLabelText('Answer 1')).not.toBeInTheDocument();
      expect(screen.getByText(/graded before you edited/i)).toBeInTheDocument();
      expect(screen.getByRole('button', answersOfCard)).toHaveTextContent(
        '4, IV',
      );
    });
  });

  describe('cards with several Canonical Answers', () => {
    /** Starts studying with card-1 accepting "4" (primary) and "IV". */
    async function startWithTwoAnswers(grade: {
      recallGrade: string;
      matchedAnswer: string | null;
    }) {
      setupMocksWithStartSession();
      const [card] = mockDeck.cards;
      const twoAnswers = {
        ...card,
        canonicalAnswers: [
          { ...card.canonicalAnswers[0] },
          {
            id: 'answer-IV',
            text: 'IV',
            isPrimary: false,
            acceptedVariants: [],
          },
        ],
      };
      const session = {
        ...mockSession,
        items: [{ id: 'item-1', card: twoAnswers }, mockSession.items[1]],
      };
      vi.mocked(trpc.study.startSession.useMutation).mockImplementation(
        ((opts?: { onSuccess?: (data: typeof session) => void }) => ({
          mutate: vi.fn(() => opts?.onSuccess?.(session)),
          mutateAsync: vi.fn(),
        })) as unknown as typeof trpc.study.startSession.useMutation,
      );
      vi.mocked(trpc.study.submitAnswer.useMutation).mockReturnValue({
        mutateAsync: vi.fn((args) =>
          Promise.resolve({
            id: 'attempt-1',
            userAnswer: args.userAnswer,
            accentMismatch: false,
            matchedVariant: null,
            ...grade,
          }),
        ),
      } as unknown as ReturnType<typeof trpc.study.submitAnswer.useMutation>);
      const user = userEvent.setup();
      renderStudyPage();
      await user.click(screen.getByRole('button', { name: /test deck/i }));
      return user;
    }

    it('lists the other answers below yours and says which one you matched', async () => {
      const user = await startWithTwoAnswers({
        recallGrade: 'NAILED',
        matchedAnswer: 'IV',
      });

      await user.type(screen.getByRole('textbox'), 'iv{Enter}');

      const notes = await screen.findByTestId('answer-notes');
      expect(notes).toHaveTextContent(
        'Matched “IV”, one of the card’s answers.',
      );
      expect(
        screen.getByRole('button', { name: 'Answers of What is 2+2?' }),
      ).toHaveTextContent('4, IV');
      expect(screen.getByTestId('correct-answer')).toHaveTextContent('4');
    });

    it("doesn't call out a match with the primary answer", async () => {
      const user = await startWithTwoAnswers({
        recallGrade: 'NAILED',
        matchedAnswer: '4',
      });

      await user.type(screen.getByRole('textbox'), '4{Enter}');

      await screen.findByTestId('result');
      expect(screen.queryByText(/matched/i)).not.toBeInTheDocument();
    });

    it('asks which answer "My answer was correct" makes a variant of', async () => {
      const user = await startWithTwoAnswers({
        recallGrade: 'MISSED',
        matchedAnswer: null,
      });
      await user.type(screen.getByRole('textbox'), 'quattro{Enter}');
      await screen.findByTestId('result');

      await user.click(
        screen.getByRole('button', { name: 'My answer was correct' }),
      );
      expect(mockAcceptAnswer).not.toHaveBeenCalled();
      const picker = screen.getByRole('group', {
        name: 'Which answer is yours another way of saying?',
      });
      await user.click(within(picker).getByRole('button', { name: 'IV' }));

      expect(mockAcceptAnswer).toHaveBeenCalledWith({
        attemptId: 'attempt-1',
        canonicalAnswerId: 'answer-IV',
      });
    });

    it('lets you back out of choosing an answer', async () => {
      const user = await startWithTwoAnswers({
        recallGrade: 'MISSED',
        matchedAnswer: null,
      });
      await user.type(screen.getByRole('textbox'), 'quattro{Enter}');
      await screen.findByTestId('result');

      await user.click(
        screen.getByRole('button', { name: 'My answer was correct' }),
      );
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(
        screen.queryByRole('group', {
          name: 'Which answer is yours another way of saying?',
        }),
      ).not.toBeInTheDocument();
      expect(mockAcceptAnswer).not.toHaveBeenCalled();
    });
  });

  describe('editing a card in place', () => {
    async function startStudying() {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();
      await user.click(screen.getByRole('button', { name: /test deck/i }));
      return user;
    }

    it('edits the front and answer on the card and goes on studying the edited card', async () => {
      const user = await startStudying();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit card' })).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'Edit card' }));
      // The toggle goes while editing; Cancel or Save ends it
      expect(
        screen.queryByRole('button', { name: 'Edit card' }),
      ).not.toBeInTheDocument();
      const front = screen.getByRole('textbox', { name: 'Front' });
      expect(front).toHaveValue('What is 2+2?');
      await user.clear(front);
      await user.type(front, 'What is 2+3?');
      await user.click(screen.getByRole('button', { name: 'Flip to back' }));
      await user.clear(screen.getByLabelText('Answer 1'));
      await user.type(screen.getByLabelText('Answer 1'), '5');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+3?',
        canonicalAnswers: [{ id: 'answer-4', text: '5', acceptedVariants: [] }],
      });
      expect(
        screen.queryByRole('textbox', { name: 'Front' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Edit card' }),
      ).toBeInTheDocument();
      expect(screen.getByText('What is 2+3?')).toBeInTheDocument();
      expect(mockInvalidateDeck).toHaveBeenCalledWith({ id: 'deck-1' });
    });

    /** Turns on edit mode, once the card has slid in. */
    async function startEditing(user: ReturnType<typeof userEvent.setup>) {
      const toggle = screen.getByRole('button', { name: 'Edit card' });
      await waitFor(() => expect(toggle).toBeEnabled());
      await user.click(toggle);
    }

    it('holds off edit mode until the card has slid in', async () => {
      await startStudying();

      // The first card is still sliding in
      expect(screen.getByRole('button', { name: 'Edit card' })).toBeDisabled();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit card' })).toBeEnabled(),
      );
    });

    /** Turns on edit mode and shows the card's back, its answers. */
    async function editAnswers(user: ReturnType<typeof userEvent.setup>) {
      await startEditing(user);
      await user.click(screen.getByRole('button', { name: 'Flip to back' }));
    }

    async function answerCard(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByRole('textbox', { name: '' }), '4{Enter}');
      await screen.findByTestId('result');
    }

    it('offers no edit toggle before the session starts', () => {
      setupBasicMocks();
      renderStudyPage();

      expect(
        screen.queryByRole('button', { name: 'Edit card' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Card options' }),
      ).not.toBeInTheDocument();
    });

    it('has no card menu or Edit dialog', async () => {
      const user = await startStudying();
      await startEditing(user);

      expect(
        screen.queryByRole('button', { name: 'Card options' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('drops the edits on Cancel', async () => {
      const user = await startStudying();

      await startEditing(user);
      await user.type(
        screen.getByRole('textbox', { name: 'Front' }),
        ' exactly',
      );
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockUpdateCard).not.toHaveBeenCalled();
      expect(
        screen.queryByRole('textbox', { name: 'Front' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('What is 2+2?')).toBeInTheDocument();
    });

    it('drops the edits on Cancel, starting afresh next time', async () => {
      const user = await startStudying();

      await editAnswers(user);
      await user.clear(screen.getByLabelText('Answer 1'));
      await user.type(screen.getByLabelText('Answer 1'), '5');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockUpdateCard).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Answer 1')).not.toBeInTheDocument();
      await startEditing(user);
      expect(screen.getByLabelText('Answer 1')).toHaveValue('4');
    });

    it('leaves edit mode on moving to another card', async () => {
      const user = await startStudying();
      await answerCard(user);

      await startEditing(user);
      await user.click(screen.getByRole('button', { name: /next/i }));

      expect(await screen.findByText('Capital of France?')).toBeInTheDocument();
      expect(
        screen.queryByRole('textbox', { name: 'Front' }),
      ).not.toBeInTheDocument();
    });

    it('turns on edit mode with Enter on the toggle without moving on', async () => {
      const user = await startStudying();
      await answerCard(user);

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit card' })).toBeEnabled(),
      );
      screen.getByRole('button', { name: 'Edit card' }).focus();
      await user.keyboard('{Enter}');

      expect(screen.queryByText('Capital of France?')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Answer 1')).toHaveValue('4');
    });

    it("won't save a blank front or answer", async () => {
      const user = await startStudying();

      await editAnswers(user);
      await user.clear(screen.getByLabelText('Answer 1'));
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

      await user.type(screen.getByLabelText('Answer 1'), '4');
      await user.click(screen.getByRole('button', { name: 'Flip to front' }));
      await user.clear(screen.getByRole('textbox', { name: 'Front' }));
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('adds an answer to the card', async () => {
      const user = await startStudying();

      await editAnswers(user);
      await user.click(screen.getByRole('button', { name: 'Add answer' }));
      await user.type(screen.getByLabelText('Answer 2'), 'four{Enter}');

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswers: [
          { id: 'answer-4', text: '4', acceptedVariants: [] },
          { text: 'four', acceptedVariants: [] },
        ],
      });
    });

    it('keeps "||" typed into an answer as plain text', async () => {
      const user = await startStudying();

      await editAnswers(user);
      await user.type(screen.getByLabelText('Answer 1'), ' || four');

      expect(screen.getByLabelText('Answer 1')).toHaveValue('4 || four');
      expect(screen.queryByLabelText('Answer 2')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(mockUpdateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          canonicalAnswers: [
            { id: 'answer-4', text: '4 || four', acceptedVariants: [] },
          ],
        }),
      );
    });

    it("explains, on the card's back, answers and variants where they are added", async () => {
      const user = await startStudying();

      await editAnswers(user);

      expect(
        screen.getByRole('button', { name: 'Add answer' }),
      ).toHaveAccessibleDescription(
        /^Answers are different correct answers, each right on its own, like 11, 13 and 17.*progress over\.$/,
      );
      expect(
        screen.getByLabelText('New accepted variant of 4'),
      ).toHaveAccessibleDescription(
        /^Variants are other ways to write one answer.*“color” for “colour”.*never reset progress\.$/,
      );
    });

    it("explains variants once, below the first answer's", async () => {
      const user = await startStudying();

      await editAnswers(user);
      await user.click(screen.getByRole('button', { name: 'Add answer' }));
      await user.type(screen.getByLabelText('Answer 2'), 'four');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await startEditing(user);
      await user.click(screen.getByRole('button', { name: 'Flip to back' }));

      expect(
        screen.getAllByText(/Variants are other ways to write one answer/),
      ).toHaveLength(1);
      expect(
        screen.getByLabelText('New accepted variant of four'),
      ).not.toHaveAccessibleDescription();
    });

    it('saves an edit with Enter without moving on from an answered card', async () => {
      const user = await startStudying();
      await answerCard(user);

      await startEditing(user);
      await user.type(
        screen.getByRole('textbox', { name: 'Front' }),
        ' exactly{Enter}',
      );

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2? exactly',
        canonicalAnswers: [{ id: 'answer-4', text: '4', acceptedVariants: [] }],
      });
      // Still on the answered card, not the next one
      expect(screen.queryByText('Capital of France?')).not.toBeInTheDocument();
      expect(screen.getByTestId('correct-answer')).toHaveTextContent(
        'What is 2+2? exactly',
      );
    });

    it('edits the answers of an answered card on its back', async () => {
      const user = await startStudying();
      await answerCard(user);
      expect(screen.queryByText(/graded before/i)).not.toBeInTheDocument();

      // An answered card shows its back already
      await startEditing(user);
      await user.clear(screen.getByLabelText('Answer 1'));
      await user.type(screen.getByLabelText('Answer 1'), 'four{Enter}');

      expect(screen.getByTestId('correct-answer')).toHaveTextContent('four');
      expect(
        screen.getByText(
          "Graded before you edited this card. It doesn't count toward the card's progress.",
        ),
      ).toBeInTheDocument();
    });

    it("doesn't call the card edited when only its primary answer changes", async () => {
      const user = await startStudying();
      await answerCard(user);

      await startEditing(user);
      await user.click(screen.getByRole('button', { name: 'Add answer' }));
      await user.type(screen.getByLabelText('Answer 2'), 'four');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      // Now "4" and "four"; make "four" the primary
      mockUpdateCard.mockClear();
      await startEditing(user);
      await user.click(
        screen.getByRole('radio', { name: 'Answer 2 is primary' }),
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          canonicalAnswers: [
            { id: 'answer-new-1', text: 'four', acceptedVariants: [] },
            { id: 'answer-4', text: '4', acceptedVariants: [] },
          ],
        }),
      );
      expect(screen.getByTestId('correct-answer')).toHaveTextContent('four');
    });

    it("adds and removes the answer's Accepted Variants, saved with Save, without saying the card was edited", async () => {
      const user = await startStudyingWithVariants();
      await user.type(screen.getByRole('textbox'), 'four{Enter}');
      await screen.findByTestId('result');

      await startEditing(user);
      const variants = screen.getByRole('list', {
        name: 'Accepted variants of 4',
      });
      expect(within(variants).getByText('four')).toBeInTheDocument();

      await user.type(
        screen.getByLabelText('New accepted variant of 4'),
        ' IV {Enter}',
      );
      expect(within(variants).getByText('IV')).toBeInTheDocument();
      expect(screen.getByLabelText('New accepted variant of 4')).toHaveValue(
        '',
      );
      await user.click(
        within(variants).getByRole('button', { name: 'Remove four' }),
      );
      expect(within(variants).queryByText('four')).not.toBeInTheDocument();
      expect(mockUpdateCard).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswers: [
          { id: 'answer-4', text: '4', acceptedVariants: ['IV'] },
        ],
      });
      expect(mockInvalidateCards).toHaveBeenCalledWith({ deckId: 'deck-1' });
      expect(screen.queryByText(/graded before/i)).not.toBeInTheDocument();
    });

    it('drops variant changes on Cancel', async () => {
      const user = await startStudyingWithVariants();

      await editAnswers(user);
      await user.click(screen.getByRole('button', { name: 'Remove four' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockUpdateCard).not.toHaveBeenCalled();
      await editAnswers(user);
      expect(
        screen.getByRole('list', { name: 'Accepted variants of 4' }),
      ).toHaveTextContent('four');
    });

    it('leaves edit mode without saving when nothing changed', async () => {
      const user = await startStudyingWithVariants();

      await editAnswers(user);
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).not.toHaveBeenCalled();
      expect(screen.queryByLabelText('Answer 1')).not.toBeInTheDocument();
    });

    it('adds a typed variant not yet added on Save', async () => {
      const user = await startStudyingWithVariants();

      await editAnswers(user);
      await user.type(screen.getByLabelText('New accepted variant of 4'), 'IV');

      expect(screen.queryByText(/not added yet/i)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(mockUpdateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          canonicalAnswers: [
            { id: 'answer-4', text: '4', acceptedVariants: ['four', 'IV'] },
          ],
        }),
      );
    });

    it('gives a newly added answer variants', async () => {
      const user = await startStudying();

      await editAnswers(user);
      await user.click(screen.getByRole('button', { name: 'Add answer' }));
      await user.type(screen.getByLabelText('Answer 2'), 'four');
      await user.type(
        screen.getByLabelText('New accepted variant of four'),
        'quattro{Enter}',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith(
        expect.objectContaining({
          canonicalAnswers: [
            { id: 'answer-4', text: '4', acceptedVariants: [] },
            { text: 'four', acceptedVariants: ['quattro'] },
          ],
        }),
      );
    });

    it("keeps a retyped answer's variants, to remove those that no longer fit", async () => {
      const user = await startStudyingWithVariants();

      await editAnswers(user);
      await user.clear(screen.getByLabelText('Answer 1'));
      await user.type(screen.getByLabelText('Answer 1'), 'IV');

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Remove four' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswers: [
          { id: 'answer-4', text: 'IV', acceptedVariants: [] },
        ],
      });
      expect(screen.queryByLabelText('Answer 1')).not.toBeInTheDocument();
    });

    it('flags a variant that is now one of the answers, holding off Save', async () => {
      const user = await startStudyingWithVariants();

      await editAnswers(user);
      await user.clear(screen.getByLabelText('Answer 1'));
      await user.type(screen.getByLabelText('Answer 1'), 'Four');

      expect(screen.getByText(/same as an answer/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Remove four' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswers: [
          { id: 'answer-4', text: 'Four', acceptedVariants: [] },
        ],
      });
    });

    it('keeps the ticked variants of a retyped answer', async () => {
      const user = await startStudyingWithVariants();

      await editAnswers(user);
      await user.type(screen.getByLabelText('Answer 1'), ' exactly{Enter}');

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2?',
        canonicalAnswers: [
          { id: 'answer-4', text: '4 exactly', acceptedVariants: ['four'] },
        ],
      });
    });

    it('keeps the variants when only the front changes', async () => {
      const user = await startStudyingWithVariants();

      await startEditing(user);
      await user.type(
        screen.getByRole('textbox', { name: 'Front' }),
        ' exactly',
      );

      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2? exactly',
        canonicalAnswers: [
          { id: 'answer-4', text: '4', acceptedVariants: ['four'] },
        ],
      });
    });

    async function deleteCard(user: ReturnType<typeof userEvent.setup>) {
      await startEditing(user);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Delete',
        }),
      );
    }

    it('deletes the card from edit mode once confirmed and moves on to the next', async () => {
      const user = await startStudying();

      await startEditing(user);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = screen.getByRole('alertdialog');
      expect(mockDeleteCard).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(mockDeleteCard).toHaveBeenCalledWith({ cardId: 'card-1' });
      expect(await screen.findByText('Capital of France?')).toBeInTheDocument();
      expect(screen.getByText('Card 1 of 1')).toBeInTheDocument();
    });

    it('leaves a deleted card out of the session summary', async () => {
      const user = await startStudying();
      await answerCard(user);

      await deleteCard(user);
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
      await answerCard(user);
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

      await startEditing(user);
      await user.click(screen.getByRole('button', { name: 'Flip to front' }));
      expect(screen.getByRole('textbox', { name: 'Front' })).toHaveValue(
        'What is 2+2?',
      );
      await user.type(
        screen.getByRole('textbox', { name: 'Front' }),
        ' exactly{Enter}',
      );

      expect(mockUpdateCard).toHaveBeenCalledWith({
        cardId: 'card-1',
        front: 'What is 2+2? exactly',
        canonicalAnswers: [{ id: 'answer-4', text: '4', acceptedVariants: [] }],
      });
      // Back on the card's front, as edit mode left it
      await user.click(screen.getByRole('button', { name: 'Flip to back' }));
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

      await deleteCard(user);
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

    it('marks the card in play known from edit mode and moves on to the next', async () => {
      const user = await startStudying();

      await startEditing(user);
      await user.click(screen.getByRole('button', { name: 'Mark known' }));

      expect(mockMarkKnown).toHaveBeenCalledWith({ cardIds: ['card-1'] });
      expect(await screen.findByText('Capital of France?')).toBeInTheDocument();
      expect(screen.getByText('Card 1 of 1')).toBeInTheDocument();
    });

    it('marks a card reviewed with Back known, keeping its answer in the session', async () => {
      const user = await startStudying();
      await reviewFirstCard(user);

      await startEditing(user);
      await user.click(screen.getByRole('button', { name: 'Mark known' }));

      expect(mockMarkKnown).toHaveBeenCalledWith({ cardIds: ['card-1'] });
      expect(
        screen.queryByRole('textbox', { name: 'Front' }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /next/i }));
      expect(await screen.findByText('Capital of France?')).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getAllByText('Card 2 of 2').length).toBeGreaterThan(0),
      );
    });

    it('marks an answered card known from below its grade, keeping it in the session', async () => {
      const user = await startStudying();
      await answerCard(user);

      await user.click(screen.getByRole('button', { name: 'Mark known' }));

      expect(mockMarkKnown).toHaveBeenCalledWith({ cardIds: ['card-1'] });
      expect(screen.getByText('Marked known')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Mark known' }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('result')).toBeInTheDocument();
    });

    it('says when the answered card was already known', async () => {
      const user = await startStudying();
      vi.mocked(trpc.card.markKnown.useMutation).mockImplementation(((
        opts?: MarkKnownOptions,
      ) => ({
        mutate: (input: { cardIds: string[] }) =>
          opts?.onSuccess?.(
            { markedCount: 0 } as never,
            input as never,
            undefined,
            {} as never,
          ),
        isPending: false,
      })) as unknown as typeof trpc.card.markKnown.useMutation);
      await answerCard(user);

      await user.click(screen.getByRole('button', { name: 'Mark known' }));

      expect(screen.getByText('Already known')).toBeInTheDocument();
    });

    it("doesn't offer Mark known on a card already known, below its grade or in edit mode", async () => {
      mockCardHistory(() => ({
        ...historyOfCardOne(),
        progress: { lifecycleState: 'STABLE', dueAt: null, isKnown: true },
      }));
      const user = await startStudying();
      await answerCard(user);

      expect(screen.getByTestId('result')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Mark known' }),
      ).not.toBeInTheDocument();
      await startEditing(user);
      expect(
        screen.getByRole('button', { name: 'History' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Mark known' }),
      ).not.toBeInTheDocument();
    });

    it("doesn't offer Mark known below the card before it's answered", async () => {
      await startStudying();

      expect(
        screen.queryByRole('button', { name: 'Mark known' }),
      ).not.toBeInTheDocument();
    });

    it("opens the card's version history from edit mode", async () => {
      const user = await startStudying();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit card' })).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'Edit card' }));

      await user.click(screen.getByRole('button', { name: 'History' }));

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Card history')).toBeInTheDocument();
      expect(
        within(dialog).getByRole('group', { name: 'Version 1' }),
      ).toBeInTheDocument();
    });

    it('goes on studying the restored card after a restore from edit mode', async () => {
      const user = await startStudying();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit card' })).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'Edit card' }));
      await user.click(screen.getByRole('button', { name: 'History' }));

      await user.click(
        within(screen.getByRole('group', { name: 'Version 1' })).getByRole(
          'button',
          { name: 'Restore' },
        ),
      );
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Restore',
        }),
      );

      expect(mockRestoreVersion).toHaveBeenCalledWith({
        cardId: 'card-1',
        versionId: 'version-1',
      });
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByRole('textbox', { name: 'Front' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('What is two plus two?')).toBeInTheDocument();
    });

    it('finishes the session when its last card is deleted', async () => {
      const user = await startStudying();

      for (const front of ['What is 2+2?', 'Capital of France?']) {
        await screen.findByText(front);
        await deleteCard(user);
      }

      expect(
        await screen.findByRole('heading', { name: /session complete/i }),
      ).toBeInTheDocument();
    });
  });

  describe("a card's history below it", () => {
    const historyRegion = { name: 'Your history with this card' };

    async function answerFirstCard(
      answer = '4',
      grade: 'correct' | 'incorrect' = 'correct',
    ) {
      setupMocksWithStartSession(grade);
      const user = userEvent.setup();
      renderStudyPage();
      await user.click(screen.getByRole('button', { name: /test deck/i }));
      await user.type(screen.getByRole('textbox'), `${answer}{Enter}`);
      await screen.findByTestId('result');
      return user;
    }

    /** Opens the version picker and lists its options. */
    async function openPicker(
      user: ReturnType<typeof userEvent.setup>,
      history: HTMLElement,
    ) {
      await user.click(
        within(history).getByRole('combobox', { name: 'Card version' }),
      );
      return screen.getAllByRole('option').map((option) => option.textContent);
    }

    it("isn't there before you answer", async () => {
      setupMocksWithStartSession();
      const user = userEvent.setup();
      renderStudyPage();
      await user.click(screen.getByRole('button', { name: /test deck/i }));

      expect(
        screen.queryByRole('region', historyRegion),
      ).not.toBeInTheDocument();
    });

    it("shows the current version's answers, how many were right, the card's state and next review", async () => {
      await answerFirstCard();

      const history = screen.getByRole('region', historyRegion);
      expect(trpc.card.history.useQuery).toHaveBeenCalledWith(
        { cardId: 'card-1' },
        expect.anything(),
      );
      expect(history).toHaveTextContent('Answered 3 times · 2 right');
      expect(history).toHaveTextContent(
        'Still learning · Next review in 2 days',
      );
      const answers = within(history).getAllByRole('listitem');
      expect(answers.map((item) => item.textContent)).toEqual([
        '4Nailed itOct 24',
        "I don't knowNeeds reviewOct 22",
        'fourNailed itOct 21',
      ]);
      expect(history).not.toHaveTextContent(/mastery/i);
    });

    it('shows the five most recent answers to the current version', async () => {
      const many = historyOfCardOne();
      const attempts = Array.from({ length: 7 }, (_, i) => ({
        id: `attempt-${i}`,
        userAnswer: `answer ${i}`,
        recallGrade: 'MISSED',
        createdAt: '2026-10-24T12:00:00.000Z',
      }));
      many.versions[0] = {
        ...many.versions[0],
        attempts,
        answeredCount: 7,
        rightCount: 0,
      };
      mockCardHistory(() => many);
      await answerFirstCard();

      const history = screen.getByRole('region', historyRegion);
      expect(within(history).getAllByRole('listitem')).toHaveLength(5);
      expect(history).toHaveTextContent('Answered 7 times · 0 right');
    });

    it('lists the versions by number in a picker; choosing one shows its front, answers and answers given', async () => {
      const user = await answerFirstCard();
      const history = screen.getByRole('region', historyRegion);
      expect(
        within(history).getByRole('combobox', { name: 'Card version' }),
      ).toHaveTextContent('Version 2 (current)');

      expect(await openPicker(user, history)).toEqual([
        'Version 2 (current)',
        'Version 1',
      ]);
      await user.click(screen.getByRole('option', { name: 'Version 1' }));

      const version = within(history).getByRole('group', {
        name: 'Version 1',
      });
      expect(version).toHaveTextContent(
        /^What is two plus two\?4Variants: IVfour$/,
      );
      expect(history).toHaveTextContent('Answered 1 time · 0 right');
      expect(
        within(history)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['fiveNeeds reviewOct 2']);
      // An earlier version has no progress of its own
      expect(history).not.toHaveTextContent('Still learning');
    });

    it("says when an earlier version's variants weren't recorded", async () => {
      const history = historyOfCardOne();
      history.versions[1].acceptedVariants = null;
      mockCardHistory(() => history);
      const user = await answerFirstCard();
      const region = screen.getByRole('region', historyRegion);

      await openPicker(user, region);
      await user.click(screen.getByRole('option', { name: 'Version 1' }));

      expect(
        within(region).getByRole('group', { name: 'Version 1' }),
      ).toHaveTextContent(
        /^What is two plus two\?4fourVariants weren’t recorded for this version\.$/,
      );
    });

    it('shows no version block for the current version', async () => {
      await answerFirstCard();

      expect(
        within(screen.getByRole('region', historyRegion)).queryByRole('group'),
      ).not.toBeInTheDocument();
    });

    it('puts answers with no recorded version before the first version recorded', async () => {
      const history = historyOfCardOne();
      history.versions = history.versions.slice(0, 1);
      history.unversioned = {
        attempts: [
          {
            id: 'attempt-old',
            userAnswer: 'three',
            recallGrade: 'MISSED',
            createdAt: '2026-09-01T12:00:00.000Z',
          },
        ],
        answeredCount: 1,
        rightCount: 0,
      };
      mockCardHistory(() => history);
      const user = await answerFirstCard();
      const region = screen.getByRole('region', historyRegion);

      expect(await openPicker(user, region)).toEqual([
        'Version 2 (current)',
        'Before version 2',
      ]);
      await user.click(
        screen.getByRole('option', { name: 'Before version 2' }),
      );

      expect(region).toHaveTextContent('Answered 1 time · 0 right');
      expect(
        within(region)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['threeNeeds reviewSep 1']);
    });

    it('has no picker when the card has only its current version', async () => {
      const history = historyOfCardOne();
      history.versions = history.versions.slice(0, 1);
      mockCardHistory(() => history);
      await answerFirstCard();

      expect(
        within(screen.getByRole('region', historyRegion)).queryByRole(
          'combobox',
        ),
      ).not.toBeInTheDocument();
    });

    it('is shown for a card reviewed with Back', async () => {
      const user = await answerFirstCard();
      await user.click(screen.getByRole('button', { name: /next/i }));
      await screen.findByText('Capital of France?');
      expect(
        screen.queryByRole('region', historyRegion),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /previous/i }));

      expect(
        await screen.findByRole('region', historyRegion),
      ).toHaveTextContent('Answered 3 times · 2 right');
    });

    it('refreshes once "My answer was correct" regrades the answer', async () => {
      const user = await answerFirstCard('IV', 'incorrect');

      await user.click(
        screen.getByRole('button', { name: 'My answer was correct' }),
      );

      await waitFor(() =>
        expect(mockInvalidateHistory).toHaveBeenCalledWith({
          cardId: 'card-1',
        }),
      );
    });

    it('refreshes once an edit to the card is saved', async () => {
      const user = await answerFirstCard();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Edit card' })).toBeEnabled(),
      );

      await user.click(screen.getByRole('button', { name: 'Edit card' }));
      await user.click(screen.getByRole('button', { name: 'Flip to front' }));
      await user.type(
        screen.getByRole('textbox', { name: 'Front' }),
        ' exactly{Enter}',
      );

      expect(mockInvalidateHistory).toHaveBeenCalledWith({ cardId: 'card-1' });
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
