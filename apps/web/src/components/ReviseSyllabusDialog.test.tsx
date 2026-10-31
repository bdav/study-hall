import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ReviseSyllabusDialog } from './ReviseSyllabusDialog';

const lessons = [
  { id: 'l1', title: 'Greetings', status: 'COMPLETE' as const },
  { id: 'l2', title: 'At the café', status: 'OPENED' as const },
  { id: 'l3', title: 'Numbers', status: 'NOT_STARTED' as const },
  { id: 'l4', title: 'Directions', status: 'NOT_STARTED' as const },
];

/** The pacing line at a count of lessons left, at an hour a week. */
function pacingAt(left: number) {
  return {
    lessons: left,
    sessionMinutes: 30,
    minutesPerWeek: 60,
    weeks: Math.max(1, Math.ceil(left / 2)),
    deadline: null,
  };
}

const proposal = {
  model: 'claude-sonnet-5-5',
  promptVersion: 'syllabus-revision-v1',
  note: 'Directions is no longer needed.',
  lessons,
  edits: [
    {
      lessonId: 'l3',
      before: { title: 'Numbers', objectives: ['Count to one hundred'] },
      after: {
        title: 'Numbers to a thousand',
        objectives: ['Count to a thousand'],
      },
    },
  ],
  archives: [{ lessonId: 'l4', title: 'Directions' }],
  additions: [
    {
      title: 'Telling the time',
      objectives: ['Say what time it is'],
      afterLessonId: 'l3',
    },
  ],
  order: null,
  pacing: {
    lessonsLeft: 3,
    byLessonsLeft: [pacingAt(2), pacingAt(3), pacingAt(4)],
  },
};

const onConfirm = vi.fn();
const onRefine = vi.fn();

function renderDialog(changes: Partial<typeof proposal> = {}) {
  return render(
    <ReviseSyllabusDialog
      open
      onClose={vi.fn()}
      onConfirm={onConfirm}
      onRefine={onRefine}
      isPending={false}
      isRefining={false}
      refineError={null}
      rounds={[{ chips: ['SPEED_UP'], text: 'More review' }]}
      proposal={{ ...proposal, ...changes } as never}
    />,
  );
}

/** The change's row, by its number in the preview. */
function change(number: number) {
  return within(screen.getAllByTestId('syllabus-change')[number - 1]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReviseSyllabusDialog', () => {
  it('shows the feedback asked for and the note', () => {
    renderDialog();

    expect(screen.getByText('Speed up — More review')).toBeInTheDocument();
    expect(
      screen.getByText('Directions is no longer needed.'),
    ).toBeInTheDocument();
  });

  it('shows each change, ticked: an edit as before and after, an archive and a new lesson in its place', () => {
    renderDialog();

    expect(change(1).getByText('Numbers')).toBeInTheDocument();
    expect(
      change(1).getByRole('textbox', { name: 'Change 1 title' }),
    ).toHaveValue('Numbers to a thousand');
    expect(
      change(1).getByRole('textbox', { name: 'Change 1 objectives' }),
    ).toHaveValue('Count to a thousand');
    expect(
      change(2).getByText(/new lesson after numbers/i),
    ).toBeInTheDocument();
    expect(
      change(2).getByRole('textbox', { name: 'Change 2 title' }),
    ).toHaveValue('Telling the time');
    expect(change(3).getByText(/archive directions/i)).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toBeChecked();
    }
  });

  it('shows the new order as one change', () => {
    renderDialog({
      edits: [],
      archives: [],
      additions: [],
      order: {
        before: ['l1', 'l2', 'l3', 'l4'],
        after: ['l1', 'l2', 'l4', 'l3'],
      },
    } as never);

    const order = screen.getByRole('list', { name: 'New order' });
    expect(
      within(order)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Greetings', 'At the café', 'Directions', 'Numbers']);
  });

  it('shows the pacing of the lessons left now and with the ticked changes', async () => {
    renderDialog();
    const user = userEvent.setup();

    expect(screen.getByLabelText('Now')).toHaveTextContent(/^3 lessons/);
    // One archived, one added
    expect(screen.getByLabelText('With these changes')).toHaveTextContent(
      /^3 lessons/,
    );
    await user.click(change(3).getByRole('checkbox'));

    expect(screen.getByLabelText('With these changes')).toHaveTextContent(
      /^4 lessons · about 30 minutes each · about 2 weeks/,
    );
  });

  it('leaves the pacing out when it is not known', () => {
    renderDialog({ pacing: null } as never);

    expect(screen.queryByLabelText('Now')).not.toBeInTheDocument();
  });

  it('applies the ticked changes as the learner left them', async () => {
    renderDialog();
    const user = userEvent.setup();
    const title = change(1).getByRole('textbox', { name: 'Change 1 title' });
    await user.clear(title);
    await user.type(title, 'Big numbers');
    await user.click(change(2).getByRole('checkbox'));

    await user.click(screen.getByRole('button', { name: 'Apply changes' }));

    expect(onConfirm).toHaveBeenCalledWith({
      edits: [
        {
          lessonId: 'l3',
          title: 'Big numbers',
          objectives: ['Count to a thousand'],
        },
      ],
      archives: ['l4'],
      additions: [],
      order: null,
    });
  });

  it('applies the new order when ticked', async () => {
    renderDialog({
      edits: [],
      archives: [],
      additions: [],
      order: {
        before: ['l1', 'l2', 'l3', 'l4'],
        after: ['l1', 'l2', 'l4', 'l3'],
      },
    } as never);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Apply changes' }));

    expect(onConfirm).toHaveBeenCalledWith({
      edits: [],
      archives: [],
      additions: [],
      order: ['l1', 'l2', 'l4', 'l3'],
    });
  });

  it('holds off applying with nothing ticked', async () => {
    renderDialog();
    const user = userEvent.setup();

    for (const box of screen.getAllByRole('checkbox')) await user.click(box);

    expect(
      screen.getByRole('button', { name: 'Apply changes' }),
    ).toBeDisabled();
  });

  it('refines from another round of chips and words, with the proposal as the learner left it', async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(change(3).getByRole('checkbox'));

    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'More practical' }));
    await user.type(
      screen.getByRole('textbox', { name: 'In your own words' }),
      'Keep directions',
    );
    await user.click(screen.getByRole('button', { name: 'Propose again' }));

    expect(onRefine).toHaveBeenCalledWith(
      { chips: ['MORE_PRACTICAL'], text: 'Keep directions' },
      {
        edits: [
          {
            lessonId: 'l3',
            title: 'Numbers to a thousand',
            objectives: ['Count to a thousand'],
            included: true,
          },
        ],
        archives: [{ lessonId: 'l4', included: false }],
        additions: [
          {
            title: 'Telling the time',
            objectives: ['Say what time it is'],
            afterLessonId: 'l3',
            included: true,
          },
        ],
        order: null,
      },
    );
  });

  it('refines with a change the learner unticked and blanked as it was proposed', async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(change(2).getByRole('checkbox'));
    await user.clear(
      change(2).getByRole('textbox', { name: 'Change 2 title' }),
    );

    await user.click(screen.getByRole('button', { name: 'Refine' }));
    await user.click(screen.getByRole('button', { name: 'Slow down' }));
    await user.click(screen.getByRole('button', { name: 'Propose again' }));

    const [, refining] = onRefine.mock.lastCall!;
    expect(refining.additions).toEqual([
      {
        title: 'Telling the time',
        objectives: ['Say what time it is'],
        afterLessonId: 'l3',
        included: false,
      },
    ]);
  });

  it('shows the new order without the lessons being archived', () => {
    renderDialog({
      edits: [],
      additions: [],
      archives: [{ lessonId: 'l3', title: 'Numbers' }],
      order: {
        before: ['l1', 'l2', 'l3', 'l4'],
        after: ['l1', 'l2', 'l4', 'l3'],
      },
    } as never);

    const order = screen.getByRole('list', { name: 'New order' });
    expect(
      within(order)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Greetings', 'At the café', 'Directions']);
  });

  it('places a new lesson in place of a lesson being archived', () => {
    renderDialog({
      edits: [],
      archives: [{ lessonId: 'l3', title: 'Numbers' }],
    } as never);

    expect(
      change(1).getByText(/new lesson in place of numbers/i),
    ).toBeInTheDocument();
  });

  it('says when nothing needs changing', () => {
    renderDialog({
      edits: [],
      archives: [],
      additions: [],
      note: null,
    } as never);

    expect(screen.getByText('No lessons need changing.')).toBeInTheDocument();
  });
});
