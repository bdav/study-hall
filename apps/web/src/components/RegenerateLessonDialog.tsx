import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import type { inferRouterInputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
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

type RegenerateInput = inferRouterInputs<AppRouter>['lesson']['regenerate'];
export type LessonFeedbackChip = NonNullable<RegenerateInput['chips']>[number];

/** What the learner asks of a regeneration. */
export type LessonFeedback = Omit<RegenerateInput, 'id'>;

/**
 * The chips, in the order shown, by their labels. A pair asks for opposite
 * things, so choosing one deselects the other; the API checks it too.
 */
const CHIP_GROUPS: { chip: LessonFeedbackChip; label: string }[][] = [
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

/**
 * Asks what should change before a written lesson is regenerated: chips for
 * the common corrections, such as "too easy" or "more examples", and the
 * learner's own words for the rest. It closes once they ask, and the lesson
 * stays readable while the new version is written; it then replaces this
 * one, and answers and tutor threads stay with the version they were made
 * on (ADR-0003). Opened from the lesson's ⋯ menu.
 */
export function RegenerateLessonDialog({
  open,
  onOpenChange,
  onRegenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegenerate: (feedback: LessonFeedback) => void;
}) {
  const [chips, setChips] = useState<LessonFeedbackChip[]>([]);
  const [feedback, setFeedback] = useState('');
  const text = feedback.trim();

  /** Chooses or unchooses a chip, its opposite giving way; in display order. */
  function toggle(
    chip: LessonFeedbackChip,
    group: { chip: LessonFeedbackChip }[],
  ) {
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
    onRegenerate(text ? { chips, feedback: text } : { chips });
    setChips([]);
    setFeedback('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
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
            className={`mt-1 w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
          />
        </form>
        <DialogFooter className="border-white/20 bg-white/5">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="regenerate-lesson"
            disabled={chips.length === 0 && !text}
            className="bg-white/20 text-white hover:bg-white/30"
          >
            Regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
