import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ReviseCardsDialog, type CardChange } from './ReviseCardsDialog';

const changes: CardChange[] = [
  {
    action: 'EDIT',
    cardId: 'card-seven',
    before: {
      front: "Italian for 'seven' (double t)",
      canonicalAnswer: 'sette',
      acceptedVariants: [],
    },
    after: { front: "Italian for 'seven'", canonicalAnswer: 'sette' },
  },
  {
    action: 'EDIT',
    cardId: 'card-morning',
    before: {
      front: 'Good morning (one word)',
      canonicalAnswer: 'Buon giorno',
      acceptedVariants: ['Bongiorno', 'Buongiorno!'],
    },
    after: { front: 'Good morning', canonicalAnswer: 'Buongiorno' },
  },
  {
    action: 'DELETE',
    cardId: 'card-hello',
    before: {
      front: 'Hello (starts with C)',
      canonicalAnswer: 'Ciao',
      acceptedVariants: [],
    },
  },
];

const mockConfirm = vi.fn();
const mockRefine = vi.fn();

type DialogOptions = {
  isPending?: boolean;
  proposed?: CardChange[];
  note?: string | null;
  instructions?: string[];
  isRefining?: boolean;
  refineError?: string | null;
};

function dialogElement({
  isPending = false,
  proposed = changes,
  note = null,
  instructions = ['Remove the hints from the fronts'],
  isRefining = false,
  refineError = null,
}: DialogOptions = {}) {
  return (
    <ReviseCardsDialog
      open
      onClose={vi.fn()}
      onConfirm={mockConfirm}
      onRefine={mockRefine}
      isPending={isPending}
      isRefining={isRefining}
      refineError={refineError}
      instructions={instructions}
      changes={proposed}
      note={note}
    />
  );
}

function renderDialog(options: DialogOptions = {}) {
  return render(dialogElement(options));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReviseCardsDialog', () => {
  it('shows each edit as before and after, and each deletion', () => {
    renderDialog();

    const [seven, morning, hello] = screen.getAllByTestId('card-change');
    expect(
      within(seven).getByText("Italian for 'seven' (double t)"),
    ).toBeInTheDocument();
    expect(within(seven).getByLabelText('Change 1 front')).toHaveValue(
      "Italian for 'seven'",
    );
    expect(within(seven).getByLabelText('Change 1 answer')).toHaveValue(
      'sette',
    );
    expect(within(morning).getByText('Buon giorno')).toBeInTheDocument();
    expect(within(morning).getByLabelText('Change 2 answer')).toHaveValue(
      'Buongiorno',
    );
    expect(within(hello).getByText(/delete/i)).toBeInTheDocument();
    expect(
      within(hello).getByText('Hello (starts with C)'),
    ).toBeInTheDocument();
    expect(within(hello).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it("shows the learner's instruction", () => {
    renderDialog();

    expect(
      screen.getByText('Remove the hints from the fronts'),
    ).toBeInTheDocument();
  });

  it('lists every instruction, oldest first', () => {
    renderDialog({
      instructions: [
        'Remove the hints from the fronts',
        'Keep the hint on the morning card',
      ],
    });

    const list = screen.getByRole('list', { name: 'Your instructions' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Remove the hints from the fronts',
      'Keep the hint on the morning card',
    ]);
  });

  it("shows the model's note on what it couldn't do", () => {
    renderDialog({
      proposed: [],
      note: 'Revising edits and deletes cards; it can’t add new ones.',
    });

    expect(
      screen.getByText(
        'Revising edits and deletes cards; it can’t add new ones.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/no cards need changing/i),
    ).not.toBeInTheDocument();
  });

  it('keeps an edited front or answer on one line', async () => {
    const user = userEvent.setup();
    renderDialog();

    const front = screen.getByLabelText('Change 1 front');
    await user.type(front, '{Enter}!');

    expect(front).toHaveValue("Italian for 'seven'!");
  });

  it('applies every change, giving only the parts an edit changes', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Apply 3 changes' }));

    expect(mockConfirm).toHaveBeenCalledWith({
      edits: [
        { cardId: 'card-seven', front: "Italian for 'seven'" },
        {
          cardId: 'card-morning',
          front: 'Good morning',
          canonicalAnswer: 'Buongiorno',
        },
      ],
      deletions: ['card-hello'],
    });
  });

  it('applies edits as the learner changed them', async () => {
    const user = userEvent.setup();
    renderDialog();

    const front = screen.getByLabelText('Change 1 front');
    await user.clear(front);
    await user.type(front, "  Italian for 'seven' (a number)  ");
    await user.click(screen.getByRole('button', { name: 'Apply 3 changes' }));

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        edits: expect.arrayContaining([
          { cardId: 'card-seven', front: "Italian for 'seven' (a number)" },
        ]),
      }),
    );
  });

  it('leaves out unticked changes', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByLabelText('Include change 2'));
    await user.click(screen.getByLabelText('Include change 3'));
    await user.click(screen.getByRole('button', { name: 'Apply 1 change' }));

    expect(mockConfirm).toHaveBeenCalledWith({
      edits: [{ cardId: 'card-seven', front: "Italian for 'seven'" }],
      deletions: [],
    });
  });

  it('applies nothing with every change unticked', async () => {
    const user = userEvent.setup();
    renderDialog();

    for (const n of [1, 2, 3]) {
      await user.click(screen.getByLabelText(`Include change ${n}`));
    }

    expect(
      screen.getByRole('button', { name: 'Apply 0 changes' }),
    ).toBeDisabled();
  });

  it('says how many cards will have their progress reset, counting only ticked edits', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(
      screen.getByText(/2 cards will have their progress reset/i),
    ).toBeInTheDocument();

    await user.click(screen.getByLabelText('Include change 1'));

    expect(
      screen.getByText(/1 card will have its progress reset/i),
    ).toBeInTheDocument();
  });

  it('treats an edit put back as it was as no change', async () => {
    const user = userEvent.setup();
    renderDialog();

    const front = screen.getByLabelText('Change 1 front');
    await user.clear(front);
    await user.type(front, "Italian for 'seven' (double t)");

    expect(
      screen.getByText(/1 card will have its progress reset/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply 2 changes' }));
    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        edits: [
          {
            cardId: 'card-morning',
            front: 'Good morning',
            canonicalAnswer: 'Buongiorno',
          },
        ],
      }),
    );
  });

  it("says a new answer clears the old one's Accepted Variants", async () => {
    const user = userEvent.setup();
    renderDialog();

    const morning = screen.getAllByTestId('card-change')[1];
    expect(
      within(morning).getByText(/clears 2 accepted variants/i),
    ).toBeInTheDocument();

    const answer = within(morning).getByLabelText('Change 2 answer');
    await user.clear(answer);
    await user.type(answer, 'Buon giorno');

    expect(
      within(morning).queryByText(/clears .* accepted variant/i),
    ).not.toBeInTheDocument();
  });

  it("won't apply a ticked edit with a blank front or answer", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByLabelText('Change 2 answer'));

    expect(
      screen.getByRole('button', { name: 'Apply 3 changes' }),
    ).toBeDisabled();
  });

  it('says when no card needs changing', () => {
    renderDialog({ proposed: [] });

    expect(screen.getByText(/no cards need changing/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Apply 0 changes' }),
    ).toBeDisabled();
  });

  it('disables applying while the changes are being applied', () => {
    renderDialog({ isPending: true });

    expect(screen.getByRole('button', { name: /applying/i })).toBeDisabled();
  });

  describe('refining', () => {
    it('proposes again from a follow-up instruction and the proposal as the learner left it', async () => {
      const user = userEvent.setup();
      renderDialog();

      const front = screen.getByLabelText('Change 1 front');
      await user.clear(front);
      await user.type(front, "Italian for 'seven', the number");
      await user.click(screen.getByLabelText('Include change 3'));
      await user.click(screen.getByRole('button', { name: 'Refine' }));
      await user.type(
        screen.getByLabelText('Refinement'),
        '  Keep the hint on the morning card ',
      );
      await user.click(screen.getByRole('button', { name: 'Propose again' }));

      expect(mockRefine).toHaveBeenCalledWith(
        'Keep the hint on the morning card',
        [
          {
            cardId: 'card-seven',
            action: 'EDIT',
            front: "Italian for 'seven', the number",
            canonicalAnswer: 'sette',
            included: true,
          },
          {
            cardId: 'card-morning',
            action: 'EDIT',
            front: 'Good morning',
            canonicalAnswer: 'Buongiorno',
            included: true,
          },
          { cardId: 'card-hello', action: 'DELETE', included: false },
        ],
      );
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('refines past a blank field on an unticked edit, giving it as proposed', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.clear(screen.getByLabelText('Change 2 answer'));
      await user.click(screen.getByLabelText('Include change 2'));
      await user.click(screen.getByRole('button', { name: 'Refine' }));
      await user.type(screen.getByLabelText('Refinement'), 'Shorter fronts');
      await user.click(screen.getByRole('button', { name: 'Propose again' }));

      expect(mockRefine).toHaveBeenCalledWith(
        'Shorter fronts',
        expect.arrayContaining([
          {
            cardId: 'card-morning',
            action: 'EDIT',
            front: 'Good morning',
            canonicalAnswer: 'Buongiorno',
            included: false,
          },
        ]),
      );
    });

    it('needs a follow-up instruction to propose again', async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole('button', { name: 'Refine' }));

      expect(
        screen.getByRole('button', { name: 'Propose again' }),
      ).toBeDisabled();
    });

    it('is put away without proposing', async () => {
      const user = userEvent.setup();
      renderDialog();

      const refine = screen.getByRole('button', { name: 'Refine' });
      await user.click(refine);
      expect(refine).toHaveAttribute('aria-expanded', 'true');
      await user.click(refine);

      expect(screen.queryByLabelText('Refinement')).not.toBeInTheDocument();
      expect(mockRefine).not.toHaveBeenCalled();
    });

    it('holds off applying while proposing again', async () => {
      const user = userEvent.setup();
      const { rerender } = renderDialog();
      await user.click(screen.getByRole('button', { name: 'Refine' }));

      rerender(dialogElement({ isRefining: true }));

      expect(
        screen.getByRole('button', { name: /proposing again/i }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Apply 3 changes' }),
      ).toBeDisabled();
    });

    it('says why a round failed, keeping the proposal as the learner left it', async () => {
      const user = userEvent.setup();
      const { rerender } = renderDialog();
      await user.click(screen.getByLabelText('Include change 3'));
      await user.click(screen.getByRole('button', { name: 'Refine' }));
      await user.type(screen.getByLabelText('Refinement'), 'Shorter fronts');

      rerender(
        dialogElement({
          refineError: 'AI is paused for the rest of the month',
        }),
      );

      expect(
        screen.getByText('AI is paused for the rest of the month'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Include change 3')).not.toBeChecked();
      expect(screen.getByLabelText('Refinement')).toHaveValue('Shorter fronts');
    });
  });
});
