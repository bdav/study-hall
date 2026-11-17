import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StudyPage from './StudyPage';
import { TooltipProvider } from '@/components/ui/tooltip';
import { trpc } from '@/lib/trpc';

/**
 * Today's Review on the web (#116): the study screen at `/review`, across
 * the decks ticked for it, whose session the API builds (#137).
 */

const mockSetDecksTicked = vi.fn();
const mockStartReview = vi.fn();
const mockAbandon = vi.fn();

vi.mock('@/lib/trpc', () => {
  const query = () => ({ useQuery: vi.fn(() => ({ data: undefined })) });
  const mutation = () => ({
    useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() })),
  });
  const cache = () => ({
    invalidate: vi.fn(),
    setData: vi.fn(),
    getData: vi.fn(),
    cancel: vi.fn(),
  });
  return {
    trpc: {
      useUtils: vi.fn(() => ({
        deck: { getById: cache() },
        card: { listByDeck: cache(), history: cache() },
        study: {
          activeSession: cache(),
          queuePreview: cache(),
          activeReview: cache(),
          reviewPreview: cache(),
        },
        today: { get: cache() },
      })),
      card: {
        update: mutation(),
        delete: mutation(),
        markKnown: mutation(),
        retire: mutation(),
        unretire: mutation(),
        undoRetire: mutation(),
        restoreVersion: mutation(),
        history: query(),
      },
      deck: { getById: query(), update: mutation(), restore: mutation() },
      today: { get: query(), setDecksTicked: mutation() },
      study: {
        startSession: mutation(),
        startReview: mutation(),
        submitAnswer: mutation(),
        dontKnow: mutation(),
        finishSession: mutation(),
        acceptAnswer: mutation(),
        abandonSession: mutation(),
        queuePreview: query(),
        activeSession: query(),
        reviewPreview: query(),
        activeReview: query(),
      },
    },
  };
});

type Today = inferRouterOutputs<AppRouter>['today']['get'];
type ReviewDeck = Today['review']['decks'][number];

const capitals: ReviewDeck = {
  id: 'deck-1',
  name: 'Capitals',
  course: null,
  cardCount: 20,
  dueCount: 3,
  newCount: 0,
  cramUntil: null,
  ticked: true,
};
const italian: ReviewDeck = {
  id: 'deck-2',
  name: 'Italian',
  course: null,
  cardCount: 9,
  dueCount: 0,
  newCount: 2,
  cramUntil: null,
  ticked: false,
};

const preview = {
  sessionSize: 5,
  dueCount: 3,
  newCount: 2,
  deckCount: 2,
  nextDueAt: null as string | null,
  wouldEnd: [] as { id: string; kind: string; deckName: string | null }[],
};

/** A card of a deck, as a session's item gives it, with its deck. */
function itemCard(
  id: string,
  front: string,
  answer: string,
  deck: { id: string; name: string; reversible: boolean },
) {
  return {
    id,
    deckId: deck.id,
    front,
    canonicalAnswers: [
      {
        id: `${id}-answer`,
        text: answer,
        isPrimary: true,
        acceptedVariants: [],
      },
    ],
    reverseVariants: [],
    deck: {
      ...deck,
      forwardLabel: deck.reversible ? 'Country → city' : null,
      reverseLabel: deck.reversible ? 'City → country' : null,
    },
  };
}

const review = {
  id: 'review-1',
  kind: 'TODAYS_REVIEW',
  direction: 'FORWARD',
  studyMode: 'STUDY',
  items: [
    {
      id: 'item-1',
      direction: 'REVERSE',
      status: 'PENDING',
      isRetry: false,
      attempts: [] as { id: string; userAnswer: string; recallGrade: string }[],
      card: itemCard('card-1', 'France', 'Paris', {
        id: 'deck-1',
        name: 'Capitals',
        reversible: true,
      }),
    },
    {
      id: 'item-2',
      direction: 'FORWARD',
      status: 'PENDING',
      isRetry: false,
      attempts: [] as { id: string; userAnswer: string; recallGrade: string }[],
      card: itemCard('card-2', 'Cane', 'Dog', {
        id: 'deck-2',
        name: 'Italian',
        reversible: false,
      }),
    },
  ],
};

function mockReview({
  decks = [capitals, italian],
  previewed = preview,
  unfinished = null,
  continueLearning = [],
}: {
  decks?: ReviewDeck[];
  previewed?: typeof preview;
  unfinished?: typeof review | null;
  continueLearning?: Today['continueLearning'];
} = {}) {
  vi.mocked(trpc.today.get.useQuery).mockReturnValue({
    data: {
      review: { decks, nextDueAt: null },
      continueLearning,
      aiPaused: false,
      previews: { decks: [], courses: [] },
    },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof trpc.today.get.useQuery>);
  vi.mocked(trpc.study.reviewPreview.useQuery).mockReturnValue({
    data: previewed,
    isPlaceholderData: false,
  } as unknown as ReturnType<typeof trpc.study.reviewPreview.useQuery>);
  vi.mocked(trpc.study.activeReview.useQuery).mockReturnValue({
    data: unfinished,
  } as unknown as ReturnType<typeof trpc.study.activeReview.useQuery>);
  vi.mocked(trpc.today.setDecksTicked.useMutation).mockReturnValue({
    mutate: mockSetDecksTicked,
  } as unknown as ReturnType<typeof trpc.today.setDecksTicked.useMutation>);
  vi.mocked(trpc.study.abandonSession.useMutation).mockReturnValue({
    mutate: mockAbandon,
  } as unknown as ReturnType<typeof trpc.study.abandonSession.useMutation>);
  vi.mocked(trpc.study.startReview.useMutation).mockImplementation(((opts?: {
    onSuccess?: (data: typeof review) => void;
  }) => ({
    mutate: mockStartReview.mockImplementation(() => opts?.onSuccess?.(review)),
  })) as unknown as typeof trpc.study.startReview.useMutation);
}

function renderReview() {
  return render(
    <MemoryRouter initialEntries={['/review']}>
      <Routes>
        <Route path="/review" element={<StudyPage review />} />
      </Routes>
    </MemoryRouter>,
    { wrapper: TooltipProvider },
  );
}

const titleCard = () => screen.getByText("Today's Review", { selector: 'p' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("Today's Review's title card", () => {
  it('heads the page, leads back to Home, and says what a review would hold', () => {
    mockReview();
    renderReview();

    expect(
      screen.getByRole('heading', { level: 1, name: "Today's Review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute(
      'href',
      '/',
    );
    expect(titleCard().parentElement).toHaveTextContent(
      '5 to study · from 2 decks',
    );
  });

  it('lists the decks with a tickbox each, labelled with its deck, saving a tick or an untick', async () => {
    mockReview();
    const user = userEvent.setup();
    renderReview();

    const decks = screen.getByRole('group', { name: 'Decks to review' });
    expect(
      within(decks).getByRole('checkbox', { name: 'Review Capitals' }),
    ).toBeChecked();
    expect(
      within(decks).getByRole('checkbox', { name: 'Review Italian' }),
    ).not.toBeChecked();
    expect(decks).toHaveTextContent('3 due');
    expect(decks).toHaveTextContent('2 new');

    await user.click(screen.getByRole('checkbox', { name: 'Review Italian' }));
    expect(mockSetDecksTicked).toHaveBeenLastCalledWith({
      deckIds: ['deck-2'],
      ticked: true,
    });
    await user.click(screen.getByRole('checkbox', { name: 'Review Capitals' }));
    expect(mockSetDecksTicked).toHaveBeenLastCalledWith({
      deckIds: ['deck-1'],
      ticked: false,
    });
  });

  it('ticks every deck with Select all, and unticks them with Select none once all are', async () => {
    mockReview();
    const user = userEvent.setup();
    const { unmount } = renderReview();

    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(mockSetDecksTicked).toHaveBeenLastCalledWith({
      deckIds: ['deck-1', 'deck-2'],
      ticked: true,
    });
    unmount();

    mockReview({ decks: [capitals, { ...italian, ticked: true }] });
    renderReview();
    expect(
      screen.queryByRole('button', { name: 'Select all' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select none' }));
    expect(mockSetDecksTicked).toHaveBeenLastCalledWith({
      deckIds: ['deck-1', 'deck-2'],
      ticked: false,
    });
  });

  it('keeps every deck listed with none ticked, saying so, and when the next card on a ticked deck comes due', () => {
    mockReview({
      decks: [
        { ...capitals, ticked: false },
        { ...italian, ticked: false },
      ],
      previewed: {
        ...preview,
        sessionSize: 0,
        dueCount: 0,
        newCount: 0,
        deckCount: 0,
        nextDueAt: '2099-11-12T15:30:00.000Z',
      },
    });
    renderReview();

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByText('No deck ticked to review')).toBeInTheDocument();
    expect(titleCard().parentElement).toHaveTextContent('Nothing due');
    expect(titleCard().parentElement).toHaveTextContent(
      /Next card due \w+, Nov 12/,
    );
  });

  it("offers a session's length and mode, but not Review retired, a Cram Date or a direction", async () => {
    mockReview();
    const user = userEvent.setup();
    renderReview();

    expect(
      screen.queryByRole('button', { name: /review retired/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cram/i }));
    expect(screen.queryByText(/cram until/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/direction/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^quick/i }));

    expect(trpc.study.reviewPreview.useQuery).toHaveBeenLastCalledWith(
      { sessionType: 'QUICK', studyMode: 'CRAM' },
      expect.anything(),
    );
  });

  it('keeps what the title card says, starting nothing, while a deck is being ticked', async () => {
    mockReview();
    vi.mocked(trpc.today.setDecksTicked.useMutation).mockReturnValue({
      mutate: mockSetDecksTicked,
      isPending: true,
    } as unknown as ReturnType<typeof trpc.today.setDecksTicked.useMutation>);
    const user = userEvent.setup();
    renderReview();

    // Its count, marked busy until looked at again
    expect(
      screen.getByText('5 to study · from 2 decks').parentElement,
    ).toHaveAttribute('aria-busy', 'true');
    await user.click(titleCard());
    expect(mockStartReview).not.toHaveBeenCalled();
  });

  it('says beforehand which unfinished sessions Start would end', () => {
    mockReview({
      previewed: {
        ...preview,
        wouldEnd: [{ id: 's-1', kind: 'DECK', deckName: 'Capitals' }],
      },
    });
    renderReview();

    expect(
      screen.getByText(
        'Starting ends your unfinished session on Capitals, keeping its answers.',
      ),
    ).toBeInTheDocument();
  });

  it('offers an unfinished review to resume, or abandon', async () => {
    const answered = {
      ...review,
      items: [
        {
          ...review.items[0],
          status: 'COMPLETED',
          attempts: [
            { id: 'a-1', userAnswer: 'France', recallGrade: 'NAILED' },
          ],
        },
        review.items[1],
      ],
    };
    mockReview({ unfinished: answered });
    const user = userEvent.setup();
    renderReview();

    expect(titleCard().parentElement).toHaveTextContent('Resume review?');
    expect(titleCard().parentElement).toHaveTextContent('1 of 2 answered');
    expect(
      screen.queryByRole('group', { name: 'Decks to review' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abandon review' }));
    expect(mockAbandon).toHaveBeenCalledWith({ id: 'review-1' });
  });
});

describe("studying Today's Review", () => {
  it('starts it with the options chosen, each card showing its deck and, on a Reversible Deck, its Direction Label', async () => {
    mockReview();
    const user = userEvent.setup();
    renderReview();

    await user.click(titleCard());

    expect(mockStartReview).toHaveBeenCalledWith({
      sessionType: 'STANDARD',
      studyMode: 'STUDY',
    });
    // Reverse asks for the front, showing the city
    expect(await screen.findByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('Capitals · City → country')).toBeInTheDocument();
  });

  /** Starts a review and finishes it at once, to its summary. */
  async function finishReview() {
    vi.mocked(trpc.study.finishSession.useMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(() => Promise.resolve({ id: 'review-1' })),
    } as unknown as ReturnType<typeof trpc.study.finishSession.useMutation>);
    const user = userEvent.setup();
    renderReview();

    await user.click(titleCard());
    await user.click(
      await screen.findByRole('button', { name: 'Finish review' }),
    );
    await screen.findByRole('button', { name: 'Start another review' });
  }

  it('offers Start another review once it ends, and nothing more with no course to continue', async () => {
    mockReview();
    await finishReview();

    expect(screen.getByText('Review complete!')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Next steps' })).toBeNull();
  });

  it("offers the first course's next step after Start another review (#118)", async () => {
    mockReview({
      continueLearning: [
        {
          id: 'course-1',
          title: 'Italian for travel',
          goal: 'Order dinner',
          deadline: null,
          next: {
            kind: 'LESSON',
            lesson: { id: 'lesson-3', title: 'Greetings', written: true },
          },
        },
        {
          id: 'course-2',
          title: 'Spanish',
          goal: 'Chat',
          deadline: null,
          next: { kind: 'SYLLABUS_PROPOSAL' },
        },
      ],
    });
    await finishReview();

    const offers = within(screen.getByRole('list', { name: 'Next steps' }))
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(offers).toEqual([['Continue: Greetings', '/lessons/lesson-3']]);
    // After Start another review, which keeps focus
    expect(
      screen.getByRole('button', { name: 'Start another review' }),
    ).toHaveFocus();
  });
});
