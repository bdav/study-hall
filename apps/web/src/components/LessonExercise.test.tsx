import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { LessonExercise } from './LessonExercise';
import { trpc } from '@/lib/trpc';

const mockInvalidate = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      lesson: { getById: { invalidate: mockInvalidate } },
    })),
    exercise: {
      submitAttempt: { useMutation: vi.fn() },
      answers: { useQuery: vi.fn() },
    },
  },
}));

type SubmitMutation = ReturnType<
  typeof trpc.exercise.submitAttempt.useMutation
>;
type AnswersQuery = ReturnType<typeof trpc.exercise.answers.useQuery>;
type Exercise = Parameters<typeof LessonExercise>[0]['exercise'];

const shortAnswer: Exercise = {
  id: 'exercise-1',
  type: 'SHORT_ANSWER',
  prompt: 'Translate: Good morning',
  latestAttempt: null,
};

const fillInTheBlank: Exercise = {
  id: 'exercise-2',
  type: 'FILL_IN_THE_BLANK',
  prompt: '___, Marco! (informal hello)',
  latestAttempt: null,
};

const freeForm: Exercise = {
  id: 'exercise-3',
  type: 'FREE_FORM_EXPLANATION',
  prompt: 'When would you say buonasera?',
  latestAttempt: null,
};

const mockSubmit = vi.fn();

function renderExercise(
  exercise: Exercise,
  mutation: Partial<SubmitMutation> = {},
  answers: Partial<AnswersQuery> = {},
) {
  vi.mocked(trpc.exercise.answers.useQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    ...answers,
  } as AnswersQuery);
  vi.mocked(trpc.exercise.submitAttempt.useMutation).mockReturnValue({
    mutate: mockSubmit,
    isPending: false,
    isError: false,
    data: undefined,
    ...mutation,
  } as unknown as SubmitMutation);

  return render(
    <ol>
      <LessonExercise exercise={exercise} index={0} lessonId="lesson-1" />
    </ol>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LessonExercise', () => {
  it('submits a short answer', async () => {
    renderExercise(shortAnswer);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/your answer/i), 'Buongiorno');
    await user.click(screen.getByRole('button', { name: /check/i }));

    expect(screen.getByText('Translate: Good morning')).toBeInTheDocument();
    expect(mockSubmit).toHaveBeenCalledWith({
      exerciseId: 'exercise-1',
      answer: 'Buongiorno',
    });
  });

  it('puts the input in the gap of a fill-in-the-blank prompt', async () => {
    renderExercise(fillInTheBlank);
    const user = userEvent.setup();

    expect(screen.queryByText(/___/)).not.toBeInTheDocument();
    expect(screen.getByText(/, Marco! \(informal hello\)/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/fill in the blank/i), 'Ciao');
    await user.keyboard('{Enter}');

    expect(mockSubmit).toHaveBeenCalledWith({
      exerciseId: 'exercise-2',
      answer: 'Ciao',
    });
  });

  it("can't be checked while the answer is blank or a check is running", async () => {
    const { unmount } = renderExercise(shortAnswer);
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
    unmount();

    renderExercise(
      { ...shortAnswer, latestAttempt: null },
      { isPending: true },
    );
    await userEvent
      .setup()
      .type(screen.getByLabelText(/your answer/i), 'Buongiorno');
    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled();
  });

  it('shows a correct result', async () => {
    renderExercise(shortAnswer, {
      data: {
        exerciseId: 'exercise-1',
        answer: 'Buongiorno',
        evaluation: 'CORRECT',
        accentCorrection: null,
        feedback: null,
        createdAt: '2026-10-23T09:00:00.000Z',
      },
    } as unknown as Partial<SubmitMutation>);

    await userEvent
      .setup()
      .type(screen.getByLabelText(/your answer/i), 'Buongiorno');

    expect(screen.getByText(/correct/i)).toBeInTheDocument();
  });

  it('shows an Accent Mismatch as correct, with the accented form and a correction note', async () => {
    renderExercise(fillInTheBlank, {
      data: {
        exerciseId: 'exercise-2',
        answer: 'e',
        evaluation: 'CORRECT',
        accentCorrection: 'è',
        feedback: null,
        createdAt: '2026-10-23T09:00:00.000Z',
      },
    } as unknown as Partial<SubmitMutation>);

    await userEvent
      .setup()
      .type(screen.getByLabelText(/fill in the blank/i), 'e');

    expect(screen.getByText(/correct/i)).toBeInTheDocument();
    expect(screen.getByTestId('accent-note')).toHaveTextContent(
      /check the accents/i,
    );
    expect(screen.getByTestId('accent-note')).toHaveTextContent('è');
  });

  it('adds no correction note to a correct answer with the right accents', async () => {
    renderExercise(shortAnswer, {
      data: {
        exerciseId: 'exercise-1',
        answer: 'Buongiorno',
        evaluation: 'CORRECT',
        accentCorrection: null,
        feedback: null,
        createdAt: '2026-10-23T09:00:00.000Z',
      },
    } as unknown as Partial<SubmitMutation>);

    await userEvent
      .setup()
      .type(screen.getByLabelText(/your answer/i), 'Buongiorno');

    expect(screen.queryByTestId('accent-note')).not.toBeInTheDocument();
  });

  it('shows an incorrect result and lets the learner try again', async () => {
    renderExercise(shortAnswer, {
      data: {
        exerciseId: 'exercise-1',
        answer: 'Buonasera',
        evaluation: 'INCORRECT',
        accentCorrection: null,
        feedback: null,
        createdAt: '2026-10-23T09:00:00.000Z',
      },
    } as unknown as Partial<SubmitMutation>);

    await userEvent
      .setup()
      .type(screen.getByLabelText(/your answer/i), 'Buonasera');

    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your answer/i)).toBeEnabled();
  });

  it('hides the result once the learner edits the answer it was for', async () => {
    renderExercise({
      ...shortAnswer,
      latestAttempt: {
        exerciseId: 'exercise-1',
        answer: 'Buongiorno',
        evaluation: 'CORRECT',
        accentCorrection: null,
        feedback: null,
        createdAt: '2026-10-22T09:00:00.000Z',
      },
    });

    await userEvent.setup().type(screen.getByLabelText(/your answer/i), 'x');

    expect(screen.queryByText(/correct/i)).not.toBeInTheDocument();
  });

  it('finds a gap of any number of underscores', () => {
    renderExercise({ ...fillInTheBlank, prompt: 'Io ____ italiano.' });

    expect(screen.queryByText(/_/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/fill in the blank/i)).toBeInTheDocument();
  });

  it('shows the latest result and answer when the lesson is reopened', () => {
    renderExercise({
      ...shortAnswer,
      latestAttempt: {
        exerciseId: 'exercise-1',
        answer: 'Buongiorno',
        evaluation: 'CORRECT',
        accentCorrection: null,
        feedback: null,
        createdAt: '2026-10-22T09:00:00.000Z',
      },
    });

    expect(screen.getByLabelText(/your answer/i)).toHaveValue('Buongiorno');
    expect(screen.getByText(/correct/i)).toBeInTheDocument();
  });

  it('refreshes the lesson after a check, so its results stay current', () => {
    renderExercise(shortAnswer);

    const options = vi.mocked(trpc.exercise.submitAttempt.useMutation).mock
      .calls[0][0] as { onSuccess: () => void };
    options.onSuccess();

    expect(mockInvalidate).toHaveBeenCalledWith({ id: 'lesson-1' });
  });

  it("says when an answer couldn't be checked", () => {
    renderExercise(shortAnswer, {
      isError: true,
    } as unknown as Partial<SubmitMutation>);

    expect(screen.getByText(/couldn't check/i)).toBeInTheDocument();
  });

  describe('revealing answers', () => {
    const attempted: Exercise = {
      ...shortAnswer,
      latestAttempt: {
        exerciseId: 'exercise-1',
        answer: 'Buonasera',
        evaluation: 'INCORRECT',
        accentCorrection: null,
        feedback: null,
        createdAt: '2026-10-22T09:00:00.000Z',
      },
    };

    it('offers no answers before the learner has tried the exercise', () => {
      renderExercise(shortAnswer);

      expect(
        screen.queryByRole('button', { name: /show answers/i }),
      ).not.toBeInTheDocument();
      expect(trpc.exercise.answers.useQuery).toHaveBeenCalledWith(
        { exerciseId: 'exercise-1' },
        { enabled: false },
      );
    });

    it('fetches the answers only when the learner asks', async () => {
      renderExercise(attempted);

      expect(trpc.exercise.answers.useQuery).toHaveBeenLastCalledWith(
        { exerciseId: 'exercise-1' },
        { enabled: false },
      );
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: /show answers/i }));

      expect(trpc.exercise.answers.useQuery).toHaveBeenLastCalledWith(
        { exerciseId: 'exercise-1' },
        { enabled: true },
      );
    });

    it('lists the accepted answers', () => {
      renderExercise(attempted, {}, {
        data: {
          expectedAnswers: ['Buongiorno', 'Buon giorno'],
          essentialPoints: [],
          supplementaryPoints: [],
          expectedPoints: [],
        },
      } as Partial<AnswersQuery>);

      expect(screen.getByText(/accepted answers/i)).toBeInTheDocument();
      expect(screen.getByText('Buongiorno')).toBeInTheDocument();
      expect(screen.getByText('Buon giorno')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /show answers/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('lists the points an older free-form explanation was written with', () => {
    renderExercise(
      {
        ...freeForm,
        latestAttempt: {
          exerciseId: 'exercise-3',
          answer: 'To say goodbye',
          evaluation: 'INCORRECT',
          accentCorrection: null,
          feedback: 'Think about when.',
          createdAt: '2026-10-22T09:00:00.000Z',
        },
      },
      {},
      {
        data: {
          expectedAnswers: [],
          essentialPoints: [],
          supplementaryPoints: [],
          expectedPoints: ['In the evening', 'As a greeting'],
        },
      } as Partial<AnswersQuery>,
    );

    expect(screen.getByText(/points a good answer makes/i)).toBeInTheDocument();
    expect(screen.getByText('In the evening')).toBeInTheDocument();
    expect(screen.getByText('As a greeting')).toBeInTheDocument();
  });

  it("separates a free-form explanation's essential points from the optional ones", () => {
    renderExercise(
      {
        ...freeForm,
        latestAttempt: {
          exerciseId: 'exercise-3',
          answer: 'To say goodbye',
          evaluation: 'INCORRECT',
          accentCorrection: null,
          feedback: 'Think about when.',
          createdAt: '2026-10-22T09:00:00.000Z',
        },
      },
      {},
      {
        data: {
          expectedAnswers: [],
          essentialPoints: ['Buonasera greets someone in the evening'],
          supplementaryPoints: ['Buonanotte is for parting at night'],
          expectedPoints: [],
        },
      } as Partial<AnswersQuery>,
    );

    const covers = screen.getByRole('list', {
      name: /a correct answer covers/i,
    });
    expect(covers).toHaveTextContent('Buonasera greets someone in the evening');
    const further = screen.getByRole('list', { name: /to go further/i });
    expect(further).toHaveTextContent('Buonanotte is for parting at night');
    expect(
      screen.queryByText(/points a good answer makes/i),
    ).not.toBeInTheDocument();
  });

  it("says when the answers couldn't be loaded", () => {
    renderExercise(
      {
        ...shortAnswer,
        latestAttempt: {
          exerciseId: 'exercise-1',
          answer: 'Buonasera',
          evaluation: 'INCORRECT',
          accentCorrection: null,
          feedback: null,
          createdAt: '2026-10-22T09:00:00.000Z',
        },
      },
      {},
      { isError: true } as Partial<AnswersQuery>,
    );

    expect(screen.getByText(/couldn't load the answers/i)).toBeInTheDocument();
  });

  it('submits a free-form explanation', async () => {
    renderExercise(freeForm);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/your explanation/i),
      'In the evening',
    );
    await user.click(screen.getByRole('button', { name: /check/i }));

    expect(
      screen.getByText('When would you say buonasera?'),
    ).toBeInTheDocument();
    expect(mockSubmit).toHaveBeenCalledWith({
      exerciseId: 'exercise-3',
      answer: 'In the evening',
    });
  });

  it("shows the AI's feedback with the result", async () => {
    renderExercise(freeForm, {
      data: {
        exerciseId: 'exercise-3',
        answer: 'To say goodbye',
        evaluation: 'INCORRECT',
        accentCorrection: null,
        feedback: 'Buonasera is a greeting. Think about when you use it.',
        createdAt: '2026-10-23T09:00:00.000Z',
      },
    } as unknown as Partial<SubmitMutation>);

    await userEvent
      .setup()
      .type(screen.getByLabelText(/your explanation/i), 'To say goodbye');

    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
    expect(
      screen.getByText('Buonasera is a greeting. Think about when you use it.'),
    ).toBeInTheDocument();
  });

  it('shows a partially correct explanation as partly right, with the feedback', async () => {
    renderExercise(freeForm, {
      data: {
        exerciseId: 'exercise-3',
        answer: 'In the evening',
        evaluation: 'PARTIALLY_CORRECT',
        accentCorrection: null,
        feedback: 'Right about buonasera. What about buonanotte?',
        createdAt: '2026-10-23T09:00:00.000Z',
      },
    } as unknown as Partial<SubmitMutation>);

    await userEvent
      .setup()
      .type(screen.getByLabelText(/your explanation/i), 'In the evening');

    expect(screen.getByText(/partly right/i)).toBeInTheDocument();
    expect(screen.queryByText(/^correct!/i)).not.toBeInTheDocument();
    expect(
      screen.getByText('Right about buonasera. What about buonanotte?'),
    ).toBeInTheDocument();
  });

  it.each([
    [
      'FORBIDDEN',
      "Checking this answer needs AI, and your account doesn't have access to AI features.",
    ],
    ['TOO_MANY_REQUESTS', 'AI features are paused until next month.'],
    ['BAD_GATEWAY', "The AI didn't produce a usable answer. Please try again."],
  ])(
    'says why an answer that needs AI could not be checked (%s)',
    (code, message) => {
      renderExercise(freeForm, {
        isError: true,
        error: { message, data: { code } },
      } as unknown as Partial<SubmitMutation>);

      expect(screen.getByText(message)).toBeInTheDocument();
    },
  );
});
