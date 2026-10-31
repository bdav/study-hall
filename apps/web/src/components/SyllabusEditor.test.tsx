import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { SyllabusEditor } from './SyllabusEditor';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      course: {
        getById: { invalidate: vi.fn() },
        listArchivedLessons: { invalidate: vi.fn() },
      },
    })),
    auth: { me: { useQuery: vi.fn() } },
    course: {
      proposeSyllabusRevision: { useMutation: vi.fn() },
      applySyllabusRevision: { useMutation: vi.fn() },
      updateLesson: { useMutation: vi.fn() },
      reorderLessons: { useMutation: vi.fn() },
      addLesson: { useMutation: vi.fn() },
      archiveLesson: { useMutation: vi.fn() },
      restoreLesson: { useMutation: vi.fn() },
      listArchivedLessons: { useQuery: vi.fn() },
    },
  },
}));

const lessons = [
  {
    id: 'lesson-1',
    title: 'Greetings',
    objectives: ['Greet someone formally and informally', 'Say your name'],
    status: 'COMPLETE' as const,
  },
  {
    id: 'lesson-2',
    title: 'At the café',
    objectives: ['Order food'],
    status: 'OPENED' as const,
  },
  {
    id: 'lesson-3',
    title: 'Numbers',
    objectives: ['Count to one hundred'],
    status: 'NOT_STARTED' as const,
  },
];

const mutate = {
  updateLesson: vi.fn(),
  reorderLessons: vi.fn(),
  addLesson: vi.fn(),
  archiveLesson: vi.fn(),
  restoreLesson: vi.fn(),
};

const archivedLessons = [
  { id: 'lesson-4', title: 'Colours', archivedAt: '2026-10-29T12:00:00.000Z' },
  { id: 'lesson-5', title: 'Weather', archivedAt: '2026-10-20T12:00:00.000Z' },
];

const mockPropose = vi.fn();

function renderEditor(
  props: Partial<Parameters<typeof SyllabusEditor>[0]> = {},
  archived: typeof archivedLessons = [],
  { canUseAI = true } = {},
) {
  vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
    data: { user: { id: 'user-1', email: 'me@example.com', canUseAI } },
  } as never);
  vi.mocked(trpc.course.proposeSyllabusRevision.useMutation).mockReturnValue({
    mutate: mockPropose,
    reset: vi.fn(),
    isPending: false,
    error: null,
  } as never);
  vi.mocked(trpc.course.applySyllabusRevision.useMutation).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as never);
  vi.mocked(trpc.course.listArchivedLessons.useQuery).mockReturnValue({
    data: archived,
  } as never);
  for (const name of Object.keys(mutate) as (keyof typeof mutate)[]) {
    vi.mocked(trpc.course[name].useMutation).mockReturnValue({
      mutate: mutate[name],
      isPending: false,
    } as never);
  }

  return render(
    <SyllabusEditor courseId="course-1" lessons={lessons} {...props} />,
  );
}

/** The lesson's row, by its number. */
function lesson(number: number) {
  return within(
    screen.getAllByRole('listitem', { name: /^lesson \d+/i })[number - 1],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('asking for changes', () => {
  const proposal = {
    model: 'claude-sonnet-5-5',
    promptVersion: 'syllabus-revision-v1',
    note: null,
    lessons: lessons.map(({ id, title }) => ({
      id,
      title,
      status: 'NOT_STARTED',
    })),
    edits: [],
    archives: [{ lessonId: 'lesson-3', title: 'Numbers' }],
    additions: [],
    order: null,
    pacing: null,
  };

  it("offers chips and a box for the learner's own words below the lessons", () => {
    renderEditor();

    const form = screen.getByRole('region', { name: 'Ask for changes' });
    const chips = within(form).getByRole('group', {
      name: 'What should change?',
    });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual([
      'Fewer lessons',
      'More lessons',
      'Speed up',
      'Slow down',
      'More practical',
      'More in depth',
    ]);
    for (const chip of within(chips).getAllByRole('button')) {
      expect(chip).toHaveAttribute('aria-pressed', 'false');
    }
    expect(
      within(form).getByRole('button', { name: 'Propose changes' }),
    ).toBeDisabled();
  });

  it("asks for changes from the chips chosen, one of each pair, and the learner's words", async () => {
    renderEditor();
    const user = userEvent.setup();
    const form = within(
      screen.getByRole('region', { name: 'Ask for changes' }),
    );

    await user.click(form.getByRole('button', { name: 'Speed up' }));
    await user.click(form.getByRole('button', { name: 'Slow down' }));
    await user.type(
      form.getByRole('textbox', { name: 'In your own words' }),
      'More review',
    );
    await user.click(form.getByRole('button', { name: 'Propose changes' }));

    expect(mockPropose).toHaveBeenCalledWith(
      { courseId: 'course-1', chips: ['SLOW_DOWN'], feedback: 'More review' },
      expect.anything(),
    );
  });

  it('opens the proposed changes for review', async () => {
    renderEditor();
    const user = userEvent.setup();
    const form = within(
      screen.getByRole('region', { name: 'Ask for changes' }),
    );
    await user.click(form.getByRole('button', { name: 'Fewer lessons' }));
    await user.click(form.getByRole('button', { name: 'Propose changes' }));

    const [, options] = mockPropose.mock.lastCall as [
      unknown,
      { onSuccess: (data: typeof proposal) => void },
    ];
    act(() => options.onSuccess(proposal));

    expect(
      screen.getByRole('dialog', { name: 'Revise syllabus' }),
    ).toBeInTheDocument();
  });

  it('is offered only to learners who can use AI', () => {
    renderEditor({}, [], { canUseAI: false });

    expect(
      screen.queryByRole('region', { name: 'Ask for changes' }),
    ).not.toBeInTheDocument();
  });
});

describe('SyllabusEditor', () => {
  it("shows each lesson's status, as the Syllabus does", () => {
    renderEditor();

    expect(lesson(1).getByText('Complete')).toBeInTheDocument();
    expect(lesson(2).getByText('Opened')).toBeInTheDocument();
    expect(lesson(3).getByText('Not started')).toBeInTheDocument();
  });

  it('shows each lesson ready to edit', () => {
    renderEditor();

    expect(
      lesson(2).getByRole('textbox', { name: 'Lesson 2 title' }),
    ).toHaveValue('At the café');
    expect(
      lesson(1).getByRole('textbox', { name: 'Lesson 1, objective 2' }),
    ).toHaveValue('Say your name');
  });

  it('renames a lesson', async () => {
    renderEditor();
    const user = userEvent.setup();
    const title = lesson(2).getByRole('textbox', { name: 'Lesson 2 title' });

    await user.clear(title);
    await user.type(title, 'Ordering a coffee{Enter}');

    expect(mutate.updateLesson).toHaveBeenCalledWith({
      lessonId: 'lesson-2',
      title: 'Ordering a coffee',
    });
  });

  it("edits a lesson's objectives", async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.type(
      lesson(3).getByRole('textbox', { name: 'New objective for Numbers' }),
      'Tell the time{Enter}',
    );

    expect(mutate.updateLesson).toHaveBeenCalledWith({
      lessonId: 'lesson-3',
      objectives: ['Count to one hundred', 'Tell the time'],
    });
  });

  it('adds a lesson by its title', async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.type(
      screen.getByRole('textbox', { name: 'New lesson title' }),
      'Days of the week{Enter}',
    );

    expect(mutate.addLesson).toHaveBeenCalledWith({
      courseId: 'course-1',
      title: 'Days of the week',
    });
  });

  describe('reordering', () => {
    // jsdom lays nothing out: stack the lessons 100px apart
    beforeEach(() => {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: Element) {
          const row = this.closest('li[aria-label^="Lesson"]');
          const rows = row ? [...row.parentElement!.children] : [];
          const top = row ? rows.indexOf(row) * 100 : 0;
          return new DOMRect(0, top, 600, row ? 90 : 0);
        },
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('moves a lesson by its drag handle, and shows the new order at once', async () => {
      renderEditor();
      const user = userEvent.setup();

      lesson(1)
        .getByRole('button', { name: 'Drag Greetings to reorder' })
        .focus();
      await user.keyboard('[Space]');
      await user.keyboard('[ArrowDown]');
      await user.keyboard('[Space]');

      expect(mutate.reorderLessons).toHaveBeenCalledWith({
        courseId: 'course-1',
        lessonIds: ['lesson-2', 'lesson-1', 'lesson-3'],
      });
      expect(
        lesson(1).getByRole('textbox', { name: 'Lesson 1 title' }),
      ).toHaveValue('At the café');
    });
  });

  it('archives a lesson after confirmation', async () => {
    renderEditor();
    const user = userEvent.setup();

    await user.click(
      lesson(2).getByRole('button', { name: 'Archive At the café' }),
    );
    expect(mutate.archiveLesson).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /^archive$/i }));

    expect(mutate.archiveLesson).toHaveBeenCalledWith({ lessonId: 'lesson-2' });
  });

  it("can't archive the syllabus's only lesson", () => {
    renderEditor({ lessons: [lessons[0]] });

    expect(
      lesson(1).getByRole('button', { name: 'Archive Greetings' }),
    ).toBeDisabled();
  });

  describe('archived lessons', () => {
    it('lists them below the Syllabus, collapsed to start, each to restore', async () => {
      renderEditor({}, archivedLessons);
      const user = userEvent.setup();
      const toggle = screen.getByRole('button', {
        name: /archived lessons \(2\)/i,
      });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByRole('button', { name: 'Restore Colours' }),
      ).not.toBeInTheDocument();

      await user.click(toggle);
      await user.click(screen.getByRole('button', { name: 'Restore Colours' }));

      expect(mutate.restoreLesson).toHaveBeenCalledWith({
        lessonId: 'lesson-4',
      });
      expect(trpc.course.listArchivedLessons.useQuery).toHaveBeenCalledWith({
        courseId: 'course-1',
      });
    });

    it('leaves the list out when no lesson is archived', () => {
      renderEditor();

      expect(
        screen.queryByRole('button', { name: /archived lessons/i }),
      ).not.toBeInTheDocument();
    });
  });
});
