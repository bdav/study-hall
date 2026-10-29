import {
  type Exercise,
  type ExerciseAttempt,
  type ExerciseEvaluation,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { matchAnswer } from './answerGrader.js';

/**
 * An exercise answer's evaluation, and the accented expected answer it
 * matched when it was an Accent Mismatch.
 */
export type ExerciseAnswerEvaluation = {
  evaluation: ExerciseEvaluation;
  accentCorrection: string | null;
};

/**
 * Evaluates an answer to a short-answer or fill-in-the-blank exercise
 * against its expected answers, with the same matching cards use. An
 * Accent Mismatch counts as correct, corrected to the expected answer it
 * matched (ADR-0002); an exact match on any expected answer needs no
 * correction.
 */
export function evaluateExerciseAnswer(
  answer: string,
  expectedAnswers: string[],
): ExerciseAnswerEvaluation {
  const matches = expectedAnswers.map((expected) => ({
    expected,
    match: matchAnswer(answer, expected),
  }));
  if (matches.some(({ match }) => match === 'exact')) {
    return { evaluation: 'CORRECT', accentCorrection: null };
  }
  const mismatch = matches.find(({ match }) => match === 'accent-mismatch');
  return mismatch
    ? { evaluation: 'CORRECT', accentCorrection: mismatch.expected }
    : { evaluation: 'INCORRECT', accentCorrection: null };
}

/**
 * The deterministic check of an answer, or null when it can't settle it and
 * the model must (ADR-0005): a free-form explanation, or an answer to an
 * open exercise that matches no expected answer. A closed exercise's answer
 * is always settled here, right or wrong.
 */
export function checkDeterministically(
  exercise: Pick<Exercise, 'type' | 'open' | 'expectedAnswers'>,
  answer: string,
): ExerciseAnswerEvaluation | null {
  if (exercise.type === 'FREE_FORM_EXPLANATION') return null;

  const checked = evaluateExerciseAnswer(answer, exercise.expectedAnswers);
  return checked.evaluation === 'INCORRECT' && exercise.open ? null : checked;
}

/**
 * What an exercise is checked against: its expected answers, or a free-form
 * explanation's essential and supplementary points (or, generated before
 * that split, expected points, ADR-0006). The learner, and so the tutor,
 * sees it only once they have attempted the exercise since they last
 * started the lesson over: never before (courses-plan.md, Tutor).
 */
export type AnswerKey = Pick<
  Exercise,
  | 'expectedAnswers'
  | 'essentialPoints'
  | 'supplementaryPoints'
  | 'expectedPoints'
>;

export function answerKey(exercise: AnswerKey): AnswerKey {
  return {
    expectedAnswers: exercise.expectedAnswers,
    essentialPoints: exercise.essentialPoints,
    supplementaryPoints: exercise.supplementaryPoints,
    expectedPoints: exercise.expectedPoints,
  };
}

/**
 * The Exercise Attempts a lesson shows: those since the learner last
 * started it over, or all of them if they never have. Earlier attempts are
 * kept (ADR-0003).
 */
export function attemptsSinceReset(
  resetAt: Date | null,
): Prisma.ExerciseAttemptWhereInput {
  return resetAt ? { createdAt: { gte: resetAt } } : {};
}

/**
 * A reset time after every Exercise Attempt made so far. Attempts are
 * timed by the database clock to the microsecond, and a Date holds only
 * milliseconds, so this is the database's time rounded up to the next
 * millisecond: a time from the app's clock could fall before an attempt
 * made just earlier.
 */
export async function nextResetTime(prisma: PrismaClient): Promise<Date> {
  const [{ resetAt }] = await prisma.$queryRaw<[{ resetAt: Date }]>`
    SELECT date_trunc('milliseconds', clock_timestamp()::timestamp)
      + interval '1 millisecond' AS "resetAt"`;
  return resetAt;
}

/** An Exercise Attempt as the learner sees its result. */
export function toAttemptView(attempt: ExerciseAttempt) {
  return {
    exerciseId: attempt.exerciseId,
    answer: attempt.answer,
    evaluation: attempt.evaluation,
    accentCorrection: attempt.accentCorrection,
    feedback: attempt.feedback,
    createdAt: attempt.createdAt,
  };
}
