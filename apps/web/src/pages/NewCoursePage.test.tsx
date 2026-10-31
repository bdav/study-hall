import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import NewCoursePage from './NewCoursePage';
import { trpc } from '@/lib/trpc';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      course: { list: { invalidate: vi.fn() } },
    })),
    auth: { me: { useQuery: vi.fn() } },
    course: {
      create: { useMutation: vi.fn() },
      interviewRound: { useMutation: vi.fn() },
    },
  },
}));

type CreateMutation = ReturnType<typeof trpc.course.create.useMutation>;
type RoundMutation = ReturnType<typeof trpc.course.interviewRound.useMutation>;

const mockMutate = vi.fn();
const mockRound = vi.fn();

function renderPage({
  canUseAI = true,
  mutation = {},
  round = {},
}: {
  canUseAI?: boolean;
  mutation?: Partial<CreateMutation>;
  round?: Partial<RoundMutation>;
} = {}) {
  vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
    data: { user: { id: 'user-1', email: 'me@example.com', canUseAI } },
  } as ReturnType<typeof trpc.auth.me.useQuery>);
  vi.mocked(trpc.course.create.useMutation).mockReturnValue({
    mutate: mockMutate,
    isPending: false,
    error: null,
    ...mutation,
  } as unknown as CreateMutation);
  vi.mocked(trpc.course.interviewRound.useMutation).mockReturnValue({
    mutate: mockRound,
    isPending: false,
    error: null,
    ...round,
  } as unknown as RoundMutation);

  return render(
    <MemoryRouter>
      <NewCoursePage />
    </MemoryRouter>,
  );
}

/** Renders the page and skips the interview, to the form, empty. */
function renderForm(options: Parameters<typeof renderPage>[0] = {}) {
  const view = renderPage(options);
  fireEvent.click(screen.getByRole('button', { name: /skip/i }));
  return view;
}

async function fillForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Topic'), 'Italian');
  await user.type(screen.getByLabelText('Goal or target level'), 'A2');
  await user.type(screen.getByLabelText('Prior knowledge'), 'Some Duolingo');
  await user.click(screen.getByRole('radio', { name: '3h' }));
  await user.click(screen.getByRole('radio', { name: '30 min' }));
  await user.click(
    within(screen.getByRole('group', { name: 'Preferred depth' })).getByRole(
      'radio',
      { name: 'In depth' },
    ),
  );
  await user.type(screen.getByLabelText('Notes'), 'Trip to Rome');
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NewCoursePage', () => {
  it('submits the course form to generate a Syllabus Proposal', async () => {
    renderForm();

    const user = await fillForm();
    await user.click(
      screen.getByRole('button', { name: /generate syllabus/i }),
    );

    expect(mockMutate).toHaveBeenCalledWith({
      topic: 'Italian',
      goal: 'A2',
      priorKnowledge: 'Some Duolingo',
      minutesPerWeek: 180,
      sessionMinutes: 30,
      deadline: null,
      depth: 'In depth',
      notes: 'Trip to Rome',
      title: '',
      focus: '',
      skip: '',
      materials: '',
      canAlreadyDo: [],
    });
  });

  it('takes a title, what to focus on and skip, and materials', async () => {
    renderForm();

    const user = await fillForm();
    await user.type(
      screen.getByLabelText('Course title'),
      'Italian for a trip to Rome',
    );
    await user.type(screen.getByLabelText('Focus on'), 'Speaking');
    await user.type(screen.getByLabelText('Skip'), 'Formal letters');
    await user.type(screen.getByLabelText('Materials'), 'Nuovo Espresso 1');
    await user.click(
      screen.getByRole('button', { name: /generate syllabus/i }),
    );

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Italian for a trip to Rome',
        focus: 'Speaking',
        skip: 'Formal letters',
        materials: 'Nuovo Espresso 1',
      }),
    );
  });

  it('suggests the topic as the title, which a blank title falls back to', async () => {
    renderForm();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Topic'), 'Italian');

    expect(screen.getByLabelText('Course title')).toHaveAttribute(
      'placeholder',
      'Italian',
    );
  });

  it('lists what the learner can already do as chips they can add and remove', async () => {
    renderForm();
    const user = await fillForm();
    const newItem = screen.getByLabelText('Something you can already do');

    await user.type(newItem, 'Order a coffee');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    // Enter adds it, rather than submitting the form
    await user.type(newItem, 'Count to ten{Enter}');
    expect(mockMutate).not.toHaveBeenCalled();
    const list = screen.getByRole('list', { name: 'Can already do' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Order a coffee', 'Count to ten']);
    await user.click(
      within(list).getByRole('button', { name: 'Remove Order a coffee' }),
    );
    await user.click(
      screen.getByRole('button', { name: /generate syllabus/i }),
    );

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ canAlreadyDo: ['Count to ten'] }),
    );
  });

  it('adds what was typed but not added when the syllabus is generated', async () => {
    renderForm();
    const user = await fillForm();

    await user.type(
      screen.getByLabelText('Something you can already do'),
      'Say hello',
    );
    await user.click(
      screen.getByRole('button', { name: /generate syllabus/i }),
    );

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ canAlreadyDo: ['Say hello'] }),
    );
  });

  it('takes an optional deadline date', async () => {
    renderForm();

    const user = await fillForm();
    fireEvent.change(screen.getByLabelText(/deadline/i), {
      target: { value: '2027-06-01' },
    });
    await user.click(
      screen.getByRole('button', { name: /generate syllabus/i }),
    );

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ deadline: '2027-06-01' }),
    );
  });

  it('offers time per week and session length as chips', () => {
    renderForm();

    const chips = {
      'Time per week': ['1h', '2h', '3h', '5h', '7h+', 'Custom'],
      'Session length': ['15 min', '30 min', '45 min', '60 min', '90 min'],
    };
    for (const [group, names] of Object.entries(chips)) {
      const choice = screen.getByRole('group', { name: group });
      expect(within(choice).getAllByRole('radio')).toHaveLength(names.length);
      for (const name of names) {
        // Neither is chosen for the learner
        expect(within(choice).getByRole('radio', { name })).not.toBeChecked();
      }
    }
  });

  it('offers preferred depth as chips, Balanced to start', () => {
    renderForm();

    const depth = screen.getByRole('group', { name: 'Preferred depth' });
    expect(within(depth).getAllByRole('radio')).toHaveLength(3);
    expect(
      within(depth).getByRole('radio', { name: 'Balanced' }),
    ).toBeChecked();
  });

  it('takes a custom time per week in hours', async () => {
    renderForm();

    const user = await fillForm();
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    await user.type(screen.getByLabelText('Hours per week'), '2.5');
    await user.click(
      screen.getByRole('button', { name: /generate syllabus/i }),
    );

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ minutesPerWeek: 150, sessionMinutes: 30 }),
    );
  });

  it('takes 7h+ as seven hours a week', async () => {
    renderForm();

    const user = await fillForm();
    await user.click(screen.getByRole('radio', { name: '7h+' }));
    await user.click(
      screen.getByRole('button', { name: /generate syllabus/i }),
    );

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ minutesPerWeek: 420 }),
    );
  });

  it('requires a topic, goal, time per week and session length', async () => {
    renderForm();
    const user = userEvent.setup();
    const generate = screen.getByRole('button', { name: /generate syllabus/i });

    await user.click(generate);
    await user.type(screen.getByLabelText('Topic'), 'Italian');
    await user.type(screen.getByLabelText('Goal or target level'), 'A2');
    await user.click(generate);
    await user.click(screen.getByRole('radio', { name: '3h' }));
    await user.click(generate);
    await user.click(screen.getByRole('radio', { name: 'Custom' }));
    await user.click(screen.getByRole('radio', { name: '30 min' }));
    // Custom needs its amount
    await user.click(generate);

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('shows a loader in place of the form while the syllabus is written', () => {
    renderPage({ mutation: { isPending: true } });

    expect(
      screen.getByRole('status', { name: 'Writing your syllabus' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /generate syllabus/i }),
    ).not.toBeInTheDocument();
  });

  it('opens the new course once its proposal is ready', () => {
    renderPage();

    const options = vi.mocked(trpc.course.create.useMutation).mock
      .calls[0][0] as { onSuccess: (data: { id: string }) => void };
    options.onSuccess({ id: 'course-1' });

    expect(mockNavigate).toHaveBeenCalledWith('/courses/course-1');
  });

  it('shows a failed generation so the learner can try again', () => {
    renderForm({
      mutation: {
        error: {
          message: "The AI didn't produce a usable answer. Please try again.",
        } as CreateMutation['error'],
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/please try again/i);
    expect(
      screen.getByRole('button', { name: /generate syllabus/i }),
    ).toBeEnabled();
  });

  it('says AI features are paused, not broken, once the monthly cap is reached', () => {
    renderPage({
      mutation: {
        error: {
          message:
            "AI features are paused until next month because this month's AI spending cap has been reached.",
          data: { code: 'TOO_MANY_REQUESTS' },
        } as CreateMutation['error'],
      },
    });

    expect(
      screen.getByRole('heading', { name: /AI features are paused/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/until next month/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /flashcards/i })).toHaveAttribute(
      'href',
      '/flashcards',
    );
  });

  it('tells a learner without AI access that courses need it', () => {
    renderPage({ canUseAI: false });

    expect(screen.getByText(/access to AI features/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Topic')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /flashcards/i })).toHaveAttribute(
      'href',
      '/flashcards',
    );
  });
});

describe('the Setup Interview', () => {
  const opening = 'Italian, for a trip to Rome in June';

  const draft = {
    title: 'Italian for a trip to Rome',
    topic: 'Italian',
    goal: 'Get by in Rome',
    priorKnowledge: 'A little Duolingo',
    canAlreadyDo: ['Order a coffee'],
    minutesPerWeek: 120,
    sessionMinutes: 30 as const,
    deadline: '2027-06-01',
    depth: 'Balanced' as const,
    focus: 'Speaking',
    skip: '',
    materials: '',
    notes: '',
  };

  const firstQuestions = [
    {
      type: 'SINGLE_CHOICE' as const,
      prompt: 'How much time a week can you give it?',
      options: ['1 hour', '2 hours', '3 hours'],
      suggested: '2 hours',
    },
    {
      type: 'FREE_TEXT' as const,
      prompt: 'What Italian do you know already?',
      suggested: 'None',
    },
  ];

  const secondQuestions = [
    {
      type: 'SINGLE_CHOICE' as const,
      prompt: 'How long is a sitting?',
      options: ['15 minutes', '30 minutes'],
      suggested: '30 minutes',
    },
    {
      type: 'FREE_TEXT' as const,
      prompt: 'Anything to leave out?',
      suggested: 'Grammar drills',
    },
  ];

  type Round = {
    draft: typeof draft;
    ready: boolean;
    questions: typeof firstQuestions;
  };

  /** Answers the round call in flight, as the API would. */
  function respond(round: Round) {
    const [, options] = mockRound.mock.lastCall as [
      unknown,
      {
        onSuccess: (
          data: Round & { model: string; promptVersion: string },
        ) => void;
      },
    ];
    act(() =>
      options.onSuccess({
        ...round,
        model: 'claude-sonnet-5-5',
        promptVersion: 'course-interview-v1',
      }),
    );
  }

  /** Starts the interview with the opening words, answered by a first round. */
  async function startInterview() {
    renderPage();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText('What do you want to learn, and why?'),
      opening,
    );
    await user.click(screen.getByRole('button', { name: 'Start' }));
    respond({ draft, ready: false, questions: firstQuestions });
    return user;
  }

  it('links back to Courses, from the opening box and from the form', async () => {
    renderPage();
    const user = userEvent.setup();

    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute(
      'href',
      '/courses',
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute(
      'href',
      '/courses',
    );
  });

  it('opens with one box asking what the learner wants to learn, and why', () => {
    renderPage();

    expect(
      screen.getByLabelText('What do you want to learn, and why?'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Topic')).not.toBeInTheDocument();
  });

  it('starts the interview from the opening words', async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText('What do you want to learn, and why?'),
      opening,
    );
    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(mockRound).toHaveBeenCalledWith(
      { opening, rounds: [] },
      expect.anything(),
    );
  });

  it('shows a round with its suggested answers already chosen', async () => {
    await startInterview();

    const time = screen.getByRole('group', {
      name: 'How much time a week can you give it?',
    });
    expect(within(time).getByRole('radio', { name: '2 hours' })).toBeChecked();
    expect(
      screen.getByLabelText('What Italian do you know already?'),
    ).toHaveValue('None');
  });

  it('sends the round with Next, with the answers as the learner left them', async () => {
    const user = await startInterview();

    await user.click(screen.getByRole('radio', { name: '3 hours' }));
    const known = screen.getByLabelText('What Italian do you know already?');
    await user.clear(known);
    await user.type(known, 'A little');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(mockRound).toHaveBeenLastCalledWith(
      {
        opening,
        rounds: [
          { questions: firstQuestions, answers: ['3 hours', 'A little'] },
        ],
      },
      expect.anything(),
    );
  });

  it('collapses earlier rounds to a line of their answers', async () => {
    const user = await startInterview();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    respond({ draft, ready: false, questions: secondQuestions });

    expect(screen.getByText('2 hours · None')).toBeInTheDocument();
    expect(
      screen.queryByRole('group', {
        name: 'How much time a week can you give it?',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'How long is a sitting?' }),
    ).toBeInTheDocument();
  });

  it('shows the drafted Course Setup once nothing is left to ask', async () => {
    const user = await startInterview();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    respond({ draft, ready: true, questions: [] });

    expect(screen.getByLabelText('Topic')).toHaveValue('Italian');
    expect(screen.getByLabelText('Course title')).toHaveValue(
      'Italian for a trip to Rome',
    );
    expect(screen.getByRole('radio', { name: '2h' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '30 min' })).toBeChecked();
    expect(screen.getByLabelText(/deadline/i)).toHaveValue('2027-06-01');
    expect(
      within(screen.getByRole('list', { name: 'Can already do' })).getByText(
        'Order a coffee',
      ),
    ).toBeInTheDocument();
  });

  it('shows the draft after three rounds, whatever comes back', async () => {
    const user = await startInterview();

    for (const questions of [secondQuestions, firstQuestions]) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
      respond({ draft, ready: false, questions });
    }
    await user.click(screen.getByRole('button', { name: 'Next' }));
    respond({ draft, ready: false, questions: secondQuestions });

    expect(screen.getByLabelText('Topic')).toHaveValue('Italian');
  });

  it('asks for a date with the date picker, which can be left blank', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText('What do you want to learn, and why?'),
      opening,
    );
    await user.click(screen.getByRole('button', { name: 'Start' }));
    const dateQuestion = {
      type: 'DATE' as const,
      prompt: 'Is there a date you need to be ready by?',
      suggested: '2027-06-01',
    };
    respond({
      draft,
      ready: false,
      questions: [dateQuestion, firstQuestions[1]] as typeof firstQuestions,
    });

    const date = screen.getByLabelText(
      'Is there a date you need to be ready by?',
    );
    expect(date).toHaveAttribute('type', 'date');
    expect(date).toHaveValue('2027-06-01');
    fireEvent.change(date, { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(mockRound).toHaveBeenLastCalledWith(
      {
        opening,
        rounds: [
          {
            questions: [dateQuestion, firstQuestions[1]],
            answers: ['', 'None'],
          },
        ],
      },
      expect.anything(),
    );
  });

  it('offers no way out of a round but answering it', async () => {
    await startInterview();

    expect(
      screen.queryByRole('button', { name: /brief|finish|skip/i }),
    ).not.toBeInTheDocument();
  });

  it('skips the interview to the form, empty', async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /skip/i }));

    expect(screen.getByLabelText('Topic')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: /generate syllabus/i }),
    ).toBeInTheDocument();
  });

  it('creates the course from the draft as checked, with the interview, on Looks right', async () => {
    const user = await startInterview();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    respond({ draft, ready: true, questions: [] });
    await user.click(screen.getByRole('button', { name: 'Looks right' }));

    expect(mockMutate).toHaveBeenCalledWith({
      title: 'Italian for a trip to Rome',
      topic: 'Italian',
      goal: 'Get by in Rome',
      priorKnowledge: 'A little Duolingo',
      canAlreadyDo: ['Order a coffee'],
      minutesPerWeek: 120,
      sessionMinutes: 30,
      deadline: '2027-06-01',
      depth: 'Balanced',
      focus: 'Speaking',
      skip: '',
      materials: '',
      notes: '',
      interview: {
        opening,
        rounds: [{ questions: firstQuestions, answers: ['2 hours', 'None'] }],
        model: 'claude-sonnet-5-5',
        promptVersion: 'course-interview-v1',
      },
    });
  });

  it('keeps the answers on screen when a round fails', async () => {
    const { rerender } = renderPage();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText('What do you want to learn, and why?'),
      opening,
    );
    await user.click(screen.getByRole('button', { name: 'Start' }));
    respond({ draft, ready: false, questions: firstQuestions });
    const known = screen.getByLabelText('What Italian do you know already?');
    await user.clear(known);
    await user.type(known, 'A little');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    vi.mocked(trpc.course.interviewRound.useMutation).mockReturnValue({
      mutate: mockRound,
      isPending: false,
      error: { message: "The AI didn't answer. Please try again." },
    } as unknown as RoundMutation);
    rerender(
      <MemoryRouter>
        <NewCoursePage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/try again/i);
    expect(
      screen.getByLabelText('What Italian do you know already?'),
    ).toHaveValue('A little');
  });
});
