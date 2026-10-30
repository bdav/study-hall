import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { RegenerateLessonDialog } from './RegenerateLessonDialog';

function renderDialog(
  props: Partial<Parameters<typeof RegenerateLessonDialog>[0]> = {},
) {
  return render(
    <RegenerateLessonDialog
      open
      onOpenChange={vi.fn()}
      onRegenerate={vi.fn()}
      {...props}
    />,
  );
}

describe('RegenerateLessonDialog', () => {
  it('says what regenerating keeps', () => {
    renderDialog();

    expect(
      screen.getByText(/answers and tutor threads stay with this version/i),
    ).toBeInTheDocument();
  });

  it('offers chips for what should change, none chosen to start', () => {
    renderDialog();

    const chips = within(
      screen.getByRole('group', { name: /what should change/i }),
    ).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Too easy',
      'Too hard',
      'Shorter',
      'Longer',
      'More examples',
      'More practice',
      'Explain it differently',
      'More real-world use',
      'Just write it differently',
    ]);
    for (const chip of chips) {
      expect(chip).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('regenerates once a chip or some text says what should change', async () => {
    renderDialog();
    const user = userEvent.setup();
    const regenerate = screen.getByRole('button', { name: 'Regenerate' });
    expect(regenerate).toBeDisabled();

    await user.type(
      screen.getByRole('textbox', { name: /in your own words/i }),
      '  ',
    );
    expect(regenerate).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Shorter' }));
    expect(regenerate).toBeEnabled();
  });

  it('asks with the chips chosen and the words that add detail, then closes', async () => {
    const onRegenerate = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ onRegenerate, onOpenChange });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'More examples' }));
    await user.click(screen.getByRole('button', { name: 'Too easy' }));
    await user.type(
      screen.getByRole('textbox', { name: /in your own words/i }),
      'The formal greetings especially',
    );
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    // In the order shown, whatever order they were chosen in
    expect(onRegenerate).toHaveBeenCalledWith({
      chips: ['TOO_EASY', 'MORE_EXAMPLES'],
      feedback: 'The formal greetings especially',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('asks with chips alone when no words are given', async () => {
    const onRegenerate = vi.fn();
    renderDialog({ onRegenerate });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Just write it differently' }),
    );
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    expect(onRegenerate).toHaveBeenCalledWith({ chips: ['FRESH_TAKE'] });
  });

  it('lets one of a pair of opposites be chosen at a time', async () => {
    renderDialog();
    const user = userEvent.setup();
    const easy = screen.getByRole('button', { name: 'Too easy' });
    const hard = screen.getByRole('button', { name: 'Too hard' });

    await user.click(easy);
    await user.click(hard);

    expect(easy).toHaveAttribute('aria-pressed', 'false');
    expect(hard).toHaveAttribute('aria-pressed', 'true');
    await user.click(hard);
    expect(hard).toHaveAttribute('aria-pressed', 'false');
  });
});
