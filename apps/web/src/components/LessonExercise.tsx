import { useId, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, XCircle } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';

type Exercise = NonNullable<
  inferRouterOutputs<AppRouter>['lesson']['getById']['version']
>['exercises'][number];

const EXERCISE_LABELS: Record<Exercise['type'], string> = {
  SHORT_ANSWER: 'Short answer',
  FILL_IN_THE_BLANK: 'Fill in the blank',
  FREE_FORM_EXPLANATION: 'Explain',
};

/**
 * A fill-in-the-blank prompt's one gap: three or more underscores, as the
 * lesson output schema in the API checks.
 */
const GAP = /_{3,}/;

const glassInputClassName =
  'border-white/20 bg-white/10 text-white placeholder-white/40 focus-visible:border-white/40 focus-visible:ring-white/20';

type Attempt = NonNullable<Exercise['latestAttempt']>;

const VERDICTS = {
  CORRECT: { Icon: CheckCircle2, text: 'Correct!', color: 'text-emerald-300' },
  // Free-form explanations only (ADR-0006)
  PARTIALLY_CORRECT: {
    Icon: CircleAlert,
    text: 'Partly right.',
    color: 'text-amber-200',
  },
  INCORRECT: {
    Icon: XCircle,
    text: 'Not quite. Try again.',
    color: 'text-amber-200',
  },
} satisfies Record<Attempt['evaluation'], unknown>;

/**
 * An attempt's result, with the AI's feedback when it evaluated the answer.
 * An Accent Mismatch is correct but always shows the accented form
 * (ADR-0002).
 */
function Result({ attempt }: { attempt: Attempt }) {
  const { Icon, text, color } = VERDICTS[attempt.evaluation];
  return (
    <>
      <p className={`mt-2 flex items-center gap-1.5 text-sm ${color}`}>
        <Icon className="size-4" />
        {text}
      </p>
      {attempt.accentCorrection && (
        <p className="mt-1 text-sm text-white/70" data-testid="accent-note">
          Check the accents:{' '}
          <span className="font-semibold text-white">
            {attempt.accentCorrection}
          </span>
        </p>
      )}
      {attempt.feedback && (
        <p className="mt-1 text-sm text-white/80">{attempt.feedback}</p>
      )}
    </>
  );
}

/** A labelled list of revealed answers or points. */
function RevealedList({ label, items }: { label: string; items: string[] }) {
  const id = useId();
  return (
    <>
      <p id={id}>{label}</p>
      <ul aria-labelledby={id} className="mt-1 list-disc pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}

type RevealedAnswers = inferRouterOutputs<AppRouter>['exercise']['answers'];

/**
 * What the learner sees after asking for an exercise's answers: the
 * accepted answers, or an explanation's essential points with its
 * supplementary ones as optional extras (ADR-0006).
 */
function Answers({
  type,
  answers,
}: {
  type: Exercise['type'];
  answers: RevealedAnswers;
}) {
  if (type !== 'FREE_FORM_EXPLANATION') {
    return (
      <RevealedList label="Accepted answers:" items={answers.expectedAnswers} />
    );
  }
  // Explanations generated before essential points have a flat list
  if (answers.essentialPoints.length === 0) {
    return (
      <RevealedList
        label="Points a good answer makes:"
        items={answers.expectedPoints}
      />
    );
  }
  return (
    <>
      <RevealedList
        label="A correct answer covers:"
        items={answers.essentialPoints}
      />
      {answers.supplementaryPoints.length > 0 && (
        <div className="mt-2">
          <RevealedList
            label="To go further:"
            items={answers.supplementaryPoints}
          />
        </div>
      )}
    </>
  );
}

/** Errors from AI evaluation whose message tells the learner what to do. */
const AI_ERROR_CODES = new Set([
  'FORBIDDEN',
  'TOO_MANY_REQUESTS',
  'BAD_GATEWAY',
]);

/**
 * One exercise of a lesson, checked on submit. The API checks
 * deterministically first and asks the AI only for answers to open
 * exercises it can't settle (ADR-0005).
 */
export function LessonExercise({
  exercise,
  index,
  lessonId,
}: {
  exercise: Exercise;
  index: number;
  lessonId: string;
}) {
  const utils = trpc.useUtils();
  const [answer, setAnswer] = useState(exercise.latestAttempt?.answer ?? '');

  const submit = trpc.exercise.submitAttempt.useMutation({
    onSuccess: () => {
      utils.lesson.getById.invalidate({ id: lessonId });
    },
  });

  // A result belongs to the answer it checked, not to later edits
  const latest = submit.data ?? exercise.latestAttempt;
  const result = latest?.answer === answer.trim() ? latest : null;

  // Answers are fetched only when the learner asks, after trying
  const [revealed, setRevealed] = useState(false);
  const answers = trpc.exercise.answers.useQuery(
    { exerciseId: exercise.id },
    { enabled: revealed },
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit.mutate({ exerciseId: exercise.id, answer });
  }

  const label = (
    <p className="text-xs uppercase tracking-wide text-white/50">
      {index + 1}. {EXERCISE_LABELS[exercise.type]}
    </p>
  );

  const canCheck = answer.trim() !== '' && !submit.isPending;
  const gap =
    exercise.type === 'FILL_IN_THE_BLANK' ? GAP.exec(exercise.prompt) : null;

  return (
    <li className="rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm">
      {label}
      <form onSubmit={handleSubmit}>
        {gap ? (
          <p className="mt-1 flex flex-wrap items-center gap-1">
            <span>{exercise.prompt.slice(0, gap.index)}</span>
            <Input
              aria-label="Fill in the blank"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className={`inline-block h-8 w-40 ${glassInputClassName}`}
            />
            <span>{exercise.prompt.slice(gap.index + gap[0].length)}</span>
          </p>
        ) : exercise.type === 'FREE_FORM_EXPLANATION' ? (
          <>
            <p className="mt-1">{exercise.prompt}</p>
            <textarea
              aria-label="Your explanation"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
              className={`mt-2 w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none ${glassInputClassName}`}
            />
          </>
        ) : (
          <>
            <p className="mt-1">{exercise.prompt}</p>
            <Input
              aria-label="Your answer"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className={`mt-2 ${glassInputClassName}`}
            />
          </>
        )}
        <button
          type="submit"
          disabled={!canCheck}
          className="mt-3 rounded-lg bg-white/20 px-4 py-1.5 text-sm text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
        >
          {submit.isPending ? 'Checking…' : 'Check'}
        </button>
      </form>
      {submit.isError ? (
        <p className="mt-2 text-sm text-destructive">
          {submit.error?.data && AI_ERROR_CODES.has(submit.error.data.code)
            ? submit.error.message
            : "We couldn't check your answer. Please try again."}
        </p>
      ) : (
        result && <Result attempt={result} />
      )}
      {answers.data ? (
        <div className="mt-3 text-sm text-white/70">
          <Answers type={exercise.type} answers={answers.data} />
        </div>
      ) : answers.isError ? (
        <p className="mt-3 text-sm text-destructive">
          We couldn&apos;t load the answers. Please try again later.
        </p>
      ) : (
        latest && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            disabled={revealed}
            className="mt-3 text-sm text-white/60 underline underline-offset-2 hover:text-white disabled:opacity-50"
          >
            {revealed ? 'Loading answers…' : 'Show answers'}
          </button>
        )
      )}
    </li>
  );
}
