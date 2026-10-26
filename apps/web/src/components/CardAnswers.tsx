import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { useAnswersForm } from '@/hooks/useAnswersForm';
import { Button } from '@/components/ui/button';
import { AnswersEditor } from '@/components/AnswersEditor';

/**
 * A card's answers below it, on the Cards tab and below the learner's answer
 * when studying: a summary of its Canonical Answers and Accepted Variants
 * that opens, in place, into the form for them. `onSaved` says whether the
 * saved answers reset the card's progress; variant changes reset nothing.
 * Marked `data-card-answers`, so page shortcuts can leave its keys alone.
 */
export function CardAnswers({
  deckId,
  card,
  isOpen,
  onOpen,
  onClose,
  onSaved,
  onVariantsChanged,
  className = '',
}: {
  deckId: string;
  card: Flashcard;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSaved?: (card: Flashcard, resetsProgress: boolean) => void;
  onVariantsChanged?: (card: Flashcard) => void;
  className?: string;
}) {
  const label = `Answers of ${card.front}`;
  if (isOpen) {
    return (
      <section
        aria-label={label}
        data-card-answers
        className={`mt-2 rounded-xl border border-white/20 bg-white/10 p-3 text-left text-white backdrop-blur-sm ${className}`}
      >
        <AnswersForm
          deckId={deckId}
          card={card}
          onDone={onClose}
          onSaved={onSaved}
          onVariantsChanged={onVariantsChanged}
        />
      </section>
    );
  }

  const [primary, ...others] = card.answers;
  const variants = card.answers.flatMap((answer) =>
    answer.acceptedVariants.map((variant) => variant.text),
  );
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={false}
      data-card-answers
      onClick={onOpen}
      className={`mt-2 block w-full rounded px-1 text-left text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white ${className}`}
    >
      <p className="truncate">
        {primary?.text}
        {others.length > 0 &&
          ` · also ${others.map((answer) => answer.text).join(', ')}`}
      </p>
      {variants.length > 0 && (
        <p className="truncate text-xs text-white/50">
          Variants: {variants.join(', ')}
        </p>
      )}
    </button>
  );
}

/** The open form: answers save together with Save; Cancel drops them. */
function AnswersForm({
  deckId,
  card,
  onDone,
  onSaved,
  onVariantsChanged,
}: {
  deckId: string;
  card: Flashcard;
  onDone: () => void;
  onSaved?: (card: Flashcard, resetsProgress: boolean) => void;
  onVariantsChanged?: (card: Flashcard) => void;
}) {
  const form = useAnswersForm(card);
  const utils = trpc.useUtils();
  const update = trpc.card.update.useMutation({
    onSuccess: (updated) => {
      onSaved?.(toFlashcard(updated), form.resetsProgress);
      utils.card.listByDeck.invalidate({ deckId });
      utils.deck.getById.invalidate({ id: deckId });
      onDone();
    },
    onError: (error) =>
      toast.error(
        error.data?.code === 'BAD_REQUEST'
          ? error.message
          : "Couldn't save the answers",
      ),
  });

  function save() {
    if (!form.isChanged) {
      onDone();
      return;
    }
    update.mutate({
      cardId: card.id,
      canonicalAnswers: form.edits,
      keepVariantIds: form.keepVariantIds,
    });
  }

  return (
    <>
      <AnswersEditor
        form={form}
        deckId={deckId}
        onVariantsChanged={onVariantsChanged}
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDone}
          className="text-white/70 hover:bg-white/10 hover:text-white"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!form.canSave || update.isPending}
          onClick={save}
          className="bg-white/20 text-white hover:bg-white/30"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </>
  );
}
