/**
 * The longest feedback the learner writes when regenerating a Syllabus
 * Proposal or a lesson.
 */
export const MAX_FEEDBACK_LENGTH = 1000;

/**
 * Whether chips can be asked for together: each once, and no two that ask
 * for opposite things.
 */
export function isChipChoice<Chip extends string>(
  chips: Chip[],
  opposites: [Chip, Chip][],
) {
  return (
    new Set(chips).size === chips.length &&
    !opposites.some(
      ([one, other]) => chips.includes(one) && chips.includes(other),
    )
  );
}
