import { render, screen } from '@testing-library/react';
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
});
