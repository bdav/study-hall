import { useId, useState, type FormEvent } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { toFlashcard, type Flashcard } from '@/lib/cards';
import { useAnswersForm } from '@/hooks/useAnswersForm';
import { Button } from '@/components/ui/button';
import { CardStack } from '@/components/CardStack';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AnswersEditor } from '@/components/AnswersEditor';

const flipButtonClasses =
  'absolute right-3 top-3 rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80';

/**
 * The card being studied in edit mode, the one in play or one reviewed: its
 * front view edits the front and its back view the answers, in place, as
 * on the deck's Cards tab. Front and answers save together with Save, and
 * changing the front or the answers' texts resets the card's progress and
 * keeps its attempts (ADR-0004), going to `onEdited`; a Save that resets
 * nothing, like choosing another primary or changing Accepted Variants,
 * goes to `onChanged`. Cancel drops the edits; Delete,
 * once confirmed, removes the card. Mounted each time edit mode turns on,
 * so it starts from the card as it is. Marked `data-card-editor`, so page
 * shortcuts leave its keys alone.
 */
export function StudyCardEditor({
  deckId,
  card,
  queueLength,
  progress,
  isFlipped,
  onFlip,
  onEdited,
  onChanged,
  onDeleted,
  onDone,
}: {
  deckId: string;
  card: Flashcard;
  queueLength: number;
  progress: string | undefined;
  isFlipped: boolean;
  onFlip: () => void;
  onEdited: (card: Flashcard) => void;
  onChanged: (card: Flashcard) => void;
  onDeleted: () => void;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [front, setFront] = useState(card.front);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const form = useAnswersForm(card);
  const frontId = useId();
  const frontChanged = front.trim() !== card.front;

  function refreshDeck() {
    utils.deck.getById.invalidate({ id: deckId });
    utils.card.listByDeck.invalidate({ deckId });
    utils.card.history.invalidate({ cardId: card.id });
  }

  const update = trpc.card.update.useMutation({
    onSuccess: (updated) => {
      const edited = toFlashcard(updated);
      if (frontChanged || form.resetsProgress) onEdited(edited);
      else onChanged(edited);
      refreshDeck();
      onDone();
    },
    onError: (error) =>
      toast.error(
        error.data?.code === 'BAD_REQUEST' || error.data?.code === 'CONFLICT'
          ? error.message
          : "Couldn't save the card",
      ),
  });

  const remove = trpc.card.delete.useMutation({
    onSuccess: () => {
      setIsConfirmingDelete(false);
      onDeleted();
      refreshDeck();
    },
    onError: () => toast.error("Couldn't delete the card"),
  });

  const canSave = front.trim() !== '' && form.canSave && !update.isPending;

  function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    if (!frontChanged && !form.isChanged) {
      onDone();
      return;
    }
    update.mutate({
      cardId: card.id,
      front: front.trim(),
      canonicalAnswers: form.edits,
    });
  }

  // On the face in view only, so each button is there once
  const actions = (
    <div className="mt-6 flex w-full items-center justify-between gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setIsConfirmingDelete(true)}
        className="text-white/70 hover:bg-white/10 hover:text-white"
      >
        <Trash2 className="mr-1 h-4 w-4" />
        Delete
      </Button>
      <div className="flex gap-2">
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
          type="submit"
          size="sm"
          disabled={!canSave}
          className="bg-white/20 text-white hover:bg-white/30"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );

  function flipButton(label: string) {
    return (
      <button
        type="button"
        onClick={onFlip}
        className={flipButtonClasses}
        title={label}
        aria-label={label}
      >
        <RefreshCw className="h-4 w-4" />
      </button>
    );
  }

  return (
    <>
      <form onSubmit={handleSave} data-card-editor>
        <CardStack
          queueLength={queueLength}
          progress={progress}
          isFlipped={isFlipped}
          backChildren={
            <div className="w-full text-left text-white">
              <p className="text-center text-sm uppercase tracking-wide text-white/50">
                {front.trim() || card.front}
              </p>
              <div className="mt-3">
                <AnswersEditor form={form} />
              </div>
              {isFlipped && actions}
              {flipButton('Flip to front')}
            </div>
          }
        >
          <div className="w-full text-center">
            <label
              htmlFor={frontId}
              className="text-xs uppercase tracking-wide text-white/50"
            >
              Front
            </label>
            {/* Wraps and grows with the text; Enter saves, as fronts are one line */}
            <textarea
              id={frontId}
              rows={1}
              value={front}
              autoFocus={!isFlipped}
              onChange={(e) => setFront(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              className="mt-1 field-sizing-content w-full resize-none border-0 border-b-2 border-white/40 bg-transparent py-2 text-center text-2xl font-bold tracking-wide text-white outline-none focus:border-white/60"
            />
            {!isFlipped && actions}
          </div>
          {flipButton('Flip to back')}
        </CardStack>
      </form>

      <ConfirmDialog
        open={isConfirmingDelete}
        onOpenChange={setIsConfirmingDelete}
        title="Delete this card?"
        description={`"${card.front}" is removed from the deck along with your answers to it. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => remove.mutate({ cardId: card.id })}
      />
    </>
  );
}
