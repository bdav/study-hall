import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { isSameAnswer, toFlashcard, type Flashcard } from '@/lib/cards';
import { useAnswersForm } from '@/hooks/useAnswersForm';
import { Button } from '@/components/ui/button';
import { AnswersEditor } from '@/components/AnswersEditor';
import { AcceptedVariantsEditor } from '@/components/AcceptedVariantsEditor';

/**
 * A card's answers below it on the Cards tab: a summary of its Canonical
 * Answers and Accepted Variants that opens, in place, into the form for
 * them, saved together with Save, and, on a Reversible Deck, the Reverse
 * Variants of its front (ADR-0011). `onSaved` says whether the saved
 * answers reset the card's progress; variant changes reset nothing. Marked
 * `data-card-answers`, so page shortcuts can leave its keys alone.
 */
export function CardAnswers({
  deckId,
  card,
  isOpen,
  onOpen,
  onClose,
  onSaved,
  reversible = false,
  disabled = false,
  className = '',
}: {
  deckId: string;
  card: Flashcard;
  /** On a Reversible Deck, its front's Reverse Variants show too. */
  reversible?: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSaved?: (card: Flashcard, resetsProgress: boolean) => void;
  /** The summary can't be chosen, as while the Cards tab is selecting. */
  disabled?: boolean;
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
          reversible={reversible}
          onDone={onClose}
          onSaved={onSaved}
        />
      </section>
    );
  }

  return (
    <CardAnswersSummary
      card={card}
      reversible={reversible}
      onOpen={onOpen}
      disabled={disabled}
      className={`text-left ${className}`}
    />
  );
}

/**
 * The summary of a card's Canonical Answers and Accepted Variants, read
 * only; choosing it opens where they're edited. `caption`, when given,
 * heads it, saying what it is. A pencil, on the caption or else after the
 * answers, shows it can be chosen, unless `disabled`, as when they're open
 * for editing already. Every answer and variant shows in full, wrapping.
 * On a Reversible Deck, the front's Reverse Variants follow (ADR-0011).
 */
export function CardAnswersSummary({
  card,
  onOpen,
  caption,
  reversible = false,
  disabled = false,
  className = '',
}: {
  card: Flashcard;
  reversible?: boolean;
  onOpen: () => void;
  caption?: string;
  disabled?: boolean;
  className?: string;
}) {
  const variants = card.answers.flatMap((answer) =>
    answer.acceptedVariants.map((variant) => variant.text),
  );
  // On the caption, or else after the answers
  const pencil = !disabled && (
    <Pencil aria-hidden className="ml-1 inline h-3 w-3 text-white/50" />
  );
  return (
    <button
      type="button"
      aria-label={`Answers of ${card.front}`}
      data-card-answers
      onClick={onOpen}
      disabled={disabled}
      className={`mt-2 block w-full rounded px-1 text-sm text-white/70 transition-colors enabled:hover:bg-white/10 enabled:hover:text-white disabled:cursor-default ${className}`}
    >
      {caption && (
        <p className="text-xs uppercase tracking-wide text-white/50">
          {caption}
          {pencil}
        </p>
      )}
      <p className="break-words">
        {card.answers.map((answer) => answer.text).join(', ')}
        {!caption && pencil}
      </p>
      {variants.length > 0 && (
        <p className="break-words text-xs text-white/50">
          Variants: {variants.join(', ')}
        </p>
      )}
      {reversible && card.reverseVariants.length > 0 && (
        <p className="break-words text-xs text-white/50">
          Reverse variants:{' '}
          {card.reverseVariants.map((variant) => variant.text).join(', ')}
        </p>
      )}
    </button>
  );
}

/**
 * The open form: answers and their variants save together with Save;
 * Cancel drops them.
 */
function AnswersForm({
  deckId,
  card,
  reversible,
  onDone,
  onSaved,
}: {
  deckId: string;
  card: Flashcard;
  reversible: boolean;
  onDone: () => void;
  onSaved?: (card: Flashcard, resetsProgress: boolean) => void;
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
        error.data?.code === 'BAD_REQUEST' || error.data?.code === 'CONFLICT'
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
      reverseVariants: form.reverseEdits,
    });
  }

  return (
    <>
      <AnswersEditor form={form} />
      {reversible && (
        <div className="mt-3">
          <AcceptedVariantsEditor
            reverse
            name={card.front}
            variants={form.reverseVariants}
            isSameAsAnswer={(variant) => isSameAnswer(variant, card.front)}
            text={form.reverseVariantText}
            isTextAccepted={form.isReverseVariantTextAccepted}
            onTextChange={form.typeReverseVariant}
            onAdd={form.addReverseVariant}
            onRemove={form.removeReverseVariant}
            description="Reverse variants are other ways to write the front, accepted when the card is studied in Reverse."
          />
        </div>
      )}
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
