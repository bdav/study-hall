import { useId, useState, type FormEvent } from 'react';
import { DropdownMenu } from 'radix-ui';
import { MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { glassDialogClassName, glassInputClassName } from '@/lib/utils';
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
import { AcceptedVariantsEditor } from '@/components/AcceptedVariantsEditor';
import { KeepVariantsDialog } from '@/components/KeepVariantsDialog';

/**
 * Edit or delete the card being studied, without leaving the Study
 * Session. Both work as on the deck's Cards tab: an edit resets the
 * card's progress and keeps its attempts (ADR-0004); deleting removes it.
 * Editing also manages the answer's Accepted Variants, which change how
 * answers are graded but not what the card asks, so they reset nothing. A
 * changed answer first asks which of its variants still fit.
 */
export function StudyCardMenu({
  deckId,
  card,
  onEdited,
  onVariantsChanged,
  onDeleted,
}: {
  deckId: string;
  card: Flashcard;
  onEdited: (card: Flashcard) => void;
  onVariantsChanged: (card: Flashcard) => void;
  onDeleted: () => void;
}) {
  const utils = trpc.useUtils();
  const [dialog, setDialog] = useState<
    'edit' | 'keep-variants' | 'delete' | null
  >(null);
  const [front, setFront] = useState(card.front);
  const [answer, setAnswer] = useState(card.canonicalAnswer);
  const frontId = useId();
  const answerId = useId();

  function refreshDeck() {
    utils.deck.getById.invalidate({ id: deckId });
    utils.card.listByDeck.invalidate({ deckId });
  }

  const update = trpc.card.update.useMutation({
    onSuccess: (updated) => {
      onEdited(toFlashcard(updated));
      setDialog(null);
      refreshDeck();
    },
    onError: () => toast.error("Couldn't save the card"),
  });
  const remove = trpc.card.delete.useMutation({
    onSuccess: () => {
      setDialog(null);
      onDeleted();
      refreshDeck();
    },
    onError: () => toast.error("Couldn't delete the card"),
  });

  function openEdit() {
    setFront(card.front);
    setAnswer(card.canonicalAnswer);
    setDialog('edit');
  }

  const canSave =
    front.trim() !== '' && answer.trim() !== '' && !update.isPending;

  const edit = {
    cardId: card.id,
    front: front.trim(),
    canonicalAnswer: answer.trim(),
  };

  function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    if (
      edit.canonicalAnswer !== card.canonicalAnswer &&
      card.acceptedVariants.length > 0
    ) {
      setDialog('keep-variants');
      return;
    }
    update.mutate(edit);
  }

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
              onSelect={openEdit}
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
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle className="text-white">Edit card</DialogTitle>
              <DialogDescription className="text-white/70">
                Changing the front or answer changes what the card asks, so its
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
              <div>
                <label htmlFor={answerId} className="text-sm text-white/70">
                  Answer
                </label>
                <Input
                  id={answerId}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  className={glassInputClassName}
                />
              </div>
              <AcceptedVariantsEditor
                deckId={deckId}
                card={card}
                onChanged={onVariantsChanged}
              />
            </div>
            <DialogFooter className="mt-6 border-white/20 bg-white/5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog(null)}
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
        </DialogContent>
      </Dialog>

      {dialog === 'keep-variants' && (
        <KeepVariantsDialog
          oldAnswer={card.canonicalAnswer}
          newAnswer={edit.canonicalAnswer}
          variants={card.acceptedVariants}
          cancelLabel="Back"
          isSaving={update.isPending}
          onSave={(keepVariantIds) =>
            update.mutate({ ...edit, keepVariantIds })
          }
          onCancel={() => setDialog('edit')}
        />
      )}

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
