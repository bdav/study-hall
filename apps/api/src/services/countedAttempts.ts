import { type RecallGrade } from '@prisma/client';

/**
 * Whether an answer was right: NAILED, or GOOD for an answer wrong only in
 * its accents, which is accepted though never perfect (ADR-0002).
 */
export function isCorrect(grade: RecallGrade) {
  return grade === 'NAILED' || grade === 'GOOD';
}

/**
 * Whether an attempt counts toward stats and scheduling: it was made since
 * its card's latest progress reset (ADR-0004).
 */
export function countsSinceReset(createdAt: Date, resetAt: Date) {
  return createdAt >= resetAt;
}
