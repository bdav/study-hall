import { fireEvent, render, screen, within } from '@testing-library/react';
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
    course: { create: { useMutation: vi.fn() } },
  },
}));

type CreateMutation = ReturnType<typeof trpc.course.create.useMutation>;

const mockMutate = vi.fn();

function renderPage({
  canUseAI = true,
  mutation = {},
}: { canUseAI?: boolean; mutation?: Partial<CreateMutation> } = {}) {
  vi.mocked(trpc.auth.me.useQuery).mockReturnValue({
    data: { user: { id: 'user-1', email: 'me@example.com', canUseAI } },
  } as ReturnType<typeof trpc.auth.me.useQuery>);
  vi.mocked(trpc.course.create.useMutation).mockReturnValue({
    mutate: mockMutate,
    isPending: false,
    error: null,
    ...mutation,
  } as unknown as CreateMutation);

  return render(
    <MemoryRouter>
      <NewCoursePage />
    </MemoryRouter>,
  );
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
    renderPage();

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
    renderPage();

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
    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Topic'), 'Italian');

    expect(screen.getByLabelText('Course title')).toHaveAttribute(
      'placeholder',
      'Italian',
    );
  });

  it('lists what the learner can already do as chips they can add and remove', async () => {
    renderPage();
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
    renderPage();
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
    renderPage();

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
    renderPage();

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
    renderPage();

    const depth = screen.getByRole('group', { name: 'Preferred depth' });
    expect(within(depth).getAllByRole('radio')).toHaveLength(3);
    expect(
      within(depth).getByRole('radio', { name: 'Balanced' }),
    ).toBeChecked();
  });

  it('takes a custom time per week in hours', async () => {
    renderPage();

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
    renderPage();

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
    renderPage();
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
    renderPage({
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
