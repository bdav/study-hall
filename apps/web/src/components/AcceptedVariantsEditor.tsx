import { useId } from 'react';
import { X } from 'lucide-react';
import { glassInputClassName } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Lists one Canonical Answer's Accepted Variants, with the box for adding
 * one, as part of the answers form: adding and removing them changes only
 * the form, saved with its Save. Variants don't change what the card asks,
 * so they never reset its progress (ADR-0004). `name` is the answer as
 * typed; a variant that is the same as one of the card's answers is
 * flagged, and typed text already accepted can't be added. `description`,
 * when given, explains variants below the box. With no variants yet, only
 * the box shows.
 */
export function AcceptedVariantsEditor({
  name,
  variants,
  isSameAsAnswer,
  text,
  isTextAccepted,
  onTextChange,
  onAdd,
  onRemove,
  description,
}: {
  name: string;
  variants: string[];
  isSameAsAnswer: (variant: string) => boolean;
  text: string;
  isTextAccepted: boolean;
  onTextChange: (text: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  description?: string;
}) {
  const inputId = useId();
  const descriptionId = useId();
  const canAdd = text.trim() !== '' && !isTextAccepted;

  return (
    <div className="text-sm">
      {variants.length > 0 && (
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-xs text-white/50">Variants</span>
          <ul
            aria-label={`Accepted variants of ${name}`}
            className="flex flex-wrap gap-2"
          >
            {variants.map((variant, i) => {
              const sameAsAnswer = isSameAsAnswer(variant);
              return (
                <li
                  key={variant}
                  className={`flex items-center gap-1 rounded-full py-0.5 pl-3 pr-1 ${sameAsAnswer ? 'bg-amber-300/20' : 'bg-white/10'}`}
                >
                  <span>{variant}</span>
                  {sameAsAnswer && (
                    <span className="text-xs text-amber-200/90">
                      same as an answer
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${variant}`}
                    onClick={() => onRemove(i)}
                    className="rounded-full p-0.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label htmlFor={inputId} className="sr-only">
          New accepted variant of {name}
        </label>
        <Input
          id={inputId}
          value={text}
          placeholder="Add variant"
          aria-describedby={description ? descriptionId : undefined}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the variant rather than submitting a surrounding form
            if (e.key === 'Enter') {
              e.preventDefault();
              if (canAdd) onAdd();
            }
          }}
          className={glassInputClassName}
        />
        <Button
          type="button"
          size="sm"
          aria-label={`Add variant of ${name}`}
          disabled={!canAdd}
          onClick={onAdd}
          className="bg-white/20 text-white hover:bg-white/30"
        >
          Add
        </Button>
      </div>
      {text.trim() !== '' && isTextAccepted && (
        <p className="mt-1 text-xs text-amber-200/90">Already accepted.</p>
      )}
      {description && (
        <p id={descriptionId} className="mt-1 text-xs text-white/50">
          {description}
        </p>
      )}
    </div>
  );
}
