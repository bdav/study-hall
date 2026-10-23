import { type ExerciseAttempt, type ExerciseEvaluation } from '@prisma/client';
import { matchAnswer } from './answerGrader.js';

/**
 * Evaluates an answer to a short-answer or fill-in-the-blank exercise
 * against its expected answers, with the same matching cards use. Accents
 * are ignored until Accent Mismatches reach exercises (#21).
 */
export function evaluateExerciseAnswer(
  answer: string,
  expectedAnswers: string[],
): ExerciseEvaluation {
  return expectedAnswers.some(
    (expected) => matchAnswer(answer, expected) !== 'no-match',
  )
    ? 'CORRECT'
    : 'INCORRECT';
}

/** An Exercise Attempt as the learner sees its result. */
export function toAttemptView(attempt: ExerciseAttempt) {
  return {
    exerciseId: attempt.exerciseId,
    answer: attempt.answer,
    evaluation: attempt.evaluation,
    createdAt: attempt.createdAt,
  };
}
