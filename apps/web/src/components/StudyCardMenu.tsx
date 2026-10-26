import { useId, useState, type FormEvent } from 'react';
import { DropdownMenu } from 'radix-ui';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { glassDialogClassName, glassInputClassName } from '@/lib/utils';
import { useAnswersForm } from '@/hooks/useAnswersForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AnswersEditor } from '@/components/AnswersEditor';

/**
 * Edit or delete the card being studied, without leaving the Study
 * Session. Both work as on the deck's Cards tab: changing the front or the
 * answers' texts resets the card's progress and keeps its attempts
 * (ADR-0004); deleting removes it. A change that resets nothing, to its
 * Accepted Variants or which answer is primary, goes to `onChanged`.
 */
export function StudyCardMenu({
  deckId,
  card,
  onEdited,
  onChanged,
  onDeleted,
}: {
  deckId: string;
  card: Flashcard;
  onEdited: (card: Flashcard) => void;
  onChanged: (card: Flashcard) => void;
  onDeleted: () => void;
}) {
  const utils = trpc.useUtils();
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);

  function refreshDeck() {
    utils.deck.getById.invalidate({ id: deckId });
    utils.card.listByDeck.invalidate({ deckId });
  }

  const remove = trpc.card.delete.useMutation({
    onSuccess: () => {
      setDialog(null);
      onDeleted();
      refreshDeck();
    },
    onError: () => toast.error("Couldn't delete the card"),
  });

  return (
    <>
      {/* Not modal, so the dialogs it opens get focus and pointer events */}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Card options"
            className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            className="z-50 min-w-32 rounded-lg border border-white/20 bg-[oklch(0.25_0.08_230)] p-1 text-sm text-white shadow-lg"
          >
            <DropdownMenu.Item
              onSelect={() => setDialog('edit')}
              className="cursor-pointer rounded px-3 py-1.5 outline-none data-[highlighted]:bg-white/10"
            >
              Edit
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => setDialog('delete')}
              className="cursor-pointer rounded px-3 py-1.5 outline-none data-[highlighted]:bg-white/10"
            >
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog
        open={dialog === 'edit'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className={glassDialogClassName} showCloseButton={false}>
          <EditCardForm
            deckId={deckId}
            card={card}
            onSaved={(updated, resetsProgress) => {
              if (resetsProgress) onEdited(updated);
              else onChanged(updated);
              setDialog(null);
              refreshDeck();
            }}
            onVariantsChanged={onChanged}
            onCancel={() => setDialog(null)}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Delete this card?"
        description={`"${card.front}" is removed from the deck along with your answers to it. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => remove.mutate({ cardId: card.id })}
      />
    </>
  );
}

/**
 * The card's front and answers, as one Save; mounted each time the dialog
 * opens, so it starts from the card as it is.
 */
function EditCardForm({
  deckId,
  card,
  onSaved,
  onVariantsChanged,
  onCancel,
}: {
  deckId: string;
  card: Flashcard;
  onSaved: (card: Flashcard, resetsProgress: boolean) => void;
  onVariantsChanged: (card: Flashcard) => void;
  onCancel: () => void;
}) {
  const [front, setFront] = useState(card.front);
  const form = useAnswersForm(card);
  const frontId = useId();
  const frontChanged = front.trim() !== card.front;

  const update = trpc.card.update.useMutation({
    onSuccess: (updated) =>
      onSaved(toFlashcard(updated), frontChanged || form.resetsProgress),
    onError: (error) =>
      toast.error(
        error.data?.code === 'BAD_REQUEST'
          ? error.message
          : "Couldn't save the card",
      ),
  });

  const canSave = front.trim() !== '' && form.canSave && !update.isPending;

  function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    // Nothing to save: variant changes are already saved
    if (!frontChanged && !form.isChanged) {
      onCancel();
      return;
    }
    update.mutate({
      cardId: card.id,
      front: front.trim(),
      canonicalAnswers: form.edits,
      keepVariantIds: form.keepVariantIds,
    });
  }

  return (
    <form onSubmit={handleSave}>
      <DialogHeader>
        <DialogTitle className="text-white">Edit card</DialogTitle>
        <DialogDescription className="text-white/70">
          Changing the front or answers changes what the card asks, so its
          progress starts over. Your earlier answers are still saved.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor={frontId} className="text-sm text-white/70">
            Front
          </label>
          <Input
            id={frontId}
            value={front}
            onChange={(e) => setFront(e.target.value)}
            className={glassInputClassName}
          />
        </div>
        <AnswersEditor
          form={form}
          deckId={deckId}
          onVariantsChanged={onVariantsChanged}
        />
      </div>
      <DialogFooter className="mt-6 border-white/20 bg-white/5">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="border-white/20 bg-white/10 text-white hover:bg-white/20"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!canSave}
          className="bg-white/20 text-white hover:bg-white/30"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  );
}
