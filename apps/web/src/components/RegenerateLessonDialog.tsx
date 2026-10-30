import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { glassDialogClassName, glassInputClassName } from '@/lib/utils';
import { MAX_FEEDBACK_LENGTH } from '@/lib/feedback';

/** Errors whose own message says what happened, rather than a fault. */
const EXPLAINED = [
  'TOO_MANY_REQUESTS',
  'FORBIDDEN',
  'CONFLICT',
  'PRECONDITION_FAILED',
];

/**
 * Regenerates a written lesson, with the learner's optional feedback, such as
 * "too easy" or "more examples". The new version replaces this one on the
 * page; answers and tutor threads stay with the version they were made on
 * (ADR-0003). Opened from the lesson's ⋯ menu.
 */
export function RegenerateLessonDialog({
  lesson,
  open,
  onOpenChange,
  onRegenerated,
}: {
  lesson: { id: string; course: { id: string } };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the new version shows, to start it from the top. */
  onRegenerated: () => void;
}) {
  const utils = trpc.useUtils();
  const [feedback, setFeedback] = useState('');

  const regenerate = trpc.lesson.regenerate.useMutation({
    onSuccess: (view) => {
      utils.lesson.getById.setData({ id: lesson.id }, view);
      // The new version starts with no tutor thread of its own
      utils.tutor.thread.invalidate({ lessonId: lesson.id });
      utils.course.getById.invalidate({ id: lesson.course.id });
      setFeedback('');
      onOpenChange(false);
      onRegenerated();
    },
  });

  function handleOpenChange(isOpen: boolean) {
    // A regeneration under way finishes first
    if (regenerate.isPending) return;
    if (!isOpen) regenerate.reset();
    onOpenChange(isOpen);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = feedback.trim();
    regenerate.mutate(
      text ? { id: lesson.id, feedback: text } : { id: lesson.id },
    );
  }

  const code = regenerate.error?.data?.code;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`sm:max-w-lg ${glassDialogClassName}`}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Regenerate lesson</DialogTitle>
          <DialogDescription className="text-white/70">
            The lesson is written again, and the new version replaces this one
            here. Your answers and tutor threads stay with this version.
          </DialogDescription>
        </DialogHeader>
        <form id="regenerate-lesson" onSubmit={handleSubmit}>
          <label
            htmlFor="regenerate-feedback"
            className="text-sm font-medium text-white/80"
          >
            What should change? (optional)
          </label>
          <textarea
            id="regenerate-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={MAX_FEEDBACK_LENGTH}
            rows={3}
            placeholder="Too easy, more examples…"
            disabled={regenerate.isPending}
            className={`mt-1 w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
          />
          {regenerate.error && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {/* AI paused or not allowed, or the lesson already being
                  written: say so, rather than suggest a fault */}
              {code && EXPLAINED.includes(code)
                ? regenerate.error.message
                : "Couldn't regenerate the lesson. It's still as it was; try again."}
            </p>
          )}
        </form>
        <DialogFooter className="border-white/20 bg-white/5">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={regenerate.isPending}
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="regenerate-lesson"
            disabled={regenerate.isPending}
            className="bg-white/20 text-white hover:bg-white/30"
          >
            {regenerate.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {regenerate.isPending ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
