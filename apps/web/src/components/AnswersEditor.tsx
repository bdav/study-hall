import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import { type Flashcard } from '@/lib/cards';
import { glassInputClassName } from '@/lib/utils';
import { type AnswersForm } from '@/hooks/useAnswersForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AcceptedVariantsEditor } from '@/components/AcceptedVariantsEditor';

/**
 * A card's Canonical Answers as one form: each answer's field, the radio
 * choosing the primary, removing it, and below it its Accepted Variants.
 * A saved answer's variants are edited straight away; once the answer is
 * retyped they become ticked boxes, for which still fit it on Save.
 */
export function AnswersEditor({
  form,
  deckId,
  onVariantsChanged,
}: {
  form: AnswersForm;
  deckId: string;
  onVariantsChanged?: (card: Flashcard) => void;
}) {
  const headingId = useId();
  const primaryName = useId();

  return (
    <div>
      <p id={headingId} className="text-sm text-white/70">
        Answers
      </p>
      <ol aria-labelledby={headingId} className="mt-1 space-y-3">
        {form.answers.map((answer, i) => {
          const label = `Answer ${i + 1}`;
          const saved = form.savedOf(answer);
          return (
            <li key={answer.key}>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name={primaryName}
                  checked={i === 0}
                  onChange={() => form.makePrimary(i)}
                  aria-label={`${label} is primary`}
                  title="Primary answer"
                  className="size-4 accent-white"
                />
                <Input
                  aria-label={label}
                  value={answer.text}
                  autoFocus={answer.isNew}
                  onChange={(e) => form.typeAnswer(i, e.target.value)}
                  className={glassInputClassName}
                />
                <button
                  type="button"
                  aria-label={`Remove answer ${i + 1}`}
                  disabled={form.answers.length === 1}
                  onClick={() => form.remove(i)}
                  className="rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {saved && !saved.retyped && (
                <div className="mt-1 pl-6">
                  <AcceptedVariantsEditor
                    deckId={deckId}
                    answer={saved.saved}
                    onChanged={onVariantsChanged}
                    onDraftChange={(hasDraft) =>
                      form.setVariantDraft(saved.saved.id, hasDraft)
                    }
                  />
                </div>
              )}
              {saved?.retyped && saved.saved.acceptedVariants.length > 0 && (
                <fieldset className="mt-1 pl-6 text-sm">
                  <legend className="text-xs text-white/60">
                    Which of “{saved.saved.text}”’s variants still fit?
                  </legend>
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {saved.saved.acceptedVariants.map((variant) => {
                      const canKeep = form.canKeep(variant);
                      return (
                        <li key={variant.id}>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={canKeep && form.isKept(variant.id)}
                              disabled={!canKeep}
                              onChange={(e) =>
                                form.setKept(variant.id, e.target.checked)
                              }
                              className="size-4 accent-white"
                            />
                            {variant.text}
                            {!canKeep && (
                              <span className="text-xs text-white/50">
                                same as an answer
                              </span>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              )}
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={form.add}
        className="mt-2 text-white/70 hover:bg-white/10 hover:text-white"
      >
        <Plus className="mr-1 h-4 w-4" />
        Add answer
      </Button>
      <p className="mt-1 text-xs text-white/50">
        Type “||” to start another answer. Changing the answers starts the
        card’s progress over; variants save as you add or remove them.
      </p>
    </div>
  );
}
