import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { chipLabels, type ChipGroups } from '@/lib/feedback';

type ProposeInput =
  inferRouterInputs<AppRouter>['course']['proposeSyllabusRevision'];

/** Proposed changes to the lessons ahead, with the Syllabus they're for. */
export type SyllabusRevisionProposal =
  inferRouterOutputs<AppRouter>['course']['proposeSyllabusRevision'];

export type RevisionChip = ProposeInput['chips'][number];

/** One round of the learner's feedback: the chips chosen and their words. */
export type RevisionRound = { chips: RevisionChip[]; text: string | null };

/** The proposal being refined, as the learner left it. */
export type RefiningRevision = NonNullable<
  ProposeInput['refining']
>['proposal'];

/** The changes the learner approved, as applying takes them. */
export type ApprovedRevision = Omit<
  inferRouterInputs<AppRouter>['course']['applySyllabusRevision'],
  'courseId'
>;

/** The chips, in the order shown, by their labels; the API owns their ids. */
export const REVISION_CHIP_GROUPS: ChipGroups<RevisionChip> = [
  [
    { chip: 'FEWER_LESSONS', label: 'Fewer lessons' },
    { chip: 'MORE_LESSONS', label: 'More lessons' },
  ],
  [
    { chip: 'SPEED_UP', label: 'Speed up' },
    { chip: 'SLOW_DOWN', label: 'Slow down' },
  ],
  [{ chip: 'MORE_PRACTICAL', label: 'More practical' }],
  [{ chip: 'MORE_IN_DEPTH', label: 'More in depth' }],
];

const CHIP_LABELS = chipLabels(REVISION_CHIP_GROUPS);

/** A round as the learner gave it: chips by label, then their words. */
export function describeRound({ chips, text }: RevisionRound) {
  const labels = chips.map((chip) => CHIP_LABELS.get(chip) ?? chip).join(', ');
  return [labels, text].filter(Boolean).join(' — ');
}
