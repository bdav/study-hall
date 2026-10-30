import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { RegenerateLessonDialog } from './RegenerateLessonDialog';
import { trpc } from '@/lib/trpc';

const mockSetLesson = vi.fn();
const mockInvalidateCourse = vi.fn();
const mockInvalidateThread = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      lesson: { getById: { setData: mockSetLesson } },
      course: { getById: { invalidate: mockInvalidateCourse } },
      tutor: { thread: { invalidate: mockInvalidateThread } },
    })),
    lesson: { regenerate: { useMutation: vi.fn() } },
  },
}));

type RegenerateMutation = ReturnType<typeof trpc.lesson.regenerate.useMutation>;

const lesson = { id: 'lesson-1', course: { id: 'course-1' } };
const mockRegenerate = vi.fn();

function renderDialog(
  props: Partial<Parameters<typeof RegenerateLessonDialog>[0]> = {},
  mutation: Partial<RegenerateMutation> = {},
) {
  vi.mocked(trpc.lesson.regenerate.useMutation).mockReturnValue({
    mutate: mockRegenerate,
    isPending: false,
    error: null,
    reset: vi.fn(),
    ...mutation,
  } as unknown as RegenerateMutation);

  return render(
    <RegenerateLessonDialog
      lesson={lesson}
      open
      onOpenChange={vi.fn()}
      onRegenerated={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RegenerateLessonDialog', () => {
  it('says what regenerating keeps', () => {
    renderDialog();

    expect(
      screen.getByText(/answers and tutor threads stay with this version/i),
    ).toBeInTheDocument();
  });

  it('rewrites the lesson with the feedback written', async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.type(
      screen.getByRole('textbox', { name: /what should change/i }),
      'More examples',
    );
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    expect(mockRegenerate).toHaveBeenCalledWith({
      id: 'lesson-1',
      feedback: 'More examples',
    });
  });

  it('rewrites the lesson without feedback, which is optional', async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    expect(mockRegenerate).toHaveBeenCalledWith({ id: 'lesson-1' });
  });

  it('shows the new version and closes once it is written', () => {
    const onOpenChange = vi.fn();
    const onRegenerated = vi.fn();
    renderDialog({ onOpenChange, onRegenerated });

    const options = vi.mocked(trpc.lesson.regenerate.useMutation).mock
      .calls[0][0] as { onSuccess: (view: unknown) => void };
    const view = { id: 'lesson-1', version: { id: 'version-2' } };
    act(() => options.onSuccess(view));

    expect(mockSetLesson).toHaveBeenCalledWith({ id: 'lesson-1' }, view);
    expect(mockInvalidateThread).toHaveBeenCalledWith({ lessonId: 'lesson-1' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onRegenerated).toHaveBeenCalled();
  });

  it("can't be closed or sent twice while the lesson is rewritten", () => {
    renderDialog({}, { isPending: true });

    expect(
      screen.getByRole('button', { name: /regenerating/i }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('says AI features are paused, not broken, once the monthly cap is reached', () => {
    renderDialog({}, {
      error: {
        data: { code: 'TOO_MANY_REQUESTS' },
        message: 'AI features are paused until next month.',
      },
    } as unknown as Partial<RegenerateMutation>);

    expect(
      screen.getByText('AI features are paused until next month.'),
    ).toBeInTheDocument();
  });

  it('says when the lesson is already being written', () => {
    renderDialog({}, {
      error: {
        data: { code: 'CONFLICT' },
        message: 'This lesson is already being written.',
      },
    } as unknown as Partial<RegenerateMutation>);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This lesson is already being written.',
    );
  });

  it('says a failed regeneration left the lesson as it was', () => {
    renderDialog({}, {
      error: { data: { code: 'BAD_GATEWAY' }, message: 'upstream' },
    } as unknown as Partial<RegenerateMutation>);

    expect(
      screen.getByText(/couldn't regenerate the lesson.*as it was/i),
    ).toBeInTheDocument();
  });
});
