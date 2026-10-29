import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { SyllabusEditor } from './SyllabusEditor';
import { trpc } from '@/lib/trpc';

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      course: { getById: { invalidate: vi.fn() } },
    })),
    course: {
      updateLesson: { useMutation: vi.fn() },
      reorderLessons: { useMutation: vi.fn() },
      addLesson: { useMutation: vi.fn() },
      archiveLesson: { useMutation: vi.fn() },
    },
  },
}));

const lessons = [
  {
    id: 'lesson-1',
    title: 'Greetings',
    objectives: ['Greet someone formally and informally', 'Say your name'],
  },
  { id: 'lesson-2', title: 'At the café', objectives: ['Order food'] },
  { id: 'lesson-3', title: 'Numbers', objectives: ['Count to one hundred'] },
];

const mutate = {
  updateLesson: vi.fn(),
  reorderLessons: vi.fn(),
  addLesson: vi.fn(),
  archiveLesson: vi.fn(),
};

function renderEditor(
  props: Partial<Parameters<typeof SyllabusEditor>[0]> = {},
) {
  for (const name of Object.keys(mutate) as (keyof typeof mutate)[]) {
    vi.mocked(trpc.course[name].useMutation).mockReturnValue({
      mutate: mutate[name],
      isPending: false,
    } as never);
  }

  return render(
    <SyllabusEditor
      courseId="course-1"
      lessons={lessons}
      onDone={vi.fn()}
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SyllabusEditor', () => {
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

  it('finishes editing', async () => {
    const onDone = vi.fn();
    renderEditor({ onDone });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(onDone).toHaveBeenCalled();
  });
});
