import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ReviseCardsDialog } from '@/components/ReviseCardsDialog';
import { glassDialogClassName, glassInputClassName } from '@/lib/utils';

/** The longest instruction the API takes. */
const MAX_INSTRUCTION_LENGTH = 1000;

/**
 * The "Revise cards" action on a deck (ADR-0007): the learner writes an
 * instruction, the AI proposes edits and deletions, and only the changes
 * the learner approves in the preview are applied.
 */
export function ReviseCards({ deckId }: { deckId: string }) {
  const utils = trpc.useUtils();
  const [isWriting, setIsWriting] = useState(false);
  const [instruction, setInstruction] = useState('');

  const propose = trpc.deck.proposeRevision.useMutation({
    onSuccess: () => setIsWriting(false),
  });
  const apply = trpc.deck.applyRevision.useMutation({
    onSuccess: ({ editedCount, deletedCount }) => {
      propose.reset();
      utils.card.listByDeck.invalidate({ deckId });
      utils.deck.list.invalidate();
      const parts = [
        editedCount > 0 &&
          `edited ${editedCount} ${editedCount === 1 ? 'card' : 'cards'}`,
        deletedCount > 0 &&
          `deleted ${deletedCount} ${deletedCount === 1 ? 'card' : 'cards'}`,
      ].filter(Boolean);
      toast.success(`Revised the deck: ${parts.join(', ')}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  const proposal = propose.data;

  function close() {
    setIsWriting(false);
    propose.reset();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setInstruction('');
          setIsWriting(true);
        }}
        className="inline-flex items-center text-sm text-white/40 hover:text-white transition-colors"
      >
        <Sparkles className="h-4 w-4 mr-1" />
        Revise cards
      </button>

      <Dialog open={isWriting} onOpenChange={(isOpen) => !isOpen && close()}>
        <DialogContent
          className={`sm:max-w-lg ${glassDialogClassName}`}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="text-white">Revise cards</DialogTitle>
            <DialogDescription className="text-white/70">
              Say how to change or remove this deck's cards, such as “remove the
              hints from the fronts”. Revising doesn't add cards. You'll see
              every proposed change before anything changes.
            </DialogDescription>
          </DialogHeader>
          <form
            id="revise-cards"
            onSubmit={(e) => {
              e.preventDefault();
              if (!instruction.trim()) return;
              propose.mutate({ deckId, instruction: instruction.trim() });
            }}
          >
            <textarea
              aria-label="Instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              maxLength={MAX_INSTRUCTION_LENGTH}
              rows={4}
              autoFocus
              className={`w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none ${glassInputClassName}`}
            />
            <p className="mt-1 text-right text-xs text-white/50">
              {instruction.length}/{MAX_INSTRUCTION_LENGTH}
            </p>
            {propose.isError && (
              <p className="mt-2 text-sm text-destructive">
                {propose.error.message}
              </p>
            )}
          </form>
          <DialogFooter className="border-white/20 bg-white/5">
            <Button
              variant="outline"
              onClick={close}
              disabled={propose.isPending}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="revise-cards"
              disabled={!instruction.trim() || propose.isPending}
              className="bg-white/20 text-white hover:bg-white/30"
            >
              {propose.isPending && <Loader2 className="size-4 animate-spin" />}
              {propose.isPending ? 'Proposing changes…' : 'Propose changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {proposal && (
        <ReviseCardsDialog
          open
          onClose={() => propose.reset()}
          onConfirm={(revision) =>
            apply.mutate({
              deckId,
              model: proposal.model,
              promptVersion: proposal.promptVersion,
              ...revision,
            })
          }
          isPending={apply.isPending}
          instruction={propose.variables?.instruction ?? ''}
          changes={proposal.changes}
          note={proposal.note}
        />
      )}
    </>
  );
}
