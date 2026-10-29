import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';

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
 * The tutor beside a lesson: its Tutor Thread for the lesson's current
 * version, restored on reopening, and a box to ask in. The reply streams in
 * as it is written, and joins the stored thread once complete.
 */
export function TutorPanel({ lessonId }: { lessonId: string }) {
  const utils = trpc.useUtils();
  const thread = trpc.tutor.thread.useQuery({ lessonId });
  const [draft, setDraft] = useState('');
  // The exchange under way, until the stored thread includes it
  const [pending, setPending] = useState<{
    message: string;
    reply: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <h2 className="pb-3 text-lg font-semibold">Tutor</h2>
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
        {pending && (
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
      {messages.length === 0 && !pending && !thread.isLoading && (
        <p className="pb-4 text-sm text-white/60">
          Ask about anything in this lesson. The tutor will help you work it out
          rather than just tell you.
        </p>
      )}
      {error && (
        <p role="alert" className="pb-2 text-sm text-amber-200">
          {error}
        </p>
      )}
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
    </div>
  );
}
