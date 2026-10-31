import { useState, type FormEvent, type ReactNode } from 'react';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { Input } from '@/components/ui/input';
import { ChoiceChips } from '@/components/ChoiceChips';
import { FieldError } from '@/components/FieldError';
import { ChipListField } from '@/components/ChipListField';
import { withTyped } from '@/lib/lists';
import { cn, glassFieldClassName } from '@/lib/utils';

/** The Course Setup as a Setup Interview drafted it, for checking here. */
export type DraftSetup =
  inferRouterOutputs<AppRouter>['course']['interviewRound']['draft'];

/** A confirmed Course Setup, as course creation takes it. */
export type CourseSetup = Omit<
  inferRouterInputs<AppRouter>['course']['create'],
  'interview'
>;

const glassInputClassName = `mt-1 ${glassFieldClassName}`;

const DEPTHS = ['Light overview', 'Balanced', 'In depth'].map((depth) => ({
  value: depth,
  label: depth,
}));

const CUSTOM = 'custom';

/** Time per week in minutes, or a custom amount the learner types in hours. */
const WEEKLY_TIMES = [
  { value: 60, label: '1h' },
  { value: 120, label: '2h' },
  { value: 180, label: '3h' },
  { value: 300, label: '5h' },
  { value: 420, label: '7h+' },
  { value: CUSTOM, label: 'Custom' },
] as const;

const SESSION_LENGTHS = [15, 30, 45, 60, 90].map((minutes) => ({
  value: minutes,
  label: `${minutes} min`,
}));

type WeeklyTime = (typeof WEEKLY_TIMES)[number]['value'];

const emptyForm = {
  topic: '',
  title: '',
  goal: '',
  priorKnowledge: '',
  deadline: '',
  depth: 'Balanced',
  focus: '',
  skip: '',
  materials: '',
  notes: '',
};

type TextField = keyof typeof emptyForm;

/** The form's text fields as the draft fills them, or empty. */
function initialForm(draft: DraftSetup | null): typeof emptyForm {
  if (!draft) return emptyForm;
  return {
    topic: draft.topic,
    title: draft.title,
    goal: draft.goal,
    priorKnowledge: draft.priorKnowledge,
    deadline: draft.deadline ?? '',
    depth: draft.depth,
    focus: draft.focus,
    skip: draft.skip,
    materials: draft.materials,
    notes: draft.notes,
  };
}

/**
 * The draft's time per week as a chip, or as a custom amount in hours when
 * no chip has it.
 */
function initialWeeklyTime(minutes: number | null | undefined): {
  weeklyTime: WeeklyTime | null;
  customHours: string;
} {
  if (minutes == null) return { weeklyTime: null, customHours: '' };
  const chip = WEEKLY_TIMES.find((time) => time.value === minutes);
  return chip
    ? { weeklyTime: chip.value, customHours: '' }
    : { weeklyTime: CUSTOM, customHours: String(+(minutes / 60).toFixed(2)) };
}

/**
 * The fields that can hold the course back: the ones it can't be written
 * without, and a deadline already past.
 */
type CheckedField =
  | 'topic'
  | 'goal'
  | 'weeklyTime'
  | 'customHours'
  | 'sessionMinutes'
  | 'deadline';

/** What each field says beside it while it holds the course back. */
const PROBLEM_MESSAGES: Record<CheckedField, string> = {
  topic: 'Add a topic: what the course is about.',
  goal: 'Add a goal: what you want to reach.',
  weeklyTime: 'Choose your time per week.',
  customHours: 'Enter your hours per week, from a quarter of an hour to 168.',
  sessionMinutes: 'Choose a session length.',
  deadline: 'Choose a deadline from today on, or leave it blank.',
};

/** Custom hours per week, as the field allows them. */
const MIN_CUSTOM_HOURS = 0.25;
const MAX_CUSTOM_HOURS = 168;

/** A field's own message ids, for its `aria-describedby`. */
const hintId = (field: string) => `${field}-hint`;
const errorId = (field: string) => `${field}-error`;

/** Shown beside an optional field's label, outside its name. */
function OptionalTag() {
  return <span className="text-xs text-white/45">Optional</span>;
}

function Field({
  id,
  label,
  hint,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <label htmlFor={id} className="text-sm font-medium text-white/80">
          {label}
        </label>
        {optional && <OptionalTag />}
      </div>
      {hint && (
        <p id={hintId(id)} className="text-xs text-white/55">
          {hint}
        </p>
      )}
      {children}
      {error && <FieldError id={errorId(id)}>{error}</FieldError>}
    </div>
  );
}

/** A group of the form's fields under a heading. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="border-b border-white/15 pb-1 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * The Course Setup, checked and corrected before the syllabus is written:
 * filled in from a Setup Interview's draft, or empty when the learner
 * skipped it. Each field says how the course uses it, and one holding the
 * course back, a required field missing or a deadline already past, says
 * so beside it: on a draft at once, and on an empty form once the learner
 * tries to go on.
 */
export function CourseSetupForm({
  draft,
  onSubmit,
  error,
}: {
  draft: DraftSetup | null;
  onSubmit: (setup: CourseSetup) => void;
  error: string | null;
}) {
  const [form, setForm] = useState(() => initialForm(draft));
  const [{ weeklyTime, customHours }, setWeekly] = useState(() =>
    initialWeeklyTime(draft?.minutesPerWeek),
  );
  const [sessionMinutes, setSessionMinutes] = useState<number | null>(
    draft?.sessionMinutes ?? null,
  );
  const [canAlreadyDo, setCanAlreadyDo] = useState<string[]>(
    draft?.canAlreadyDo ?? [],
  );
  const [canAlreadyDoText, setCanAlreadyDoText] = useState('');
  const [triedToGoOn, setTriedToGoOn] = useState(false);

  const hours = Number(customHours);
  // Today, where the learner is, as the date field gives dates
  const today = new Date().toLocaleDateString('en-CA');
  const problems = (
    [
      !form.topic.trim() && 'topic',
      !form.goal.trim() && 'goal',
      weeklyTime === null && 'weeklyTime',
      weeklyTime === CUSTOM &&
        !(
          customHours.trim() &&
          hours >= MIN_CUSTOM_HOURS &&
          hours <= MAX_CUSTOM_HOURS
        ) &&
        'customHours',
      sessionMinutes === null && 'sessionMinutes',
      form.deadline !== '' && form.deadline < today && 'deadline',
    ] as const
  ).filter((field): field is CheckedField => Boolean(field));
  const showProblems = triedToGoOn || draft !== null;

  /** The message beside a field while it holds the course back. */
  function problemMessage(field: CheckedField) {
    return showProblems && problems.includes(field)
      ? PROBLEM_MESSAGES[field]
      : null;
  }

  /** A field's `aria-describedby`: its message, then its hint. */
  function describedBy(field: string) {
    const hasProblem = showProblems && problems.includes(field as CheckedField);
    return [hasProblem && errorId(field), hintId(field)]
      .filter(Boolean)
      .join(' ');
  }

  function update(field: TextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (problems.length > 0) {
      setTriedToGoOn(true);
      // The first field holding it back, or the first of its chips
      document
        .querySelector<HTMLElement>(
          `#${problems[0]}, #${problems[0]}-chips input`,
        )
        ?.focus();
      return;
    }
    // Never null here, since neither is missing; this tells TypeScript
    if (weeklyTime === null || sessionMinutes === null) return;
    onSubmit({
      ...form,
      deadline: form.deadline || null,
      minutesPerWeek:
        weeklyTime === CUSTOM ? Math.round(hours * 60) : weeklyTime,
      sessionMinutes,
      // Typed but not added is meant to be in the list
      canAlreadyDo: withTyped(canAlreadyDo, canAlreadyDoText),
    });
  }

  return (
    <div className="w-full max-w-xl text-white">
      {draft ? (
        <>
          <h1 className="text-2xl font-bold">Check your course</h1>
          <p className="mt-1 text-white/60">
            We drafted this from your answers. Correct anything that&apos;s off,
            then we&apos;ll propose a syllabus you can shape before starting.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">New Course</h1>
          <p className="mt-1 text-white/60">
            Tell us what you want to learn. The topic, your goal and your time
            are all we need; the rest shapes the syllabus we&apos;ll propose,
            which you can review before starting.
          </p>
        </>
      )}

      {/* The form names a missing field beside it, not in a browser bubble */}
      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-8">
        <Section title="What you're learning">
          <Field
            id="topic"
            label="Topic"
            hint="What the course is about, such as Italian or the history of China."
            error={problemMessage('topic')}
          >
            <Input
              id="topic"
              value={form.topic}
              onChange={(e) => update('topic', e.target.value)}
              placeholder="Italian"
              aria-describedby={describedBy('topic')}
              aria-invalid={Boolean(problemMessage('topic'))}
              className={glassInputClassName}
              required
            />
          </Field>
          <Field
            id="title"
            label="Course title"
            hint="How the course is listed. Left blank, it's the topic."
            optional
          >
            <Input
              id="title"
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
              maxLength={200}
              placeholder={form.topic || 'Italian for a trip to Rome'}
              aria-describedby={describedBy('title')}
              className={glassInputClassName}
            />
          </Field>
          <Field
            id="goal"
            label="Goal or target level"
            hint="What you want to be able to do, or the level to reach. The syllabus works toward it."
            error={problemMessage('goal')}
          >
            <Input
              id="goal"
              value={form.goal}
              onChange={(e) => update('goal', e.target.value)}
              placeholder="Reach A2 before my trip in June"
              aria-describedby={describedBy('goal')}
              aria-invalid={Boolean(problemMessage('goal'))}
              className={glassInputClassName}
              required
            />
          </Field>
        </Section>

        <Section title="Where you're starting">
          <Field
            id="priorKnowledge"
            label="Prior knowledge"
            hint="What you've learned before, in your own words, so lessons start in the right place."
            optional
          >
            <Input
              id="priorKnowledge"
              value={form.priorKnowledge}
              onChange={(e) => update('priorKnowledge', e.target.value)}
              placeholder="A few months of Duolingo"
              aria-describedby={describedBy('priorKnowledge')}
              className={glassInputClassName}
            />
          </Field>
          <ChipListField
            label="Can already do"
            labelAside={<OptionalTag />}
            hint="Specific things you can already do. The syllabus leaves these out."
            inputLabel="Something you can already do"
            placeholder="Order a coffee"
            items={canAlreadyDo}
            onChange={setCanAlreadyDo}
            text={canAlreadyDoText}
            onTextChange={setCanAlreadyDoText}
            maxLength={200}
            inputClassName={cn(glassInputClassName, 'mt-0')}
          />
        </Section>

        <Section title="Your time">
          <div id="weeklyTime-chips">
            <ChoiceChips
              label="Time per week"
              hint="With session length, this sets how many weeks the course takes."
              error={problemMessage('weeklyTime')}
              options={[...WEEKLY_TIMES]}
              value={weeklyTime}
              onChange={(value) =>
                setWeekly((current) => ({ ...current, weeklyTime: value }))
              }
              required
            />
          </div>
          {weeklyTime === CUSTOM && (
            <Field
              id="customHours"
              label="Hours per week"
              hint="How many hours a week, such as 4 or 1.5."
              error={problemMessage('customHours')}
            >
              <Input
                id="customHours"
                type="number"
                inputMode="decimal"
                min={MIN_CUSTOM_HOURS}
                max={MAX_CUSTOM_HOURS}
                step="any"
                value={customHours}
                onChange={(e) =>
                  setWeekly((current) => ({
                    ...current,
                    customHours: e.target.value,
                  }))
                }
                placeholder="4"
                aria-describedby={describedBy('customHours')}
                aria-invalid={Boolean(problemMessage('customHours'))}
                className={`max-w-32 ${glassInputClassName}`}
                required
              />
            </Field>
          )}
          <div id="sessionMinutes-chips">
            <ChoiceChips
              label="Session length"
              hint="Each lesson fits one session."
              error={problemMessage('sessionMinutes')}
              options={SESSION_LENGTHS}
              value={sessionMinutes}
              onChange={setSessionMinutes}
              required
            />
          </div>
          <Field
            id="deadline"
            label="Deadline"
            hint="The syllabus is sized to fit the time until it."
            optional
            error={problemMessage('deadline')}
          >
            <Input
              id="deadline"
              type="date"
              min={today}
              value={form.deadline}
              onChange={(e) => update('deadline', e.target.value)}
              aria-describedby={describedBy('deadline')}
              aria-invalid={Boolean(problemMessage('deadline'))}
              className={`max-w-48 [color-scheme:dark] ${glassInputClassName}`}
            />
          </Field>
        </Section>

        <Section title="Shaping the course">
          <ChoiceChips
            label="Preferred depth"
            hint="How far each lesson goes into its subject."
            options={DEPTHS}
            value={form.depth}
            onChange={(depth) => update('depth', depth)}
          />
          <Field
            id="focus"
            label="Focus on"
            hint="What the syllabus weights most."
            optional
          >
            <Input
              id="focus"
              value={form.focus}
              onChange={(e) => update('focus', e.target.value)}
              placeholder="Speaking and listening"
              aria-describedby={describedBy('focus')}
              className={glassInputClassName}
            />
          </Field>
          <Field
            id="skip"
            label="Skip"
            hint="What the syllabus leaves out."
            optional
          >
            <Input
              id="skip"
              value={form.skip}
              onChange={(e) => update('skip', e.target.value)}
              placeholder="Formal writing"
              aria-describedby={describedBy('skip')}
              className={glassInputClassName}
            />
          </Field>
          <Field
            id="materials"
            label="Materials"
            hint="A textbook or course you're following. Lessons follow its order and coverage."
            optional
          >
            <Input
              id="materials"
              value={form.materials}
              onChange={(e) => update('materials', e.target.value)}
              placeholder="Nuovo Espresso 1"
              aria-describedby={describedBy('materials')}
              className={glassInputClassName}
            />
          </Field>
          <Field
            id="notes"
            label="Notes"
            hint="Anything else the syllabus, lessons and tutor should know."
            optional
          >
            <textarea
              id="notes"
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="What you'll use it for, or how you like to learn"
              rows={3}
              aria-describedby={describedBy('notes')}
              className={`w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
            />
          </Field>
        </Section>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="w-full rounded-lg bg-white/20 py-2 text-white backdrop-blur-sm hover:bg-white/30"
        >
          {draft ? 'Looks right' : 'Generate syllabus'}
        </button>
      </form>
    </div>
  );
}
