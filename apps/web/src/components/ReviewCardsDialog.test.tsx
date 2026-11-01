import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ReviewCardsDialog } from './ReviewCardsDialog';

const proposals = [
  { front: 'Translate: Good morning', canonicalAnswer: 'Buongiorno' },
  { front: 'Translate: Good evening', canonicalAnswer: 'Buonasera' },
];

const mockConfirm = vi.fn();

function renderDialog({
  existingCards = [],
  isPending = false,
}: {
  existingCards?: { id: string; front: string; canonicalAnswer: string }[];
  isPending?: boolean;
} = {}) {
  return render(
    <ReviewCardsDialog
      open
      onClose={vi.fn()}
      onConfirm={mockConfirm}
      isPending={isPending}
      proposals={proposals}
      existingCards={existingCards}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReviewCardsDialog', () => {
  it('shows every proposed card, selected, and adds them all', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByLabelText('Card 1 front')).toHaveValue(
      'Translate: Good morning',
    );
    expect(screen.getByLabelText('Card 2 answer')).toHaveValue('Buonasera');
    expect(screen.getByLabelText('Include card 1')).toBeChecked();
    expect(screen.getByLabelText('Include card 2')).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Add 2 cards' }));

    expect(mockConfirm).toHaveBeenCalledWith(proposals);
  });

  it('adds cards as the learner edited them', async () => {
    const user = userEvent.setup();
    renderDialog();

    const answer = screen.getByLabelText('Card 1 answer');
    await user.clear(answer);
    await user.type(answer, 'Buon giorno');
    await user.click(screen.getByRole('button', { name: 'Add 2 cards' }));

    expect(mockConfirm).toHaveBeenCalledWith([
      { front: 'Translate: Good morning', canonicalAnswer: 'Buon giorno' },
      proposals[1],
    ]);
  });

  it('leaves out deselected cards, and adds nothing when none are selected', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByLabelText('Include card 1'));
    expect(
      screen.getByRole('button', { name: 'Add 1 card' }),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText('Include card 2'));
    expect(screen.getByRole('button', { name: 'Add 0 cards' })).toBeDisabled();

    await user.click(screen.getByLabelText('Include card 2'));
    await user.click(screen.getByRole('button', { name: 'Add 1 card' }));
    expect(mockConfirm).toHaveBeenCalledWith([proposals[1]]);
  });

  it('flags a card the Course Deck already has, and leaves it deselected', () => {
    renderDialog({
      existingCards: [
        {
          id: 'card-1',
          front: 'translate: good morning',
          canonicalAnswer: 'Buongiorno',
        },
      ],
    });

    expect(screen.getByLabelText('Include card 1')).not.toBeChecked();
    expect(screen.getByLabelText('Include card 2')).toBeChecked();
    expect(screen.getAllByText(/already in the course deck/i)).toHaveLength(1);
  });

  it('stops flagging a duplicate once its front is edited to differ', async () => {
    const user = userEvent.setup();
    renderDialog({
      existingCards: [
        {
          id: 'card-1',
          front: 'Translate: Good morning',
          canonicalAnswer: 'Buongiorno',
        },
      ],
    });

    await user.type(screen.getByLabelText('Card 1 front'), ' (formal)');

    expect(
      screen.queryByText(/already in the course deck/i),
    ).not.toBeInTheDocument();
  });

  it("won't add a selected card with a blank front or answer", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByLabelText('Card 2 answer'));

    expect(screen.getByRole('button', { name: 'Add 2 cards' })).toBeDisabled();
  });

  it('disables adding while the cards are being created', () => {
    renderDialog({ isPending: true });

    expect(screen.getByRole('button', { name: /adding/i })).toBeDisabled();
  });

  describe('as the preview of generated cards', () => {
    const mockRefine = vi.fn();

    function renderGenerated({
      instructions = ['Common Italian greetings'],
      note = null,
      cards = proposals,
      isRefining = false,
      refineError = null,
    }: {
      instructions?: string[];
      note?: string | null;
      cards?: typeof proposals;
      isRefining?: boolean;
      refineError?: string | null;
    } = {}) {
      return render(
        <ReviewCardsDialog
          open
          onClose={vi.fn()}
          onConfirm={mockConfirm}
          isPending={false}
          proposals={cards}
          existingCards={[
            {
              id: 'card-1',
              front: 'Translate: good evening',
              canonicalAnswer: 'Buonasera',
            },
          ]}
          title="Generate cards"
          deckNoun="deck"
          instructions={instructions}
          note={note}
          refine={{ onRefine: mockRefine, isRefining, error: refineError }}
        />,
      );
    }

    it("shows the learner's description and the model's note, and flags cards the deck has", () => {
      renderGenerated({ note: 'Only two greetings fit.' });

      const dialog = screen.getByRole('dialog');
      expect(
        within(dialog).getByRole('heading', { name: 'Generate cards' }),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole('list', { name: 'Your description' }),
      ).toHaveTextContent('Common Italian greetings');
      expect(within(dialog).getByText('Only two greetings fit.')).toBeVisible();
      expect(within(dialog).getByText(/already in the deck/i)).toBeVisible();
      expect(within(dialog).getByLabelText('Include card 2')).not.toBeChecked();
    });

    it('lists the description and every instruction since, in order', () => {
      renderGenerated({
        instructions: ['Common Italian greetings', 'Add formal ones'],
      });

      expect(
        within(
          screen.getByRole('list', {
            name: 'Your description and instructions',
          }),
        )
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toEqual(['Common Italian greetings', 'Add formal ones']);
    });

    it('says when no cards were proposed and there is no note', () => {
      renderGenerated({ cards: [] });

      expect(screen.getByText('No cards were proposed.')).toBeVisible();
    });

    it('refines from a follow-up instruction and the cards as the learner left them', async () => {
      const user = userEvent.setup();
      renderGenerated();

      const answer = screen.getByLabelText('Card 1 answer');
      await user.clear(answer);
      await user.type(answer, 'Buon giorno');
      await user.click(screen.getByRole('button', { name: 'Refine' }));
      await user.type(
        screen.getByLabelText('Refinement'),
        'Use full sentences',
      );
      await user.click(screen.getByRole('button', { name: 'Propose again' }));

      expect(mockRefine).toHaveBeenCalledWith('Use full sentences', [
        {
          front: 'Translate: Good morning',
          canonicalAnswer: 'Buon giorno',
          included: true,
        },
        {
          front: 'Translate: Good evening',
          canonicalAnswer: 'Buonasera',
          included: false,
        },
      ]);
    });

    it('holds off adding while proposing again, and says why a round failed', async () => {
      const user = userEvent.setup();
      const { unmount } = renderGenerated({ isRefining: true });
      expect(screen.getByRole('button', { name: 'Add 1 card' })).toBeDisabled();
      unmount();

      renderGenerated({ refineError: 'The AI service failed' });
      await user.click(screen.getByRole('button', { name: 'Refine' }));
      expect(screen.getByText('The AI service failed')).toBeVisible();
    });
  });
});
