import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import { CenteredPage } from '@/components/CenteredPage';

const glassInputClassName =
  'mt-1 border-white/20 bg-white/10 text-white placeholder-white/40 focus-visible:border-white/40 focus-visible:ring-white/20';

const DEPTHS = ['Light overview', 'Balanced', 'In depth'];

const emptyForm = {
  topic: '',
  goal: '',
  priorKnowledge: '',
  timePerWeek: '',
  depth: 'Balanced',
  notes: '',
};

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

export default function NewCoursePage() {
  const [form, setForm] = useState(emptyForm);
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
      <CenteredPage centered>
        <div className="max-w-md text-center text-white">
          <h1 className="text-2xl font-bold">Courses need AI access</h1>
          <p className="mt-2 text-white/70">
            Your account doesn&apos;t have access to AI features yet, and
            courses use them to build your syllabus and lessons.
          </p>
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

  function update(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createCourse.mutate(form);
  }

  const isGenerating = createCourse.isPending;

  return (
    <CenteredPage>
      <div className="w-full max-w-xl text-white">
        <h1 className="text-2xl font-bold">New Course</h1>
        <p className="mt-1 text-white/60">
          Tell us what you want to learn, and we&apos;ll propose a syllabus you
          can review before starting.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <fieldset disabled={isGenerating} className="space-y-4">
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="timePerWeek" label="Time per week">
                <Input
                  id="timePerWeek"
                  value={form.timePerWeek}
                  onChange={(e) => update('timePerWeek', e.target.value)}
                  placeholder="3 hours"
                  className={glassInputClassName}
                  required
                />
              </Field>
              <Field id="depth" label="Preferred depth">
                <select
                  id="depth"
                  value={form.depth}
                  onChange={(e) => update('depth', e.target.value)}
                  className={`h-8 w-full rounded-lg border px-2.5 text-sm outline-none ${glassInputClassName}`}
                >
                  {DEPTHS.map((depth) => (
                    <option key={depth} value={depth} className="text-black">
                      {depth}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field id="notes" label="Notes">
              <textarea
                id="notes"
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                placeholder="Anything else: what you'll use it for, what to focus on or skip"
                rows={3}
                className={`w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none ${glassInputClassName}`}
              />
            </Field>
          </fieldset>

          {createCourse.error && !isGenerating && (
            <p role="alert" className="text-sm text-red-400">
              {createCourse.error.message}
            </p>
          )}

          {isGenerating && (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-white/80"
            >
              <Loader2 className="size-4 animate-spin" />
              Generating your syllabus. This can take a minute…
            </p>
          )}

          <button
            type="submit"
            disabled={isGenerating}
            className="w-full rounded-lg bg-white/20 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
          >
            {isGenerating ? 'Generating…' : 'Generate syllabus'}
          </button>
        </form>
      </div>
    </CenteredPage>
  );
}
