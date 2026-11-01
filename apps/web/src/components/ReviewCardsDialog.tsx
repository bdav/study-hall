import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { inferRouterInputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
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
import { MAX_INSTRUCTION_LENGTH } from '@/components/ReviseCardsDialog';
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

/** A proposed card as the model is told of it when refining. */
export type RefiningCard = NonNullable<
  inferRouterInputs<AppRouter>['deck']['proposeCards']['refining']
>['cards'][number];

interface ReviewCardsDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (cards: ReviewCard[]) => void;
  isPending: boolean;
  proposals: ReviewCard[];
  /** The deck's cards, to flag proposals it already has. */
  existingCards: ExistingCard[];
  title?: string;
  /** The deck the cards go into, as the dialog names it. */
  deckNoun?: string;
  /** What the cards were proposed from, oldest first, when the learner wrote it. */
  instructions?: string[];
  /** The model's note on why there are fewer cards than asked for. */
  note?: string | null;
  /** Proposing again from a follow-up instruction, when offered. */
  refine?: {
    onRefine: (instruction: string, cards: RefiningCard[]) => void;
    isRefining: boolean;
    /** Why the last round failed, if it did. */
    error: string | null;
  };
}

function isComplete(card: ReviewCard) {
  return card.front.trim() !== '' && card.canonicalAnswer.trim() !== '';
}

/**
 * The import preview for proposed cards, from a lesson (review cards) or
 * from the learner's description (generated cards, #75): the learner edits
 * them, deselects the ones they don't want, and sees which the deck already
 * has. Duplicates start deselected. With `refine`, the learner can propose
 * again from a follow-up instruction, as often as they like; a new proposal
 * comes with a new dialog, so the parent keys it by round.
 */
export function ReviewCardsDialog({
  open,
  onClose,
  onConfirm,
  isPending,
  proposals,
  existingCards,
  title = 'Review cards',
  deckNoun = 'course deck',
  instructions,
  note,
  refine,
}: ReviewCardsDialogProps) {
  const instructionsId = useId();
  const [isRefineOpen, setIsRefineOpen] = useState(false);
  const [refinement, setRefinement] = useState('');
  const findDuplicate = duplicateFinder(existingCards);
  const [rows, setRows] = useState(() =>
    proposals.map((card) => ({
      ...card,
      proposed: card,
      selected: !findDuplicate(card.front),
    })),
  );

  const selected = rows.filter((row) => row.selected);
  const complete = selected.every(isComplete);
  const isRefining = refine?.isRefining ?? false;
  const isBusy = isPending || isRefining;
  const canRefine = refinement.trim() !== '' && complete;

  /**
   * The cards as the learner left them, ticked or not. A field left blank
   * on an unticked card, which adding ignores, goes as proposed.
   */
  function refiningCards(): RefiningCard[] {
    return rows.map((row) => ({
      front: row.front.trim() || row.proposed.front,
      canonicalAnswer:
        row.canonicalAnswer.trim() || row.proposed.canonicalAnswer,
      included: row.selected,
    }));
  }

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
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription className="text-white/70">
            Choose the cards to add to the {deckNoun}. You can edit them first.
          </DialogDescription>
        </DialogHeader>

        {instructions && (
          <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm">
            <p id={instructionsId} className="text-xs text-white/50">
              {instructions.length === 1
                ? 'Your description'
                : 'Your description and instructions'}
            </p>
            <ol
              aria-labelledby={instructionsId}
              className={`space-y-1 text-white/80 ${instructions.length > 1 ? 'list-decimal pl-5' : ''}`}
            >
              {instructions.map((instruction, i) => (
                <li key={i} className="whitespace-pre-wrap break-words">
                  {instruction}
                </li>
              ))}
            </ol>
          </div>
        )}
        {note && <p className="text-sm text-white/80">{note}</p>}

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
                          Already in the {deckNoun}, answered “
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
          {rows.length === 0 && !note && (
            <p className="py-4 text-center text-sm text-white/70">
              No cards were proposed.
            </p>
          )}
        </div>

        {refine && isRefineOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canRefine)
                refine.onRefine(refinement.trim(), refiningCards());
            }}
          >
            <textarea
              aria-label="Refinement"
              value={refinement}
              onChange={(e) => setRefinement(e.target.value)}
              maxLength={MAX_INSTRUCTION_LENGTH}
              rows={2}
              autoFocus
              placeholder="Say what to change about these cards"
              className={`w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
            />
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="text-sm text-destructive">{refine.error}</p>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-white/50">
                  {refinement.length}/{MAX_INSTRUCTION_LENGTH}
                </span>
                <Button
                  type="submit"
                  disabled={!canRefine || isBusy}
                  className="bg-white/20 text-white hover:bg-white/30"
                >
                  {isRefining && <Loader2 className="size-4 animate-spin" />}
                  {isRefining ? 'Proposing again…' : 'Propose again'}
                </Button>
              </div>
            </div>
            {isRefining && (
              <p className="mt-1 text-xs text-white/60">
                A large set of cards can take a couple of minutes.
              </p>
            )}
          </form>
        )}

        <DialogFooter
          className={`border-white/20 bg-white/5 ${tallDialogFooterClassName}`}
        >
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isBusy}
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            Cancel
          </Button>
          {refine && (
            <Button
              variant="outline"
              onClick={() => setIsRefineOpen((isOpen) => !isOpen)}
              aria-expanded={isRefineOpen}
              disabled={isBusy}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              Refine
            </Button>
          )}
          <Button
            onClick={handleConfirm}
            disabled={selected.length === 0 || !complete || isBusy}
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
