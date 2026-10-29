import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ArrowUp, Loader2, SquarePen } from 'lucide-react';
import { keepPreviousData } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Role =
  inferRouterOutputs<AppRouter>['tutor']['thread']['messages'][number]['role'];

/** One message, the learner's set off to the right. */
function Message({ role, children }: { role: Role; children: ReactNode }) {
  const isLearner = role === 'LEARNER';
  return (
    <li
      className={`flex flex-col gap-1 ${isLearner ? 'items-end' : 'items-start'}`}
    >
      <span className="text-xs text-white/50">
        {isLearner ? 'You' : 'Tutor'}
      </span>
      <div
        // A step smaller than the lesson's prose, with the same room
        // between lines, for long replies in a narrow column
        className={`text-[0.9375rem] leading-relaxed whitespace-pre-wrap ${isLearner ? 'max-w-[85%] rounded-lg bg-white/15 px-3 py-2' : ''}`}
      >
        {children}
      </div>
    </li>
  );
}

/**
 * The tutor beside a lesson: the current Tutor Thread of the lesson's
 * current version, restored on reopening, and a box to ask in. The reply
 * streams in as it is written, and joins the stored thread once complete.
 * Each message goes with the exercise the learner is on, so the tutor can
 * address it and their answers to it (#24). New thread starts a fresh one,
 * which the tutor then sees alone, and the version's earlier threads can be
 * read back from the picker (#62).
 */
export function TutorPanel({
  lessonId,
  exercise,
}: {
  lessonId: string;
  /** The exercise on the learner's screen, numbered as the lesson shows it. */
  exercise?: { id: string; number: number };
}) {
  const utils = trpc.useUtils();
  // An earlier thread being read back, or null for the current one
  const [earlierId, setEarlierId] = useState<string | null>(null);
  const thread = trpc.tutor.thread.useQuery(
    earlierId ? { lessonId, threadId: earlierId } : { lessonId },
    // The thread on screen, and the picker, stay while another loads
    { placeholderData: keepPreviousData },
  );
  const threads = thread.data?.threads ?? [];
  const current = threads.find((t) => t.isCurrent);
  const readingEarlier = earlierId !== null;
  const [draft, setDraft] = useState('');
  // The exchange under way, until the stored thread includes it
  const [pending, setPending] = useState<{
    message: string;
    reply: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startThread = trpc.tutor.startThread.useMutation({
    onSuccess: () => {
      setEarlierId(null);
      setError(null);
      void utils.tutor.thread.invalidate({ lessonId });
    },
    onError: () => setError('Couldn’t start a new thread.'),
  });

  // A reply is read to the end even if the panel closes, since the server
  // stores it then: the thread, perhaps reopened meanwhile, is refreshed
  const ask = async (message: string) => {
    setPending({ message, reply: '' });
    setError(null);
    setDraft('');
    try {
      const stream = await utils.client.tutor.ask.mutate({
        lessonId,
        message,
        exerciseId: exercise?.id,
      });
      for await (const piece of stream) {
        setPending(
          (current) => current && { ...current, reply: current.reply + piece },
        );
      }
      await utils.tutor.thread.invalidate({ lessonId });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The tutor couldn’t reply.',
      );
      // The message wasn't stored, so it's back to send again
      setDraft((current) => current || message);
    }
    setPending(null);
  };

  const onSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    const message = draft.trim();
    if (message && !pending) void ask(message);
  };

  // Enter sends; Shift+Enter starts a new line
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSubmit();
  };

  // Keep the newest message in view as the thread grows
  const listRef = useRef<HTMLOListElement>(null);
  const messages = thread.data?.messages ?? [];
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, pending?.message, pending?.reply]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 pb-3">
        <h2 className="mr-auto text-lg font-semibold">Tutor</h2>
        {current && threads.length > 1 && (
          <Select
            value={earlierId ?? current.id}
            onValueChange={(id) => setEarlierId(id === current.id ? null : id)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Thread"
              className="border-white/20 bg-white/10 text-xs text-white hover:bg-white/15 [&_svg]:text-white/60"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              align="end"
              className="border border-white/20 bg-[oklch(0.25_0.08_230)] text-white ring-0"
            >
              {threads.map((t) => (
                <SelectItem
                  key={t.id}
                  value={t.id}
                  className="text-xs focus:bg-white/10 focus:text-white"
                >
                  Thread {t.number}
                  {t.isCurrent && ' (current)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <button
          type="button"
          onClick={() => startThread.mutate({ lessonId })}
          // An empty current thread is fresh already
          disabled={
            pending !== null ||
            startThread.isPending ||
            (!readingEarlier && messages.length === 0)
          }
          className="touch-target flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <SquarePen aria-hidden className="size-3.5" />
          New thread
        </button>
      </div>
      <ol
        ref={listRef}
        aria-label="Messages"
        // Read out as it streams in
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1"
      >
        {messages.map((message) => (
          <Message key={message.id} role={message.role}>
            {message.content}
          </Message>
        ))}
        {pending && !readingEarlier && (
          <>
            <Message role="LEARNER">{pending.message}</Message>
            <Message role="TUTOR">
              {pending.reply || (
                <Loader2
                  aria-label="The tutor is replying"
                  className="size-4 animate-spin text-white/60"
                />
              )}
            </Message>
          </>
        )}
      </ol>
      {!readingEarlier &&
        messages.length === 0 &&
        !pending &&
        !thread.isLoading && (
          <p className="pb-4 text-sm text-white/60">
            Ask about anything in this lesson. The tutor will help you work it
            out rather than just tell you.
          </p>
        )}
      {exercise && !readingEarlier && (
        <p className="pb-2 text-xs text-white/50">
          The tutor can see exercise {exercise.number} and your answers.
        </p>
      )}
      {error && (
        <p role="alert" className="pb-2 text-sm text-amber-200">
          {error}
        </p>
      )}
      {readingEarlier ? (
        <div className="flex flex-col items-start gap-2 border-t border-white/15 pt-3 text-sm text-white/60">
          <p>An earlier thread, kept to read back. The tutor doesn’t see it.</p>
          <button
            type="button"
            onClick={() => setEarlierId(null)}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-[oklch(0.25_0.08_230)]"
          >
            Back to the current thread
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="relative pt-2">
          <textarea
            aria-label="Message the tutor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            maxLength={4000}
            placeholder="Ask the tutor"
            className="w-full resize-none rounded-md border border-white/20 bg-white/10 py-2 pr-11 pl-3 text-base text-white placeholder-white/40 outline-none focus-visible:border-white/40 focus-visible:ring-2 focus-visible:ring-white/20 md:text-sm"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={pending !== null || !draft.trim()}
            className="touch-target absolute right-2 bottom-3.5 flex size-7 items-center justify-center rounded-md bg-white text-[oklch(0.25_0.08_230)] transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </form>
      )}
    </div>
  );
}
