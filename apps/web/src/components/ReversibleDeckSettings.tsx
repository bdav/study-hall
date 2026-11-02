import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { type Flashcard } from '@/lib/cards';
import {
  cardsSharingAnswers,
  DEFAULT_DIRECTION_LABELS,
  MAX_DIRECTION_LABEL_LENGTH,
  type DirectedDeck,
} from '@/lib/directions';
import { InPlaceField } from '@/components/InPlaceField';
import { Switch } from '@/components/Switch';

type DeckDetails = DirectedDeck & { id: string; description: string | null };

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
 * Reverse and keeps its history. None of it needs AI.
 */
export function StudyBothWays({ deck }: { deck: DeckDetails }) {
  const update = useDeckUpdate(deck.id);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <Switch
        checked={deck.reversible}
        onChange={(reversible) => update.mutate({ id: deck.id, reversible })}
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
