import { useState } from 'react';
import { BadgeCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { cardsCount, markedKnownMessage } from '@/lib/cards';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const actionClassName =
  'inline-flex items-center text-white/60 transition-colors hover:text-white disabled:pointer-events-none disabled:opacity-40';

/**
 * The Cards tab's toolbar while selecting cards: how many are selected,
 * select all or none, and mark them known (ADR-0009) or delete them, each
 * after a confirmation that says how many. Either action ends selecting.
 */
export function CardSelectionBar({
  deckId,
  cardIds,
  selected,
  onSelect,
  onDone,
}: {
  deckId: string;
  /** The deck's cards, in deck order. */
  cardIds: string[];
  selected: Set<string>;
  onSelect: (selected: Set<string>) => void;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [confirming, setConfirming] = useState<'known' | 'delete' | null>(null);
  // In deck order, and only cards still in the deck
  const selectedIds = cardIds.filter((id) => selected.has(id));
  const count = selectedIds.length;
  const allSelected = count === cardIds.length;

  function refresh() {
    utils.card.listByDeck.invalidate({ deckId });
    utils.deck.list.invalidate();
  }

  const markKnown = trpc.card.markKnown.useMutation({
    onSuccess: ({ markedCount }) => {
      toast.success(markedKnownMessage(markedCount));
      refresh();
      onDone();
    },
    onError: () => toast.error("Couldn't mark the cards known"),
  });
  const deleteMany = trpc.card.deleteMany.useMutation({
    onSuccess: ({ deletedCount }) => {
      toast.success(`Deleted ${cardsCount(deletedCount)}`);
      refresh();
      onDone();
    },
    onError: () => toast.error("Couldn't delete the cards"),
  });

  return (
    <div className="mr-4 flex items-center justify-end gap-4 text-sm">
      <span className="text-white/70">{count} selected</span>
      <button
        type="button"
        onClick={() => onSelect(new Set(allSelected ? [] : cardIds))}
        className={actionClassName}
      >
        {allSelected ? 'Select none' : 'Select all'}
      </button>
      <button
        type="button"
        disabled={count === 0}
        onClick={() => setConfirming('known')}
        aria-label="Mark selected known"
        className={actionClassName}
      >
        <BadgeCheck className="mr-1 h-4 w-4" />
        Mark known
      </button>
      <button
        type="button"
        disabled={count === 0}
        onClick={() => setConfirming('delete')}
        aria-label="Delete selected"
        className={`${actionClassName} hover:text-destructive`}
      >
        <Trash2 className="mr-1 h-4 w-4" />
        Delete
      </button>
      <button type="button" onClick={onDone} className={actionClassName}>
        Done
      </button>

      <ConfirmDialog
        open={confirming === 'known'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Mark ${cardsCount(count)} known?`}
        description="Each comes back for review a few days on, as a card you've learned would, instead of as new. Cards you already know well are left as they are, and your answers are kept."
        confirmLabel="Mark known"
        onConfirm={() => markKnown.mutate({ cardIds: selectedIds })}
      />
      <ConfirmDialog
        open={confirming === 'delete'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Delete ${cardsCount(count)}?`}
        description="They're removed from the deck along with your answers to them. This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => deleteMany.mutate({ cardIds: selectedIds })}
      />
    </div>
  );
}
