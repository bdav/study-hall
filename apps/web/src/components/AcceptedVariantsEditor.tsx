import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { glassInputClassName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Lists a card's Accepted Variants and adds and removes them, each change
 * saved straight away. Variants don't change what the card asks, so they
 * never reset its progress (ADR-0004). Not a form of its own, so it can sit
 * inside the card's edit form. `onDraftChange` says whether a typed variant
 * is waiting to be added, so the surrounding dialog can hold off closing.
 */
export function AcceptedVariantsEditor({
  deckId,
  card,
  onChanged,
  onDraftChange,
}: {
  deckId: string;
  card: Flashcard;
  onChanged?: (card: Flashcard) => void;
  onDraftChange?: (hasDraft: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [text, setText] = useState('');
  const headingId = useId();
  const inputId = useId();

  function changeText(value: string) {
    setText(value);
    onDraftChange?.(value.trim() !== '');
  }

  function handleChanged(updated: Parameters<typeof toFlashcard>[0]) {
    onChanged?.(toFlashcard(updated));
    utils.deck.getById.invalidate({ id: deckId });
    utils.card.listByDeck.invalidate({ deckId });
  }

  const add = trpc.card.addVariant.useMutation({
    onSuccess: (updated) => {
      changeText('');
      handleChanged(updated);
    },
    onError: (error) =>
      toast.error(
        error.data?.code === 'CONFLICT'
          ? error.message
          : "Couldn't add the variant",
      ),
  });
  const remove = trpc.card.removeVariant.useMutation({
    onSuccess: handleChanged,
    onError: () => toast.error("Couldn't remove the variant"),
  });

  const { canonicalAnswerId } = card;
  if (!canonicalAnswerId) return null;

  const canAdd = text.trim() !== '' && !add.isPending;

  function handleAdd() {
    if (!canAdd || !canonicalAnswerId) return;
    add.mutate({ canonicalAnswerId, text: text.trim() });
  }

  return (
    <div>
      <h3 id={headingId} className="text-sm font-medium text-white">
        Accepted variants
      </h3>
      <p className="mt-1 text-xs text-white/60">
        Other answers accepted as “{card.canonicalAnswer}”. Saved as you add or
        remove them, without resetting the card's progress.
      </p>
      {card.acceptedVariants.length === 0 ? (
        <p className="mt-2 text-sm text-white/40">None yet.</p>
      ) : (
        <ul aria-labelledby={headingId} className="mt-2 flex flex-wrap gap-2">
          {card.acceptedVariants.map((variant) => (
            <li
              key={variant.id}
              className="flex items-center gap-1 rounded-full bg-white/10 py-0.5 pl-3 pr-1 text-sm"
            >
              <span>{variant.text}</span>
              <button
                type="button"
                aria-label={`Remove ${variant.text}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ variantId: variant.id })}
                className="rounded-full p-0.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-end gap-2">
        <label htmlFor={inputId} className="sr-only">
          New accepted variant
        </label>
        <Input
          id={inputId}
          value={text}
          placeholder="Add a variant"
          onChange={(e) => changeText(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the variant rather than submitting a surrounding form
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          className={glassInputClassName}
        />
        <Button
          type="button"
          size="sm"
          disabled={!canAdd}
          onClick={handleAdd}
          className="bg-white/20 text-white hover:bg-white/30"
        >
          Add
        </Button>
      </div>
      {text.trim() !== '' && (
        <p className="mt-1 text-xs text-amber-200/90">
          Not added yet. Press Add or Enter.
        </p>
      )}
    </div>
  );
}
