import { type RecallGrade } from '@prisma/client';

/**
 * Tier 1: Deterministic answer grading via normalized string matching.
 * Future tiers (embedding similarity, LLM adjudication) will extend this.
 */

export function normalizeAnswer(answer: string): string {
  return answer
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^\w\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim()
    .toLowerCase();
}

/** A deterministic grade, and whether it was lowered for wrong accents. */
export type Grading = {
  recallGrade: Extract<RecallGrade, 'NAILED' | 'GOOD' | 'MISSED'>;
  accentMismatch: boolean;
};

/**
 * Grades an answer against a Canonical Answer. An Accent Mismatch is
 * accepted but never perfect, so it grades GOOD (ADR-0002).
 */
export function gradeAnswer(
  userAnswer: string,
  canonicalAnswer: string,
): Grading {
  switch (matchAnswer(userAnswer, canonicalAnswer)) {
    case 'exact':
      return { recallGrade: 'NAILED', accentMismatch: false };
    case 'accent-mismatch':
      return { recallGrade: 'GOOD', accentMismatch: true };
    case 'no-match':
      return { recallGrade: 'MISSED', accentMismatch: false };
  }
}

/**
 * How an answer matches one correct answer. An Accent Mismatch is right
 * except for its accent marks (ADR-0002).
 */
export type AnswerMatch = 'exact' | 'accent-mismatch' | 'no-match';

/**
 * The one comparison between an answer and a correct answer: a Canonical
 * Answer today, and Accepted Variants (#4) and course exercises (#20, #21)
 * next. Case, punctuation and extra whitespace never matter, but the spaces
 * between words do. An answer with no letters or digits never matches.
 */
export function matchAnswer(
  answer: string,
  correctAnswer: string,
): AnswerMatch {
  const answerForm = comparisonForm(answer, { keepAccents: false });
  if (
    !answerForm ||
    answerForm !== comparisonForm(correctAnswer, { keepAccents: false })
  ) {
    return 'no-match';
  }
  return comparisonForm(answer, { keepAccents: true }) ===
    comparisonForm(correctAnswer, { keepAccents: true })
    ? 'exact'
    : 'accent-mismatch';
}

/**
 * An answer reduced to its lowercase words of letters and digits, in any
 * script, one space apart. Spaces between words are kept because they can
 * change the word: "por que" (why) is not "porque" (because). Accent marks
 * are the combining marks Unicode splits off a letter (é, ñ, ç); letters
 * such as ł, ø and ß have none and always count.
 */
function comparisonForm(
  answer: string,
  { keepAccents }: { keepAccents: boolean },
): string {
  const letters = keepAccents
    ? answer.normalize('NFC')
    : answer.normalize('NFD').replace(/\p{M}/gu, ''); // strip accent marks
  return letters
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
    .toLowerCase();
}
