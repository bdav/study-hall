import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import LessonPage from './LessonPage';
import { trpc } from '@/lib/trpc';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockSetData = vi.fn();
const mockCancel = vi.fn();
const mockInvalidate = vi.fn();
const mockInvalidateCards = vi.fn();
const mockInvalidateDecks = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      lesson: {
        getById: {
          setData: mockSetData,
          cancel: mockCancel,
          invalidate: mockInvalidate,
        },
      },
      card: { listByDeck: { invalidate: mockInvalidateCards } },
      deck: { list: { invalidate: mockInvalidateDecks } },
    })),
    auth: { me: { useQuery: vi.fn() } },
    lesson: {
      getById: { useQuery: vi.fn() },
      generate: { useMutation: vi.fn() },
      proposeReviewCards: { useMutation: vi.fn() },
      createReviewCards: { useMutation: vi.fn() },
    },
    exercise: {
      submitAttempt: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
      answers: { useQuery: vi.fn(() => ({ data: undefined })) },
    },
  },
}));

type LessonQuery = ReturnType<typeof trpc.lesson.getById.useQuery>;
type GenerateMutation = ReturnType<typeof trpc.lesson.generate.useMutation>;
type ProposeMutation = ReturnType<
  typeof trpc.lesson.proposeReviewCards.useMutation
>;
type CreateMutation = ReturnType<
  typeof trpc.lesson.createReviewCards.useMutation
>;
type CreateOptions = Parameters<
  typeof trpc.lesson.createReviewCards.useMutation
>[0];

const lesson = {
  id: 'lesson-1',
  title: 'Greetings',
  objectives: ['Greet someone formally'],
  firstOpenedAt: null,
  course: { id: 'course-1', title: 'Italian' },
  generating: false,
  version: null,
};

const generatedLesson = {
  ...lesson,
  firstOpenedAt: '2026-10-23T09:00:00.000Z',
  version: {
    id: 'version-1',
    content: [
      {
        heading: 'Saying hello',
        paragraphs: [
          'Italian has a formal and an informal hello.',
          'Use buongiorno with strangers.',
        ],
      },
    ],
    examples: [{ example: 'Ciao, Marco!', explanation: 'An informal hello.' }],
    exercises: [
      {
        id: 'exercise-1',
        type: 'SHORT_ANSWER',
        prompt: 'Translate: Good morning',
        latestAttempt: null,
      },
      {
        id: 'exercise-2',
        type: 'FILL_IN_THE_BLANK',
        prompt: '___, Marco!',
        latestAttempt: null,
      },
      {
        id: 'exercise-3',
        type: 'FREE_FORM_EXPLANATION',
        prompt: 'When would you say buonasera?',
        latestAttempt: null,
      },
    ],
    hiddenExerciseCount: 0,
  },
};

const mockGenerate = vi.fn();
const mockPropose = vi.fn();
const mockResetProposal = vi.fn();
const mockCreate = vi.fn();

function renderPage({
  query = {},
  mutation = {},
  canUseAI = true,
  meLoading = false,
  strict = false,
  propose = {},
  create = {},
}: {
  query?: Partial<LessonQuery>;
  mutation?: Partial<GenerateMutation>;
  canUseAI?: boolean;
  meLoading?: boolean;
  strict?: boolean;
  propose?: Partial<ProposeMutation>;
  create?: Partial<CreateMutation>;
} = {}) {
  vi.mocked(trpc.auth.me.useQuery).mockReturnValue(
    (meLoading
      ? { data: undefined, isLoading: true }
      : {
          data: { user: { id: 'user-1', email: 'me@example.com', canUseAI } },
          isLoading: false,
        }) as ReturnType<typeof trpc.auth.me.useQuery>,
  );
  vi.mocked(trpc.lesson.getById.useQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    ...query,
  } as LessonQuery);
  vi.mocked(trpc.lesson.generate.useMutation).mockReturnValue({
    mutate: mockGenerate,
    isPending: false,
    isError: false,
    error: null,
    ...mutation,
  } as unknown as GenerateMutation);
  vi.mocked(trpc.lesson.proposeReviewCards.useMutation).mockReturnValue({
    mutate: mockPropose,
    reset: mockResetProposal,
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    ...propose,
  } as unknown as ProposeMutation);
  vi.mocked(trpc.lesson.createReviewCards.useMutation).mockReturnValue({
    mutate: mockCreate,
    isPending: false,
    ...create,
  } as unknown as CreateMutation);

  const page = (
    <MemoryRouter initialEntries={['/lessons/lesson-1']}>
      <Routes>
        <Route path="/lessons/:lessonId" element={<LessonPage />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LessonPage', () => {
  describe('a generated lesson', () => {
    it('loads the lesson from the route', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      expect(trpc.lesson.getById.useQuery).toHaveBeenCalledWith(
        { id: 'lesson-1' },
        expect.anything(),
      );
      expect(
        screen.getByRole('heading', { level: 1, name: 'Greetings' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /italian/i })).toHaveAttribute(
        'href',
        '/courses/course-1',
      );
    });

    it('renders the content blocks and examples', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      expect(
        screen.getByRole('heading', { name: 'Saying hello' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Italian has a formal and an informal hello.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Use buongiorno with strangers.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Ciao, Marco!')).toBeInTheDocument();
      expect(screen.getByText('An informal hello.')).toBeInTheDocument();
    });

    it('lists the exercises in order with their type', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      const exercises = within(
        screen.getByRole('list', { name: /exercises/i }),
      ).getAllByRole('listitem');
      expect(exercises).toHaveLength(3);
      expect(exercises[0]).toHaveTextContent(
        /short answer.*translate: good morning/i,
      );
      expect(exercises[1]).toHaveTextContent(/fill in the blank.*, marco!/i);
      expect(exercises[2]).toHaveTextContent(
        /explain.*when would you say buonasera\?/i,
      );
    });

    it('says how many exercises are hidden because they need AI access', () => {
      renderPage({
        query: {
          data: {
            ...generatedLesson,
            version: {
              ...generatedLesson.version,
              exercises: generatedLesson.version.exercises.slice(0, 2),
              hiddenExerciseCount: 1,
            },
          },
        } as Partial<LessonQuery>,
      });

      expect(screen.getByText(/1 more exercise needs AI/i)).toBeInTheDocument();
    });

    it('mentions no hidden exercises when none are hidden', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      expect(screen.queryByText(/needs? AI/i)).not.toBeInTheDocument();
    });

    it('never generates a lesson that already has a version', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });

  describe('making review cards', () => {
    const proposal = {
      cards: [
        {
          type: 'TYPED_RECALL' as const,
          front: 'Translate: Good morning',
          canonicalAnswer: 'Buongiorno',
        },
        {
          type: 'TYPED_RECALL' as const,
          front: 'Translate: Good evening',
          canonicalAnswer: 'Buonasera',
        },
      ],
      model: 'claude-sonnet-5-5',
      promptVersion: 'card-proposal-v1',
      existingCards: [
        {
          id: 'card-1',
          front: 'Translate: Good evening',
          canonicalAnswer: 'Buonasera',
        },
      ],
    };
    const written = { data: generatedLesson } as Partial<LessonQuery>;

    it('proposes review cards for the lesson', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });

      await user.click(
        screen.getByRole('button', { name: 'Make review cards' }),
      );

      expect(mockPropose).toHaveBeenCalledWith({ id: 'lesson-1' });
    });

    it('is offered only to learners who can use AI', () => {
      renderPage({ query: written, canUseAI: false });

      expect(
        screen.queryByRole('button', { name: 'Make review cards' }),
      ).not.toBeInTheDocument();
    });

    it('shows that cards are being proposed', () => {
      renderPage({ query: written, propose: { isPending: true } });

      expect(
        screen.getByRole('button', { name: /proposing cards/i }),
      ).toBeDisabled();
    });

    it('says why proposing failed', () => {
      renderPage({
        query: written,
        propose: {
          isError: true,
          error: { message: 'AI features are paused until next month.' },
        } as unknown as Partial<ProposeMutation>,
      });

      expect(
        screen.getByText('AI features are paused until next month.'),
      ).toBeInTheDocument();
    });

    it('opens the proposed cards in the preview, with Course Deck duplicates flagged', () => {
      renderPage({ query: written, propose: { data: proposal } });

      expect(screen.getByLabelText('Card 1 front')).toHaveValue(
        'Translate: Good morning',
      );
      expect(screen.getByLabelText('Include card 2')).not.toBeChecked();
      expect(
        screen.getByText(/already in the course deck/i),
      ).toBeInTheDocument();
    });

    it('adds the confirmed cards to the Course Deck as Typed Recall cards from this proposal', async () => {
      const user = userEvent.setup();
      renderPage({ query: written, propose: { data: proposal } });

      await user.click(screen.getByRole('button', { name: 'Add 1 card' }));

      expect(mockCreate).toHaveBeenCalledWith({
        id: 'lesson-1',
        model: 'claude-sonnet-5-5',
        promptVersion: 'card-proposal-v1',
        cards: [
          {
            type: 'TYPED_RECALL',
            front: 'Translate: Good morning',
            canonicalAnswer: 'Buongiorno',
          },
        ],
      });
    });

    it('closes the preview, refreshes the deck and confirms once the cards are added', () => {
      renderPage({ query: written, propose: { data: proposal } });
      const [options] = vi.mocked(trpc.lesson.createReviewCards.useMutation)
        .mock.calls[0] as [CreateOptions];

      options?.onSuccess?.(
        { deckId: 'deck-1', createdCount: 1 },
        {} as never,
        undefined,
        {} as never,
      );

      expect(mockResetProposal).toHaveBeenCalled();
      expect(mockInvalidateCards).toHaveBeenCalledWith({ deckId: 'deck-1' });
      expect(mockInvalidateDecks).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        'Added 1 review card to the course deck',
      );
    });

    it('closes the preview without adding anything on cancel', async () => {
      const user = userEvent.setup();
      renderPage({ query: written, propose: { data: proposal } });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockResetProposal).toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('a lesson opened for the first time', () => {
    it('generates it once, even under StrictMode', () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        strict: true,
      });

      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(mockGenerate).toHaveBeenCalledWith({ id: 'lesson-1' });
    });

    it('shows a loading state while the lesson is written', () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        mutation: { isPending: true },
      });

      expect(
        screen.getByRole('status', { name: /writing your lesson/i }),
      ).toBeInTheDocument();
    });

    it('shows the lesson as soon as it is generated, ahead of any stale refetch', async () => {
      renderPage({ query: { data: lesson } as Partial<LessonQuery> });

      const options = vi.mocked(trpc.lesson.generate.useMutation).mock
        .calls[0][0] as { onSuccess: (data: unknown) => Promise<void> };
      await options.onSuccess(generatedLesson);

      expect(mockCancel).toHaveBeenCalledWith({ id: 'lesson-1' });
      expect(mockSetData).toHaveBeenCalledWith(
        { id: 'lesson-1' },
        generatedLesson,
      );
    });

    it("doesn't generate without AI access, and says why", () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        canUseAI: false,
      });

      expect(mockGenerate).not.toHaveBeenCalled();
      expect(screen.getByText(/needs ai access/i)).toBeInTheDocument();
    });

    it("waits to learn whether the learner can use AI before saying they can't", () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        meLoading: true,
      });

      expect(screen.queryByText(/needs ai access/i)).not.toBeInTheDocument();
      expect(mockGenerate).not.toHaveBeenCalled();
      expect(
        screen.getByRole('status', { name: /writing your lesson/i }),
      ).toBeInTheDocument();
    });

    it('says when AI is paused by the spending cap', () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        mutation: {
          isError: true,
          error: {
            message: 'AI features are paused until next month.',
            data: { code: 'TOO_MANY_REQUESTS' },
          },
        } as unknown as Partial<GenerateMutation>,
      });

      expect(
        screen.getByText('AI features are paused until next month.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /try again/i }),
      ).not.toBeInTheDocument();
    });

    it('waits for a lesson another tab is writing, without writing it again', () => {
      renderPage({
        query: {
          data: { ...lesson, generating: true },
        } as Partial<LessonQuery>,
      });

      expect(mockGenerate).not.toHaveBeenCalled();
      expect(
        screen.getByRole('status', { name: /writing your lesson/i }),
      ).toBeInTheDocument();
    });

    it('checks back every few seconds while the lesson is being written', () => {
      renderPage({ query: { data: lesson } as Partial<LessonQuery> });

      const { refetchInterval } = vi.mocked(trpc.lesson.getById.useQuery).mock
        .calls[0][1] as {
        refetchInterval: (query: {
          state: { data?: { generating: boolean } };
        }) => number | false;
      };
      expect(refetchInterval({ state: { data: { generating: true } } })).toBe(
        3000,
      );
      expect(refetchInterval({ state: { data: { generating: false } } })).toBe(
        false,
      );
    });

    it('joins the wait when another tab started writing the lesson first', () => {
      renderPage({
        // The lesson is refetched to learn that another open is writing it
        query: { data: lesson, isFetching: true } as Partial<LessonQuery>,
        mutation: {
          isError: true,
          error: {
            message: 'This lesson is already being written.',
            data: { code: 'CONFLICT' },
          },
        } as unknown as Partial<GenerateMutation>,
      });

      const options = vi.mocked(trpc.lesson.generate.useMutation).mock
        .calls[0][0] as { onError: (error: unknown) => void };
      options.onError({ data: { code: 'CONFLICT' } });

      expect(mockInvalidate).toHaveBeenCalledWith({ id: 'lesson-1' });
      expect(
        screen.getByRole('status', { name: /writing your lesson/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /try again/i }),
      ).not.toBeInTheDocument();
    });

    it('offers to try again if the other open stopped without writing it', () => {
      renderPage({
        query: { data: lesson, isFetching: false } as Partial<LessonQuery>,
        mutation: {
          isError: true,
          error: {
            message: 'This lesson is already being written.',
            data: { code: 'CONFLICT' },
          },
        } as unknown as Partial<GenerateMutation>,
      });

      expect(
        screen.getByRole('button', { name: /try again/i }),
      ).toBeInTheDocument();
    });

    it('offers to try again when generation fails', async () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        mutation: {
          isError: true,
          error: {
            message: "The AI didn't produce a usable answer.",
            data: { code: 'BAD_GATEWAY' },
          },
        } as unknown as Partial<GenerateMutation>,
      });
      mockGenerate.mockClear();

      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: /try again/i }));

      expect(mockGenerate).toHaveBeenCalledWith({ id: 'lesson-1' });
    });
  });

  it('shows a loading state', () => {
    renderPage({ query: { isLoading: true } });

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows when the lesson cannot be found', () => {
    renderPage({
      query: {
        isError: true,
        error: { data: { code: 'NOT_FOUND' } },
      } as unknown as Partial<LessonQuery>,
    });

    expect(screen.getByText(/lesson not found/i)).toBeInTheDocument();
  });
});
