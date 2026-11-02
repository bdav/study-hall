import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { type Flashcard } from '@/lib/cards';
import {
  cardsSharingAnswers,
  DEFAULT_DIRECTION_LABELS,
  hasLabelToSuggest,
  MAX_DIRECTION_LABEL_LENGTH,
  type DirectedDeck,
} from '@/lib/directions';
import { InPlaceField } from '@/components/InPlaceField';
import { Switch } from '@/components/Switch';

type DeckDetails = DirectedDeck & {
  id: string;
  description: string | null;
  // Whether each label is the AI's suggestion, which a new one may replace
  forwardLabelSuggested?: boolean;
  reverseLabelSuggested?: boolean;
};

/** Saves changes to a deck's details, refreshing where they show. */
function useDeckUpdate(deckId: string) {
  const utils = trpc.useUtils();
  return trpc.deck.update.useMutation({
    onSuccess: () => {
      utils.deck.getById.invalidate({ id: deckId });
      utils.deck.list.invalidate();
    },
    onError: () => toast.error("Couldn't save the deck"),
  });
}

/** A deck's description, below its title, edited in place as the title is. */
export function EditableDeckDescription({ deck }: { deck: DeckDetails }) {
  const update = useDeckUpdate(deck.id);
  return (
    <div className="mt-1">
      <InPlaceField
        label="Deck description"
        editLabel={
          deck.description ? 'Edit the description' : 'Add a description'
        }
        value={deck.description ?? ''}
        placeholder="Add a description"
        onSave={(description) =>
          update.mutate({ id: deck.id, description: description || null })
        }
        className="w-full text-sm text-white/70"
      />
    </div>
  );
}

/**
 * Study both ways (ADR-0011): a switch making the deck a Reversible Deck or
 * not, and while it's one, its two Direction Labels edited in place beside
 * it, Forward and Reverse standing in for blank ones. Turning it off hides
 * Reverse and keeps its history. None of it needs AI; for a learner who can
 * use AI, turning it on asks the AI to suggest the labels, and Suggest
 * labels beside them asks again (#83). Suggestions are saved where the
 * learner hasn't typed their own, and show once the deck is refetched; a
 * label being typed meanwhile is kept, its own save coming after. With
 * both labels the learner's own, turning it on asks nothing, and Suggest
 * labels says they're kept.
 */
export function StudyBothWays({
  deck,
  canUseAI,
}: {
  deck: DeckDetails;
  canUseAI: boolean;
}) {
  const utils = trpc.useUtils();
  const update = useDeckUpdate(deck.id);
  const suggest = trpc.deck.suggestDirectionLabels.useMutation({
    onSuccess: ({ suggested }) => {
      if (suggested) utils.deck.getById.invalidate({ id: deck.id });
      else toast.success('Both labels are your own, so they’re kept');
    },
    onError: (error) =>
      toast.error(`Couldn't suggest labels: ${error.message}`),
  });
  const suggestLabels = () => suggest.mutate({ deckId: deck.id });

  function setReversible(reversible: boolean) {
    if (reversible && canUseAI && hasLabelToSuggest(deck)) {
      update.mutate({ id: deck.id, reversible }, { onSuccess: suggestLabels });
    } else {
      update.mutate({ id: deck.id, reversible });
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Switch
        checked={deck.reversible}
        onChange={setReversible}
        // Lined up with the description above
        className="-ml-2"
      >
        Study both ways
      </Switch>
      {deck.reversible && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-white/80">
          <InPlaceField
            label="Forward label"
            editLabel="Edit the Forward label"
            value={deck.forwardLabel ?? ''}
            placeholder={DEFAULT_DIRECTION_LABELS.FORWARD}
            maxLength={MAX_DIRECTION_LABEL_LENGTH}
            onSave={(label) =>
              update.mutate({ id: deck.id, forwardLabel: label || null })
            }
          />
          <span aria-hidden className="text-white/40">
            ·
          </span>
          <InPlaceField
            label="Reverse label"
            editLabel="Edit the Reverse label"
            value={deck.reverseLabel ?? ''}
            placeholder={DEFAULT_DIRECTION_LABELS.REVERSE}
            maxLength={MAX_DIRECTION_LABEL_LENGTH}
            onSave={(label) =>
              update.mutate({ id: deck.id, reverseLabel: label || null })
            }
          />
          {canUseAI && (
            <button
              type="button"
              onClick={suggestLabels}
              disabled={suggest.isPending}
              className="ml-2 inline-flex items-center text-xs text-white/50 transition-colors hover:text-white disabled:opacity-60"
            >
              <Sparkles aria-hidden className="mr-1 h-3.5 w-3.5" />
              {suggest.isPending ? 'Suggesting…' : 'Suggest labels'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * On a Reversible Deck, the cards Reverse can't tell apart, those sharing a
 * primary answer, by name; nothing when there are none. Each is still
 * graded against its own front.
 */
export function SharedAnswersWarning({ cards }: { cards: Flashcard[] }) {
  const groups = cardsSharingAnswers(cards);
  if (groups.length === 0) return null;
  return (
    <div
      role="status"
      aria-label="Cards Reverse can't tell apart"
      className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100"
    >
      <p>
        In Reverse, these cards show the same answer, so there&apos;s no telling
        which front is wanted. Each is graded against its own front.
      </p>
      <ul className="mt-1 list-disc pl-5">
        {groups.map((group) => (
          <li key={group[0].id} className="break-words">
            {group[0].canonicalAnswer}:{' '}
            {group.map((card) => `“${card.front}”`).join(', ')}
          </li>
        ))}
      </ul>
    </div>
  );
}
