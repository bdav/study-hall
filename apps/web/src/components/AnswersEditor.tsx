import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import { glassInputClassName } from '@/lib/utils';
import { type AnswersForm } from '@/hooks/useAnswersForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AcceptedVariantsEditor } from '@/components/AcceptedVariantsEditor';

/**
 * A card's Canonical Answers as one form, saved together: each answer's
 * field, the radio choosing the primary, removing it, and below it its
 * Accepted Variants, on any answer, new or retyped. What an answer is, and
 * what a variant is, are explained where each is added: below "Add
 * answer", and below the first answer's box for adding a variant.
 */
export function AnswersEditor({ form }: { form: AnswersForm }) {
  const headingId = useId();
  const primaryName = useId();
  const answersHelpId = useId();

  return (
    <div>
      <p id={headingId} className="text-sm text-white/70">
        Answers
      </p>
      <ol aria-labelledby={headingId} className="mt-1 space-y-3">
        {form.answers.map((answer, i) => {
          const label = `Answer ${i + 1}`;
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
              <div className="mt-1 pl-6">
                <AcceptedVariantsEditor
                  name={answer.text.trim() || label}
                  variants={answer.variants}
                  isSameAsAnswer={form.isSameAsAnswer}
                  text={answer.variantText}
                  isTextAccepted={form.isVariantTextAccepted(i)}
                  onTextChange={(text) => form.typeVariant(i, text)}
                  onAdd={() => form.addVariant(i)}
                  onRemove={(variant) => form.removeVariant(i, variant)}
                  description={
                    i === 0
                      ? 'Variants are other ways to write one answer, such as spellings or forms, like “color” for “colour”. They never reset progress.'
                      : undefined
                  }
                />
              </div>
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={form.add}
        aria-describedby={answersHelpId}
        className="mt-2 text-white/70 hover:bg-white/10 hover:text-white"
      >
        <Plus className="mr-1 h-4 w-4" />
        Add answer
      </Button>
      <p id={answersHelpId} className="mt-1 text-xs text-white/50">
        Answers are different correct answers, each right on its own, like 11,
        13 and 17 for “a prime between 10 and 20”. Changing them starts the
        card’s progress over.
      </p>
    </div>
  );
}
