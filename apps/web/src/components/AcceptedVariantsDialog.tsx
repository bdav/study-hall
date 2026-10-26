import { useState } from 'react';
import { type Flashcard } from '@/lib/cards';
import { glassDialogClassName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AcceptedVariantsEditor } from '@/components/AcceptedVariantsEditor';

/** Manages one card's Accepted Variants, from the deck's Cards tab. */
export function AcceptedVariantsDialog({
  deckId,
  card,
  onClose,
}: {
  deckId: string;
  card: Flashcard | undefined;
  onClose: () => void;
}) {
  // A variant typed but not added, which Done would otherwise lose
  const [hasDraft, setHasDraft] = useState(false);

  function close() {
    setHasDraft(false);
    onClose();
  }

  return (
    <Dialog open={!!card} onOpenChange={(open) => !open && close()}>
      <DialogContent className={glassDialogClassName} showCloseButton={false}>
        {card && (
          <>
            <DialogHeader>
              <DialogTitle className="text-white">{card.front}</DialogTitle>
              <DialogDescription className="text-white/70">
                Answer: {card.canonicalAnswer}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <AcceptedVariantsEditor
                deckId={deckId}
                card={card}
                onDraftChange={setHasDraft}
              />
            </div>
            <DialogFooter className="mt-6 border-white/20 bg-white/5">
              <Button
                type="button"
                disabled={hasDraft}
                onClick={close}
                className="bg-white/20 text-white hover:bg-white/30"
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
