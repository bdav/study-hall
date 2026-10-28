import type { CSSProperties } from 'react';
import { useCallback, useState } from 'react';
import { Trash2 } from 'lucide-react';
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { NewCard, UpdateCard, SkippedRow } from '@/lib/csvDiff';
import { isSameAnswer, splitAnswers } from '@/lib/cards';
import {
  glassDialogClassName,
  glassInputClassName,
  tallDialogBodyClassName,
  tallDialogClassName,
} from '@/lib/utils';

/**
 * Below sm, a table too wide for the dialog stacks each row instead: the
 * header row is hidden, and each cell takes the width with its column's
 * name above it (`stackedCell`).
 */
const STACKED_TABLE =
  'max-sm:[&_thead]:hidden max-sm:[&_tr]:flex max-sm:[&_tr]:flex-wrap max-sm:[&_tr]:py-2';

/** A cell of a `STACKED_TABLE`, named `label` when stacked. */
function stackedCell(label: string, className = '') {
  return {
    'data-label': label,
    className: `py-2 max-sm:block max-sm:w-full max-sm:max-w-none max-sm:py-1 max-sm:whitespace-normal max-sm:before:block max-sm:before:text-xs max-sm:before:text-white/50 max-sm:before:content-[attr(data-label)] ${className}`,
  };
}

/** A stacked row's remove button, at the row's end. */
const STACKED_REMOVE_CELL = 'py-2 max-sm:ml-auto max-sm:block';

function TruncatedCell({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const [isTruncated, setIsTruncated] = useState(false);

  const ref = useCallback((node: HTMLSpanElement | null) => {
    if (node) {
      setIsTruncated(node.scrollWidth > node.clientWidth);
    }
  }, []);

  const span = (
    <span ref={ref} className={`block truncate ${className ?? ''}`}>
      {children}
    </span>
  );

  if (!isTruncated) return span;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{span}</TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-sm break-words bg-[oklch(0.2_0.06_230)] text-white border border-white/20"
        style={{ '--tooltip-bg': 'oklch(0.2 0.06 230)' } as CSSProperties}
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

interface ImportPreviewDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (data: {
    new: { front: string; canonicalAnswers: string[] }[];
    update: { cardId: string; canonicalAnswers: string[] }[];
  }) => void;
  isPending: boolean;
  initialNewCards: NewCard[];
  initialUpdateCards: UpdateCard[];
  skippedRows: SkippedRow[];
}

/** The answers an answer column splits into, when it holds several. */
function ParsedAnswers({ back }: { back: string }) {
  const answers = splitAnswers(back);
  if (answers.length < 2) return null;
  return (
    <p className="mt-1 text-xs text-white/50">
      {answers.length} answers: {answers.join(' · ')}
    </p>
  );
}

/**
 * How many Accepted Variants an update clears: those of the card's answers
 * the new ones leave out, and any that is now one of the answers. A kept
 * answer keeps its other variants.
 */
function ClearedVariants({ card }: { card: UpdateCard }) {
  const answers = splitAnswers(card.newBack);
  const cleared = card.oldAnswers.flatMap((answer) =>
    answers.includes(answer.text)
      ? answer.variants.filter((variant) =>
          answers.some((text) => isSameAnswer(variant, text)),
        )
      : answer.variants,
  ).length;
  if (cleared === 0) return null;
  return (
    <p className="text-xs text-white/50">
      Clears {cleared} accepted {cleared === 1 ? 'variant' : 'variants'}
    </p>
  );
}

export function ImportPreviewDialog({
  open,
  onClose,
  onImport,
  isPending,
  initialNewCards,
  initialUpdateCards,
  skippedRows,
}: ImportPreviewDialogProps) {
  const [newCards, setNewCards] = useState(initialNewCards);
  const [updateCards, setUpdateCards] = useState(initialUpdateCards);

  const hasChanges = newCards.length > 0 || updateCards.length > 0;

  function handleImport() {
    onImport({
      new: newCards.map((c) => ({
        front: c.front,
        canonicalAnswers: splitAnswers(c.back),
      })),
      update: updateCards.map((c) => ({
        cardId: c.cardId,
        canonicalAnswers: splitAnswers(c.newBack),
      })),
    });
  }

  function removeNewCard(index: number) {
    setNewCards((prev) => prev.filter((_, i) => i !== index));
  }

  function removeUpdateCard(index: number) {
    setUpdateCards((prev) => prev.filter((_, i) => i !== index));
  }

  function updateNewCardField(
    index: number,
    field: 'front' | 'back',
    value: string,
  ) {
    setNewCards((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    );
  }

  function updateUpdateCardBack(index: number, value: string) {
    setUpdateCards((prev) =>
      prev.map((c, i) => (i === index ? { ...c, newBack: value } : c)),
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
          <DialogTitle className="text-white">Import Preview</DialogTitle>
          <DialogDescription className="text-white/70">
            Review the cards that will be imported. You can edit or remove rows
            before importing.
          </DialogDescription>
        </DialogHeader>

        <div className={`space-y-6 py-2 ${tallDialogBodyClassName}`}>
          {/* New Cards Section */}
          {newCards.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold mb-1">
                New cards ({newCards.length})
              </h3>
              <Table className={STACKED_TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Front</TableHead>
                    <TableHead>Back</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {newCards.map((card, i) => (
                    <TableRow key={i} data-testid="new-card-row">
                      <TableCell {...stackedCell('Front')}>
                        <Input
                          value={card.front}
                          onChange={(e) =>
                            updateNewCardField(i, 'front', e.target.value)
                          }
                          aria-label={`New card ${i + 1} front`}
                          className={glassInputClassName}
                        />
                      </TableCell>
                      <TableCell {...stackedCell('Back')}>
                        <Input
                          value={card.back}
                          onChange={(e) =>
                            updateNewCardField(i, 'back', e.target.value)
                          }
                          aria-label={`New card ${i + 1} back`}
                          className={glassInputClassName}
                        />
                        <ParsedAnswers back={card.back} />
                      </TableCell>
                      <TableCell className={STACKED_REMOVE_CELL}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-white/70 hover:text-white hover:bg-white/10"
                          onClick={() => removeNewCard(i)}
                          aria-label={`Remove new card ${i + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}

          {/* Updating Section */}
          {updateCards.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold mb-1">
                Updating ({updateCards.length})
              </h3>
              <Table className={STACKED_TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Question</TableHead>
                    <TableHead>Old Answer</TableHead>
                    <TableHead>New Answer</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {updateCards.map((card, i) => (
                    <TableRow key={card.cardId} data-testid="update-card-row">
                      <TableCell {...stackedCell('Question', 'max-w-[10rem]')}>
                        <TruncatedCell className="font-medium text-white/80">
                          {card.front}
                        </TruncatedCell>
                      </TableCell>
                      <TableCell {...stackedCell('Old Answer', 'max-w-[8rem]')}>
                        <TruncatedCell className="text-white/60 line-through">
                          {card.oldBack}
                        </TruncatedCell>
                        <ClearedVariants card={card} />
                      </TableCell>
                      <TableCell {...stackedCell('New Answer')}>
                        <Input
                          value={card.newBack}
                          onChange={(e) =>
                            updateUpdateCardBack(i, e.target.value)
                          }
                          aria-label={`Update card ${i + 1} new back`}
                          className={glassInputClassName}
                        />
                        <ParsedAnswers back={card.newBack} />
                      </TableCell>
                      <TableCell className={STACKED_REMOVE_CELL}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-white/70 hover:text-white hover:bg-white/10"
                          onClick={() => removeUpdateCard(i)}
                          aria-label={`Remove update card ${i + 1}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}

          {/* Skipped Section */}
          {skippedRows.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-white/70 mb-1">
                Skipped ({skippedRows.length})
              </h3>
              <Table className={STACKED_TABLE}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Front</TableHead>
                    <TableHead>Back</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skippedRows.map((row, i) => (
                    <TableRow
                      key={i}
                      className="hover:bg-transparent"
                      data-testid="skipped-row"
                    >
                      <TableCell {...stackedCell('Front', 'max-w-[10rem]')}>
                        <TruncatedCell className="text-white/60">
                          {row.front}
                        </TruncatedCell>
                      </TableCell>
                      <TableCell {...stackedCell('Back', 'max-w-[8rem]')}>
                        <TruncatedCell className="text-white/60">
                          {row.back}
                        </TruncatedCell>
                      </TableCell>
                      <TableCell
                        {...stackedCell(
                          'Reason',
                          'text-xs text-white/70 italic',
                        )}
                      >
                        {row.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}

          {!hasChanges && skippedRows.length === 0 && (
            <p className="text-sm text-white/70 text-center py-4">
              No cards to import.
            </p>
          )}
        </div>

        <DialogFooter className="border-white/20 bg-white/5">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isPending}
            className="border-white/20 bg-white/10 text-white hover:bg-white/20"
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!hasChanges || isPending}
            className="bg-white/20 text-white hover:bg-white/30"
          >
            {isPending ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
