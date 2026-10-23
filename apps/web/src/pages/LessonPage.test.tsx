import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LessonPage from './LessonPage';
import { trpc } from '@/lib/trpc';

const mockSetData = vi.fn();
const mockCancel = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      lesson: { getById: { setData: mockSetData, cancel: mockCancel } },
    })),
    auth: { me: { useQuery: vi.fn() } },
    lesson: {
      getById: { useQuery: vi.fn() },
      generate: { useMutation: vi.fn() },
    },
  },
}));

type LessonQuery = ReturnType<typeof trpc.lesson.getById.useQuery>;
type GenerateMutation = ReturnType<typeof trpc.lesson.generate.useMutation>;

const lesson = {
  id: 'lesson-1',
  title: 'Greetings',
  objectives: ['Greet someone formally'],
  firstOpenedAt: null,
  course: { id: 'course-1', title: 'Italian' },
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
      },
      { id: 'exercise-2', type: 'FILL_IN_THE_BLANK', prompt: '___, Marco!' },
      {
        id: 'exercise-3',
        type: 'FREE_FORM_EXPLANATION',
        prompt: 'When would you say buonasera?',
      },
    ],
  },
};

const mockGenerate = vi.fn();

function renderPage({
  query = {},
  mutation = {},
  canUseAI = true,
  meLoading = false,
  strict = false,
}: {
  query?: Partial<LessonQuery>;
  mutation?: Partial<GenerateMutation>;
  canUseAI?: boolean;
  meLoading?: boolean;
  strict?: boolean;
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

  const page = (
    <MemoryRouter initialEntries={['/lessons/lesson-1']}>
      <Routes>
        <Route path="/lessons/:lessonId" element={<LessonPage />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LessonPage', () => {
  describe('a generated lesson', () => {
    it('loads the lesson from the route', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      expect(trpc.lesson.getById.useQuery).toHaveBeenCalledWith({
        id: 'lesson-1',
      });
      expect(
        screen.getByRole('heading', { level: 1, name: 'Greetings' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /italian/i })).toHaveAttribute(
        'href',
        '/courses/course-1',
      );
    });

    it('renders the content blocks and examples', () => {
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
      expect(screen.getByText('Ciao, Marco!')).toBeInTheDocument();
      expect(screen.getByText('An informal hello.')).toBeInTheDocument();
    });

    it('lists the exercises in order with their type', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      const exercises = within(
        screen.getByRole('list', { name: /exercises/i }),
      ).getAllByRole('listitem');
      expect(exercises).toHaveLength(3);
      expect(exercises[0]).toHaveTextContent(
        /short answer.*translate: good morning/i,
      );
      expect(exercises[1]).toHaveTextContent(/fill in the blank.*___, marco!/i);
      expect(exercises[2]).toHaveTextContent(
        /explain.*when would you say buonasera\?/i,
      );
    });

    it('never generates a lesson that already has a version', () => {
      renderPage({ query: { data: generatedLesson } as Partial<LessonQuery> });

      expect(mockGenerate).not.toHaveBeenCalled();
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

    it('asks the learner to wait while another tab writes the lesson', () => {
      renderPage({
        query: { data: lesson } as Partial<LessonQuery>,
        mutation: {
          isError: true,
          error: {
            message: 'This lesson is already being written.',
            data: { code: 'CONFLICT' },
          },
        } as unknown as Partial<GenerateMutation>,
      });

      expect(
        screen.getByText('This lesson is already being written.'),
      ).toBeInTheDocument();
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
