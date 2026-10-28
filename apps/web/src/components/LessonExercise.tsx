import { useId, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  CornerDownLeft,
  XCircle,
} from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { exerciseElementId, type PagingView } from '@/lib/lessonSteps';
import { Input } from '@/components/ui/input';
import { ItemCount } from '@/components/ItemCount';

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

/** How a result reads, and how it marks its exercise's rule. */
const MISSED_TONES = { color: 'text-amber-200', rule: 'border-amber-200' };
const VERDICTS = {
  CORRECT: {
    Icon: CheckCircle2,
    text: 'Correct!',
    color: 'text-emerald-300',
    rule: 'border-emerald-300',
  },
  // Free-form explanations only (ADR-0006)
  PARTIALLY_CORRECT: {
    Icon: CircleAlert,
    text: 'Partly right.',
    ...MISSED_TONES,
  },
  INCORRECT: { Icon: XCircle, text: 'Not quite. Try again.', ...MISSED_TONES },
} satisfies Record<Attempt['evaluation'], unknown>;

/**
 * An attempt's result, with the AI's feedback when it evaluated the answer.
 * An Accent Mismatch is correct but always shows the accented form
 * (ADR-0002).
 */
function Result({ attempt }: { attempt: Attempt }) {
  const { Icon, text, color } = VERDICTS[attempt.evaluation];
  return (
    <div className="mt-2">
      <p className={`flex items-center gap-1.5 text-sm ${color}`}>
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
    </div>
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
 * exercises it can't settle (ADR-0005). One at a time, it's on a light
 * panel with its count; in a list, it's numbered in the margin, with a rule
 * down its side saying how it went.
 */
export function LessonExercise({
  exercise,
  index,
  lessonId,
  showMyAnswer,
  showAnswerKey,
  view,
  count,
}: {
  exercise: Exercise;
  index: number;
  /** Shown one at a time, or in the list of all the step's exercises. */
  view: PagingView;
  /** How many exercises the step has. */
  count: number;
  lessonId: string;
  /**
   * Off, the exercise starts blank, as if never answered, so it can be
   * retaken; answering makes a new attempt and earlier ones are kept.
   */
  showMyAnswer: boolean;
  /** On, an attempted exercise shows its answers without being asked. */
  showAnswerKey: boolean;
}) {
  const utils = trpc.useUtils();
  const shownAttempt = showMyAnswer ? exercise.latestAttempt : null;
  const [answer, setAnswer] = useState(shownAttempt?.answer ?? '');

  const submit = trpc.exercise.submitAttempt.useMutation({
    onSuccess: () => {
      utils.lesson.getById.invalidate({ id: lessonId });
    },
  });

  // A result belongs to the answer it checked, not to later edits
  const latest = submit.data ?? shownAttempt;
  const result = latest?.answer === answer.trim() ? latest : null;

  // Answers are fetched only after an attempt, hidden or not, and only
  // when the learner asks or has the answer key on
  const attempted = Boolean(submit.data ?? exercise.latestAttempt);
  const [revealed, setRevealed] = useState(false);
  // The answer key shows or hides every exercise's answers, so turning it
  // either way also closes answers opened one at a time
  const [keyWhenRevealed, setKeyWhenRevealed] = useState(showAnswerKey);
  if (keyWhenRevealed !== showAnswerKey) {
    setKeyWhenRevealed(showAnswerKey);
    setRevealed(false);
  }
  const wantsAnswers = attempted && (revealed || showAnswerKey);
  const answers = trpc.exercise.answers.useQuery(
    { exerciseId: exercise.id },
    { enabled: wantsAnswers },
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit.mutate({ exerciseId: exercise.id, answer });
  }

  const label = (
    <p className="text-xs uppercase tracking-wide text-white/50">
      {EXERCISE_LABELS[exercise.type]}
    </p>
  );

  const canCheck = answer.trim() !== '' && !submit.isPending;
  const gap =
    exercise.type === 'FILL_IN_THE_BLANK' ? GAP.exec(exercise.prompt) : null;

  const checkButton = (
    <button
      type="submit"
      disabled={!canCheck}
      className="shrink-0 rounded-lg bg-white/20 px-4 py-1.5 text-sm text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
    >
      {submit.isPending ? 'Checking…' : 'Check'}
    </button>
  );

  // Check sits at the end of a gap's sentence, and below an explanation,
  // whose field it would otherwise narrow; a short answer has its own
  const body = (
    <>
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
            <span className="ml-2">{checkButton}</span>
          </p>
        ) : exercise.type === 'FREE_FORM_EXPLANATION' ? (
          <>
            <p className="mt-1">{exercise.prompt}</p>
            <textarea
              aria-label="Your explanation"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={3}
              className={`mt-2 w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
            />
            <div className="mt-3">{checkButton}</div>
          </>
        ) : (
          <>
            <p className="mt-1">{exercise.prompt}</p>
            <div className="relative mt-2 flex items-start gap-2">
              {/* One line that grows taller as a long answer wraps, rather
                  than scrolling it sideways on a narrow screen. Still one
                  line of text: Enter checks it and a pasted line break is a
                  space */}
              <textarea
                aria-label="Your answer"
                rows={1}
                value={answer}
                onChange={(e) => setAnswer(e.target.value.replace(/\n/g, ' '))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (canCheck) e.currentTarget.form?.requestSubmit();
                }}
                enterKeyHint="go"
                className={`field-sizing-content min-w-0 flex-1 resize-none rounded-lg border px-2.5 py-1 text-base outline-none max-sm:pr-9 md:text-sm ${glassInputClassName}`}
              />
              {/* On phones, a return arrow in the field's corner, so the
                  answer has the width; from sm, the Check button beside it */}
              <button
                type="submit"
                disabled={!canCheck}
                className="touch-target rounded-lg text-sm text-white disabled:opacity-50 max-sm:absolute max-sm:right-1.5 max-sm:bottom-1 max-sm:p-1 max-sm:text-white/70 sm:shrink-0 sm:bg-white/20 sm:px-4 sm:py-1.5 sm:backdrop-blur-sm sm:hover:bg-white/30"
              >
                <CornerDownLeft className="size-5 sm:hidden" aria-hidden />
                <span className="max-sm:sr-only">
                  {submit.isPending ? 'Checking…' : 'Check'}
                </span>
              </button>
            </div>
          </>
        )}
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
      {/* Fetched answers stay cached, so they show only while wanted */}
      {wantsAnswers && answers.data ? (
        <div className="mt-3 text-sm text-white/70">
          <Answers type={exercise.type} answers={answers.data} />
        </div>
      ) : wantsAnswers && answers.isError ? (
        <p className="mt-3 text-sm text-destructive">
          We couldn&apos;t load the answers. Please try again later.
        </p>
      ) : showAnswerKey && !attempted ? (
        <p className="mt-3 text-sm text-white/50">
          Answer this exercise to see its answers.
        </p>
      ) : (
        attempted && (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            disabled={revealed || showAnswerKey}
            className="mt-3 text-sm text-white/60 underline underline-offset-2 hover:text-white disabled:opacity-50"
          >
            {revealed || showAnswerKey ? 'Loading answers…' : 'Show answers'}
          </button>
        )
      )}
    </>
  );

  const id = exerciseElementId(exercise.id);
  if (view === 'one') {
    return (
      <li id={id} className="scroll-mt-28 rounded-2xl bg-white/5 p-5">
        <div className="flex items-baseline justify-between gap-3">
          {label}
          <ItemCount noun="Exercise" index={index} count={count} />
        </div>
        {body}
      </li>
    );
  }
  // How the answer shown went, so editing it, like hiding answers, leaves
  // it unchecked
  const outcome = !result
    ? 'unchecked'
    : result.evaluation === 'CORRECT'
      ? 'correct'
      : 'missed';
  return (
    <li
      id={id}
      data-result={outcome}
      className="grid scroll-mt-28 grid-cols-[2rem_minmax(0,1fr)] py-5 first:pt-0 last:pb-0"
    >
      <span className="pt-1 text-white/50 tabular-nums">{index + 1}</span>
      <div
        className={`border-l-4 py-1 pl-4 ${result ? VERDICTS[result.evaluation].rule : 'border-white/20'}`}
      >
        {label}
        {body}
      </div>
    </li>
  );
}
