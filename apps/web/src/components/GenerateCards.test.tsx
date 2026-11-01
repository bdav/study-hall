import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GenerateCards } from './GenerateCards';
import { trpc } from '@/lib/trpc';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockInvalidateCards = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      card: { listByDeck: { invalidate: mockInvalidateCards } },
      deck: { list: { invalidate: vi.fn() } },
    })),
    deck: {
      proposeCards: { useMutation: vi.fn() },
      addGeneratedCards: { useMutation: vi.fn() },
    },
  },
}));

const mutationReturn = {
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
};

const proposal = {
  model: 'claude-sonnet-5-5',
  promptVersion: 'card-generation-v1',
  cards: [
    {
      type: 'TYPED_RECALL' as const,
      front: 'Preterite of hacer: yo ___',
      canonicalAnswer: 'hice',
    },
    {
      type: 'TYPED_RECALL' as const,
      front: 'Preterite of ir: yo ___',
      canonicalAnswer: 'fui',
    },
  ],
  note: null,
  existingCards: [
    { id: 'card-1', front: 'Preterite of ir: yo ___', canonicalAnswer: 'fui' },
  ],
};

function mockPropose(overrides: Partial<typeof mutationReturn> = {}) {
  const propose = vi.fn();
  vi.mocked(trpc.deck.proposeCards.useMutation).mockReturnValue({
    ...mutationReturn,
    mutate: propose,
    ...overrides,
  } as unknown as ReturnType<typeof trpc.deck.proposeCards.useMutation>);
  return propose;
}

/** proposeCards's mutate, answering each call with the next proposal. */
function proposeReplying(...proposals: unknown[]) {
  const propose = vi.fn(
    (_input: unknown, options?: { onSuccess?: (data: unknown) => void }) => {
      options?.onSuccess?.(proposals[propose.mock.calls.length - 1]);
    },
  );
  vi.mocked(trpc.deck.proposeCards.useMutation).mockReturnValue({
    ...mutationReturn,
    mutate: propose,
  } as unknown as ReturnType<typeof trpc.deck.proposeCards.useMutation>);
  return propose;
}

function mockAdd() {
  const add = vi.fn();
  vi.mocked(trpc.deck.addGeneratedCards.useMutation).mockReturnValue({
    ...mutationReturn,
    mutate: add,
  } as unknown as ReturnType<typeof trpc.deck.addGeneratedCards.useMutation>);
  return add;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPropose();
  mockAdd();
});

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  render(<GenerateCards deckId="deck-1" variant="action" />);
  await user.click(screen.getByRole('button', { name: /generate cards/i }));
  return screen.getByRole('dialog');
}

describe('GenerateCards', () => {
  it('proposes cards from the description, 20 to start', async () => {
    const user = userEvent.setup();
    const propose = mockPropose();
    const dialog = await openForm(user);

    const generate = within(dialog).getByRole('button', { name: 'Generate' });
    expect(generate).toBeDisabled();
    expect(within(dialog).getByRole('radio', { name: '20' })).toBeChecked();
    await user.type(
      within(dialog).getByLabelText('Description'),
      'Spanish irregular preterites',
    );
    await user.click(generate);

    expect(propose).toHaveBeenCalledWith(
      {
        deckId: 'deck-1',
        description: 'Spanish irregular preterites',
        count: 20,
      },
      expect.anything(),
    );
  });

  it('asks for as many cards as the chip chosen', async () => {
    const user = userEvent.setup();
    const propose = mockPropose();
    const dialog = await openForm(user);

    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((chip) => chip.closest('label')?.textContent),
    ).toEqual(['10', '20', '30', '50', 'Other']);
    await user.type(within(dialog).getByLabelText('Description'), 'Numbers');
    await user.click(within(dialog).getByRole('radio', { name: '50' }));
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }));

    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({ count: 50 }),
      expect.anything(),
    );
  });

  it('asks for a number of cards of the learner’s own', async () => {
    const user = userEvent.setup();
    const propose = mockPropose();
    const dialog = await openForm(user);

    await user.type(within(dialog).getByLabelText('Description'), 'Numbers');
    await user.click(within(dialog).getByRole('radio', { name: 'Other' }));
    const custom = within(dialog).getByLabelText('Number of cards');
    await user.type(custom, '75');
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }));

    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({ count: 75 }),
      expect.anything(),
    );
  });

  it('says 250 is the most, and holds off Generate, only for a larger number', async () => {
    const user = userEvent.setup();
    const dialog = await openForm(user);

    await user.type(within(dialog).getByLabelText('Description'), 'Numbers');
    expect(within(dialog).queryByText(/250/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Other' }));
    await user.type(within(dialog).getByLabelText('Number of cards'), '300');

    expect(
      within(dialog).getByText('You can generate up to 250 cards at a time.'),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Generate' }),
    ).toBeDisabled();

    await user.clear(within(dialog).getByLabelText('Number of cards'));
    await user.type(within(dialog).getByLabelText('Number of cards'), '250');
    expect(within(dialog).queryByText(/up to 250/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Generate' }),
    ).toBeEnabled();
  });

  it('says the cards are being written, and that a large set takes a while', async () => {
    const user = userEvent.setup();
    mockPropose({ isPending: true });
    const dialog = await openForm(user);

    expect(
      within(dialog).getByRole('status', { name: 'Writing cards' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/couple of minutes/)).toBeVisible();
  });

  it('shows why proposing failed', async () => {
    const user = userEvent.setup();
    mockPropose({
      isError: true,
      error: { message: 'The AI service failed' } as never,
    });
    const dialog = await openForm(user);

    expect(within(dialog).getByText('The AI service failed')).toBeVisible();
  });

  async function generate(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openForm(user);
    await user.type(
      within(dialog).getByLabelText('Description'),
      'Spanish irregular preterites',
    );
    await user.click(within(dialog).getByRole('radio', { name: '10' }));
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }));
    return screen.getByRole('dialog');
  }

  it('opens the proposal in the preview, duplicates unticked, and adds the ticked cards', async () => {
    const user = userEvent.setup();
    proposeReplying(proposal);
    const add = mockAdd();

    const preview = await generate(user);
    expect(
      within(preview).getByText('Spanish irregular preterites'),
    ).toBeVisible();
    expect(within(preview).getByLabelText('Include card 1')).toBeChecked();
    expect(within(preview).getByLabelText('Include card 2')).not.toBeChecked();
    expect(within(preview).getByText(/already in the deck/i)).toBeVisible();
    await user.click(
      within(preview).getByRole('button', { name: 'Add 1 card' }),
    );

    expect(add).toHaveBeenCalledWith({
      deckId: 'deck-1',
      model: 'claude-sonnet-5-5',
      promptVersion: 'card-generation-v1',
      cards: [proposal.cards[0]],
    });
  });

  it('refines the proposal, showing the new one with every instruction', async () => {
    const user = userEvent.setup();
    const propose = proposeReplying(proposal, {
      ...proposal,
      cards: [
        {
          type: 'TYPED_RECALL' as const,
          front: 'Ayer yo ___ la cena (hacer)',
          canonicalAnswer: 'hice',
        },
      ],
    });

    const preview = await generate(user);
    await user.click(within(preview).getByRole('button', { name: 'Refine' }));
    await user.type(
      within(preview).getByLabelText('Refinement'),
      'Use full sentences',
    );
    await user.click(
      within(preview).getByRole('button', { name: 'Propose again' }),
    );

    expect(propose).toHaveBeenLastCalledWith(
      {
        deckId: 'deck-1',
        description: 'Spanish irregular preterites',
        count: 10,
        refining: {
          instructions: ['Use full sentences'],
          cards: [
            {
              front: 'Preterite of hacer: yo ___',
              canonicalAnswer: 'hice',
              included: true,
            },
            {
              front: 'Preterite of ir: yo ___',
              canonicalAnswer: 'fui',
              included: false,
            },
          ],
        },
      },
      expect.anything(),
    );
    const refined = screen.getByRole('dialog');
    expect(
      within(
        within(refined).getByRole('list', {
          name: 'Your description and instructions',
        }),
      )
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Spanish irregular preterites', 'Use full sentences']);
    expect(within(refined).getAllByTestId('review-card-row')).toHaveLength(1);
    expect(within(refined).getByLabelText('Card 1 front')).toHaveValue(
      'Ayer yo ___ la cena (hacer)',
    );
  });

  it('is offered as a tile on an empty deck', () => {
    render(<GenerateCards deckId="deck-1" variant="tile" />);

    expect(
      screen.getByRole('button', { name: /generate cards/i }),
    ).toBeInTheDocument();
  });
});
