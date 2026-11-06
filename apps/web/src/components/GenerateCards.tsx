import { useId, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ChoiceChips } from '@/components/ChoiceChips';
import { DeckCard } from '@/components/DeckCard';
import { FieldError } from '@/components/FieldError';
import { WritingLoader } from '@/components/WritingLoader';
import {
  ReviewCardsDialog,
  type RefiningCard,
} from '@/components/ReviewCardsDialog';
import { MAX_INSTRUCTION_LENGTH } from '@/components/ReviseCardsDialog';
import { glassDialogClassName, glassInputClassName } from '@/lib/utils';

type Proposal = inferRouterOutputs<AppRouter>['deck']['proposeCards'];

/** The most cards the API proposes at a time. */
const MAX_GENERATED_CARDS = 250;

const OTHER = 'other';

const COUNT_CHOICES: { value: number | typeof OTHER; label: string }[] = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 30, label: '30' },
  { value: 50, label: '50' },
  { value: OTHER, label: 'Other' },
];

/**
 * The latest proposal, the description and follow-up instructions it came
 * from, oldest first, and how many cards were asked for.
 */
interface Generation {
  instructions: string[];
  count: number;
  proposal: Proposal;
}

/**
 * "Generate cards" on a deck (#75, ADR-0010): the learner describes the
 * cards they want and how many, the AI proposes them, the learner refines
 * the proposal as often as they like, and only the cards they tick in the
 * preview are added. As an action beside the deck's other actions, or as a
 * tile beside New Card and Import CSV on an empty deck. The latest proposal
 * is kept here, not in the mutation, so a round in flight or failed leaves
 * it.
 */
export function GenerateCards({
  deckId,
  variant,
}: {
  deckId: string;
  variant: 'action' | 'tile';
}) {
  const utils = trpc.useUtils();
  const tooManyId = useId();
  const [isWriting, setIsWriting] = useState(false);
  const [description, setDescription] = useState('');
  const [countChoice, setCountChoice] = useState<number | typeof OTHER>(20);
  const [customCount, setCustomCount] = useState('');
  const [generation, setGeneration] = useState<Generation | null>(null);

  const count = countChoice === OTHER ? Number(customCount) : countChoice;
  const isTooMany = count > MAX_GENERATED_CARDS;
  const isCountValid =
    Number.isInteger(count) && count >= 1 && count <= MAX_GENERATED_CARDS;
  const canGenerate = description.trim() !== '' && isCountValid;

  const propose = trpc.deck.proposeCards.useMutation();
  const add = trpc.deck.addGeneratedCards.useMutation({
    onSuccess: ({ createdCount }) => {
      setGeneration(null);
      propose.reset();
      utils.card.listByDeck.invalidate({ deckId });
      utils.deck.list.invalidate();
      toast.success(
        `Added ${createdCount} ${createdCount === 1 ? 'card' : 'cards'} to the deck`,
      );
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  function open() {
    setDescription('');
    setCountChoice(20);
    setCustomCount('');
    propose.reset();
    setIsWriting(true);
  }

  function close() {
    setIsWriting(false);
    // Escape still closes while proposing: this drops that round, so it
    // can't open the preview
    propose.reset();
  }

  function closePreview() {
    setGeneration(null);
    propose.reset();
  }

  function refine(next: string, cards: RefiningCard[]) {
    if (!generation) return;
    const [first, ...followUps] = generation.instructions;
    propose.mutate(
      {
        deckId,
        description: first,
        count: generation.count,
        refining: { instructions: [...followUps, next], cards },
      },
      {
        onSuccess: (proposal) =>
          setGeneration({
            ...generation,
            instructions: [...generation.instructions, next],
            proposal,
          }),
      },
    );
  }

  return (
    <>
      {variant === 'action' ? (
        <button
          type="button"
          onClick={open}
          className="touch-target inline-flex items-center text-sm text-white/40 hover:text-white transition-colors"
        >
          <Sparkles className="h-4 w-4 mr-1" />
          Generate cards
        </button>
      ) : (
        <DeckCard
          stackCount={0}
          className="cursor-pointer transition-shadow hover:shadow-lg"
          onClick={open}
        >
          <Sparkles className="h-10 w-10 text-white/60" />
          <p className="mt-2 text-sm font-medium text-white/60">
            Generate cards
          </p>
        </DeckCard>
      )}

      <Dialog open={isWriting} onOpenChange={(isOpen) => !isOpen && close()}>
        <DialogContent
          className={`sm:max-w-lg ${glassDialogClassName}`}
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle className="text-white">Generate cards</DialogTitle>
            <DialogDescription className="text-white/70">
              Describe the cards you want, such as “the most common Spanish
              irregular preterites, first person singular”. You'll see every
              card before any is added.
            </DialogDescription>
          </DialogHeader>
          {propose.isPending ? (
            <WritingLoader
              label="Writing cards"
              title="Writing your cards…"
              detail="A large set of cards can take a couple of minutes."
            />
          ) : (
            <form
              id="generate-cards"
              noValidate
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                const first = description.trim();
                if (!canGenerate) return;
                propose.mutate(
                  { deckId, description: first, count },
                  {
                    onSuccess: (proposal) => {
                      setIsWriting(false);
                      setGeneration({ instructions: [first], count, proposal });
                    },
                  },
                );
              }}
            >
              <div>
                <textarea
                  aria-label="Description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={MAX_INSTRUCTION_LENGTH}
                  rows={4}
                  autoFocus
                  className={`w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
                />
                <p className="mt-1 text-right text-xs text-white/50">
                  {description.length}/{MAX_INSTRUCTION_LENGTH}
                </p>
              </div>
              <ChoiceChips
                label="How many cards"
                options={COUNT_CHOICES}
                value={countChoice}
                onChange={setCountChoice}
              >
                {countChoice === OTHER && (
                  <div className="mt-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={customCount}
                      onChange={(e) => setCustomCount(e.target.value)}
                      aria-label="Number of cards"
                      aria-invalid={isTooMany}
                      aria-describedby={isTooMany ? tooManyId : undefined}
                      placeholder="40"
                      autoFocus
                      className={`max-w-32 ${glassInputClassName}`}
                    />
                    {isTooMany && (
                      <FieldError id={tooManyId}>
                        You can generate up to {MAX_GENERATED_CARDS} cards at a
                        time.
                      </FieldError>
                    )}
                  </div>
                )}
              </ChoiceChips>
              {propose.isError && (
                <p className="text-sm text-destructive">
                  {propose.error.message}
                </p>
              )}
            </form>
          )}
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
              form="generate-cards"
              disabled={!canGenerate || propose.isPending}
              className="bg-white/20 text-white hover:bg-white/30"
            >
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {generation && (
        <ReviewCardsDialog
          // Each round's proposal starts the preview afresh
          key={generation.instructions.length}
          open
          onClose={closePreview}
          onConfirm={(cards) =>
            add.mutate({
              deckId,
              model: generation.proposal.model,
              promptVersion: generation.proposal.promptVersion,
              // Typed Recall is the only card type the preview edits
              cards: cards.map((card) => ({ type: 'TYPED_RECALL', ...card })),
            })
          }
          isPending={add.isPending}
          proposals={generation.proposal.cards}
          existingCards={generation.proposal.existingCards}
          title="Generate cards"
          deckNoun="deck"
          instructions={generation.instructions}
          note={generation.proposal.note}
          refine={{
            onRefine: refine,
            isRefining: propose.isPending,
            error: propose.error?.message ?? null,
          }}
        />
      )}
    </>
  );
}
