import { useState } from 'react';
import { isSameAnswer, type AnswerEdit, type Flashcard } from '@/lib/cards';

/**
 * One answer as the form holds it: an existing Canonical Answer, by id, or a
 * new one. `key` stays put as answers move, and `isNew` marks an answer the
 * author just added, to type into.
 */
export type AnswerDraft = {
  key: string;
  id?: string;
  text: string;
  isNew?: boolean;
};

let newKeys = 0;

function newAnswer(text = ''): AnswerDraft {
  newKeys += 1;
  return { key: `new-${newKeys}`, text, isNew: true };
}

function texts(answers: { text: string }[]) {
  return answers.map((answer) => answer.text);
}

/**
 * Editing a card's Canonical Answers, the first primary, for one Save:
 * adding, removing and retyping them, choosing the primary, and which of a
 * retyped answer's Accepted Variants still fit it. Typing "a || b" into an
 * answer makes it two. Variants of unchanged answers are edited on their own,
 * straight away; one typed but not added holds off the Save.
 */
export function useAnswersForm(card: Flashcard) {
  const [answers, setAnswers] = useState<AnswerDraft[]>(() =>
    card.answers.map(({ id, text }) => ({ key: id, id, text })),
  );
  // Variants of retyped answers the author unticked
  const [unkept, setUnkept] = useState<ReadonlySet<string>>(new Set());
  // Answers whose variant box has text not yet added
  const [variantDrafts, setVariantDrafts] = useState<ReadonlySet<string>>(
    new Set(),
  );

  function typeAnswer(index: number, value: string) {
    const [first, ...rest] = value.split('||');
    const added = rest
      .map((part) => part.trim())
      // A trailing empty part is the new answer to type into
      .filter((part, i) => part !== '' || i === rest.length - 1)
      .map(newAnswer);
    setAnswers((prev) => [
      ...prev.slice(0, index),
      { ...prev[index], text: added.length > 0 ? first.trim() : first },
      ...added,
      ...prev.slice(index + 1),
    ]);
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

  function setKept(variantId: string, keep: boolean) {
    setUnkept((prev) => {
      const next = new Set(prev);
      if (keep) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }

  function setVariantDraft(answerId: string, hasDraft: boolean) {
    setVariantDrafts((prev) => {
      const next = new Set(prev);
      if (hasDraft) next.add(answerId);
      else next.delete(answerId);
      return next;
    });
  }

  const edits: AnswerEdit[] = answers
    .map(({ id, text }) => ({ id, text: text.trim() }))
    .filter((answer) => answer.text !== '')
    .map(({ id, text }) => (id ? { id, text } : { text }));

  /** The saved answer behind a form answer, and whether it was retyped. */
  function savedOf(answer: AnswerDraft) {
    const saved = card.answers.find((a) => a.id === answer.id);
    return saved && { saved, retyped: saved.text !== answer.text.trim() };
  }

  /** Whether a variant can stay: not the text of one of the answers. */
  function canKeep(variant: { text: string }) {
    return !edits.some((answer) => isSameAnswer(variant.text, answer.text));
  }

  const keepVariantIds = answers
    .map(savedOf)
    .filter((entry) => entry?.retyped)
    .flatMap((entry) => entry!.saved.acceptedVariants)
    .filter((variant) => !unkept.has(variant.id) && canKeep(variant))
    .map((variant) => variant.id);

  // A typed, unadded variant holds off Save while its box is still shown:
  // its answer is there, not retyped
  const hasVariantDraft = answers.some(
    (answer) =>
      answer.id &&
      variantDrafts.has(answer.id) &&
      savedOf(answer)?.retyped === false,
  );

  const isChanged =
    JSON.stringify(edits) !==
    JSON.stringify(card.answers.map(({ id, text }) => ({ id, text })));
  const sorted = (list: string[]) => [...list].sort().join('\n');
  // Choosing another primary alone keeps the card's progress
  const resetsProgress = sorted(texts(edits)) !== sorted(texts(card.answers));

  return {
    answers,
    typeAnswer,
    makePrimary,
    remove,
    add,
    savedOf,
    canKeep,
    isKept: (variantId: string) => !unkept.has(variantId),
    setKept,
    setVariantDraft,
    edits,
    keepVariantIds,
    isChanged,
    resetsProgress,
    canSave: edits.length > 0 && !hasVariantDraft,
  };
}

export type AnswersForm = ReturnType<typeof useAnswersForm>;
