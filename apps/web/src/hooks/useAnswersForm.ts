import { useState } from 'react';
import { isSameAnswer, type AnswerEdit, type Flashcard } from '@/lib/cards';

/**
 * One answer as the form holds it: an existing Canonical Answer, by id, or a
 * new one, with its Accepted Variants' texts and the text typed into its
 * box for adding one. `key` stays put as answers move, and `isNew` marks an
 * answer the author just added, to type into.
 */
export type AnswerDraft = {
  key: string;
  id?: string;
  text: string;
  isNew?: boolean;
  variants: string[];
  variantText: string;
};

let newKeys = 0;

function newAnswer(): AnswerDraft {
  newKeys += 1;
  return {
    key: `new-${newKeys}`,
    text: '',
    isNew: true,
    variants: [],
    variantText: '',
  };
}

function texts(answers: { text: string }[]) {
  return answers.map((answer) => answer.text);
}

/**
 * Editing a card's Canonical Answers, the first primary, and each one's
 * Accepted Variants, all for one Save: adding, removing and retyping
 * answers, choosing the primary, and adding and removing variants, on any
 * answer, new or retyped. A variant typed but not added is added on Save,
 * unless it's already accepted. A variant that grades the same as one of
 * the answers adds nothing, so it holds off the Save until it's removed.
 */
export function useAnswersForm(card: Flashcard) {
  const [answers, setAnswers] = useState<AnswerDraft[]>(() =>
    card.answers.map(({ id, text, acceptedVariants }) => ({
      key: id,
      id,
      text,
      variants: acceptedVariants.map((variant) => variant.text),
      variantText: '',
    })),
  );

  function change(index: number, update: Partial<AnswerDraft>) {
    setAnswers((prev) =>
      prev.map((answer, i) =>
        i === index ? { ...answer, ...update } : answer,
      ),
    );
  }

  function makePrimary(index: number) {
    setAnswers((prev) => [prev[index], ...prev.filter((_, i) => i !== index)]);
  }

  function remove(index: number) {
    setAnswers((prev) => prev.filter((_, i) => i !== index));
  }

  function add() {
    setAnswers((prev) => [...prev, newAnswer()]);
  }

  /** Whether a variant grades the same as one of the card's answers. */
  function isSameAsAnswer(variant: string) {
    return answers.some((answer) => isSameAnswer(variant, answer.text));
  }

  /** Whether the text typed into an answer's variant box is already accepted. */
  function isVariantTextAccepted(index: number) {
    const { variantText, variants } = answers[index];
    return (
      isSameAsAnswer(variantText) ||
      variants.some((variant) => isSameAnswer(variantText, variant))
    );
  }

  function addVariant(index: number) {
    const text = answers[index].variantText.trim();
    if (text === '' || isVariantTextAccepted(index)) return;
    change(index, {
      variants: [...answers[index].variants, text],
      variantText: '',
    });
  }

  function removeVariant(index: number, variantIndex: number) {
    change(index, {
      variants: answers[index].variants.filter((_, i) => i !== variantIndex),
    });
  }

  const edits: AnswerEdit[] = answers.flatMap((answer, i) => {
    const text = answer.text.trim();
    if (text === '') return [];
    const typed = answer.variantText.trim();
    const acceptedVariants =
      typed !== '' && !isVariantTextAccepted(i)
        ? [...answer.variants, typed]
        : answer.variants;
    return [
      answer.id
        ? { id: answer.id, text, acceptedVariants }
        : { text, acceptedVariants },
    ];
  });

  const isChanged =
    JSON.stringify(edits) !==
    JSON.stringify(
      card.answers.map(({ id, text, acceptedVariants }) => ({
        id,
        text,
        acceptedVariants: texts(acceptedVariants),
      })),
    );
  const sorted = (list: string[]) => [...list].sort().join('\n');
  // Choosing another primary, or changing variants, keeps the card's progress
  const resetsProgress = sorted(texts(edits)) !== sorted(texts(card.answers));

  return {
    answers,
    typeAnswer: (index: number, text: string) => change(index, { text }),
    makePrimary,
    remove,
    add,
    typeVariant: (index: number, variantText: string) =>
      change(index, { variantText }),
    addVariant,
    removeVariant,
    isSameAsAnswer,
    isVariantTextAccepted,
    edits,
    isChanged,
    resetsProgress,
    canSave:
      edits.length > 0 &&
      !answers.some((answer) => answer.variants.some(isSameAsAnswer)),
  };
}

export type AnswersForm = ReturnType<typeof useAnswersForm>;
