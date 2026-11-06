import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cardsCount } from '@/lib/cards';
import { STUDY_DIRECTIONS, type StudyDirection } from '@/lib/directions';

const choiceClassName =
  'cursor-pointer rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 pointer-coarse:min-h-touch';

/**
 * Marking cards of a Reversible Deck known (ADR-0009, ADR-0011): asks which
 * Study Direction, by its Direction Label, or both ways, and marks them in
 * it with `onMark`.
 */
export function MarkKnownDialog({
  count,
  labels,
  open,
  onOpenChange,
  onMark,
}: {
  count: number;
  labels: Record<StudyDirection, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMark: (directions: StudyDirection[]) => void;
}) {
  function mark(directions: StudyDirection[]) {
    onOpenChange(false);
    onMark(directions);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark {cardsCount(count)} known?</AlertDialogTitle>
          <AlertDialogDescription>
            Which way do you know {count === 1 ? 'it' : 'them'}? Each comes back
            for review that way a few days on, instead of as new. Your answers
            are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-wrap gap-2">
          {STUDY_DIRECTIONS.map((direction) => (
            <button
              key={direction}
              type="button"
              onClick={() => mark([direction])}
              className={choiceClassName}
            >
              {labels[direction]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => mark([...STUDY_DIRECTIONS])}
            className={choiceClassName}
          >
            Both ways
          </button>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer select-none border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white">
            Cancel
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
