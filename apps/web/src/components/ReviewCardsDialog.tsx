import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { duplicateFinder, type ExistingCard } from '@/lib/csvDiff';
import {
  glassDialogClassName,
  glassInputClassName,
  tallDialogBodyClassName,
  tallDialogClassName,
  tallDialogFooterClassName,
} from '@/lib/utils';

/** A proposed Typed Recall card, as the learner confirms it. */
export interface ReviewCard {
  front: string;
  canonicalAnswer: string;
}

interface ReviewCardsDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (cards: ReviewCard[]) => void;
  isPending: boolean;
  proposals: ReviewCard[];
  /** The Course Deck's cards, to flag proposals it already has. */
  existingCards: ExistingCard[];
}

/**
 * The import preview for proposed review cards: the learner edits them,
 * deselects the ones they don't want, and sees which the Course Deck
 * already has. Duplicates start deselected.
 */
export function ReviewCardsDialog({
  open,
  onClose,
  onConfirm,
  isPending,
  proposals,
  existingCards,
}: ReviewCardsDialogProps) {
  const findDuplicate = duplicateFinder(existingCards);
  const [rows, setRows] = useState(() =>
    proposals.map((card) => ({
      ...card,
      selected: !findDuplicate(card.front),
    })),
  );

  const selected = rows.filter((row) => row.selected);
  const complete = selected.every(
    (row) => row.front.trim() !== '' && row.canonicalAnswer.trim() !== '',
  );

  function updateRow(index: number, change: Partial<(typeof rows)[number]>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...change } : row)),
    );
  }

  function handleConfirm() {
    onConfirm(
      selected.map(({ front, canonicalAnswer }) => ({
        front,
        canonicalAnswer,
      })),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className={`sm:max-w-2xl ${tallDialogClassName} ${glassDialogClassName}`}
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Review cards</DialogTitle>
          <DialogDescription className="text-white/70">
            Choose the cards to add to the course deck. You can edit them first.
          </DialogDescription>
        </DialogHeader>

        <div className={`py-2 ${tallDialogBodyClassName}`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Front</TableHead>
                <TableHead>Answer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => {
                const duplicate = findDuplicate(row.front);
                return (
                  <TableRow key={i} data-testid="review-card-row">
                    <TableCell className="py-2 align-top">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) =>
                          updateRow(i, { selected: e.target.checked })
                        }
                        aria-label={`Include card ${i + 1}`}
                        className="mt-2.5 size-4 accent-white"
                      />
                    </TableCell>
                    <TableCell className="py-2 align-top">
                      <Input
                        value={row.front}
                        onChange={(e) =>
                          updateRow(i, { front: e.target.value })
                        }
                        aria-label={`Card ${i + 1} front`}
                        className={glassInputClassName}
                      />
                      {duplicate && (
                        <p className="mt-1 text-xs italic text-white/60">
                          Already in the course deck, answered “
                          {duplicate.canonicalAnswer}”
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="py-2 align-top">
                      <Input
                        value={row.canonicalAnswer}
                        onChange={(e) =>
                          updateRow(i, { canonicalAnswer: e.target.value })
                        }
                        aria-label={`Card ${i + 1} answer`}
                        className={glassInputClassName}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter
          className={`border-white/20 bg-white/5 ${tallDialogFooterClassName}`}
        >
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selected.length === 0 || !complete || isPending}
            className="bg-white/20 text-white hover:bg-white/30"
          >
            {isPending
              ? 'Adding...'
              : `Add ${selected.length} ${selected.length === 1 ? 'card' : 'cards'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
