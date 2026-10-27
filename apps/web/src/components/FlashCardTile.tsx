import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Pencil, RefreshCw, Undo2, Trash2 } from 'lucide-react';
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
  /**
   * While the Cards tab is selecting cards: the tile's buttons are hidden,
   * its rows keeping their height so the text doesn't move.
   */
  isSelecting?: boolean;
  isSaving?: boolean;
  /** The answer's Accepted Variants. */
  variants: AcceptedVariant[];
}

/**
 * A face's text, edited in place: shown in full, wrapping and growing with
 * it, with a pencil beside it at rest, as the deck title has. While it has
 * focus, the pencil goes and the text is underlined.
 */
function TileField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  showPencil,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder: string;
  showPencil: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  return (
    // The face's middle, all of which puts the cursor in the text
    <div
      data-tile-field
      onClick={() => ref.current?.focus()}
      className="flex min-w-0 flex-1 cursor-text items-center justify-center gap-1.5 px-4 pb-3"
    >
      <textarea
        ref={ref}
        aria-label={label}
        // Two rows where the text can't size itself, full width there too
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          onBlur?.();
        }}
        placeholder={placeholder}
        className={`field-sizing-content min-w-12 max-w-full resize-none border-b-2 bg-transparent text-center text-base font-medium text-white outline-none transition-colors placeholder:text-white/30 not-supports-[field-sizing:content]:w-full ${
          isFocused ? 'border-white/60' : 'border-transparent'
        }`}
      />
      {showPencil && !isFocused && (
        <button
          type="button"
          // The text itself takes focus from the keyboard; a click here
          // reaches the face's middle, which focuses it
          tabIndex={-1}
          aria-label={`Edit ${label.toLowerCase()}`}
          title={`Edit ${label.toLowerCase()}`}
          className="shrink-0 rounded p-0.5 text-white/40 transition-colors hover:text-white/70"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function FlashCardTile({
  front,
  back,
  onSave,
  onDelete,
  onMarkKnown,
  isSelecting = false,
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
        // The faces share one grid cell: the tile is 3:2 at least, and grows
        // to show a long front or answer in full
        className="grid aspect-3/2 w-full grid-cols-1 transition-transform duration-500"
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front face */}
        <div
          className="col-start-1 row-start-1 flex min-w-0 flex-col rounded-xl border border-white/30 bg-white/10 backdrop-blur-sm"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="flex min-h-[30px] items-center justify-between px-3 pt-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
              Front
            </span>
            {!isSelecting && (
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
            )}
          </div>
          <TileField
            label="Card front"
            value={localFront}
            onChange={handleFrontChange}
            placeholder="Front text..."
            showPencil={!isSelecting}
          />
          <div className="flex min-h-[30px] justify-end gap-1 px-3 pb-2">
            {!isSelecting && (
              <>
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
              </>
            )}
          </div>
        </div>

        {/* Back face */}
        <div
          className="col-start-1 row-start-1 flex min-w-0 flex-col rounded-xl border border-white/30 bg-white/15 backdrop-blur-sm"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <div className="flex min-h-[30px] items-center justify-between px-3 pt-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
              Back
            </span>
            {!isSelecting && (
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
            )}
          </div>
          <TileField
            label="Card answer"
            value={localBack}
            onChange={handleBackChange}
            onBlur={handleBackBlur}
            placeholder="Back text..."
            showPencil={!isSelecting}
          />
          <div className="flex min-h-[30px] justify-end gap-1 px-3 pb-2">
            {!isSelecting && (
              <>
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
              </>
            )}
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
