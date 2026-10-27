import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { glassDialogClassName, glassInputClassName } from '@/lib/utils';

/** A proposed change to one card, with the card as it is. */
export type CardChange =
  inferRouterOutputs<AppRouter>['deck']['proposeRevision']['changes'][number];

/** The changes the learner approved, each edit giving only what it changes. */
export interface ApprovedRevision {
  edits: { cardId: string; front?: string; canonicalAnswer?: string }[];
  deletions: string[];
}

interface ReviseCardsDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (revision: ApprovedRevision) => void;
  isPending: boolean;
  /** The learner's instruction the changes were proposed from. */
  instruction: string;
  changes: CardChange[];
  /** The model's note on what it couldn't do, such as add cards. */
  note: string | null;
}

/** A proposed change as the learner has it: ticked or not, and as edited. */
interface Row {
  change: CardChange;
  selected: boolean;
  front: string;
  canonicalAnswer: string;
}

/** What an edit row changes, as typed; nothing when put back as it was. */
function editOf(row: Row) {
  const { cardId, before } = row.change;
  const front = row.front.trim();
  const canonicalAnswer = row.canonicalAnswer.trim();
  return {
    cardId,
    ...(front !== before.front && { front }),
    ...(canonicalAnswer !== before.canonicalAnswer && { canonicalAnswer }),
  };
}

function changesSomething(row: Row) {
  const edit = editOf(row);
  return edit.front !== undefined || edit.canonicalAnswer !== undefined;
}

/** An After field that wraps and grows with its text, kept to one line. */
function AfterField(props: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <textarea
      rows={1}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault();
      }}
      aria-label={props.label}
      className={`field-sizing-content w-full resize-none px-2.5 py-1 text-sm outline-none ${glassInputClassName}`}
    />
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The preview of a revision of a deck's cards (ADR-0007): each edit as
 * before and after, editable, and each deletion. The learner unticks the
 * changes they don't want; nothing changes until they apply the rest. An
 * edit resets its card's progress (ADR-0004), so the preview counts them.
 */
export function ReviseCardsDialog({
  open,
  onClose,
  onConfirm,
  isPending,
  instruction,
  changes,
  note,
}: ReviseCardsDialogProps) {
  const [rows, setRows] = useState<Row[]>(() =>
    changes.map((change) => ({
      change,
      selected: true,
      ...(change.action === 'EDIT' ? change.after : change.before),
    })),
  );

  const applied = rows.filter(
    (row) =>
      row.selected && (row.change.action === 'DELETE' || changesSomething(row)),
  );
  const edits = applied.filter((row) => row.change.action === 'EDIT');
  const complete = edits.every(
    (row) => row.front.trim() !== '' && row.canonicalAnswer.trim() !== '',
  );

  function updateRow(index: number, change: Partial<Omit<Row, 'change'>>) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...change } : row)),
    );
  }

  function handleConfirm() {
    onConfirm({
      edits: edits.map(editOf),
      deletions: applied
        .filter((row) => row.change.action === 'DELETE')
        .map((row) => row.change.cardId),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className={`sm:max-w-2xl max-h-[80vh] flex flex-col ${glassDialogClassName}`}
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Revise cards</DialogTitle>
          <DialogDescription className="text-white/70">
            Untick the changes you don't want, or edit them first. Nothing
            changes until you apply them.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm">
          <p className="text-xs text-white/50">Your instruction</p>
          <p className="whitespace-pre-wrap break-words text-white/80">
            {instruction}
          </p>
        </div>
        {note && <p className="text-sm text-white/80">{note}</p>}

        <ol className="flex-1 space-y-3 overflow-y-auto py-2">
          {rows.map((row, i) => {
            const n = i + 1;
            const { action, cardId, before } = row.change;
            const clearedVariants =
              action === 'EDIT' &&
              row.canonicalAnswer.trim() !== before.canonicalAnswer
                ? before.acceptedVariants.length
                : 0;
            return (
              <li
                key={cardId}
                data-testid="card-change"
                className="flex gap-3 rounded-lg border border-white/15 bg-white/5 p-3"
              >
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={(e) => updateRow(i, { selected: e.target.checked })}
                  aria-label={`Include change ${n}`}
                  className="mt-1 size-4 shrink-0 accent-white"
                />
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                  <div className="min-w-0 text-sm">
                    <p className="text-xs text-white/50">
                      {action === 'DELETE' ? 'Delete' : 'Before'}
                    </p>
                    <p
                      className={`break-words text-white/80 ${action === 'DELETE' ? 'line-through' : ''}`}
                    >
                      {before.front}
                    </p>
                    <p
                      className={`break-words text-white/60 ${action === 'DELETE' ? 'line-through' : ''}`}
                    >
                      {before.canonicalAnswer}
                    </p>
                  </div>
                  {action === 'EDIT' && (
                    <div className="min-w-0">
                      <p className="text-xs text-white/50">After</p>
                      <AfterField
                        value={row.front}
                        onChange={(front) => updateRow(i, { front })}
                        label={`Change ${n} front`}
                      />
                      <AfterField
                        value={row.canonicalAnswer}
                        onChange={(canonicalAnswer) =>
                          updateRow(i, { canonicalAnswer })
                        }
                        label={`Change ${n} answer`}
                      />
                      {clearedVariants > 0 && (
                        <p className="mt-1 text-xs text-white/50">
                          Clears{' '}
                          {plural(
                            clearedVariants,
                            'accepted variant',
                            'accepted variants',
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        {rows.length === 0 && !note && (
          <p className="py-4 text-center text-sm text-white/70">
            No cards need changing.
          </p>
        )}

        {edits.length > 0 && (
          <p className="text-sm text-white/70">
            {edits.length === 1
              ? '1 card will have its progress reset'
              : `${edits.length} cards will have their progress reset`}
            : a new front or answer starts a card afresh, keeping your past
            answers.
          </p>
        )}

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
            onClick={handleConfirm}
            disabled={applied.length === 0 || !complete || isPending}
            className="bg-white/20 text-white hover:bg-white/30"
          >
            {isPending
              ? 'Applying...'
              : `Apply ${plural(applied.length, 'change', 'changes')}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
