import { render, screen } from '@testing-library/react';
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
  await user.type(screen.getByLabelText('Time per week'), '3 hours');
  await user.selectOptions(
    screen.getByLabelText('Preferred depth'),
    'In depth',
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
      timePerWeek: '3 hours',
      depth: 'In depth',
      notes: 'Trip to Rome',
    });
  });

  it('requires a topic, goal and time per week', async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: /generate syllabus/i }),
    );

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('shows a loading state while the syllabus is generated', () => {
    renderPage({ mutation: { isPending: true } });

    expect(screen.getByRole('status')).toHaveTextContent(
      /generating your syllabus/i,
    );
    expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled();
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
