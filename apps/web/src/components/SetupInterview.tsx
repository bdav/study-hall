import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { ChoiceChips } from '@/components/ChoiceChips';
import { glassFieldClassName } from '@/lib/utils';
import type { DraftSetup } from '@/components/CourseSetupForm';

/** The interview so far, as the page holds it and sends it each round. */
type Interview = inferRouterInputs<AppRouter>['course']['interviewRound'];

/**
 * The interview as course creation keeps it, with the model and prompt
 * version that asked its latest round.
 */
export type Transcript = NonNullable<
  inferRouterInputs<AppRouter>['course']['create']['interview']
>;

type AnsweredRound = Interview['rounds'][number];
type Round = inferRouterOutputs<AppRouter>['course']['interviewRound'];
type Question = Round['questions'][number];

/** The most rounds of questions, whatever the model returns. */
const MAX_ROUNDS = 3;

const textAreaClassName = `mt-1 w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassFieldClassName}`;

const primaryButtonClassName =
  'rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50';

const secondaryButtonClassName =
  'rounded-lg px-4 py-2 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50';

/**
 * A Setup Interview: the learner says what they want to learn and why, then
 * answers up to three rounds of questions, each with its suggested answer
 * already chosen, and the Course Setup it drafts goes to the course form.
 * It only moves forward: a wrong answer is corrected on the form.
 */
export function SetupInterview({
  onDone,
  onSkip,
}: {
  /** The latest draft, and the interview that drafted it. */
  onDone: (draft: DraftSetup, transcript: Transcript) => void;
  onSkip: () => void;
}) {
  const [opening, setOpening] = useState('');
  const [rounds, setRounds] = useState<AnsweredRound[]>([]);
  const [current, setCurrent] = useState<Round | null>(null);
  const interviewRound = trpc.course.interviewRound.useMutation();
  const isAsking = interviewRound.isPending;

  /**
   * Asks for the round after these. The answered round joins the others
   * only once the next arrives, so a failed call leaves it on screen as the
   * learner answered it.
   */
  function ask(answered: AnsweredRound[]) {
    const interview = { opening: opening.trim(), rounds: answered };
    interviewRound.mutate(interview, {
      onSuccess: (round) => {
        if (round.ready || answered.length >= MAX_ROUNDS) {
          onDone(round.draft, { ...interview, ...askedBy(round) });
          return;
        }
        setRounds(answered);
        setCurrent(round);
      },
    });
  }

  function handleStart(e: FormEvent) {
    e.preventDefault();
    if (opening.trim()) ask([]);
  }

  const status = isAsking && (
    <p
      role="status"
      className="mt-4 flex items-center gap-2 text-sm text-white/70"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Thinking about what to ask…
    </p>
  );
  const failure = interviewRound.error && (
    <p role="alert" className="mt-4 text-sm text-red-400">
      {interviewRound.error.message}
    </p>
  );

  if (!current) {
    return (
      <div className="w-full max-w-xl text-white">
        <h1 className="text-2xl font-bold">New Course</h1>
        <p className="mt-1 text-white/60">
          Tell us in your own words, and we&apos;ll ask a few questions to shape
          your course.
        </p>
        <form onSubmit={handleStart} className="mt-6">
          <label
            htmlFor="opening"
            className="block text-sm font-medium text-white/80"
          >
            What do you want to learn, and why?
          </label>
          <textarea
            id="opening"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            placeholder="Italian, because I'm going to Rome in June and want to get by"
            rows={4}
            maxLength={2000}
            required
            disabled={isAsking}
            className={textAreaClassName}
          />
          {status}
          {failure}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isAsking}
              className={primaryButtonClassName}
            >
              Start
            </button>
            <button
              type="button"
              onClick={onSkip}
              disabled={isAsking}
              className={secondaryButtonClassName}
            >
              Skip, I&apos;ll fill in the form
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl text-white">
      <h1 className="text-2xl font-bold">New Course</h1>
      <p className="mt-1 text-sm text-white/60">
        <span className="sr-only">You said: </span>
        &ldquo;{opening.trim()}&rdquo;
      </p>
      {rounds.length > 0 && (
        <ol aria-label="Your answers so far" className="mt-4 space-y-1">
          {rounds.map(({ answers }, index) => (
            <li key={index} className="text-sm text-white/70">
              <span className="sr-only">Round {index + 1}: </span>
              <span>
                {answers.filter(Boolean).join(' · ') || 'No answers given'}
              </span>
            </li>
          ))}
        </ol>
      )}
      <RoundForm
        // A new round starts from its own suggested answers
        key={rounds.length}
        questions={current.questions}
        disabled={isAsking}
        onNext={(answers) =>
          ask([...rounds, { questions: current.questions, answers }])
        }
        onShowBrief={() =>
          onDone(current.draft, {
            opening: opening.trim(),
            rounds,
            ...askedBy(current),
          })
        }
      >
        {status}
        {failure}
      </RoundForm>
    </div>
  );
}

/** The model and prompt version that asked a round, for the transcript. */
function askedBy({ model, promptVersion }: Round) {
  return { model, promptVersion };
}

/** A round's questions on one screen, each starting at its suggested answer. */
function RoundForm({
  questions,
  disabled,
  onNext,
  onShowBrief,
  children,
}: {
  questions: Question[];
  disabled: boolean;
  onNext: (answers: string[]) => void;
  onShowBrief: () => void;
  children: ReactNode;
}) {
  const [answers, setAnswers] = useState(() =>
    questions.map((question) => question.suggested),
  );

  function answer(index: number, value: string) {
    setAnswers((current) =>
      current.map((other, i) => (i === index ? value : other)),
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onNext(answers.map((value) => value.trim()));
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6">
      <fieldset disabled={disabled} className="space-y-5">
        {questions.map((question, index) => (
          <QuestionField
            key={index}
            question={question}
            value={answers[index]}
            onChange={(value) => answer(index, value)}
          />
        ))}
      </fieldset>
      {children}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={disabled}
          className={primaryButtonClassName}
        >
          Next
        </button>
        <button
          type="button"
          onClick={onShowBrief}
          disabled={disabled}
          className={secondaryButtonClassName}
        >
          Show my brief
        </button>
      </div>
    </form>
  );
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  if (question.type === 'SINGLE_CHOICE') {
    return (
      <ChoiceChips
        label={question.prompt}
        options={question.options.map((option) => ({
          value: option,
          label: option,
        }))}
        value={value}
        onChange={onChange}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-white/80">
        {question.prompt}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={1000}
        className={textAreaClassName}
      />
    </div>
  );
}
