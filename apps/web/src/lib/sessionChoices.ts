/**
 * The Study Session types a learner chooses between, each with the most
 * and fewest cards it holds (`updated-plan.md` §12.1, `SESSION_SIZES` in
 * the API's `queueGenerator.ts`).
 */
export const SESSION_TYPES = [
  { value: 'QUICK', label: 'Quick', detail: '5–12 cards' },
  { value: 'STANDARD', label: 'Standard', detail: '10–25 cards' },
  { value: 'DEEP', label: 'Deep', detail: '20–50 cards' },
] as const;

export type SessionType = (typeof SESSION_TYPES)[number]['value'];

/**
 * The study modes, each mixing a session's cards its own way (§16): Study
 * balanced, Drill Weakest mostly weak cards and no NEW ones, Cram more NEW
 * cards and reviews before they're due.
 */
export const STUDY_MODES = [
  { value: 'STUDY', label: 'Study', detail: 'A balanced mix' },
  {
    value: 'DRILL_WEAKEST',
    label: 'Drill weakest',
    detail: 'Shaky cards, no new',
  },
  { value: 'CRAM', label: 'Cram', detail: 'More new, reviews early' },
] as const;

export type StudyMode = (typeof STUDY_MODES)[number]['value'];

/** How the learner chooses to study: a session's type and Study Mode. */
export type SessionChoice = { sessionType: SessionType; studyMode: StudyMode };
