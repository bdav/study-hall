import { useState, type FormEvent } from 'react';
import { isSameAnswer, type AcceptedVariant } from '@/lib/cards';
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

/**
 * Asks which Accepted Variants still fit a card's changed answer, since a
 * rewrite can leave the old answer's variants accepting wrong answers. All
 * start ticked, so a typo fix keeps them in one click; the unticked ones are
 * removed with the edit. A variant the new answer has become can't be kept,
 * as the API drops it.
 */
export function KeepVariantsDialog({
  oldAnswer,
  newAnswer,
  variants,
  cancelLabel,
  isSaving = false,
  onSave,
  onCancel,
}: {
  oldAnswer: string;
  newAnswer: string;
  variants: AcceptedVariant[];
  cancelLabel: string;
  isSaving?: boolean;
  onSave: (keepVariantIds: string[]) => void;
  onCancel: () => void;
}) {
  const isNewAnswer = (variant: AcceptedVariant) =>
    isSameAnswer(variant.text, newAnswer);
  const [kept, setKept] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        variants
          .filter((variant) => !isNewAnswer(variant))
          .map((variant) => variant.id),
      ),
  );

  function toggle(id: string, keep: boolean) {
    setKept((prev) => {
      const next = new Set(prev);
      if (keep) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    onSave(variants.map((v) => v.id).filter((id) => kept.has(id)));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className={glassDialogClassName} showCloseButton={false}>
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle className="text-white">
              Which accepted variants still fit?
            </DialogTitle>
            <DialogDescription className="text-white/70">
              You changed the answer from “{oldAnswer}” to “{newAnswer}”.
              Unticked variants are removed.
            </DialogDescription>
          </DialogHeader>
          <ul className="mt-4 space-y-2">
            {variants.map((variant) => (
              <li key={variant.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={kept.has(variant.id)}
                    disabled={isNewAnswer(variant)}
                    onChange={(e) => toggle(variant.id, e.target.checked)}
                    className="size-4 accent-white"
                  />
                  {variant.text}
                  {isNewAnswer(variant) && (
                    <span className="text-xs text-white/50">
                      same as the new answer
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
          <DialogFooter className="mt-6 border-white/20 bg-white/5">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="border-white/20 bg-white/10 text-white hover:bg-white/20"
            >
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              disabled={isSaving}
              className="bg-white/20 text-white hover:bg-white/30"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
