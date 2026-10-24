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
import { glassInputClassName } from '@/lib/utils';

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
    new: { front: string; canonicalAnswer: string }[];
    update: { cardId: string; canonicalAnswer: string }[];
  }) => void;
  isPending: boolean;
  initialNewCards: NewCard[];
  initialUpdateCards: UpdateCard[];
  skippedRows: SkippedRow[];
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
      new: newCards.map((c) => ({ front: c.front, canonicalAnswer: c.back })),
      update: updateCards.map((c) => ({
        cardId: c.cardId,
        canonicalAnswer: c.newBack,
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
        className="sm:max-w-2xl max-h-[80vh] flex flex-col border border-white/20 bg-[oklch(0.25_0.08_230)] text-white backdrop-blur-md"
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

        <div className="flex-1 overflow-y-auto space-y-6 py-2">
          {/* New Cards Section */}
          {newCards.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold mb-1">
                New cards ({newCards.length})
              </h3>
              <Table>
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
                      <TableCell className="py-2">
                        <Input
                          value={card.front}
                          onChange={(e) =>
                            updateNewCardField(i, 'front', e.target.value)
                          }
                          aria-label={`New card ${i + 1} front`}
                          className={glassInputClassName}
                        />
                      </TableCell>
                      <TableCell className="py-2">
                        <Input
                          value={card.back}
                          onChange={(e) =>
                            updateNewCardField(i, 'back', e.target.value)
                          }
                          aria-label={`New card ${i + 1} back`}
                          className={glassInputClassName}
                        />
                      </TableCell>
                      <TableCell className="py-2">
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
              <Table>
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
                      <TableCell className="py-2 max-w-[10rem]">
                        <TruncatedCell className="font-medium text-white/80">
                          {card.front}
                        </TruncatedCell>
                      </TableCell>
                      <TableCell className="py-2 max-w-[8rem]">
                        <TruncatedCell className="text-white/60 line-through">
                          {card.oldBack}
                        </TruncatedCell>
                      </TableCell>
                      <TableCell className="py-2">
                        <Input
                          value={card.newBack}
                          onChange={(e) =>
                            updateUpdateCardBack(i, e.target.value)
                          }
                          aria-label={`Update card ${i + 1} new back`}
                          className={glassInputClassName}
                        />
                      </TableCell>
                      <TableCell className="py-2">
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
              <Table>
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
                      <TableCell className="py-2 max-w-[10rem]">
                        <TruncatedCell className="text-white/60">
                          {row.front}
                        </TruncatedCell>
                      </TableCell>
                      <TableCell className="py-2 max-w-[8rem]">
                        <TruncatedCell className="text-white/60">
                          {row.back}
                        </TruncatedCell>
                      </TableCell>
                      <TableCell className="py-2 text-white/70 text-xs italic">
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
