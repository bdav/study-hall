import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ProposalEditor } from './ProposalEditor';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      course: {
        getById: {
          cancel: vi.fn(),
          getData: vi.fn(),
          setData: vi.fn(),
          invalidate: vi.fn(),
        },
      },
    })),
    course: {
      updateProposal: { useMutation: vi.fn() },
      regenerateProposal: { useMutation: vi.fn() },
    },
  },
}));

type UpdateMutation = ReturnType<typeof trpc.course.updateProposal.useMutation>;
type RegenerateMutation = ReturnType<
  typeof trpc.course.regenerateProposal.useMutation
>;

const lessons = [
  {
    title: 'Greetings',
    objectives: ['Greet someone formally and informally', 'Say your name'],
  },
  { title: 'At the café', objectives: ['Order food and drinks'] },
  { title: 'Numbers', objectives: ['Count to one hundred'] },
];

const mockUpdate = vi.fn();
const mockRegenerate = vi.fn();

function renderEditor(
  props: Partial<Parameters<typeof ProposalEditor>[0]> = {},
  regeneration: Partial<RegenerateMutation> = {},
  saving: Partial<UpdateMutation> = {},
) {
  vi.mocked(trpc.course.updateProposal.useMutation).mockReturnValue({
    mutate: mockUpdate,
    isPending: false,
    ...saving,
  } as unknown as UpdateMutation);
  vi.mocked(trpc.course.regenerateProposal.useMutation).mockReturnValue({
    mutate: mockRegenerate,
    isPending: false,
    error: null,
    ...regeneration,
  } as unknown as RegenerateMutation);

  return render(
    <ProposalEditor
      courseId="course-1"
      lessons={lessons}
      feedback={[]}
      courseTitle="Italian"
      onAccept={vi.fn()}
      isAccepting={false}
      onDiscard={vi.fn()}
      isDiscarding={false}
      {...props}
    />,
  );
}

/** The lesson's row, by its number. */
function lesson(number: number) {
  return within(
    screen.getAllByRole('listitem', { name: /^lesson \d+/i })[number - 1],
  );
}

/** The lessons as the last save sent them. */
function savedLessons() {
  return mockUpdate.mock.lastCall?.[0].lessons;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProposalEditor', () => {
  it("shows each lesson's title and learning objectives, ready to edit", () => {
    renderEditor();

    expect(screen.getAllByRole('listitem', { name: /^lesson/i })).toHaveLength(
      3,
    );
    expect(
      lesson(1).getByRole('textbox', { name: 'Lesson 1 title' }),
    ).toHaveValue('Greetings');
    expect(
      lesson(1).getByRole('textbox', { name: 'Lesson 1, objective 2' }),
    ).toHaveValue('Say your name');
  });

  it('renames a lesson when the learner leaves its title', async () => {
    renderEditor();
    const user = userEvent.setup();
    const title = lesson(2).getByRole('textbox', { name: 'Lesson 2 title' });

    await user.clear(title);
    await user.type(title, 'Ordering a coffee');
    await user.tab();

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.lastCall?.[0].courseId).toBe('course-1');
    expect(savedLessons().map((l: { title: string }) => l.title)).toEqual([
      'Greetings',
      'Ordering a coffee',
      'Numbers',
    ]);
  });

  it('puts a blanked title back, saving nothing', async () => {
    renderEditor();
    const user = userEvent.setup();
    const title = lesson(1).getByRole('textbox', { name: 'Lesson 1 title' });

    await user.clear(title);
    await user.tab();

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(title).toHaveValue('Greetings');
  });

  it('edits an objective, and removes one left blank', async () => {
    renderEditor();
    const user = userEvent.setup();
    const first = lesson(1).getByRole('textbox', {
      name: 'Lesson 1, objective 1',
    });

    await user.clear(first);
    await user.type(first, 'Say hello{Enter}');
    expect(savedLessons()[0].objectives).toEqual([
      'Say hello',
      'Say your name',
    ]);

    await user.clear(
      lesson(1).getByRole('textbox', { name: 'Lesson 1, objective 2' }),
    );
    await user.tab();
    expect(savedLessons()[0].objectives).toEqual([
      'Greet someone formally and informally',
    ]);
  });

  it('moves a lesson up or down', async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.click(
      lesson(2).getByRole('button', { name: 'Move At the café up' }),
    );
    expect(savedLessons().map((l: { title: string }) => l.title)).toEqual([
      'At the café',
      'Greetings',
      'Numbers',
    ]);

    await user.click(
      lesson(2).getByRole('button', { name: 'Move At the café down' }),
    );
    expect(savedLessons().map((l: { title: string }) => l.title)).toEqual([
      'Greetings',
      'Numbers',
      'At the café',
    ]);
  });

  it("can't move the first lesson up or the last down", () => {
    renderEditor();

    expect(
      lesson(1).getByRole('button', { name: 'Move Greetings up' }),
    ).toBeDisabled();
    expect(
      lesson(3).getByRole('button', { name: 'Move Numbers down' }),
    ).toBeDisabled();
  });

  it('removes a lesson', async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.click(
      lesson(2).getByRole('button', { name: 'Remove At the café' }),
    );
    expect(savedLessons().map((l: { title: string }) => l.title)).toEqual([
      'Greetings',
      'Numbers',
    ]);
  });

  it('adds a lesson by its title', async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.type(
      screen.getByRole('textbox', { name: 'New lesson title' }),
      'Days of the week{Enter}',
    );

    expect(savedLessons().at(-1)).toEqual({
      title: 'Days of the week',
      objectives: [],
    });
    expect(
      screen.getByRole('textbox', { name: 'New lesson title' }),
    ).toHaveValue('');
  });

  it("won't add a lesson without a title", async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.type(
      screen.getByRole('textbox', { name: 'New lesson title' }),
      '   ',
    );

    expect(screen.getByRole('button', { name: 'Add lesson' })).toBeDisabled();
  });

  it('adds an objective to a lesson', async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.type(
      lesson(3).getByRole('textbox', { name: 'New objective for Numbers' }),
      'Tell the time{Enter}',
    );

    expect(savedLessons()[2].objectives).toEqual([
      'Count to one hundred',
      'Tell the time',
    ]);
  });

  it("can't remove a proposal's only lesson", () => {
    renderEditor({ lessons: [lessons[0]] });

    expect(
      lesson(1).getByRole('button', { name: 'Remove Greetings' }),
    ).toBeDisabled();
  });

  describe('regenerating', () => {
    it('asks for a new proposal with the feedback written', async () => {
      renderEditor();
      const user = userEvent.setup();
      const regenerate = screen.getByRole('button', { name: 'Regenerate' });
      expect(regenerate).toBeDisabled();

      await user.type(
        screen.getByRole('textbox', { name: /ask for a new proposal/i }),
        'More focus on the past tense',
      );
      await user.click(regenerate);

      expect(mockRegenerate).toHaveBeenCalledWith(
        { courseId: 'course-1', feedback: 'More focus on the past tense' },
        expect.anything(),
      );
    });

    it('clears the feedback once the new proposal is in', async () => {
      renderEditor();
      const user = userEvent.setup();
      const box = screen.getByRole('textbox', {
        name: /ask for a new proposal/i,
      });
      await user.type(box, 'Shorter');
      await user.click(screen.getByRole('button', { name: 'Regenerate' }));

      const options = mockRegenerate.mock.lastCall?.[1] as {
        onSuccess: () => void;
      };
      act(() => options.onSuccess());

      expect(box).toHaveValue('');
    });

    it('lists the feedback given so far, oldest first', () => {
      renderEditor({ feedback: ['More focus on the past tense', 'Shorter'] });

      const list = within(
        screen.getByRole('list', { name: /feedback so far/i }),
      );
      expect(
        list.getAllByRole('listitem').map((item) => item.textContent),
      ).toEqual(['More focus on the past tense', 'Shorter']);
    });

    it('holds off editing and accepting while a new proposal is written', () => {
      renderEditor({}, { isPending: true });

      expect(
        screen.getByRole('button', { name: /regenerating/i }),
      ).toBeDisabled();
      expect(
        lesson(1).getByRole('textbox', { name: 'Lesson 1 title' }),
      ).toBeDisabled();
      expect(
        lesson(1).getByRole('button', { name: 'Remove Greetings' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('textbox', { name: 'New lesson title' }),
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: /accept syllabus/i }),
      ).toBeDisabled();
    });

    it("says when the learner's account can't use AI", () => {
      renderEditor({}, {
        error: {
          data: { code: 'FORBIDDEN' },
          message: "Your account doesn't have access to AI features",
        },
      } as unknown as Partial<RegenerateMutation>);

      expect(
        screen.getByText("Your account doesn't have access to AI features"),
      ).toBeInTheDocument();
    });

    it('says AI features are paused, not broken, once the monthly cap is reached', () => {
      renderEditor({}, {
        error: {
          data: { code: 'TOO_MANY_REQUESTS' },
          message: 'AI features are paused until next month.',
        },
      } as unknown as Partial<RegenerateMutation>);

      expect(
        screen.getByText('AI features are paused until next month.'),
      ).toBeInTheDocument();
    });
  });

  it('holds off accepting and regenerating while an edit is saved, but not editing', () => {
    renderEditor({}, {}, { isPending: true });

    expect(
      screen.getByRole('button', { name: /accept syllabus/i }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled();
    expect(
      lesson(1).getByRole('textbox', { name: 'Lesson 1 title' }),
    ).toBeEnabled();
  });

  it('starts a half-typed objective afresh when the lessons move under it', async () => {
    const { rerender } = renderEditor();
    const user = userEvent.setup();
    await user.type(
      lesson(2).getByRole('textbox', { name: 'New objective for At the café' }),
      'Ask for the bill',
    );

    rerender(
      <ProposalEditor
        courseId="course-1"
        lessons={[lessons[0], lessons[2], lessons[1]]}
        feedback={[]}
        courseTitle="Italian"
        onAccept={vi.fn()}
        isAccepting={false}
        onDiscard={vi.fn()}
        isDiscarding={false}
      />,
    );

    expect(
      lesson(2).getByRole('textbox', { name: 'New objective for Numbers' }),
    ).toHaveValue('');
  });

  describe('accepting and discarding', () => {
    it('accepts the proposal', async () => {
      const onAccept = vi.fn();
      renderEditor({ onAccept });
      const user = userEvent.setup();

      await user.click(
        screen.getByRole('button', { name: /accept syllabus/i }),
      );

      expect(onAccept).toHaveBeenCalled();
    });

    it('discards the proposal after confirmation', async () => {
      const onDiscard = vi.fn();
      renderEditor({ onDiscard });
      const user = userEvent.setup();

      await user.click(
        screen.getByRole('button', { name: /discard proposal/i }),
      );
      await user.click(
        await screen.findByRole('button', { name: /^discard$/i }),
      );

      expect(onDiscard).toHaveBeenCalled();
    });
  });
});
