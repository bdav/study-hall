import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, RefreshCw, Undo2, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { KeepVariantsDialog } from '@/components/KeepVariantsDialog';
import { type AcceptedVariant } from '@/lib/cards';

interface FlashCardTileProps {
  front: string;
  back: string;
  /** `keepVariantIds` comes with a changed answer that had variants. */
  onSave: (front: string, back: string, keepVariantIds?: string[]) => void;
  onDelete: () => void;
  /** Marks the card known (ADR-0009). */
  onMarkKnown: () => void;
  isSaving?: boolean;
  /** The answer's Accepted Variants. */
  variants: AcceptedVariant[];
}

export function FlashCardTile({
  front,
  back,
  onSave,
  onDelete,
  onMarkKnown,
  isSaving,
  variants,
}: FlashCardTileProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [localFront, setLocalFront] = useState(front);
  const [localBack, setLocalBack] = useState(back);
  const [isDirty, setIsDirty] = useState(false);
  const [prevFront, setPrevFront] = useState(front);
  const [prevBack, setPrevBack] = useState(back);
  // A changed answer waiting on which of its variants still fit
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Sync from server when props change (adjust state during render)
  if (front !== prevFront || back !== prevBack) {
    setPrevFront(front);
    setPrevBack(back);
    setLocalFront(front);
    setLocalBack(back);
    setIsDirty(false);
  }

  // An answer with variants isn't saved as you type: leaving it asks which
  // variants still fit the new answer
  const asksAboutVariants = variants.length > 0;

  function debouncedSave(newFront: string, newBack: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!newFront.trim() || !newBack.trim()) return;
      if (asksAboutVariants && newBack.trim() !== back) {
        if (newFront.trim() !== front) onSaveRef.current(newFront.trim(), back);
        return;
      }
      onSaveRef.current(newFront.trim(), newBack.trim());
    }, 800);
  }

  function handleBackBlur() {
    const answer = localBack.trim();
    if (!asksAboutVariants || !answer || answer === back) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPendingAnswer(answer);
  }

  function saveAnswer(keepVariantIds: string[]) {
    if (pendingAnswer === null) return;
    onSaveRef.current(
      localFront.trim() || front,
      pendingAnswer,
      keepVariantIds,
    );
    setPendingAnswer(null);
  }

  function cancelAnswer() {
    setPendingAnswer(null);
    setLocalBack(back);
    setIsDirty(localFront !== front);
    // A front edited alongside the answer is still saved
    debouncedSave(localFront, back);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleFrontChange = (value: string) => {
    setLocalFront(value);
    setIsDirty(value !== front || localBack !== back);
    debouncedSave(value, localBack);
  };

  const handleBackChange = (value: string) => {
    setLocalBack(value);
    setIsDirty(localFront !== front || value !== back);
    debouncedSave(localFront, value);
  };

  const handleRevert = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLocalFront(front);
    setLocalBack(back);
    setIsDirty(false);
  };

  return (
    <div
      className="group relative w-full pt-3"
      style={{ perspective: '600px' }}
    >
      <div
        className="relative aspect-3/2 w-full transition-transform duration-500"
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front face */}
        <div
          className="absolute inset-0 flex flex-col rounded-xl border border-white/30 bg-white/10 backdrop-blur-sm"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
              Front
            </span>
            <div className="flex items-center gap-1">
              {isDirty && (
                <button
                  onClick={handleRevert}
                  className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
                  title="Revert changes"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
              )}
              {isSaving && (
                <span className="text-[10px] text-white/40">Saving...</span>
              )}
              <button
                onClick={() => setIsFlipped(true)}
                className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
                title="Flip to back"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center px-4 pb-3">
            <textarea
              value={localFront}
              onChange={(e) => handleFrontChange(e.target.value)}
              className="w-full resize-none bg-transparent text-center text-base font-medium text-white outline-none placeholder:text-white/30"
              rows={2}
              placeholder="Front text..."
            />
          </div>
          <div className="flex justify-end gap-1 px-3 pb-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMarkKnown();
              }}
              className="rounded p-1 text-white/0 transition-colors group-hover:text-white/30 group-hover:hover:text-white/80 focus-visible:text-white/60"
              title="Mark known"
            >
              <BadgeCheck className="h-3.5 w-3.5" />
            </button>
            <ConfirmDialog
              title="Delete card"
              description="Are you sure you want to delete this card? This cannot be undone."
              confirmLabel="Delete"
              onConfirm={onDelete}
              trigger={
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="rounded p-1 text-white/0 transition-colors group-hover:text-white/30 group-hover:hover:text-red-400"
                  title="Delete card"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              }
            />
          </div>
        </div>

        {/* Back face */}
        <div
          className="absolute inset-0 flex flex-col rounded-xl border border-white/30 bg-white/15 backdrop-blur-sm"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <div className="flex items-center justify-between px-3 pt-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
              Back
            </span>
            <div className="flex items-center gap-1">
              {isDirty && (
                <button
                  onClick={handleRevert}
                  // Keeps focus in the answer, so leaving it doesn't ask
                  // about variants of an answer being reverted
                  onMouseDown={(e) => e.preventDefault()}
                  className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
                  title="Revert changes"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
              )}
              {isSaving && (
                <span className="text-[10px] text-white/40">Saving...</span>
              )}
              <button
                onClick={() => setIsFlipped(false)}
                className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
                title="Flip to front"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center px-4 pb-3">
            <textarea
              value={localBack}
              onChange={(e) => handleBackChange(e.target.value)}
              onBlur={handleBackBlur}
              className="w-full resize-none bg-transparent text-center text-base font-medium text-white outline-none placeholder:text-white/30"
              rows={2}
              placeholder="Back text..."
            />
          </div>
          <div className="flex justify-end gap-1 px-3 pb-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMarkKnown();
              }}
              className="rounded p-1 text-white/0 transition-colors group-hover:text-white/30 group-hover:hover:text-white/80 focus-visible:text-white/60"
              title="Mark known"
            >
              <BadgeCheck className="h-3.5 w-3.5" />
            </button>
            <ConfirmDialog
              title="Delete card"
              description="Are you sure you want to delete this card? This cannot be undone."
              confirmLabel="Delete"
              onConfirm={onDelete}
              trigger={
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="rounded p-1 text-white/0 transition-colors group-hover:text-white/30 group-hover:hover:text-red-400"
                  title="Delete card"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              }
            />
          </div>
        </div>
      </div>
      {pendingAnswer !== null && (
        <KeepVariantsDialog
          oldAnswer={back}
          newAnswer={pendingAnswer}
          variants={variants}
          cancelLabel="Cancel"
          onSave={saveAnswer}
          onCancel={cancelAnswer}
        />
      )}
    </div>
  );
}
