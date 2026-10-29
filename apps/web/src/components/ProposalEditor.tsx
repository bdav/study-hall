import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { arrayMove } from '@dnd-kit/sortable';
import { trpc } from '@/lib/trpc';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  AddField,
  EditableLessonList,
  type LessonFields,
} from '@/components/EditableLessonList';
import { glassInputClassName } from '@/lib/utils';

/** A proposed lesson: it doesn't exist yet, so it has no id or progress. */
export type ProposedLesson = LessonFields;

/** The longest feedback a regeneration takes, as the API allows. */
const MAX_FEEDBACK_LENGTH = 1000;

/** A lesson as the editor holds it: keyed, so it keeps its place in the
 * DOM, its fields and anything half-typed in them, as it moves. */
type KeyedLesson = { key: string; lesson: ProposedLesson };

let lastKey = 0;
function withKeys(lessons: ProposedLesson[]): KeyedLesson[] {
  return lessons.map((lesson) => ({ key: `lesson-${++lastKey}`, lesson }));
}

function sameLessons(a: ProposedLesson[], b: ProposedLesson[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface ProposalEditorProps {
  courseId: string;
  courseTitle: string;
  lessons: ProposedLesson[];
  /** The learner's feedback on each regeneration so far, oldest first. */
  feedback: string[];
  onAccept: () => void;
  isAccepting: boolean;
  onDiscard: () => void;
  isDiscarding: boolean;
}

/**
 * A Syllabus Proposal the learner shapes before accepting it: lessons
 * renamed, dragged into a new order, removed and added, and their
 * objectives edited, each change saved as it's made, so the proposal is
 * always as they left it. Or they ask for a new proposal with written
 * feedback, which builds on it.
 */
export function ProposalEditor({
  courseId,
  courseTitle,
  lessons,
  feedback,
  onAccept,
  isAccepting,
  onDiscard,
  isDiscarding,
}: ProposalEditorProps) {
  const utils = trpc.useUtils();
  const [newFeedback, setNewFeedback] = useState('');

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
    const text = newFeedback.trim();
    if (!text) return;
    regenerate.mutate(
      { courseId, feedback: text },
      { onSuccess: () => setNewFeedback('') },
    );
  }

  return (
    <>
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
        <label htmlFor="proposal-feedback" className="font-semibold">
          Ask for a new proposal
        </label>
        <p className="mt-1 text-sm text-white/60">
          Say what to change, such as &ldquo;more focus on the past
          tense&rdquo;. The new proposal builds on this one, your edits
          included, and replaces it.
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
              {feedback.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          </>
        )}
        <textarea
          id="proposal-feedback"
          value={newFeedback}
          onChange={(e) => setNewFeedback(e.target.value)}
          maxLength={MAX_FEEDBACK_LENGTH}
          rows={3}
          disabled={isBusy}
          className={`mt-3 w-full rounded-lg border px-2.5 py-1.5 text-base outline-none md:text-sm ${glassInputClassName}`}
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
          disabled={isActionBlocked || !newFeedback.trim()}
          className="mt-2 flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
        >
          {isRegenerating && <Loader2 className="size-4 animate-spin" />}
          {isRegenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
      </form>

      <button
        type="button"
        onClick={onAccept}
        disabled={isActionBlocked}
        className="mt-8 w-full rounded-lg bg-white/20 py-2 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
      >
        {isAccepting ? 'Accepting…' : 'Accept syllabus'}
      </button>
      <ConfirmDialog
        title="Discard proposal"
        description={`Discard the proposed syllabus and remove "${courseTitle}"? You can create the course again later.`}
        confirmLabel="Discard"
        onConfirm={onDiscard}
        trigger={
          <button
            type="button"
            disabled={isActionBlocked}
            className="mt-3 w-full rounded-lg py-2 text-sm text-white/60 hover:text-white disabled:opacity-50"
          >
            Discard proposal
          </button>
        }
      />
    </>
  );
}
