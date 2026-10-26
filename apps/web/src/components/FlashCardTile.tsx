import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Undo2, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';

interface FlashCardTileProps {
  front: string;
  back: string;
  onSave: (front: string, back: string) => void;
  onDelete: () => void;
  isSaving?: boolean;
  /** How many Accepted Variants the answer has. */
  variantCount: number;
  onEditVariants: () => void;
}

export function FlashCardTile({
  front,
  back,
  onSave,
  onDelete,
  isSaving,
  variantCount,
  onEditVariants,
}: FlashCardTileProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [localFront, setLocalFront] = useState(front);
  const [localBack, setLocalBack] = useState(back);
  const [isDirty, setIsDirty] = useState(false);
  const [prevFront, setPrevFront] = useState(front);
  const [prevBack, setPrevBack] = useState(back);
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

  function debouncedSave(newFront: string, newBack: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (newFront.trim() && newBack.trim()) {
        onSaveRef.current(newFront.trim(), newBack.trim());
      }
    }, 800);
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
          <div className="flex justify-end px-3 pb-2">
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
              className="w-full resize-none bg-transparent text-center text-base font-medium text-white outline-none placeholder:text-white/30"
              rows={2}
              placeholder="Back text..."
            />
          </div>
          <div className="flex items-center justify-between px-3 pb-2">
            <button
              onClick={onEditVariants}
              aria-label={`Accepted variants for ${front}`}
              className="rounded px-1 text-[10px] font-medium uppercase tracking-wider text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
            >
              {variantCount === 0
                ? 'Variants'
                : `${variantCount} ${variantCount === 1 ? 'variant' : 'variants'}`}
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
    </div>
  );
}
