import { useState, type FormEvent } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { inferRouterInputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
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

type Chip = NonNullable<
  inferRouterInputs<AppRouter>['lesson']['regenerate']['chips']
>[number];

/**
 * The chips, in the order shown, by their labels. A pair asks for opposite
 * things, so choosing one deselects the other; the API checks it too.
 */
const CHIP_GROUPS: { chip: Chip; label: string }[][] = [
  [
    { chip: 'TOO_EASY', label: 'Too easy' },
    { chip: 'TOO_HARD', label: 'Too hard' },
  ],
  [
    { chip: 'SHORTER', label: 'Shorter' },
    { chip: 'LONGER', label: 'Longer' },
  ],
  [{ chip: 'MORE_EXAMPLES', label: 'More examples' }],
  [{ chip: 'MORE_PRACTICE', label: 'More practice' }],
  [{ chip: 'EXPLAIN_DIFFERENTLY', label: 'Explain it differently' }],
  [{ chip: 'MORE_REAL_WORLD', label: 'More real-world use' }],
  [{ chip: 'FRESH_TAKE', label: 'Just write it differently' }],
];

const ALL_CHIPS = CHIP_GROUPS.flat().map(({ chip }) => chip);

/** Errors whose own message says what happened, rather than a fault. */
const EXPLAINED = [
  'TOO_MANY_REQUESTS',
  'FORBIDDEN',
  'CONFLICT',
  'PRECONDITION_FAILED',
];

/**
 * Regenerates a written lesson from what the learner says should change:
 * chips for the common corrections, such as "too easy" or "more examples",
 * and their own words for the rest. The new version replaces this one on the
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
  const [chips, setChips] = useState<Chip[]>([]);
  const [feedback, setFeedback] = useState('');
  const text = feedback.trim();

  const regenerate = trpc.lesson.regenerate.useMutation({
    onSuccess: (view) => {
      utils.lesson.getById.setData({ id: lesson.id }, view);
      // The new version starts with no tutor thread of its own
      utils.tutor.thread.invalidate({ lessonId: lesson.id });
      utils.course.getById.invalidate({ id: lesson.course.id });
      setChips([]);
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

  /** Chooses or unchooses a chip, its opposite giving way; in display order. */
  function toggle(chip: Chip, group: { chip: Chip }[]) {
    setChips((chosen) => {
      const next = chosen.includes(chip)
        ? chosen.filter((other) => other !== chip)
        : [
            ...chosen.filter((other) => !group.some((g) => g.chip === other)),
            chip,
          ];
      return ALL_CHIPS.filter((other) => next.includes(other));
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (chips.length === 0 && !text) return;
    regenerate.mutate(
      text
        ? { id: lesson.id, chips, feedback: text }
        : { id: lesson.id, chips },
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
          <div role="group" aria-labelledby="regenerate-chips-label">
            <p
              id="regenerate-chips-label"
              className="text-sm font-medium text-white/80"
            >
              What should change?
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CHIP_GROUPS.flatMap((group) =>
                group.map(({ chip, label }) => {
                  const isChosen = chips.includes(chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      aria-pressed={isChosen}
                      onClick={() => toggle(chip, group)}
                      disabled={regenerate.isPending}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50 ${
                        isChosen
                          ? 'border-white/80 bg-white/25 text-white'
                          : 'border-white/25 text-white/75 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {/* Chosen shows by more than colour */}
                      {isChosen && <Check className="size-3.5" aria-hidden />}
                      {label}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
          <label
            htmlFor="regenerate-feedback"
            className="mt-4 block text-sm font-medium text-white/80"
          >
            In your own words (optional)
          </label>
          <textarea
            id="regenerate-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={MAX_FEEDBACK_LENGTH}
            rows={3}
            placeholder="The formal greetings especially…"
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
            disabled={regenerate.isPending || (chips.length === 0 && !text)}
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
