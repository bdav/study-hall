import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
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
import {
  ReviseCardsDialog,
  MAX_INSTRUCTION_LENGTH,
  type RefiningChange,
} from '@/components/ReviseCardsDialog';
import { glassDialogClassName, glassInputClassName } from '@/lib/utils';

type Proposal = inferRouterOutputs<AppRouter>['deck']['proposeRevision'];

/** The latest proposal and the instructions it came from, oldest first. */
interface Revision {
  instructions: string[];
  proposal: Proposal;
}

/**
 * The "Revise cards" action on a deck (ADR-0007): the learner writes an
 * instruction, the AI proposes edits and deletions, the learner refines the
 * proposal with more instructions as often as they like, and only the
 * changes they approve in the preview are applied. The latest proposal is
 * kept here, not in the mutation, so a round in flight or failed leaves it.
 */
export function ReviseCards({ deckId }: { deckId: string }) {
  const utils = trpc.useUtils();
  const [isWriting, setIsWriting] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [revision, setRevision] = useState<Revision | null>(null);

  const propose = trpc.deck.proposeRevision.useMutation();
  const apply = trpc.deck.applyRevision.useMutation({
    onSuccess: ({ editedCount, deletedCount }) => {
      setRevision(null);
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
  function close() {
    setIsWriting(false);
    propose.reset();
  }

  function closePreview() {
    setRevision(null);
    // Escape still closes while proposing again: this drops that round,
    // so it can't reopen the preview
    propose.reset();
  }

  function refine(next: string, changes: RefiningChange[]) {
    if (!revision) return;
    const { instructions } = revision;
    propose.mutate(
      {
        deckId,
        instruction: next,
        refining: { instructions, changes },
      },
      {
        onSuccess: (proposal) =>
          setRevision({ instructions: [...instructions, next], proposal }),
      },
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setInstruction('');
          propose.reset();
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
              const first = instruction.trim();
              if (!first) return;
              propose.mutate(
                { deckId, instruction: first },
                {
                  onSuccess: (proposal) => {
                    setIsWriting(false);
                    setRevision({ instructions: [first], proposal });
                  },
                },
              );
            }}
          >
            <textarea
              aria-label="Instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              maxLength={MAX_INSTRUCTION_LENGTH}
              rows={4}
              autoFocus
              className={`w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
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

      {revision && (
        <ReviseCardsDialog
          // Each round's proposal starts the preview afresh
          key={revision.instructions.length}
          open
          onClose={closePreview}
          onConfirm={(approved) =>
            apply.mutate({
              deckId,
              model: revision.proposal.model,
              promptVersion: revision.proposal.promptVersion,
              ...approved,
            })
          }
          onRefine={refine}
          isPending={apply.isPending}
          isRefining={propose.isPending}
          refineError={propose.error?.message ?? null}
          instructions={revision.instructions}
          changes={revision.proposal.changes}
          note={revision.proposal.note}
        />
      )}
    </>
  );
}
