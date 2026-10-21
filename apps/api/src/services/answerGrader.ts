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

export function gradeAnswer(
  userAnswer: string,
  canonicalAnswer: string,
): Extract<RecallGrade, 'NAILED' | 'MISSED'> {
  const normalized = normalizeAnswer(userAnswer);
  const canonical = normalizeAnswer(canonicalAnswer);

  if (!normalized) return 'MISSED';

  return normalized === canonical ? 'NAILED' : 'MISSED';
}
