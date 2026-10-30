import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { arrayMove } from '@dnd-kit/sortable';
import { trpc } from '@/lib/trpc';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FeedbackChips } from '@/components/FeedbackChips';
import { WritingLoader } from '@/components/WritingLoader';
import {
  AddField,
  EditableLessonList,
  type LessonFields,
} from '@/components/EditableLessonList';
import { glassInputClassName } from '@/lib/utils';
import {
  chipLabels,
  MAX_FEEDBACK_LENGTH,
  type ChipGroups,
} from '@/lib/feedback';

/** A proposed lesson: it doesn't exist yet, so it has no id or progress. */
export type ProposedLesson = LessonFields;

/** A lesson as the editor holds it: keyed, so it keeps its place in the
 * DOM, its fields and anything half-typed in them, as it moves. */
type KeyedLesson = { key: string; lesson: ProposedLesson };

let lastKey = 0;
function withKeys(lessons: ProposedLesson[]): KeyedLesson[] {
  return lessons.map((lesson) => ({ key: `lesson-${++lastKey}`, lesson }));
}

type SyllabusFeedbackChip = NonNullable<
  inferRouterInputs<AppRouter>['course']['regenerateProposal']['chips']
>[number];

/** One regeneration's feedback: the chips chosen and the learner's words. */
export type FeedbackRound = NonNullable<
  inferRouterOutputs<AppRouter>['course']['getById']['proposal']
>['feedback'][number];

/** The chips, in the order shown, by their labels. */
const CHIP_GROUPS: ChipGroups<SyllabusFeedbackChip> = [
  [
    { chip: 'FEWER_LESSONS', label: 'Fewer lessons' },
    { chip: 'MORE_LESSONS', label: 'More lessons' },
  ],
  [
    { chip: 'START_EASIER', label: 'Start easier' },
    { chip: 'START_FURTHER_ALONG', label: 'Start further along' },
  ],
  [{ chip: 'MORE_PRACTICAL', label: 'More practical' }],
  [{ chip: 'MORE_IN_DEPTH', label: 'More in depth' }],
];

const CHIP_LABELS = chipLabels(CHIP_GROUPS);

/** A round of feedback as the learner gave it: chips by label, then words. */
function describeRound({ chips, text }: FeedbackRound) {
  const labels = chips.map((chip) => CHIP_LABELS.get(chip) ?? chip).join(', ');
  return [labels, text].filter(Boolean).join(' — ');
}

function sameLessons(a: ProposedLesson[], b: ProposedLesson[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface ProposalEditorProps {
  courseId: string;
  courseTitle: string;
  lessons: ProposedLesson[];
  /** The learner's feedback on each regeneration so far, oldest first. */
  feedback: FeedbackRound[];
  onAccept: () => void;
  isAccepting: boolean;
  /**
   * Where Accept goes: the page's pinned header, so it's in view however
   * long the proposal. It waits on the editing here, which is why the
   * editor renders it there.
   */
  acceptTarget: HTMLElement | null;
  onDiscard: () => void;
  isDiscarding: boolean;
}

/**
 * A Syllabus Proposal the learner shapes before accepting it: lessons
 * renamed, dragged into a new order, removed and added, and their
 * objectives edited, each change saved as it's made, so the proposal is
 * always as they left it. Or they ask for a new proposal, saying what
 * should change with chips and in their own words, which builds on it.
 */
export function ProposalEditor({
  courseId,
  courseTitle,
  lessons,
  feedback,
  onAccept,
  isAccepting,
  acceptTarget,
  onDiscard,
  isDiscarding,
}: ProposalEditorProps) {
  const utils = trpc.useUtils();
  const [chips, setChips] = useState<SyllabusFeedbackChip[]>([]);
  const [newFeedback, setNewFeedback] = useState('');
  const text = newFeedback.trim();

  // The lessons as the learner has left them, shown at once while each
  // change saves. They follow the proposal only when it changes to
  // something else, as a regeneration does (adjust state during render,
  // not in an effect)
  const [items, setItems] = useState(() => withKeys(lessons));
  const [syncedLessons, setSyncedLessons] = useState(lessons);
  if (lessons !== syncedLessons) {
    setSyncedLessons(lessons);
    if (
      !sameLessons(
        lessons,
        items.map((item) => item.lesson),
      )
    ) {
      setItems(withKeys(lessons));
    }
  }

  const update = trpc.course.updateProposal.useMutation({
    onError: () => {
      // Back to the proposal as saved
      setItems(withKeys(lessons));
      toast.error('Failed to save the change to the proposal');
    },
  });

  const regenerate = trpc.course.regenerateProposal.useMutation({
    onSuccess: () => {
      utils.course.getById.invalidate({ id: courseId });
    },
  });

  const isRegenerating = regenerate.isPending;
  const isBusy = isRegenerating || isAccepting || isDiscarding;
  // Accepting or regenerating waits for an edit being saved, so it works
  // from the proposal as the learner left it. Editing doesn't wait: a field
  // disabled as its neighbour saves would lose the focus moving into it
  const isActionBlocked = isBusy || update.isPending;

  function save(next: KeyedLesson[]) {
    setItems(next);
    update.mutate({ courseId, lessons: next.map((item) => item.lesson) });
  }

  function handleRegenerate(e: FormEvent) {
    e.preventDefault();
    if (chips.length === 0 && !text) return;
    regenerate.mutate(
      text ? { courseId, chips, feedback: text } : { courseId, chips },
      {
        onSuccess: () => {
          setChips([]);
          setNewFeedback('');
        },
      },
    );
  }

  // Nothing of this proposal to edit, accept or discard while its
  // replacement is written; the chips and feedback typed stay, should it
  // fail
  if (isRegenerating) {
    return (
      <WritingLoader
        label="Writing a new proposal"
        title="Writing a new syllabus proposal"
        detail="It builds on this one, your edits and feedback included. This takes about a minute."
      />
    );
  }

  return (
    <>
      <h2 className="text-lg font-semibold">Syllabus Proposal</h2>
      <p className="mt-1 text-sm text-white/60">
        Shape the lessons below: rename, reorder, remove or add them, and edit
        their objectives. Accepting creates your course&apos;s syllabus.
      </p>
      <EditableLessonList
        label="Proposed lessons"
        lessons={items.map(({ key, lesson }) => ({ id: key, lesson }))}
        removal={{ verb: 'Remove', Icon: Trash2 }}
        // A proposal always has a lesson
        canRemove={items.length > 1}
        disabled={isBusy}
        onMove={(from, to) => save(arrayMove(items, from, to))}
        onChange={(key, lesson) =>
          save(
            items.map((current) =>
              current.key === key ? { ...current, lesson } : current,
            ),
          )
        }
        onRemove={(key) => save(items.filter((current) => current.key !== key))}
      />
      <AddField
        label="New lesson title"
        buttonLabel="Add lesson"
        placeholder="Add a lesson by its title"
        onAdd={(title) =>
          save([...items, ...withKeys([{ title, objectives: [] }])])
        }
        disabled={isBusy}
        className="mt-3 rounded-xl border border-dashed border-white/30 p-4"
      />

      <form
        onSubmit={handleRegenerate}
        className="mt-8 rounded-xl border border-white/20 bg-white/5 p-4"
      >
        <h3 className="font-semibold">Ask for a new proposal</h3>
        <p className="mt-1 text-sm text-white/60">
          Say what should change. The new proposal builds on this one, your
          edits included, and replaces it.
        </p>
        {feedback.length > 0 && (
          <>
            <p id="feedback-so-far" className="mt-3 text-sm text-white/60">
              Your feedback so far:
            </p>
            <ol
              aria-labelledby="feedback-so-far"
              className="mt-1 list-decimal space-y-0.5 pl-6 text-sm text-white/80"
            >
              {feedback.map((round, index) => (
                <li key={index}>{describeRound(round)}</li>
              ))}
            </ol>
          </>
        )}
        <div className="mt-3">
          <FeedbackChips
            groups={CHIP_GROUPS}
            chosen={chips}
            onChange={setChips}
            disabled={isBusy}
          />
        </div>
        <label
          htmlFor="proposal-feedback"
          className="mt-4 block text-sm font-medium text-white/80"
        >
          In your own words (optional)
        </label>
        <textarea
          id="proposal-feedback"
          value={newFeedback}
          onChange={(e) => setNewFeedback(e.target.value)}
          maxLength={MAX_FEEDBACK_LENGTH}
          rows={3}
          disabled={isBusy}
          placeholder="More on the past tense…"
          className={`mt-1 w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
        />
        {regenerate.error && (
          <p className="mt-2 text-sm text-destructive">
            {/* AI paused or not allowed: say so, rather than suggest a fault */}
            {regenerate.error.data?.code === 'TOO_MANY_REQUESTS' ||
            regenerate.error.data?.code === 'FORBIDDEN'
              ? regenerate.error.message
              : 'Failed to write a new proposal. Try again.'}
          </p>
        )}
        <button
          type="submit"
          disabled={isActionBlocked || (chips.length === 0 && !text)}
          className="mt-2 flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
        >
          {isRegenerating && <Loader2 className="size-4 animate-spin" />}
          {isRegenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
      </form>

      {acceptTarget &&
        createPortal(
          <button
            type="button"
            onClick={onAccept}
            disabled={isActionBlocked}
            // A line of its own on narrow screens, as Continue is
            className="flex w-full shrink-0 items-center justify-center rounded-lg bg-white/25 px-4 py-2 font-medium text-white backdrop-blur-sm hover:bg-white/35 disabled:opacity-50 sm:w-auto"
          >
            {isAccepting ? 'Accepting…' : 'Accept syllabus'}
          </button>,
          acceptTarget,
        )}
      <ConfirmDialog
        title="Discard proposal"
        description={`Discard the proposed syllabus and remove "${courseTitle}"? You can create the course again later.`}
        confirmLabel="Discard"
        onConfirm={onDiscard}
        trigger={
          <button
            type="button"
            disabled={isActionBlocked}
            className="mt-8 w-full rounded-lg py-2 text-sm text-white/60 hover:text-white disabled:opacity-50"
          >
            Discard proposal
          </button>
        }
      />
    </>
  );
}
