/**
 * The Study Session types a learner chooses between, each with the most
 * and fewest cards it holds (`updated-plan.md` §12.1, `SESSION_SIZES` in
 * the API's `queueGenerator.ts`).
 */
export const SESSION_TYPES = [
  { value: 'QUICK', label: 'Quick', cards: '5–12 cards' },
  { value: 'STANDARD', label: 'Standard', cards: '10–25 cards' },
  { value: 'DEEP', label: 'Deep', cards: '20–50 cards' },
] as const;

export type SessionType = (typeof SESSION_TYPES)[number]['value'];
