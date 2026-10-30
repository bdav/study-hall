/**
 * The longest feedback the learner writes when regenerating a Syllabus
 * Proposal or a lesson, as the API allows (`MAX_FEEDBACK_LENGTH`).
 */
export const MAX_FEEDBACK_LENGTH = 1000;

/**
 * Chips in the order shown, by their labels, in groups: a group of two asks
 * for opposite things, so choosing one deselects the other. The API checks
 * it too, and owns the chips' ids and what each asks of the model.
 */
export type ChipGroups<Chip extends string> = { chip: Chip; label: string }[][];

/** Each chip's label, for showing chips chosen earlier. */
export function chipLabels<Chip extends string>(groups: ChipGroups<Chip>) {
  return new Map(groups.flat().map(({ chip, label }) => [chip, label]));
}
