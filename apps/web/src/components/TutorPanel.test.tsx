import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { TutorPanel } from './TutorPanel';
import { trpc } from '@/lib/trpc';

const mockAsk = vi.fn();
const mockInvalidate = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: vi.fn(() => ({
      client: { tutor: { ask: { mutate: mockAsk } } },
      tutor: { thread: { invalidate: mockInvalidate } },
    })),
    tutor: { thread: { useQuery: vi.fn() } },
  },
}));

type ThreadQuery = ReturnType<typeof trpc.tutor.thread.useQuery>;

function mockThread(
  messages: { role: 'LEARNER' | 'TUTOR'; content: string }[],
) {
  vi.mocked(trpc.tutor.thread.useQuery).mockReturnValue({
    data: {
      messages: messages.map((message, index) => ({
        id: `message-${index}`,
        createdAt: '2026-10-28T09:00:00.000Z',
        ...message,
      })),
    },
    isLoading: false,
    isError: false,
  } as unknown as ThreadQuery);
}

type Deferred = {
  promise: Promise<string | null>;
  resolve: (piece: string | null) => void;
  reject: (error: Error) => void;
};

function deferred(): Deferred {
  let resolve!: Deferred['resolve'];
  let reject!: Deferred['reject'];
  const promise = new Promise<string | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A streamed reply whose pieces the test hands out one at a time. */
function controlledReply() {
  const pieces: Deferred[] = [];
  const next = (index: number) => (pieces[index] ??= deferred());
  let sent = 0;
  return {
    stream: (async function* () {
      for (let index = 0; ; index++) {
        const piece = await next(index).promise;
        if (piece === null) return;
        yield piece;
      }
    })(),
    send: (piece: string) => next(sent++).resolve(piece),
    end: () => next(sent++).resolve(null),
    fail: (error: Error) => next(sent++).reject(error),
  };
}

function messageList() {
  return within(screen.getByRole('list', { name: 'Messages' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvalidate.mockResolvedValue(undefined);
});

describe('TutorPanel', () => {
  it('restores the thread when the lesson is reopened', () => {
    mockThread([
      { role: 'LEARNER', content: 'What does ciao mean?' },
      { role: 'TUTOR', content: 'What do you think it means?' },
    ]);

    render(<TutorPanel lessonId="lesson-1" />);

    const items = messageList().getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('You');
    expect(items[0]).toHaveTextContent('What does ciao mean?');
    expect(items[1]).toHaveTextContent('Tutor');
    expect(items[1]).toHaveTextContent('What do you think it means?');
  });

  it('invites a first question while the thread is empty', () => {
    mockThread([]);

    render(<TutorPanel lessonId="lesson-1" />);

    expect(
      screen.getByText(/ask about anything in this lesson/i),
    ).toBeVisible();
  });

  it('shows the reply as it streams in, then the stored thread', async () => {
    const user = userEvent.setup();
    mockThread([]);
    const reply = controlledReply();
    mockAsk.mockReturnValue(Promise.resolve(reply.stream));
    render(<TutorPanel lessonId="lesson-1" />);

    await user.type(
      screen.getByLabelText('Message the tutor'),
      'What does ciao mean?{Enter}',
    );

    expect(mockAsk).toHaveBeenCalledWith({
      lessonId: 'lesson-1',
      message: 'What does ciao mean?',
    });
    expect(screen.getByLabelText('Message the tutor')).toHaveValue('');
    expect(
      await messageList().findByText('What does ciao mean?'),
    ).toBeVisible();

    reply.send('What do ');
    expect(await messageList().findByText('What do')).toBeVisible();
    reply.send('you think?');
    expect(await messageList().findByText('What do you think?')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    // Refetching the thread brings back the exchange as stored
    mockInvalidate.mockImplementation(async () =>
      mockThread([
        { role: 'LEARNER', content: 'What does ciao mean?' },
        { role: 'TUTOR', content: 'What do you think?' },
      ]),
    );
    reply.end();
    await vi.waitFor(() =>
      expect(mockInvalidate).toHaveBeenCalledWith({ lessonId: 'lesson-1' }),
    );
    await user.type(screen.getByLabelText('Message the tutor'), 'Hello');
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();
    expect(messageList().getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the stored exchange after the panel closes and reopens mid-reply', async () => {
    const user = userEvent.setup();
    mockThread([]);
    const reply = controlledReply();
    // As the real link does, aborting ends the stream with an error
    mockAsk.mockImplementation(
      (_input: unknown, { signal }: { signal?: AbortSignal } = {}) => {
        signal?.addEventListener('abort', () =>
          reply.fail(new Error('aborted')),
        );
        return Promise.resolve(reply.stream);
      },
    );
    const { unmount } = render(<TutorPanel lessonId="lesson-1" />);
    await user.type(
      screen.getByLabelText('Message the tutor'),
      'What does ciao mean?{Enter}',
    );
    reply.send('What do ');
    await messageList().findByText('What do');

    unmount();
    reply.send('you think?');
    reply.end();

    // The thread reopened before the reply was stored is refreshed with it
    await vi.waitFor(() =>
      expect(mockInvalidate).toHaveBeenCalledWith({ lessonId: 'lesson-1' }),
    );
  });

  it('keeps a Shift+Enter line break in the message', async () => {
    const user = userEvent.setup();
    mockThread([]);
    render(<TutorPanel lessonId="lesson-1" />);

    await user.type(
      screen.getByLabelText('Message the tutor'),
      'Line one{Shift>}{Enter}{/Shift}Line two',
    );

    expect(mockAsk).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message the tutor')).toHaveValue(
      'Line one\nLine two',
    );
  });

  it('says why a reply failed and gives the message back to send again', async () => {
    const user = userEvent.setup();
    mockThread([]);
    const reply = controlledReply();
    mockAsk.mockReturnValue(Promise.resolve(reply.stream));
    render(<TutorPanel lessonId="lesson-1" />);

    await user.type(
      screen.getByLabelText('Message the tutor'),
      'What does ciao mean?{Enter}',
    );
    reply.send('What do ');
    reply.fail(new Error("The AI didn't produce a usable answer."));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The AI didn't produce a usable answer.",
    );
    expect(screen.getByLabelText('Message the tutor')).toHaveValue(
      'What does ciao mean?',
    );
    expect(messageList().queryByText('What do')).not.toBeInTheDocument();
  });
});
