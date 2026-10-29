import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { vi } from 'vitest';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import LessonPage from './LessonPage';
import { trpc } from '@/lib/trpc';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockSetData = vi.fn();
const mockCancel = vi.fn();
const mockInvalidate = vi.fn();
const mockInvalidateCards = vi.fn();
const mockInvalidateCourse = vi.fn();
const mockResetAnswers = vi.fn();
const mockInvalidateDecks = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      lesson: {
        getById: {
          setData: mockSetData,
          cancel: mockCancel,
          invalidate: mockInvalidate,
        },
      },
      course: { getById: { invalidate: mockInvalidateCourse } },
      exercise: { answers: { reset: mockResetAnswers } },
      card: { listByDeck: { invalidate: mockInvalidateCards } },
      deck: { list: { invalidate: mockInvalidateDecks } },
    })),
    auth: { me: { useQuery: vi.fn() } },
    lesson: {
      getById: { useQuery: vi.fn() },
      generate: { useMutation: vi.fn() },
      proposeReviewCards: { useMutation: vi.fn() },
      createReviewCards: { useMutation: vi.fn() },
      setCompleted: { useMutation: vi.fn() },
      startOver: { useMutation: vi.fn() },
    },
    exercise: {
      submitAttempt: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
      answers: { useQuery: vi.fn(() => ({ data: undefined })) },
    },
    tutor: {
      thread: {
        useQuery: vi.fn(() => ({
          data: {
            messages: [
              {
                id: 'message-1',
                role: 'LEARNER',
                content: 'What does ciao mean?',
                createdAt: '2026-10-28T09:00:00.000Z',
              },
            ],
          },
          isLoading: false,
        })),
      },
    },
  },
}));

type LessonQuery = ReturnType<typeof trpc.lesson.getById.useQuery>;
type GenerateMutation = ReturnType<typeof trpc.lesson.generate.useMutation>;
type ProposeMutation = ReturnType<
  typeof trpc.lesson.proposeReviewCards.useMutation
>;
type CreateMutation = ReturnType<
  typeof trpc.lesson.createReviewCards.useMutation
>;
type SetCompletedMutation = ReturnType<
  typeof trpc.lesson.setCompleted.useMutation
>;
type SetCompletedOptions = Parameters<
  typeof trpc.lesson.setCompleted.useMutation
>[0];
type StartOverMutation = ReturnType<typeof trpc.lesson.startOver.useMutation>;
type StartOverOptions = Parameters<typeof trpc.lesson.startOver.useMutation>[0];
type CreateOptions = Parameters<
  typeof trpc.lesson.createReviewCards.useMutation
>[0];

const lesson = {
  id: 'lesson-1',
  title: 'Greetings',
  objectives: ['Greet someone formally'],
  firstOpenedAt: null,
  course: { id: 'course-1', title: 'Italian' },
  completedAt: null,
  resetAt: null,
  generating: false,
  nextLesson: { id: 'lesson-2', title: 'At the café' },
  version: null,
};

const generatedLesson = {
  ...lesson,
  firstOpenedAt: '2026-10-23T09:00:00.000Z',
  version: {
    id: 'version-1',
    content: [
      {
        heading: 'Saying hello',
        paragraphs: [
          'Italian has a formal and an informal hello.',
          'Use buongiorno with strangers.',
        ],
      },
    ],
    examples: [{ example: 'Ciao, Marco!', explanation: 'An informal hello.' }],
    exercises: [
      {
        id: 'exercise-1',
        type: 'SHORT_ANSWER',
        prompt: 'Translate: Good morning',
        latestAttempt: null,
      },
      {
        id: 'exercise-2',
        type: 'FILL_IN_THE_BLANK',
        prompt: '___, Marco!',
        latestAttempt: null,
      },
      {
        id: 'exercise-3',
        type: 'FREE_FORM_EXPLANATION',
        prompt: 'When would you say buonasera?',
        latestAttempt: null,
      },
    ],
    hiddenExerciseCount: 0,
    missedExerciseCount: 0,
  },
};

/** A lesson with two sections, so there's a step between the first and Examples. */
const twoSectionLesson = {
  ...generatedLesson,
  version: {
    ...generatedLesson.version,
    content: [
      ...generatedLesson.version.content,
      {
        heading: 'Saying goodbye',
        paragraphs: ['Arrivederci works almost everywhere.'],
      },
    ],
  },
};

const practice = '/lessons/lesson-1?step=practice';

/** Practice shows every exercise on one page, rather than one at a time. */
function showAllExercises() {
  localStorage.setItem('study-hall:paging-view', 'all');
}
const wrapUp = '/lessons/lesson-1?step=wrap-up';

/** Shows the current URL's query, so tests can see the step in the URL. */
function LocationProbe() {
  const { search } = useLocation();
  return <output aria-label="Current search">{search}</output>;
}

const mockGenerate = vi.fn();
const mockPropose = vi.fn();
const mockResetProposal = vi.fn();
const mockCreate = vi.fn();
const mockSetCompleted = vi.fn();
const mockStartOver = vi.fn();

function renderPage({
  query = {},
  mutation = {},
  canUseAI = true,
  meLoading = false,
  strict = false,
  propose = {},
  create = {},
  setCompleted = {},
  startOver = {},
  path = '/lessons/lesson-1',
  extra,
}: {
  path?: string;
  /** More elements to render inside the router. */
  extra?: ReactNode;
  query?: Partial<LessonQuery>;
  mutation?: Partial<GenerateMutation>;
  canUseAI?: boolean;
  meLoading?: boolean;
  strict?: boolean;
  propose?: Partial<ProposeMutation>;
  create?: Partial<CreateMutation>;
  setCompleted?: Partial<SetCompletedMutation>;
  startOver?: Partial<StartOverMutation>;
} = {}) {
  vi.mocked(trpc.auth.me.useQuery).mockReturnValue(
    (meLoading
      ? { data: undefined, isLoading: true }
      : {
          data: { user: { id: 'user-1', email: 'me@example.com', canUseAI } },
          isLoading: false,
        }) as ReturnType<typeof trpc.auth.me.useQuery>,
  );
  vi.mocked(trpc.lesson.getById.useQuery).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    ...query,
  } as LessonQuery);
  vi.mocked(trpc.lesson.generate.useMutation).mockReturnValue({
    mutate: mockGenerate,
    isPending: false,
    isError: false,
    error: null,
    ...mutation,
  } as unknown as GenerateMutation);
  vi.mocked(trpc.lesson.proposeReviewCards.useMutation).mockReturnValue({
    mutate: mockPropose,
    reset: mockResetProposal,
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    ...propose,
  } as unknown as ProposeMutation);
  vi.mocked(trpc.lesson.createReviewCards.useMutation).mockReturnValue({
    mutate: mockCreate,
    isPending: false,
    ...create,
  } as unknown as CreateMutation);
  vi.mocked(trpc.lesson.setCompleted.useMutation).mockReturnValue({
    mutate: mockSetCompleted,
    isPending: false,
    ...setCompleted,
  } as unknown as SetCompletedMutation);
  vi.mocked(trpc.lesson.startOver.useMutation).mockReturnValue({
    mutate: mockStartOver,
    isPending: false,
    ...startOver,
  } as unknown as StartOverMutation);

  const page = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/lessons/:lessonId"
          element={
            <>
              <LessonPage />
              <LocationProbe />
              {extra}
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('LessonPage', () => {
  describe('lesson steps', () => {
    const written = { data: twoSectionLesson } as Partial<LessonQuery>;
    const currentStep = () =>
      screen.getByRole('heading', { level: 2 }).textContent;

    it('opens on the first section, alone', () => {
      renderPage({ query: written });

      expect(
        screen.getByRole('heading', { level: 2, name: 'Saying hello' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 2, name: 'Saying goodbye' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Ciao, Marco!')).not.toBeInTheDocument();
    });

    it('moves through the sections, then Examples, Practice and Wrap up with Next', async () => {
      // One at a time, Next would walk Practice's exercises first
      showAllExercises();
      const user = userEvent.setup();
      renderPage({ query: written });

      expect(currentStep()).toBe('Saying hello');
      await user.click(screen.getByRole('button', { name: /^next:/i }));
      expect(currentStep()).toBe('Saying goodbye');
      await user.click(screen.getByRole('button', { name: /^next:/i }));
      expect(currentStep()).toBe('Examples');
      expect(screen.getByText('Ciao, Marco!')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^next:/i }));
      expect(currentStep()).toBe('Practice');
      await user.click(screen.getByRole('button', { name: /^next:/i }));
      expect(currentStep()).toBe('Wrap up');
      expect(
        screen.queryByRole('button', { name: /^next:/i }),
      ).not.toBeInTheDocument();
    });

    it('has no Examples step when the lesson has no examples', async () => {
      const user = userEvent.setup();
      renderPage({
        query: {
          data: {
            ...generatedLesson,
            version: { ...generatedLesson.version, examples: [] },
          },
        } as Partial<LessonQuery>,
      });

      await user.click(screen.getByRole('button', { name: /^next:/i }));

      expect(currentStep()).toBe('Practice');
    });

    it('moves back with Previous, which the first step has none of', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });
      expect(
        screen.queryByRole('button', { name: /^previous:/i }),
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^next:/i }));
      await user.click(screen.getByRole('button', { name: /^previous:/i }));

      expect(
        screen.getByRole('heading', { level: 2, name: 'Saying hello' }),
      ).toBeInTheDocument();
    });

    it('leaves focus on Next when it is clicked, so Enter keeps moving on', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });

      await user.click(screen.getByRole('button', { name: /^next:/i }));
      expect(
        screen.getByRole('button', { name: 'Next: Examples' }),
      ).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(currentStep()).toBe('Examples');
    });

    it('labels a button to a step on two lines: its direction, then the title', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });
      await user.click(screen.getByRole('button', { name: /^next:/i }));

      const previous = screen.getByRole('button', {
        name: 'Previous: Saying hello',
      });
      expect(within(previous).getByText('Previous')).toBeInTheDocument();
      expect(within(previous).getByText('Saying hello')).toBeInTheDocument();
      const next = screen.getByRole('button', { name: 'Next: Examples' });
      expect(within(next).getByText('Next')).toBeInTheDocument();
      expect(within(next).getByText('Examples')).toBeInTheDocument();
    });

    it('names the step Next and Previous go to', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });

      expect(
        screen.getByRole('button', { name: 'Next: Saying goodbye' }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^next:/i }));
      expect(
        screen.getByRole('button', { name: 'Previous: Saying hello' }),
      ).toBeInTheDocument();
    });

    describe('with the arrow keys', () => {
      it('moves to the next step with → and back with ←', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        await user.keyboard('{ArrowRight}');
        expect(currentStep()).toBe('Saying goodbye');
        await user.keyboard('{ArrowRight}');
        expect(currentStep()).toBe('Examples');
        await user.keyboard('{ArrowLeft}');
        expect(currentStep()).toBe('Saying goodbye');
      });

      it("moves focus to the new step's heading", async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        await user.keyboard('{ArrowRight}');
        expect(
          screen.getByRole('heading', { level: 2, name: 'Saying goodbye' }),
        ).toHaveFocus();
      });

      it('stays put past the first and last steps', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        await user.keyboard('{ArrowLeft}');
        expect(currentStep()).toBe('Saying hello');
        expect(screen.getByLabelText('Current search')).toHaveTextContent('');
      });

      it('never changes step while the learner types an answer', async () => {
        showAllExercises();
        const user = userEvent.setup();
        renderPage({ query: written, path: practice });

        await user.click(screen.getAllByLabelText('Your answer')[0]);
        await user.keyboard('Ciao{ArrowLeft}{ArrowRight}');
        expect(currentStep()).toBe('Practice');

        // An explanation is answered in a multi-line field
        await user.click(screen.getByLabelText('Your explanation'));
        await user.keyboard('{ArrowLeft}');
        expect(currentStep()).toBe('Practice');
      });

      it('leaves the keys to the browser when a modifier is held', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        // Alt+← is the browser's Back
        await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
        await user.keyboard('{Meta>}{ArrowRight}{/Meta}');
        expect(currentStep()).toBe('Saying hello');
      });
    });

    describe('the outline', () => {
      const outline = () =>
        screen.getByRole('navigation', { name: 'Lesson outline' });

      it('lists the steps and marks the current one', () => {
        renderPage({
          query: written,
          path: '/lessons/lesson-1?step=section-2',
        });

        const items = within(outline()).getAllByRole('link');
        expect(items.map((item) => item.textContent)).toEqual([
          'Saying hello',
          'Saying goodbye',
          'Examples',
          expect.stringMatching(/^Practice/),
          'Wrap up',
        ]);
        expect(
          within(outline()).getByRole('link', { name: 'Saying goodbye' }),
        ).toHaveAttribute('aria-current', 'step');
        expect(
          within(outline()).getByRole('link', { name: 'Saying hello' }),
        ).not.toHaveAttribute('aria-current');
      });

      it('shows how many exercises have been answered', () => {
        const answeredOne = {
          ...twoSectionLesson,
          version: {
            ...twoSectionLesson.version,
            exercises: twoSectionLesson.version.exercises.map(
              (exercise, index) =>
                index === 1
                  ? {
                      ...exercise,
                      latestAttempt: {
                        exerciseId: exercise.id,
                        answer: 'Ciao',
                        evaluation: 'CORRECT',
                        accentCorrection: null,
                        feedback: null,
                        createdAt: '2026-10-24T09:00:00.000Z',
                      },
                    }
                  : exercise,
            ),
          },
        };
        renderPage({ query: { data: answeredOne } as Partial<LessonQuery> });

        expect(
          within(outline()).getByRole('link', { name: /practice/i }),
        ).toHaveTextContent('1 of 3 answered');
      });

      it('jumps to a step when clicked', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        await user.click(
          within(outline()).getByRole('link', { name: /practice/i }),
        );

        expect(
          screen.getByRole('heading', { level: 2, name: 'Practice' }),
        ).toBeInTheDocument();
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=practice',
        );
      });

      it('is always shown on wide screens, with nothing to hide it', () => {
        renderPage({ query: written });

        expect(outline()).toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: /hide outline/i }),
        ).not.toBeInTheDocument();
      });

      it('opens in a drawer from the menu, which closes on choosing a step', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        await user.click(screen.getByRole('button', { name: 'Open outline' }));
        const drawer = screen.getByRole('dialog', { name: 'Lesson outline' });
        await user.click(
          within(drawer).getByRole('link', { name: 'Examples' }),
        );

        expect(
          screen.getByRole('heading', { level: 2, name: 'Examples' }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      it('leaves focus on Next after choosing the step already shown', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        await user.click(
          within(outline()).getByRole('link', { name: 'Saying hello' }),
        );
        await user.click(screen.getByRole('button', { name: /^next:/i }));

        expect(
          screen.getByRole('button', { name: 'Next: Examples' }),
        ).toHaveFocus();
      });

      it("moves focus to the chosen step's heading, so moving on leaves none behind", async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        await user.click(
          within(outline()).getByRole('link', { name: 'Saying goodbye' }),
        );
        expect(
          screen.getByRole('heading', { level: 2, name: 'Saying goodbye' }),
        ).toHaveFocus();

        await user.keyboard('{ArrowRight}');
        expect(
          screen.getByRole('heading', { level: 2, name: 'Examples' }),
        ).toHaveFocus();
      });

      it('moves focus to the heading of a step chosen from the drawer', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        await user.click(screen.getByRole('button', { name: 'Open outline' }));
        await user.click(
          within(
            screen.getByRole('dialog', { name: 'Lesson outline' }),
          ).getByRole('link', { name: 'Examples' }),
        );

        await waitFor(() =>
          expect(
            screen.getByRole('heading', { level: 2, name: 'Examples' }),
          ).toHaveFocus(),
        );
      });
    });

    describe('in the URL', () => {
      it('puts the current step in the URL', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });

        await user.click(screen.getByRole('button', { name: /^next:/i }));

        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=section-2',
        );
        await user.click(screen.getByRole('button', { name: /^next:/i }));
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=examples',
        );
      });

      it('opens the step the URL names, so a reload or link lands on it', () => {
        renderPage({ query: written, path: '/lessons/lesson-1?step=practice' });

        expect(
          screen.getByRole('heading', { level: 2, name: 'Practice' }),
        ).toBeInTheDocument();
      });

      it('opens the first step when the URL names a step the lesson lacks', () => {
        renderPage({
          query: written,
          path: '/lessons/lesson-1?step=section-9',
        });

        expect(
          screen.getByRole('heading', { level: 2, name: 'Saying hello' }),
        ).toBeInTheDocument();
      });

      it('goes back to the previous step with the browser', async () => {
        const user = userEvent.setup();
        function BrowserBack() {
          const navigate = useNavigate();
          return (
            <button type="button" onClick={() => navigate(-1)}>
              Browser back
            </button>
          );
        }
        renderPage({ query: written, extra: <BrowserBack /> });

        await user.click(screen.getByRole('button', { name: /^next:/i }));
        await user.click(screen.getByRole('button', { name: /^next:/i }));
        await user.click(screen.getByRole('button', { name: 'Browser back' }));

        expect(
          screen.getByRole('heading', { level: 2, name: 'Saying goodbye' }),
        ).toBeInTheDocument();
      });
    });
  });

  describe('a generated lesson', () => {
    it('loads the lesson from the route', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      expect(trpc.lesson.getById.useQuery).toHaveBeenCalledWith(
        { id: 'lesson-1' },
        expect.anything(),
      );
      expect(
        screen.getByRole('heading', { level: 1, name: 'Greetings' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /italian/i })).toHaveAttribute(
        'href',
        '/courses/course-1',
      );
    });

    it('renders a content section', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      expect(
        screen.getByRole('heading', { name: 'Saying hello' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Italian has a formal and an informal hello.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Use buongiorno with strangers.'),
      ).toBeInTheDocument();
    });

    it('renders the examples on their step', () => {
      renderPage({
        query: { data: generatedLesson } as Partial<LessonQuery>,
        path: '/lessons/lesson-1?step=examples',
      });

      expect(screen.getByText('Ciao, Marco!')).toBeInTheDocument();
      expect(screen.getByText('An informal hello.')).toBeInTheDocument();
    });

    it('lists the exercises in order with their type on Practice', () => {
      showAllExercises();
      renderPage({
        query: { data: generatedLesson } as Partial<LessonQuery>,
        path: practice,
      });

      const exercises = within(
        screen.getByRole('list', { name: /exercises/i }),
      ).getAllByRole('listitem');
      expect(exercises).toHaveLength(3);
      expect(exercises[0]).toHaveTextContent(
        /short answer.*translate: good morning/i,
      );
      expect(exercises[1]).toHaveTextContent(/fill in the blank.*, marco!/i);
      expect(exercises[2]).toHaveTextContent(
        /explain.*when would you say buonasera\?/i,
      );
    });

    it('says how many exercises are hidden because they need AI access', () => {
      renderPage({
        query: {
          data: {
            ...generatedLesson,
            version: {
              ...generatedLesson.version,
              exercises: generatedLesson.version.exercises.slice(0, 2),
              hiddenExerciseCount: 1,
            },
          },
        } as Partial<LessonQuery>,
        path: practice,
      });

      expect(screen.getByText(/1 more exercise needs AI/i)).toBeInTheDocument();
    });

    it('mentions no hidden exercises when none are hidden', () => {
      renderPage({
        query: { data: generatedLesson } as Partial<LessonQuery>,
        path: practice,
      });

      expect(screen.queryByText(/needs? AI/i)).not.toBeInTheDocument();
    });

    it('never generates a lesson that already has a version', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });

  describe('reading views', () => {
    const written = { data: twoSectionLesson } as Partial<LessonQuery>;
    const view = () => screen.getByRole('group', { name: 'Reading view' });
    const openFullLesson = (user: ReturnType<typeof userEvent.setup>) =>
      user.click(within(view()).getByRole('button', { name: 'Full lesson' }));

    it('offers By section and Full lesson on the reading steps, By section first', () => {
      renderPage({ query: written });

      expect(
        within(view()).getByRole('button', { name: 'By section' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        within(view()).getByRole('button', { name: 'Full lesson' }),
      ).toHaveAttribute('aria-pressed', 'false');
    });

    it('stays in the pinned header, so it never scrolls out of view', () => {
      renderPage({ query: written, path: '/lessons/lesson-1?step=section-2' });

      expect(
        within(screen.getByRole('banner')).getByRole('group', {
          name: 'Reading view',
        }),
      ).toBeInTheDocument();
    });

    it('is offered in the ⋯ menu too, for narrow screens', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });

      await user.click(screen.getByRole('button', { name: 'More actions' }));
      expect(
        screen.getByRole('menuitemradio', { name: 'By section' }),
      ).toBeChecked();
      await user.click(
        screen.getByRole('menuitemradio', { name: 'Full lesson' }),
      );

      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
    });

    it('leaves the ⋯ menu without it on Practice', async () => {
      const user = userEvent.setup();
      renderPage({ query: written, path: practice });

      await user.click(screen.getByRole('button', { name: 'More actions' }));

      expect(
        screen.queryByRole('menuitemradio', { name: 'By section' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('menuitem', { name: 'Start over' }),
      ).toBeInTheDocument();
    });

    it('leaves the Examples step to its own view in the header, offering the reading view in the ⋯ menu', async () => {
      const user = userEvent.setup();
      renderPage({ query: written, path: '/lessons/lesson-1?step=examples' });

      const banner = within(screen.getByRole('banner'));
      expect(
        banner.queryByRole('group', { name: 'Reading view' }),
      ).not.toBeInTheDocument();
      expect(
        banner.getByRole('group', { name: 'Examples view' }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'More actions' }));
      await user.click(
        screen.getByRole('menuitemradio', { name: 'Full lesson' }),
      );
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
    });

    it("isn't offered on Practice or Wrap up", () => {
      const { unmount } = renderPage({ query: written, path: practice });
      expect(
        screen.queryByRole('group', { name: 'Reading view' }),
      ).not.toBeInTheDocument();
      unmount();

      renderPage({ query: written, path: wrapUp });
      expect(
        screen.queryByRole('group', { name: 'Reading view' }),
      ).not.toBeInTheDocument();
    });

    it('shows every section and the Examples on one page in Full lesson', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });

      await openFullLesson(user);

      expect(
        screen
          .getAllByRole('heading', { level: 2 })
          .map((heading) => heading.textContent),
      ).toEqual(['Saying hello', 'Saying goodbye', 'Examples']);
      expect(
        screen.getByText('Arrivederci works almost everywhere.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Ciao, Marco!')).toBeInTheDocument();
      expect(
        within(view()).getByRole('button', { name: 'Full lesson' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps Practice and Wrap up as their own steps in Full lesson', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });
      await openFullLesson(user);

      expect(
        screen.queryByRole('button', { name: /^previous:/i }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next: Practice' }));

      expect(
        screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
      ).toEqual(['Practice']);
      await user.click(
        screen.getByRole('button', { name: 'Previous: Examples' }),
      );
      expect(screen.getByText('Ciao, Marco!')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Saying hello' }),
      ).toBeInTheDocument();
    });

    describe("keeping the learner's place", () => {
      /** The sections `scrollIntoView` was called on, by their headings. */
      function scrolledTo(scroll: { mock: { contexts: unknown[] } }) {
        return scroll.mock.contexts.map(
          (element) =>
            (element as Element).querySelector('h2')?.textContent ?? null,
        );
      }

      /** Places each section so its top is the given distance from the viewport's. */
      function placeSections(tops: Record<string, number>) {
        for (const [heading, top] of Object.entries(tops)) {
          const section = screen
            .getByRole('heading', { level: 2, name: heading })
            .closest('section')!;
          section.getBoundingClientRect = () => ({ top }) as DOMRect;
        }
      }

      it('opens Full lesson at the section the learner was reading', async () => {
        const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
        const user = userEvent.setup();
        renderPage({
          query: written,
          path: '/lessons/lesson-1?step=section-2',
        });

        await openFullLesson(user);

        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=section-2',
        );
        expect(scrolledTo(scroll)).toEqual(['Saying goodbye']);
      });

      it('follows the section being read as the learner scrolls Full lesson', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });
        await openFullLesson(user);

        placeSections({
          'Saying hello': -600,
          'Saying goodbye': 90,
          Examples: 500,
        });
        fireEvent.scroll(window);

        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=section-2',
        );
        expect(
          within(
            screen.getByRole('navigation', { name: 'Lesson outline' }),
          ).getByRole('link', { name: 'Saying goodbye' }),
        ).toHaveAttribute('aria-current', 'step');
      });

      it('opens By section at the section the learner scrolled to', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });
        await openFullLesson(user);
        placeSections({
          'Saying hello': -600,
          'Saying goodbye': 90,
          Examples: 500,
        });
        fireEvent.scroll(window);

        await user.click(
          within(view()).getByRole('button', { name: 'By section' }),
        );

        expect(
          screen
            .getAllByRole('heading', { level: 2 })
            .map((heading) => heading.textContent),
        ).toEqual(['Saying goodbye']);
      });

      it('keeps a section the page can only scroll to its end for', async () => {
        // A late section on a page too short to bring it up to the top
        const page = document.documentElement;
        vi.spyOn(page, 'scrollHeight', 'get').mockReturnValue(2000);
        vi.spyOn(window, 'scrollY', 'get').mockReturnValue(2000 - innerHeight);
        const user = userEvent.setup();
        renderPage({
          query: written,
          path: '/lessons/lesson-1?step=section-2',
        });
        await openFullLesson(user);
        placeSections({
          'Saying hello': -600,
          'Saying goodbye': 300,
          Examples: 600,
        });

        // The jump's own scroll
        fireEvent.scroll(window);
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=section-2',
        );

        // The learner's, at the end of the page
        fireEvent.scroll(window);
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=examples',
        );
      });

      it('never lets scrolling undo leaving Full lesson for Practice', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });
        await openFullLesson(user);
        placeSections({
          'Saying hello': -600,
          'Saying goodbye': 90,
          Examples: 500,
        });
        // A scroll that lands after the click, before the page has moved on
        const scrollAfterClick = () => fireEvent.scroll(window);
        document.addEventListener('click', scrollAfterClick);

        await user.click(
          screen.getByRole('button', { name: 'Next: Practice' }),
        );
        document.removeEventListener('click', scrollAfterClick);

        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=practice',
        );
      });

      it('scrolls to a section chosen in the outline', async () => {
        const user = userEvent.setup();
        renderPage({ query: written });
        await openFullLesson(user);
        const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');

        await user.click(
          within(
            screen.getByRole('navigation', { name: 'Lesson outline' }),
          ).getByRole('link', { name: 'Examples' }),
        );

        expect(scrolledTo(scroll)).toEqual(['Examples']);
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=examples',
        );
      });
    });

    describe('the remembered choice', () => {
      it('opens lessons in the view the learner chose last', async () => {
        const user = userEvent.setup();
        const { unmount } = renderPage({ query: written });
        await openFullLesson(user);
        unmount();

        renderPage({ query: written });

        expect(
          within(view()).getByRole('button', { name: 'Full lesson' }),
        ).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
      });

      it('still works when the browser has no storage to remember it in', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new DOMException('Storage is disabled', 'SecurityError');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('Storage is disabled', 'SecurityError');
        });
        const user = userEvent.setup();
        renderPage({ query: written });

        expect(
          within(view()).getByRole('button', { name: 'By section' }),
        ).toHaveAttribute('aria-pressed', 'true');
        await openFullLesson(user);
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
      });

      it("ignores a stored value it doesn't know", () => {
        localStorage.setItem('study-hall:lesson-reading-view', 'sideways');

        renderPage({ query: written });

        expect(
          within(view()).getByRole('button', { name: 'By section' }),
        ).toHaveAttribute('aria-pressed', 'true');
      });
    });

    it('moves past the whole page with → in Full lesson', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });
      await openFullLesson(user);

      await user.keyboard('{ArrowRight}');

      expect(
        screen.getByRole('heading', { level: 2, name: 'Practice' }),
      ).toBeInTheDocument();
    });
  });

  describe('Examples', () => {
    /** Three examples, after two sections, so there's a middle one. */
    const threeExamples = {
      ...twoSectionLesson,
      version: {
        ...twoSectionLesson.version,
        examples: [
          { example: 'Ciao, Marco!', explanation: 'An informal hello.' },
          { example: 'Buongiorno, signora.', explanation: 'A formal hello.' },
          {
            example: 'Buonasera a tutti.',
            explanation: 'Hello in the evening.',
          },
        ],
      },
    };
    const examplesAt = (path = '/lessons/lesson-1?step=examples') =>
      renderPage({
        query: { data: threeExamples } as Partial<LessonQuery>,
        path,
      });
    const footer = () =>
      within(screen.getByRole('navigation', { name: 'Lesson steps' }))
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'));
    const examplesView = () =>
      within(screen.getByRole('banner')).getByRole('group', {
        name: 'Examples view',
      });

    describe('one at a time', () => {
      it('is the default: one example, with a count', () => {
        examplesAt();

        expect(
          within(examplesView()).getByRole('button', { name: 'One at a time' }),
        ).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Example 1 of 3')).toBeInTheDocument();
        expect(screen.getByText('Ciao, Marco!')).toBeInTheDocument();
        expect(
          screen.queryByText('Buongiorno, signora.'),
        ).not.toBeInTheDocument();
      });

      it('shows the count as numbers only, read in full to screen readers', () => {
        examplesAt('/lessons/lesson-1?step=examples&example=2');

        expect(screen.getByText('2 / 3')).toHaveAttribute(
          'aria-hidden',
          'true',
        );
        expect(screen.getByText('Example 2 of 3')).toHaveClass('sr-only');
      });

      it('walks the examples with the footer, reaching the steps either side only past the ends', async () => {
        const user = userEvent.setup();
        examplesAt();

        expect(footer()).toEqual(['Previous: Saying goodbye', 'Next example']);
        await user.click(screen.getByRole('button', { name: 'Next example' }));
        expect(screen.getByText('Buongiorno, signora.')).toBeInTheDocument();
        expect(footer()).toEqual(['Previous example', 'Next example']);
        await user.click(screen.getByRole('button', { name: 'Next example' }));
        expect(footer()).toEqual(['Previous example', 'Next: Practice']);
        await user.click(
          screen.getByRole('button', { name: 'Previous example' }),
        );
        expect(screen.getByText('Example 2 of 3')).toBeInTheDocument();
      });

      it('walks the examples with the arrow keys, then on to the steps either side', async () => {
        const user = userEvent.setup();
        examplesAt();

        await user.keyboard('{ArrowRight}');
        expect(screen.getByText('Example 2 of 3')).toBeInTheDocument();
        expect(
          screen.getByRole('heading', { level: 2, name: 'Examples' }),
        ).toHaveFocus();
        await user.keyboard('{ArrowLeft}{ArrowLeft}');
        expect(
          screen.getByRole('heading', { level: 2, name: 'Saying goodbye' }),
        ).toBeInTheDocument();
      });

      it('keeps the example in the URL, so reloading, going back and links open it', async () => {
        const user = userEvent.setup();
        const { unmount } = examplesAt();
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=examples&example=1',
        );
        await user.click(screen.getByRole('button', { name: 'Next example' }));
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=examples&example=2',
        );
        unmount();

        examplesAt('/lessons/lesson-1?step=examples&example=3');
        expect(screen.getByText('Example 3 of 3')).toBeInTheDocument();
      });

      it('opens the first example for one the lesson lacks, and says so in the URL', () => {
        examplesAt('/lessons/lesson-1?step=examples&example=9');

        expect(screen.getByText('Example 1 of 3')).toBeInTheDocument();
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=examples&example=1',
        );
      });

      it('arrives back from Practice at the last example, walking backwards', async () => {
        const user = userEvent.setup();
        examplesAt('/lessons/lesson-1?step=practice');

        await user.keyboard('{ArrowLeft}');

        expect(screen.getByText('Example 3 of 3')).toBeInTheDocument();
        await user.keyboard('{ArrowLeft}');
        expect(screen.getByText('Example 2 of 3')).toBeInTheDocument();
      });
    });

    it('shows every example on one page in All examples, with no count', async () => {
      const user = userEvent.setup();
      examplesAt();

      await user.click(
        within(examplesView()).getByRole('button', { name: 'All examples' }),
      );

      expect(screen.getByText('Ciao, Marco!')).toBeInTheDocument();
      expect(screen.getByText('Buonasera a tutti.')).toBeInTheDocument();
      expect(screen.queryByText(/example \d of 3/i)).not.toBeInTheDocument();
      expect(footer()).toEqual(['Previous: Saying goodbye', 'Next: Practice']);
    });

    it('lists every example beside its explanation, all at once', async () => {
      const user = userEvent.setup();
      examplesAt();

      await user.click(
        within(examplesView()).getByRole('button', { name: 'All examples' }),
      );

      expect(
        screen.getAllByRole('term').map((term) => term.textContent),
      ).toEqual(['Ciao, Marco!', 'Buongiorno, signora.', 'Buonasera a tutti.']);
      expect(
        screen.getAllByRole('definition').map((d) => d.textContent),
      ).toEqual([
        'An informal hello.',
        'A formal hello.',
        'Hello in the evening.',
      ]);
    });

    it('shares its view with Practice, both ways', async () => {
      const user = userEvent.setup();
      examplesAt();
      await user.click(
        within(examplesView()).getByRole('button', { name: 'All examples' }),
      );
      await user.click(screen.getByRole('button', { name: 'Next: Practice' }));

      expect(
        within(
          within(screen.getByRole('banner')).getByRole('group', {
            name: 'Practice view',
          }),
        ).getByRole('button', { name: 'All exercises' }),
      ).toHaveAttribute('aria-pressed', 'true');

      await user.click(screen.getByRole('button', { name: 'One at a time' }));
      await user.click(
        screen.getByRole('button', { name: 'Previous: Examples' }),
      );
      expect(screen.getByText(/example \d of 3/i)).toBeInTheDocument();
    });

    it('shows every example in Full lesson, with no examples view to choose', async () => {
      const user = userEvent.setup();
      examplesAt();

      await user.click(screen.getByRole('button', { name: 'More actions' }));
      await user.click(
        screen.getByRole('menuitemradio', { name: 'Full lesson' }),
      );

      expect(screen.getByText('Buonasera a tutti.')).toBeInTheDocument();
      // On the full page, the header offers the reading view again
      expect(
        within(screen.getByRole('banner')).getByRole('group', {
          name: 'Reading view',
        }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/example \d of 3/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('group', { name: 'Examples view' }),
      ).not.toBeInTheDocument();
    });

    it('offers the examples view in the ⋯ menu too, for narrow screens', async () => {
      const user = userEvent.setup();
      examplesAt();

      await user.click(screen.getByRole('button', { name: 'More actions' }));
      await user.click(
        screen.getByRole('menuitemradio', { name: 'All examples' }),
      );

      expect(screen.getByText('Buonasera a tutti.')).toBeInTheDocument();
    });

    it('remembers the view chosen in either step, for next time', async () => {
      const user = userEvent.setup();
      const { unmount } = renderPage({
        query: { data: threeExamples } as Partial<LessonQuery>,
        path: practice,
      });
      await user.click(
        within(
          within(screen.getByRole('banner')).getByRole('group', {
            name: 'Practice view',
          }),
        ).getByRole('button', { name: 'All exercises' }),
      );
      unmount();

      examplesAt();

      expect(
        within(examplesView()).getByRole('button', { name: 'All examples' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Buonasera a tutti.')).toBeInTheDocument();
    });

    it('still works when the browser has no storage', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Storage is disabled', 'SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Storage is disabled', 'SecurityError');
      });
      const user = userEvent.setup();
      examplesAt();

      expect(screen.getByText('Example 1 of 3')).toBeInTheDocument();
      await user.click(
        within(examplesView()).getByRole('button', { name: 'All examples' }),
      );
      expect(screen.getByText('Buonasera a tutti.')).toBeInTheDocument();
    });
  });

  describe('Practice', () => {
    const answeredFirst = {
      ...generatedLesson,
      version: {
        ...generatedLesson.version,
        exercises: generatedLesson.version.exercises.map((exercise, index) =>
          index === 0
            ? {
                ...exercise,
                latestAttempt: {
                  exerciseId: exercise.id,
                  answer: 'Buonasera',
                  evaluation: 'INCORRECT',
                  accentCorrection: null,
                  feedback: null,
                  createdAt: '2026-10-24T09:00:00.000Z',
                },
              }
            : exercise,
        ),
      },
    };
    const practiceOf = (data: object = answeredFirst, path = practice) =>
      renderPage({ query: { data } as Partial<LessonQuery>, path });
    const shownExercises = () =>
      within(screen.getByRole('list', { name: 'Exercises' })).getAllByRole(
        'listitem',
      );
    const banner = () => screen.getByRole('banner');
    const practiceView = () =>
      within(banner()).getByRole('group', { name: 'Practice view' });
    const toggles = () => within(banner()).getByRole('group', { name: 'Show' });
    /** Whether the answers of the exercise were last asked for. */
    const answersRequested = (exerciseId: string) =>
      vi
        .mocked(trpc.exercise.answers.useQuery)
        .mock.calls.filter(
          ([input]) =>
            (input as { exerciseId: string }).exerciseId === exerciseId,
        )
        .at(-1)?.[1]?.enabled;

    describe('one at a time', () => {
      it('is the default: one exercise, with a count', () => {
        practiceOf();

        expect(
          within(practiceView()).getByRole('button', { name: 'One at a time' }),
        ).toHaveAttribute('aria-pressed', 'true');
        expect(shownExercises()).toHaveLength(1);
        expect(shownExercises()[0]).toHaveTextContent(/good morning/i);
        expect(screen.getByText('Exercise 1 of 3')).toBeInTheDocument();
      });

      it('numbers the exercise once, in its corner, as numbers only', () => {
        practiceOf();

        const exercise = within(shownExercises()[0]);
        expect(exercise.getByText('1 / 3')).toHaveAttribute(
          'aria-hidden',
          'true',
        );
        expect(exercise.getByText('Exercise 1 of 3')).toHaveClass('sr-only');
        expect(exercise.getByText('Short answer')).toBeInTheDocument();
        expect(exercise.queryByText(/^1\./)).not.toBeInTheDocument();
      });

      it('moves between exercises with the footer buttons, with each in the URL', async () => {
        const user = userEvent.setup();
        practiceOf();

        await user.click(screen.getByRole('button', { name: 'Next exercise' }));
        expect(screen.getByText('Exercise 2 of 3')).toBeInTheDocument();
        expect(shownExercises()[0]).toHaveTextContent(/fill in the blank/i);
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=practice&exercise=exercise-2',
        );

        await user.click(
          screen.getByRole('button', { name: 'Previous exercise' }),
        );
        expect(screen.getByText('Exercise 1 of 3')).toBeInTheDocument();
      });

      it('offers the steps either side only past the first and last exercises', async () => {
        const user = userEvent.setup();
        practiceOf();
        const buttons = () =>
          within(screen.getByRole('navigation', { name: 'Lesson steps' }))
            .getAllByRole('button')
            .map((button) => button.getAttribute('aria-label'));

        expect(buttons()).toEqual(['Previous: Examples', 'Next exercise']);
        await user.click(screen.getByRole('button', { name: 'Next exercise' }));
        expect(buttons()).toEqual(['Previous exercise', 'Next exercise']);
        await user.click(screen.getByRole('button', { name: 'Next exercise' }));
        expect(buttons()).toEqual(['Previous exercise', 'Next: Wrap up']);

        await user.click(screen.getByRole('button', { name: 'Next: Wrap up' }));
        expect(
          screen.getByRole('heading', { level: 2, name: 'Wrap up' }),
        ).toBeInTheDocument();
      });

      it('has no Previous and Next of its own above the exercise', () => {
        practiceOf();

        expect(
          screen.getAllByRole('button', { name: /exercise$/i }),
        ).toHaveLength(1);
      });

      it('puts the first exercise in the URL on arriving, so the exercise on screen is always named', () => {
        practiceOf();

        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=practice&exercise=exercise-1',
        );
      });

      it('opens the exercise the URL names, or the first for one it lacks', () => {
        const { unmount } = practiceOf(
          answeredFirst,
          '/lessons/lesson-1?step=practice&exercise=exercise-3',
        );
        expect(screen.getByText('Exercise 3 of 3')).toBeInTheDocument();
        unmount();

        practiceOf(
          answeredFirst,
          '/lessons/lesson-1?step=practice&exercise=exercise-9',
        );
        expect(screen.getByText('Exercise 1 of 3')).toBeInTheDocument();
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=practice&exercise=exercise-1',
        );
      });

      it('moves between exercises with the arrow keys, then on past them to the next or previous step', async () => {
        const user = userEvent.setup();
        practiceOf();

        await user.keyboard('{ArrowRight}');
        expect(screen.getByText('Exercise 2 of 3')).toBeInTheDocument();
        await user.keyboard('{ArrowRight}{ArrowRight}');
        expect(
          screen.getByRole('heading', { level: 2, name: 'Wrap up' }),
        ).toBeInTheDocument();
      });

      it('arrives back from Wrap up at the last exercise', async () => {
        const user = userEvent.setup();
        practiceOf(answeredFirst, wrapUp);

        await user.click(
          screen.getByRole('button', { name: 'Previous: Practice' }),
        );

        expect(screen.getByText('Exercise 3 of 3')).toBeInTheDocument();
      });

      it('goes back past the first exercise to the previous step with ←', async () => {
        const user = userEvent.setup();
        practiceOf();

        await user.keyboard('{ArrowLeft}');

        expect(
          screen.getByRole('heading', { level: 2, name: 'Examples' }),
        ).toBeInTheDocument();
      });
    });

    describe('all exercises', () => {
      it('shows every exercise on one page, with no count', async () => {
        const user = userEvent.setup();
        practiceOf();

        await user.click(
          within(practiceView()).getByRole('button', { name: 'All exercises' }),
        );

        expect(shownExercises()).toHaveLength(3);
        expect(screen.queryByText(/exercise \d of 3/i)).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Next exercise' }),
        ).not.toBeInTheDocument();
      });
    });

    it("isn't offered on the other steps", () => {
      renderPage({
        query: { data: answeredFirst } as Partial<LessonQuery>,
        path: wrapUp,
      });

      expect(
        screen.queryByRole('group', { name: 'Practice view' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('group', { name: 'Show' }),
      ).not.toBeInTheDocument();
    });

    describe('Show my answers', () => {
      it('is on by default, showing the latest answer', () => {
        practiceOf();

        expect(
          within(toggles()).getByRole('switch', { name: 'My answers' }),
        ).toBeChecked();
        expect(screen.getByLabelText('Your answer')).toHaveValue('Buonasera');
      });

      it('hides answers when off, so exercises can be retaken', async () => {
        const user = userEvent.setup();
        practiceOf();

        await user.click(
          within(toggles()).getByRole('switch', { name: 'My answers' }),
        );

        expect(screen.getByLabelText('Your answer')).toHaveValue('');
        expect(screen.queryByText(/not quite/i)).not.toBeInTheDocument();
      });
    });

    describe('Show answer key', () => {
      it('is off by default, requesting no answers', () => {
        practiceOf();

        expect(
          within(toggles()).getByRole('switch', { name: 'Answer key' }),
        ).not.toBeChecked();
        expect(answersRequested('exercise-1')).toBe(false);
      });

      it('requests the answers of attempted exercises only, in both views', async () => {
        const user = userEvent.setup();
        practiceOf();
        await user.click(
          within(toggles()).getByRole('switch', { name: 'Answer key' }),
        );
        expect(answersRequested('exercise-1')).toBe(true);

        await user.click(
          within(practiceView()).getByRole('button', { name: 'All exercises' }),
        );
        expect(answersRequested('exercise-1')).toBe(true);
        expect(answersRequested('exercise-2')).toBe(false);
        expect(answersRequested('exercise-3')).toBe(false);
        expect(
          screen.getAllByText(/answer this exercise to see its answers/i),
        ).toHaveLength(2);
      });
    });

    it('combines both toggles: blank answers with the answer key, a revision sheet to retake', async () => {
      const user = userEvent.setup();
      practiceOf();
      await user.click(
        within(toggles()).getByRole('switch', { name: 'My answers' }),
      );
      await user.click(
        within(toggles()).getByRole('switch', { name: 'Answer key' }),
      );

      expect(screen.getByLabelText('Your answer')).toHaveValue('');
      expect(answersRequested('exercise-1')).toBe(true);
    });

    it('applies both toggles in All exercises too', async () => {
      const user = userEvent.setup();
      practiceOf();
      await user.click(
        within(practiceView()).getByRole('button', { name: 'All exercises' }),
      );
      await user.click(
        within(toggles()).getByRole('switch', { name: 'My answers' }),
      );
      await user.click(
        within(toggles()).getByRole('switch', { name: 'Answer key' }),
      );

      expect(screen.getAllByLabelText('Your answer')[0]).toHaveValue('');
      expect(answersRequested('exercise-1')).toBe(true);
      expect(answersRequested('exercise-2')).toBe(false);
    });

    it('offers the view and both toggles in the ⋯ menu too, for narrow screens', async () => {
      const user = userEvent.setup();
      practiceOf();

      await user.click(screen.getByRole('button', { name: 'More actions' }));
      await user.click(
        screen.getByRole('menuitemcheckbox', { name: 'Show my answers' }),
      );
      expect(screen.getByLabelText('Your answer')).toHaveValue('');

      await user.click(screen.getByRole('button', { name: 'More actions' }));
      expect(
        screen.getByRole('menuitemcheckbox', { name: 'Show answer key' }),
      ).not.toBeChecked();
      await user.click(
        screen.getByRole('menuitemradio', { name: 'All exercises' }),
      );
      expect(shownExercises()).toHaveLength(3);
    });

    describe('remembered choices', () => {
      it('keeps the view and both toggles for next time', async () => {
        const user = userEvent.setup();
        const { unmount } = practiceOf();
        await user.click(
          within(practiceView()).getByRole('button', { name: 'All exercises' }),
        );
        await user.click(
          within(toggles()).getByRole('switch', { name: 'My answers' }),
        );
        await user.click(
          within(toggles()).getByRole('switch', { name: 'Answer key' }),
        );
        unmount();

        practiceOf();

        expect(shownExercises()).toHaveLength(3);
        expect(
          within(toggles()).getByRole('switch', { name: 'My answers' }),
        ).not.toBeChecked();
        expect(
          within(toggles()).getByRole('switch', { name: 'Answer key' }),
        ).toBeChecked();
      });

      it('still works when the browser has no storage', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new DOMException('Storage is disabled', 'SecurityError');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('Storage is disabled', 'SecurityError');
        });
        const user = userEvent.setup();
        practiceOf();

        expect(shownExercises()).toHaveLength(1);
        await user.click(
          within(toggles()).getByRole('switch', { name: 'My answers' }),
        );
        expect(screen.getByLabelText('Your answer')).toHaveValue('');
      });
    });
  });

  describe('Wrap up', () => {
    /** An attempt at an exercise, judged as given. */
    const attempt = (
      exerciseId: string,
      answer: string,
      evaluation: string,
    ) => ({
      exerciseId,
      answer,
      evaluation,
      accentCorrection: null,
      feedback: null,
      createdAt: '2026-10-24T09:00:00.000Z',
    });
    const withAttempts = (
      evaluations: (string | null)[],
      overrides: object = {},
    ) => ({
      ...generatedLesson,
      ...overrides,
      version: {
        ...generatedLesson.version,
        exercises: generatedLesson.version.exercises.map((exercise, index) => ({
          ...exercise,
          latestAttempt: evaluations[index]
            ? attempt(exercise.id, 'An answer', evaluations[index])
            : null,
        })),
      },
    });
    const wrapUpFor = (data: object, options = {}) =>
      renderPage({
        path: wrapUp,
        query: { data } as Partial<LessonQuery>,
        ...options,
      });
    const results = () => screen.getByRole('list', { name: 'Your results' });

    describe('results', () => {
      it("shows each exercise's latest result and how many were right", () => {
        wrapUpFor(withAttempts(['CORRECT', 'INCORRECT', null]));

        expect(screen.getByText('You got 1 of 3 right.')).toBeInTheDocument();
        const items = within(results()).getAllByRole('listitem');
        expect(items[0]).toHaveTextContent(/translate: good morning.*correct/i);
        expect(items[1]).toHaveTextContent(/, marco!.*incorrect/i);
        expect(items[2]).toHaveTextContent(
          /when would you say buonasera\?.*not tried yet/i,
        );
      });

      it('counts a partly right explanation as missed, not right', () => {
        wrapUpFor(withAttempts(['CORRECT', 'CORRECT', 'PARTIALLY_CORRECT']));

        expect(screen.getByText('You got 2 of 3 right.')).toBeInTheDocument();
        expect(within(results()).getAllByRole('listitem')[2]).toHaveTextContent(
          /partly right/i,
        );
      });

      it('links each missed exercise to it in Practice', async () => {
        const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
        const user = userEvent.setup();
        wrapUpFor(withAttempts(['CORRECT', 'INCORRECT', 'PARTIALLY_CORRECT']));

        const items = within(results()).getAllByRole('listitem');
        expect(
          within(items[0]).queryByRole('link', { name: /try again/i }),
        ).not.toBeInTheDocument();
        await user.click(
          within(items[1]).getByRole('link', { name: /try again/i }),
        );

        expect(
          screen.getByRole('heading', { level: 2, name: 'Practice' }),
        ).toBeInTheDocument();
        expect(screen.getByLabelText('Current search')).toHaveTextContent(
          '?step=practice&exercise=exercise-2',
        );
        expect(
          scroll.mock.contexts.map((element) =>
            // The blank renders as a field, so the prompt reads ", Marco!"
            /fill in the blank.*exercise 2 of 3.*, marco!/i.test(
              (element as Element).textContent ?? '',
            ),
          ),
        ).toContain(true);
      });

      it('needs no AI access', () => {
        wrapUpFor(withAttempts(['CORRECT', null, null]), { canUseAI: false });

        expect(screen.getByText('You got 1 of 3 right.')).toBeInTheDocument();
        expect(
          screen.getByRole('link', { name: 'Continue: At the café' }),
        ).toBeInTheDocument();
      });
    });

    describe('making review cards', () => {
      it('suggests trying the exercises first when none has been tried, but still offers it', () => {
        wrapUpFor(withAttempts([null, null, null]));

        expect(
          screen.getByText(/try the exercises first/i),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Make review cards' }),
        ).toBeEnabled();
      });

      /** As the API counts them: ever got wrong on this version. */
      const missed = (
        data: ReturnType<typeof withAttempts>,
        count: number,
      ) => ({
        ...data,
        version: { ...data.version, missedExerciseCount: count },
      });

      it('says how many missed exercises the cards will focus on', () => {
        wrapUpFor(
          missed(withAttempts(['INCORRECT', 'PARTIALLY_CORRECT', null]), 2),
        );

        expect(
          screen.getByText(/focus on the 2 exercises you missed/i),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Make review cards' }),
        ).toBeEnabled();
      });

      it('counts exercises missed before starting over, which the cards still focus on', () => {
        wrapUpFor(missed(withAttempts([null, null, null]), 1));

        expect(
          screen.getByText(/focus on the 1 exercise you missed/i),
        ).toBeInTheDocument();
        expect(
          screen.queryByText(/try the exercises first/i),
        ).not.toBeInTheDocument();
      });

      it('counts an exercise missed and then put right, which the cards still focus on', () => {
        wrapUpFor(missed(withAttempts(['CORRECT', 'CORRECT', null]), 1));

        expect(
          screen.getByText(/focus on the 1 exercise you missed/i),
        ).toBeInTheDocument();
      });

      it('says so when nothing was missed', () => {
        wrapUpFor(withAttempts(['CORRECT', 'CORRECT', null]));

        expect(
          screen.getByText(/you haven't missed any exercises/i),
        ).toBeInTheDocument();
      });
    });

    describe('suggesting completion', () => {
      const suggestion = () =>
        screen.queryByText(/you've tried every exercise/i);

      it('suggests marking the lesson complete once every exercise has been tried', () => {
        wrapUpFor(withAttempts(['CORRECT', 'INCORRECT', 'PARTIALLY_CORRECT']));

        expect(suggestion()).toBeInTheDocument();
        expect(mockSetCompleted).not.toHaveBeenCalled();
      });

      it("doesn't suggest it for a lesson with no exercises to try", () => {
        wrapUpFor({
          ...generatedLesson,
          version: { ...generatedLesson.version, exercises: [] },
        });

        expect(suggestion()).not.toBeInTheDocument();
      });

      it('waits until every exercise has been tried', () => {
        wrapUpFor(withAttempts(['CORRECT', 'INCORRECT', null]));

        expect(suggestion()).not.toBeInTheDocument();
      });

      it("doesn't suggest it for a lesson already complete", () => {
        wrapUpFor(
          withAttempts(['CORRECT', 'CORRECT', 'CORRECT'], {
            completedAt: '2026-10-24T09:00:00.000Z',
          }),
        );

        expect(suggestion()).not.toBeInTheDocument();
      });
    });

    describe('continuing', () => {
      it('continues to the next lesson', () => {
        wrapUpFor(withAttempts([null, null, null]));

        expect(
          screen.getByRole('link', { name: 'Continue: At the café' }),
        ).toHaveAttribute('href', '/lessons/lesson-2');
      });

      it('says when every other lesson is complete, and links back to the course', () => {
        wrapUpFor(withAttempts([null, null, null], { nextLesson: null }));

        expect(
          screen.getByText(/every other lesson in this course is complete/i),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('link', { name: 'Back to Italian' }),
        ).toHaveAttribute('href', '/courses/course-1');
        expect(
          screen.queryByRole('link', { name: /^continue/i }),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('Lesson Completion', () => {
    const written = { data: generatedLesson } as Partial<LessonQuery>;
    const completed = {
      data: { ...generatedLesson, completedAt: '2026-10-24T09:00:00.000Z' },
    } as Partial<LessonQuery>;

    it('can be toggled from the header on any step', async () => {
      const user = userEvent.setup();
      renderPage({ query: written });

      const toggle = screen.getByRole('button', { name: 'Mark complete' });
      expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await user.click(toggle);

      expect(mockSetCompleted).toHaveBeenCalledWith({
        id: 'lesson-1',
        completed: true,
      });
    });

    it('shows a complete lesson as complete in the header, and undoes it', async () => {
      const user = userEvent.setup();
      renderPage({ query: completed });

      const toggle = screen.getByRole('button', { name: 'Mark complete' });
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await user.click(toggle);

      expect(mockSetCompleted).toHaveBeenCalledWith({
        id: 'lesson-1',
        completed: false,
      });
    });

    it('offers it in the ⋯ menu on narrow screens, where the header has no room', async () => {
      const user = userEvent.setup();
      renderPage({ query: completed });

      expect(screen.getByRole('button', { name: 'Mark complete' })).toHaveClass(
        'max-sm:hidden',
      );
      await user.click(screen.getByRole('button', { name: 'More actions' }));
      const item = screen.getByRole('menuitemcheckbox', {
        name: 'Mark complete',
      });
      expect(item).toHaveAttribute('aria-checked', 'true');
      await user.click(item);

      expect(mockSetCompleted).toHaveBeenCalledWith({
        id: 'lesson-1',
        completed: false,
      });
    });

    it('marks the lesson complete from Wrap up', async () => {
      const user = userEvent.setup();
      renderPage({ path: wrapUp, query: written });

      await user.click(
        within(screen.getByRole('main')).getByRole('button', {
          name: 'Mark complete',
        }),
      );

      expect(mockSetCompleted).toHaveBeenCalledWith({
        id: 'lesson-1',
        completed: true,
      });
    });

    it('shows a complete lesson as complete, and undoes it', async () => {
      const user = userEvent.setup();
      renderPage({ path: wrapUp, query: completed });

      expect(
        screen.getByText(/you marked this lesson complete/i),
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Mark as not complete' }),
      );

      expect(mockSetCompleted).toHaveBeenCalledWith({
        id: 'lesson-1',
        completed: false,
      });
    });

    it('needs no AI access', () => {
      renderPage({ path: wrapUp, query: written, canUseAI: false });

      expect(
        within(screen.getByRole('main')).getByRole('button', {
          name: 'Mark complete',
        }),
      ).toBeInTheDocument();
    });

    it("can be set on a lesson that hasn't been written, so none is locked", () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        canUseAI: false,
      });

      expect(screen.getByText(/hasn't been written yet/i)).toBeInTheDocument();
      expect(
        within(screen.getByRole('main')).getByRole('button', {
          name: 'Mark complete',
        }),
      ).toBeInTheDocument();
    });

    it('waits while the change is saved', () => {
      renderPage({
        path: wrapUp,
        query: written,
        setCompleted: { isPending: true },
      });

      expect(
        within(screen.getByRole('main')).getByRole('button', {
          name: 'Mark complete',
        }),
      ).toBeDisabled();
    });

    it('refreshes the lesson and its course once saved', () => {
      renderPage({ path: wrapUp, query: written });
      const [options] = vi.mocked(trpc.lesson.setCompleted.useMutation).mock
        .calls[0] as [SetCompletedOptions];

      options?.onSuccess?.(
        { id: 'lesson-1', completedAt: new Date() } as never,
        { id: 'lesson-1', completed: true },
        undefined,
        {} as never,
      );

      expect(mockInvalidate).toHaveBeenCalledWith({ id: 'lesson-1' });
      expect(mockInvalidateCourse).toHaveBeenCalledWith({ id: 'course-1' });
    });
  });

  describe('the tutor', () => {
    const written = { data: twoSectionLesson } as Partial<LessonQuery>;

    /** A screen wide enough for the tutor beside the lesson, or not. */
    function screenIsWide(wide: boolean) {
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (query) =>
          ({
            matches: wide,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      );
    }

    it('is open beside the lesson to start, and stays open from step to step', async () => {
      const user = userEvent.setup();
      screenIsWide(true);
      renderPage({ query: written });

      const toggle = screen.getByRole('button', { name: 'Tutor' });
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      const tutor = screen.getByRole('complementary', { name: 'Tutor' });
      expect(within(tutor).getByText('What does ciao mean?')).toBeVisible();

      await user.click(screen.getByRole('button', { name: /next/i }));

      expect(
        within(screen.getByRole('complementary', { name: 'Tutor' })).getByText(
          'What does ciao mean?',
        ),
      ).toBeVisible();
    });

    it('closes and reopens from the header, remembering the choice', async () => {
      const user = userEvent.setup();
      screenIsWide(true);
      const { unmount } = renderPage({ query: written });

      await user.click(screen.getByRole('button', { name: 'Tutor' }));

      expect(screen.getByRole('button', { name: 'Tutor' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(
        screen.queryByRole('complementary', { name: 'Tutor' }),
      ).not.toBeInTheDocument();

      unmount();
      renderPage({ query: written });

      expect(
        screen.queryByRole('complementary', { name: 'Tutor' }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Tutor' }));
      expect(
        screen.getByRole('complementary', { name: 'Tutor' }),
      ).toBeInTheDocument();
    });

    it('tells the tutor the exercise on screen, practising one at a time', () => {
      screenIsWide(true);
      renderPage({
        query: { data: generatedLesson } as Partial<LessonQuery>,
        path: '/lessons/lesson-1?step=practice&exercise=exercise-2',
      });

      expect(
        within(screen.getByRole('complementary', { name: 'Tutor' })).getByText(
          'The tutor can see exercise 2 and your answers.',
        ),
      ).toBeVisible();
    });

    it('tells the tutor of no exercise away from Practice, or with all exercises shown', () => {
      screenIsWide(true);
      localStorage.setItem('study-hall:paging-view', 'all');
      renderPage({
        query: { data: generatedLesson } as Partial<LessonQuery>,
        path: '/lessons/lesson-1?step=practice&exercise=exercise-2',
      });

      expect(screen.queryByText(/can see exercise/)).not.toBeInTheDocument();
    });

    it('opens as a drawer on a narrower screen, starting closed', async () => {
      const user = userEvent.setup();
      screenIsWide(false);
      renderPage({ query: written });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Tutor' }));

      const drawer = screen.getByRole('dialog', { name: 'Tutor' });
      expect(within(drawer).getByText('What does ciao mean?')).toBeVisible();
    });

    it('is offered only to learners who can use AI', () => {
      renderPage({ query: written, canUseAI: false });

      expect(
        screen.queryByRole('button', { name: 'Tutor' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('starting a lesson over', () => {
    const answered = {
      ...generatedLesson,
      version: {
        ...generatedLesson.version,
        exercises: generatedLesson.version.exercises.map((exercise, index) =>
          index === 0
            ? {
                ...exercise,
                latestAttempt: {
                  exerciseId: exercise.id,
                  answer: 'Buonasera',
                  evaluation: 'INCORRECT',
                  accentCorrection: null,
                  feedback: null,
                  createdAt: '2026-10-24T09:00:00.000Z',
                },
              }
            : exercise,
        ),
      },
    };

    it('starts the lesson over once the learner confirms', async () => {
      const user = userEvent.setup();
      renderPage({ query: { data: answered } as Partial<LessonQuery> });

      await user.click(screen.getByRole('button', { name: 'More actions' }));
      await user.click(screen.getByRole('menuitem', { name: 'Start over' }));
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(/earlier answers are still saved/i);
      expect(mockStartOver).not.toHaveBeenCalled();
      await user.click(
        within(dialog).getByRole('button', { name: 'Start over' }),
      );

      expect(mockStartOver).toHaveBeenCalledWith({ id: 'lesson-1' });
    });

    it('refreshes the lesson and its course, then forgets revealed answers', async () => {
      // Until the lesson has refetched, a revealed exercise is still
      // mounted and would refetch its answers, which now fails
      let lessonRefetched: () => void = () => {};
      mockInvalidate.mockReturnValueOnce(
        new Promise<void>((resolve) => (lessonRefetched = resolve)),
      );
      renderPage({ query: { data: answered } as Partial<LessonQuery> });
      const [options] = vi.mocked(trpc.lesson.startOver.useMutation).mock
        .calls[0] as [StartOverOptions];

      const done = options?.onSuccess?.(
        { id: 'lesson-1', resetAt: new Date() } as never,
        { id: 'lesson-1' },
        undefined,
        {} as never,
      );

      expect(mockInvalidate).toHaveBeenCalledWith({ id: 'lesson-1' });
      expect(mockInvalidateCourse).toHaveBeenCalledWith({ id: 'course-1' });
      expect(mockResetAnswers).not.toHaveBeenCalled();
      lessonRefetched();
      await done;
      expect(mockResetAnswers).toHaveBeenCalled();
    });

    it('shows every exercise empty once the lesson has started over', () => {
      const { rerender } = renderPage({
        query: { data: answered } as Partial<LessonQuery>,
        path: practice,
      });
      expect(screen.getAllByLabelText('Your answer')[0]).toHaveValue(
        'Buonasera',
      );

      vi.mocked(trpc.lesson.getById.useQuery).mockReturnValue({
        data: { ...generatedLesson, resetAt: '2026-10-25T09:00:00.000Z' },
        isLoading: false,
        isError: false,
      } as unknown as LessonQuery);
      rerender(
        <MemoryRouter initialEntries={[practice]}>
          <Routes>
            <Route path="/lessons/:lessonId" element={<LessonPage />} />
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getAllByLabelText('Your answer')[0]).toHaveValue('');
    });

    it("isn't offered before the lesson is written", () => {
      renderPage({ query: { data: lesson } as Partial<LessonQuery> });

      expect(
        screen.queryByRole('button', { name: 'More actions' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Start over' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('making review cards', () => {
    const proposal = {
      cards: [
        {
          type: 'TYPED_RECALL' as const,
          front: 'Translate: Good morning',
          canonicalAnswer: 'Buongiorno',
        },
        {
          type: 'TYPED_RECALL' as const,
          front: 'Translate: Good evening',
          canonicalAnswer: 'Buonasera',
        },
      ],
      model: 'claude-sonnet-5-5',
      promptVersion: 'card-proposal-v1',
      existingCards: [
        {
          id: 'card-1',
          front: 'Translate: Good evening',
          canonicalAnswer: 'Buonasera',
        },
      ],
    };
    const written = { data: generatedLesson } as Partial<LessonQuery>;

    it('proposes review cards for the lesson', async () => {
      const user = userEvent.setup();
      renderPage({ path: wrapUp, query: written });

      await user.click(
        screen.getByRole('button', { name: 'Make review cards' }),
      );

      expect(mockPropose).toHaveBeenCalledWith({ id: 'lesson-1' });
    });

    it('is offered only to learners who can use AI', () => {
      renderPage({ path: wrapUp, query: written, canUseAI: false });

      expect(
        screen.queryByRole('button', { name: 'Make review cards' }),
      ).not.toBeInTheDocument();
    });

    it('shows that cards are being proposed', () => {
      renderPage({
        path: wrapUp,
        query: written,
        propose: { isPending: true },
      });

      expect(
        screen.getByRole('button', { name: /proposing cards/i }),
      ).toBeDisabled();
    });

    it('says why proposing failed', () => {
      renderPage({
        path: wrapUp,
        query: written,
        propose: {
          isError: true,
          error: { message: 'AI features are paused until next month.' },
        } as unknown as Partial<ProposeMutation>,
      });

      expect(
        screen.getByText('AI features are paused until next month.'),
      ).toBeInTheDocument();
    });

    it('opens the proposed cards in the preview, with Course Deck duplicates flagged', () => {
      renderPage({ path: wrapUp, query: written, propose: { data: proposal } });

      expect(screen.getByLabelText('Card 1 front')).toHaveValue(
        'Translate: Good morning',
      );
      expect(screen.getByLabelText('Include card 2')).not.toBeChecked();
      expect(
        screen.getByText(/already in the course deck/i),
      ).toBeInTheDocument();
    });

    it('adds the confirmed cards to the Course Deck as Typed Recall cards from this proposal', async () => {
      const user = userEvent.setup();
      renderPage({ path: wrapUp, query: written, propose: { data: proposal } });

      await user.click(screen.getByRole('button', { name: 'Add 1 card' }));

      expect(mockCreate).toHaveBeenCalledWith({
        id: 'lesson-1',
        model: 'claude-sonnet-5-5',
        promptVersion: 'card-proposal-v1',
        cards: [
          {
            type: 'TYPED_RECALL',
            front: 'Translate: Good morning',
            canonicalAnswer: 'Buongiorno',
          },
        ],
      });
    });

    it('closes the preview, refreshes the deck and confirms once the cards are added', () => {
      renderPage({ path: wrapUp, query: written, propose: { data: proposal } });
      const [options] = vi.mocked(trpc.lesson.createReviewCards.useMutation)
        .mock.calls[0] as [CreateOptions];

      options?.onSuccess?.(
        { deckId: 'deck-1', createdCount: 1 },
        {} as never,
        undefined,
        {} as never,
      );

      expect(mockResetProposal).toHaveBeenCalled();
      expect(mockInvalidateCards).toHaveBeenCalledWith({ deckId: 'deck-1' });
      expect(mockInvalidateDecks).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith(
        'Added 1 review card to the course deck',
      );
    });

    it('closes the preview without adding anything on cancel', async () => {
      const user = userEvent.setup();
      renderPage({ path: wrapUp, query: written, propose: { data: proposal } });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockResetProposal).toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('a lesson opened for the first time', () => {
    it('generates it once, even under StrictMode', () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        strict: true,
      });

      expect(mockGenerate).toHaveBeenCalledTimes(1);
      expect(mockGenerate).toHaveBeenCalledWith({ id: 'lesson-1' });
    });

    it('shows a loading state while the lesson is written', () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        mutation: { isPending: true },
      });

      expect(
        screen.getByRole('status', { name: /writing your lesson/i }),
      ).toBeInTheDocument();
    });

    it('shows the lesson as soon as it is generated, ahead of any stale refetch', async () => {
      renderPage({ query: { data: lesson } as Partial<LessonQuery> });

      const options = vi.mocked(trpc.lesson.generate.useMutation).mock
        .calls[0][0] as { onSuccess: (data: unknown) => Promise<void> };
      await options.onSuccess(generatedLesson);

      expect(mockCancel).toHaveBeenCalledWith({ id: 'lesson-1' });
      expect(mockSetData).toHaveBeenCalledWith(
        { id: 'lesson-1' },
        generatedLesson,
      );
    });

    it("doesn't generate without AI access, and says why", () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        canUseAI: false,
      });

      expect(mockGenerate).not.toHaveBeenCalled();
      expect(screen.getByText(/needs ai access/i)).toBeInTheDocument();
    });

    it("waits to learn whether the learner can use AI before saying they can't", () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        meLoading: true,
      });

      expect(screen.queryByText(/needs ai access/i)).not.toBeInTheDocument();
      expect(mockGenerate).not.toHaveBeenCalled();
      expect(
        screen.getByRole('status', { name: /writing your lesson/i }),
      ).toBeInTheDocument();
    });

    it('says when AI is paused by the spending cap', () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        mutation: {
          isError: true,
          error: {
            message: 'AI features are paused until next month.',
            data: { code: 'TOO_MANY_REQUESTS' },
          },
        } as unknown as Partial<GenerateMutation>,
      });

      expect(
        screen.getByText('AI features are paused until next month.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /try again/i }),
      ).not.toBeInTheDocument();
    });

    it('waits for a lesson another tab is writing, without writing it again', () => {
      renderPage({
        query: {
          data: { ...lesson, generating: true },
        } as Partial<LessonQuery>,
      });

      expect(mockGenerate).not.toHaveBeenCalled();
      expect(
        screen.getByRole('status', { name: /writing your lesson/i }),
      ).toBeInTheDocument();
    });

    it('checks back every few seconds while the lesson is being written', () => {
      renderPage({ query: { data: lesson } as Partial<LessonQuery> });

      const { refetchInterval } = vi.mocked(trpc.lesson.getById.useQuery).mock
        .calls[0][1] as {
        refetchInterval: (query: {
          state: { data?: { generating: boolean } };
        }) => number | false;
      };
      expect(refetchInterval({ state: { data: { generating: true } } })).toBe(
        3000,
      );
      expect(refetchInterval({ state: { data: { generating: false } } })).toBe(
        false,
      );
    });

    it('joins the wait when another tab started writing the lesson first', () => {
      renderPage({
        // The lesson is refetched to learn that another open is writing it
        query: { data: lesson, isFetching: true } as Partial<LessonQuery>,
        mutation: {
          isError: true,
          error: {
            message: 'This lesson is already being written.',
            data: { code: 'CONFLICT' },
          },
        } as unknown as Partial<GenerateMutation>,
      });

      const options = vi.mocked(trpc.lesson.generate.useMutation).mock
        .calls[0][0] as { onError: (error: unknown) => void };
      options.onError({ data: { code: 'CONFLICT' } });

      expect(mockInvalidate).toHaveBeenCalledWith({ id: 'lesson-1' });
      expect(
        screen.getByRole('status', { name: /writing your lesson/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /try again/i }),
      ).not.toBeInTheDocument();
    });

    it('offers to try again if the other open stopped without writing it', () => {
      renderPage({
        query: { data: lesson, isFetching: false } as Partial<LessonQuery>,
        mutation: {
          isError: true,
          error: {
            message: 'This lesson is already being written.',
            data: { code: 'CONFLICT' },
          },
        } as unknown as Partial<GenerateMutation>,
      });

      expect(
        screen.getByRole('button', { name: /try again/i }),
      ).toBeInTheDocument();
    });

    it('offers to try again when generation fails', async () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        mutation: {
          isError: true,
          error: {
            message: "The AI didn't produce a usable answer.",
            data: { code: 'BAD_GATEWAY' },
          },
        } as unknown as Partial<GenerateMutation>,
      });
      mockGenerate.mockClear();

      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: /try again/i }));

      expect(mockGenerate).toHaveBeenCalledWith({ id: 'lesson-1' });
    });
  });

  it('shows a loading state', () => {
    renderPage({ query: { isLoading: true } });

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
  });

  it('shows when the lesson cannot be found', () => {
    renderPage({
      query: {
        isError: true,
        error: { data: { code: 'NOT_FOUND' } },
      } as unknown as Partial<LessonQuery>,
    });

    expect(screen.getByText(/lesson not found/i)).toBeInTheDocument();
  });
});
