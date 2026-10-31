import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { CheckChips, ChoiceChips } from '@/components/ChoiceChips';
import { Input } from '@/components/ui/input';
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
type Answer = AnsweredRound['answers'][number];
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
              <span>{summarize(answers)}</span>
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
      >
        {status}
        {failure}
      </RoundForm>
    </div>
  );
}

/** A round's answers on one line: "2 hours · Order food, Small talk". */
function summarize(answers: Answer[]): string {
  return (
    answers
      .map((answer) => (Array.isArray(answer) ? answer.join(', ') : answer))
      .filter(Boolean)
      .join(' · ') || 'No answers given'
  );
}

/** The model and prompt version that asked a round, for the transcript. */
function askedBy({ model, promptVersion }: Round) {
  return { model, promptVersion };
}

/** The choice that takes an answer of the learner's own in place of chips. */
const SOMETHING_ELSE = 'Something else…';

/**
 * A question's answer as the learner is giving it: the chips chosen or the
 * text, or, once they choose Something else, their own words.
 */
type AnswerState = { value: Answer; own: string | null };

function startingAnswer(question: Question): AnswerState {
  return {
    value: 'suggested' in question ? question.suggested : [],
    own: null,
  };
}

/** A choice question's options, less any of the page's own Something else. */
function offered(options: string[]): string[] {
  return options.filter((option) => option !== SOMETHING_ELSE);
}

/** The answer the round sends: their own words in place of any chips. */
function finalAnswer({ value, own }: AnswerState): Answer {
  if (own !== null) return own.trim();
  return typeof value === 'string' ? value.trim() : value;
}

/** A round's questions on one screen, each starting at its suggested answer. */
function RoundForm({
  questions,
  disabled,
  onNext,
  children,
}: {
  questions: Question[];
  disabled: boolean;
  onNext: (answers: Answer[]) => void;
  children: ReactNode;
}) {
  const [answers, setAnswers] = useState(() => questions.map(startingAnswer));

  function answer(index: number, state: AnswerState) {
    setAnswers((current) =>
      current.map((other, i) => (i === index ? state : other)),
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onNext(answers.map(finalAnswer));
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6">
      <fieldset disabled={disabled} className="space-y-5">
        {questions.map((question, index) => (
          <QuestionField
            key={index}
            question={question}
            answer={answers[index]}
            onChange={(state) => answer(index, state)}
          />
        ))}
      </fieldset>
      {children}
      <button
        type="submit"
        disabled={disabled}
        className={`mt-6 ${primaryButtonClassName}`}
      >
        Next
      </button>
    </form>
  );
}

/** The field for an answer of the learner's own, once they choose it. */
function OwnAnswer({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      aria-label="Your answer"
      placeholder="Your answer"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={1000}
      required
      // Spaces alone aren't an answer
      pattern=".*\S.*"
      className={`mt-2 ${glassFieldClassName}`}
    />
  );
}

function QuestionField({
  question,
  answer,
  onChange,
}: {
  question: Question;
  answer: AnswerState;
  onChange: (answer: AnswerState) => void;
}) {
  const id = useId();
  const { own } = answer;
  const ownAnswer = own !== null && (
    <OwnAnswer
      value={own}
      onChange={(text) => onChange({ ...answer, own: text })}
    />
  );
  const text = typeof answer.value === 'string' ? answer.value : '';
  const setText = (value: string) => onChange({ value, own: null });

  if (question.type === 'SINGLE_CHOICE') {
    return (
      <ChoiceChips
        label={question.prompt}
        options={[...offered(question.options), SOMETHING_ELSE].map(
          (option) => ({
            value: option,
            label: option,
          }),
        )}
        value={own !== null ? SOMETHING_ELSE : text}
        onChange={(chosen) =>
          chosen === SOMETHING_ELSE
            ? onChange({ ...answer, own: own ?? '' })
            : setText(chosen)
        }
      >
        {ownAnswer}
      </ChoiceChips>
    );
  }

  if (question.type === 'MULTIPLE_CHOICE') {
    const chips = Array.isArray(answer.value) ? answer.value : [];
    return (
      <CheckChips
        label={question.prompt}
        options={[...offered(question.options), SOMETHING_ELSE]}
        chosen={own !== null ? [SOMETHING_ELSE] : chips}
        onChange={(chosen) =>
          // Something else clears the chips, and choosing a chip clears it
          own === null && chosen.includes(SOMETHING_ELSE)
            ? onChange({ value: [], own: '' })
            : onChange({
                value: chosen.filter((option) => option !== SOMETHING_ELSE),
                own: null,
              })
        }
      >
        {ownAnswer}
      </CheckChips>
    );
  }

  if (question.type === 'PLACEMENT') {
    return (
      <CheckChips
        label={question.prompt}
        options={question.options}
        chosen={Array.isArray(answer.value) ? answer.value : []}
        onChange={(ticked) => onChange({ value: ticked, own: null })}
      >
        <p className="mt-1 text-xs text-white/50">
          Tick only what you can do now; the course leaves these out.
        </p>
      </CheckChips>
    );
  }

  if (question.type === 'DATE') {
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-white/80">
          {question.prompt}
        </label>
        <Input
          id={id}
          type="date"
          // Today, where the learner is; blank when there's no date
          min={new Date().toLocaleDateString('en-CA')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`mt-1 max-w-48 [color-scheme:dark] ${glassFieldClassName}`}
        />
        <p className="mt-1 text-xs text-white/50">
          Leave it blank if there isn&apos;t one.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-white/80">
        {question.prompt}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={1000}
        className={textAreaClassName}
      />
    </div>
  );
}
