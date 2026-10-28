import { type ReactNode } from 'react';
import { Circle, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { trpc } from '@/lib/trpc';
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';

type Lesson = inferRouterOutputs<AppRouter>['lesson']['getById'];

/** Sets or undoes Lesson Completion, refreshing what shows it. */
function useSetCompleted(lesson: Lesson) {
  const utils = trpc.useUtils();
  return trpc.lesson.setCompleted.useMutation({
    onSuccess: () => {
      utils.lesson.getById.invalidate({ id: lesson.id });
      // The syllabus shows the lesson's status and where to continue
      utils.course.getById.invalidate({ id: lesson.course.id });
    },
    onError: () => {
      toast.error("Couldn't save the lesson's completion");
    },
  });
}

/**
 * Lesson Completion as a compact toggle, for the header from sm; on
 * narrower screens it's in the ⋯ menu instead (`CompletionMenuItem`).
 */
export function CompletionToggle({ lesson }: { lesson: Lesson }) {
  const setCompleted = useSetCompleted(lesson);
  const complete = lesson.completedAt !== null;
  const Icon = complete ? CircleCheck : Circle;

  return (
    <button
      type="button"
      aria-pressed={complete}
      onClick={() =>
        setCompleted.mutate({ id: lesson.id, completed: !complete })
      }
      disabled={setCompleted.isPending}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm disabled:opacity-60 max-sm:hidden ${
        complete
          ? 'bg-white/20 text-white'
          : 'text-white/70 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon className="size-4" />
      Mark complete
    </button>
  );
}

/** Lesson Completion as a checkbox in the header's ⋯ menu. */
export function CompletionMenuItem({
  lesson,
  className,
}: {
  lesson: Lesson;
  className?: string;
}) {
  const setCompleted = useSetCompleted(lesson);
  const complete = lesson.completedAt !== null;

  return (
    <DropdownMenuCheckboxItem
      checked={complete}
      onCheckedChange={(checked) =>
        setCompleted.mutate({ id: lesson.id, completed: checked })
      }
      disabled={setCompleted.isPending}
      className={className}
    >
      Mark complete
    </DropdownMenuCheckboxItem>
  );
}

/**
 * Lesson Completion: the learner's own mark that they're done with the
 * lesson, set and undone in any order. It records where they are in the
 * syllabus, never how well they know the material, so it's only ever
 * suggested, never set for them.
 */
export function LessonCompletion({
  lesson,
  suggestion,
}: {
  lesson: Lesson;
  /** Shown while the lesson isn't complete, such as why now's the time. */
  suggestion?: ReactNode;
}) {
  const setCompleted = useSetCompleted(lesson);
  const complete = lesson.completedAt !== null;

  return (
    <section className="mt-8 flex flex-wrap items-center gap-3 border-t border-white/20 pt-6">
      {complete ? (
        <p className="text-white/80">You marked this lesson complete.</p>
      ) : (
        suggestion && <p className="w-full text-white/80">{suggestion}</p>
      )}
      <button
        type="button"
        onClick={() =>
          setCompleted.mutate({ id: lesson.id, completed: !complete })
        }
        disabled={setCompleted.isPending}
        className={
          complete
            ? 'rounded-lg px-3 py-2 text-sm text-white/60 hover:text-white disabled:opacity-60'
            : 'rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-60'
        }
      >
        {complete ? 'Mark as not complete' : 'Mark complete'}
      </button>
    </section>
  );
}
