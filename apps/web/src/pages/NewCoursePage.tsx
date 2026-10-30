import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import { CenteredPage } from '@/components/CenteredPage';
import { WritingLoader } from '@/components/WritingLoader';
import { ChoiceChips } from '@/components/ChoiceChips';

const glassInputClassName =
  'mt-1 border-white/20 bg-white/10 text-white placeholder-white/40 focus-visible:border-white/40 focus-visible:ring-white/20';

const DEPTHS = ['Light overview', 'Balanced', 'In depth'];

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
  goal: '',
  priorKnowledge: '',
  depth: 'Balanced',
  notes: '',
};

type TextField = keyof typeof emptyForm;

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-white/80">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Shown instead of the form when AI can't be used, pointing to flashcards. */
function AiUnavailableNotice({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <CenteredPage centered>
      <div className="max-w-md text-center text-white">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-white/70">{children}</p>
        <p className="mt-4 text-white/70">
          Standalone{' '}
          <Link to="/flashcards" className="underline hover:text-white">
            flashcards
          </Link>{' '}
          are fully available.
        </p>
      </div>
    </CenteredPage>
  );
}

export default function NewCoursePage() {
  const [form, setForm] = useState(emptyForm);
  const [weeklyTime, setWeeklyTime] = useState<WeeklyTime | null>(null);
  const [customHours, setCustomHours] = useState('');
  const [sessionMinutes, setSessionMinutes] = useState<number | null>(null);
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();

  const createCourse = trpc.course.create.useMutation({
    onSuccess: (data) => {
      utils.course.list.invalidate();
      navigate(`/courses/${data.id}`);
    },
  });

  if (me.data?.user && !me.data.user.canUseAI) {
    return (
      <AiUnavailableNotice title="Courses need AI access">
        Your account doesn&apos;t have access to AI features yet, and courses
        use them to build your syllabus and lessons.
      </AiUnavailableNotice>
    );
  }

  // The monthly AI spending cap was reached: AI is paused, not broken
  if (createCourse.error?.data?.code === 'TOO_MANY_REQUESTS') {
    return (
      <AiUnavailableNotice title="AI features are paused">
        {createCourse.error.message}
      </AiUnavailableNotice>
    );
  }

  function update(field: TextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // The browser holds off submitting until both are chosen
    if (weeklyTime === null || sessionMinutes === null) return;
    createCourse.mutate({
      ...form,
      minutesPerWeek:
        weeklyTime === CUSTOM
          ? Math.round(Number(customHours) * 60)
          : weeklyTime,
      sessionMinutes,
    });
  }

  // The form stays as typed underneath, should generating fail
  if (createCourse.isPending) {
    return (
      <CenteredPage centered>
        <WritingLoader
          label="Writing your syllabus"
          title="Writing your syllabus proposal"
          detail="This takes about a minute. You can shape it before you start."
        />
      </CenteredPage>
    );
  }

  return (
    <CenteredPage>
      <div className="w-full max-w-xl text-white">
        <h1 className="text-2xl font-bold">New Course</h1>
        <p className="mt-1 text-white/60">
          Tell us what you want to learn, and we&apos;ll propose a syllabus you
          can review before starting.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <fieldset className="space-y-4">
            <Field id="topic" label="Topic">
              <Input
                id="topic"
                value={form.topic}
                onChange={(e) => update('topic', e.target.value)}
                placeholder="Italian"
                className={glassInputClassName}
                required
              />
            </Field>
            <Field id="goal" label="Goal or target level">
              <Input
                id="goal"
                value={form.goal}
                onChange={(e) => update('goal', e.target.value)}
                placeholder="Reach A2 before my trip in June"
                className={glassInputClassName}
                required
              />
            </Field>
            <Field id="priorKnowledge" label="Prior knowledge">
              <Input
                id="priorKnowledge"
                value={form.priorKnowledge}
                onChange={(e) => update('priorKnowledge', e.target.value)}
                placeholder="A few months of Duolingo"
                className={glassInputClassName}
              />
            </Field>
            <ChoiceChips
              label="Time per week"
              options={[...WEEKLY_TIMES]}
              value={weeklyTime}
              onChange={setWeeklyTime}
              required
            />
            {weeklyTime === CUSTOM && (
              <Field id="customHours" label="Hours per week">
                <Input
                  id="customHours"
                  type="number"
                  inputMode="decimal"
                  min={0.25}
                  max={168}
                  step="any"
                  value={customHours}
                  onChange={(e) => setCustomHours(e.target.value)}
                  placeholder="4"
                  className={`max-w-32 ${glassInputClassName}`}
                  required
                />
              </Field>
            )}
            <ChoiceChips
              label="Session length"
              options={SESSION_LENGTHS}
              value={sessionMinutes}
              onChange={setSessionMinutes}
              required
            />
            <Field id="depth" label="Preferred depth">
              <select
                id="depth"
                value={form.depth}
                onChange={(e) => update('depth', e.target.value)}
                className={`h-8 w-full rounded-lg border px-2.5 text-base outline-none md:text-sm ${glassInputClassName}`}
              >
                {DEPTHS.map((depth) => (
                  <option key={depth} value={depth} className="text-black">
                    {depth}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="notes" label="Notes">
              <textarea
                id="notes"
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                placeholder="Anything else: what you'll use it for, what to focus on or skip"
                rows={3}
                className={`w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
              />
            </Field>
          </fieldset>

          {createCourse.error && (
            <p role="alert" className="text-sm text-red-400">
              {createCourse.error.message}
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-lg bg-white/20 py-2 text-white backdrop-blur-sm hover:bg-white/30"
          >
            Generate syllabus
          </button>
        </form>
      </div>
    </CenteredPage>
  );
}
