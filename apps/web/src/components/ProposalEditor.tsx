import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { glassInputClassName } from '@/lib/utils';

/** A proposed lesson: it doesn't exist yet, so it has no id or progress. */
export type ProposedLesson = { title: string; objectives: string[] };

/** The longest feedback a regeneration takes, as the API allows. */
const MAX_FEEDBACK_LENGTH = 1000;

const iconButtonClassName =
  'relative touch-target shrink-0 rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30';

/**
 * Text edited in place: it saves when the learner leaves it or presses
 * Enter, and Escape puts back what was there.
 */
function InlineField({
  label,
  value,
  onCommit,
  required = false,
  disabled,
  className = '',
}: {
  label: string;
  value: string;
  /** Called with the trimmed text, only when it changed. */
  onCommit: (value: string) => void;
  /** Left blank, it puts its text back rather than saving. */
  required?: boolean;
  disabled: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  // Follow the saved text when it changes underneath (adjust state during
  // render, not in an effect)
  const [previous, setPrevious] = useState(value);
  if (value !== previous) {
    setPrevious(value);
    setDraft(value);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === value || (required && !trimmed)) {
      setDraft(value);
      return;
    }
    onCommit(trimmed);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(value);
    }
  }

  return (
    <input
      type="text"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      disabled={disabled}
      className={`min-w-0 border-b-2 border-transparent bg-transparent text-base text-white outline-none transition-colors hover:border-white/20 focus:border-white/60 disabled:opacity-60 md:text-[length:inherit] ${className}`}
    />
  );
}

/** A field that adds what's typed in it, with Enter or its button. */
function AddField({
  label,
  buttonLabel,
  placeholder,
  onAdd,
  disabled,
  belongsTo,
  className = '',
}: {
  label: string;
  buttonLabel: string;
  placeholder: string;
  onAdd: (text: string) => void;
  disabled: boolean;
  /**
   * What the field adds to. When it changes, as when lessons move under
   * it, the field starts afresh rather than adding to the wrong one.
   */
  belongsTo?: string;
  className?: string;
}) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  // Adjust state during render, not in an effect
  const [previousBelongsTo, setPreviousBelongsTo] = useState(belongsTo);
  if (belongsTo !== previousBelongsTo) {
    setPreviousBelongsTo(belongsTo);
    setText('');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    onAdd(trimmed);
    setText('');
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex items-center gap-1 ${className}`}
    >
      <input
        type="text"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="min-w-0 flex-1 border-b-2 border-white/20 bg-transparent text-base text-white outline-none transition-colors placeholder:text-white/40 focus:border-white/60 disabled:opacity-60 md:text-[length:inherit]"
      />
      <button
        type="submit"
        aria-label={buttonLabel}
        title={buttonLabel}
        disabled={disabled || !trimmed}
        className={iconButtonClassName}
      >
        <Plus className="size-4" />
      </button>
    </form>
  );
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
 * renamed, reordered, removed and added, and their objectives edited, each
 * change saved as it's made, so the proposal is always as they left it. Or
 * they ask for a new proposal with written feedback, which builds on it.
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

  // Each edit shows at once: the course's cached proposal takes it before
  // the save, and goes back if the save fails
  const update = trpc.course.updateProposal.useMutation({
    onMutate: async ({ lessons: next }) => {
      await utils.course.getById.cancel({ id: courseId });
      const previous = utils.course.getById.getData({ id: courseId });
      utils.course.getById.setData({ id: courseId }, (course) =>
        course?.proposal
          ? { ...course, proposal: { ...course.proposal, lessons: next } }
          : course,
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      utils.course.getById.setData({ id: courseId }, context?.previous);
      toast.error('Failed to save the change to the proposal');
    },
    onSettled: () => {
      utils.course.getById.invalidate({ id: courseId });
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

  function save(next: ProposedLesson[]) {
    update.mutate({ courseId, lessons: next });
  }

  function replaceLesson(index: number, lesson: ProposedLesson) {
    save(lessons.map((current, i) => (i === index ? lesson : current)));
  }

  /** Swaps a lesson with its neighbour above (-1) or below (1). */
  function moveLesson(index: number, by: -1 | 1) {
    const next = [...lessons];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    save(next);
  }

  function removeLesson(index: number) {
    save(lessons.filter((_, i) => i !== index));
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
      <ol aria-label="Proposed lessons" className="mt-4 space-y-3">
        {lessons.map((lesson, index) => {
          const number = index + 1;
          return (
            <li
              // Lessons have no ids until accepted; fields follow their
              // lesson's text when the order changes
              key={index}
              aria-label={`Lesson ${number}: ${lesson.title}`}
              className="rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm"
            >
              <div className="flex items-center gap-1 font-semibold">
                <span className="mr-1 text-white/50">{number}.</span>
                <InlineField
                  label={`Lesson ${number} title`}
                  value={lesson.title}
                  onCommit={(title) =>
                    replaceLesson(index, { ...lesson, title })
                  }
                  required
                  disabled={isBusy}
                  className="flex-1"
                />
                <button
                  type="button"
                  aria-label={`Move ${lesson.title} up`}
                  title="Move up"
                  disabled={isBusy || index === 0}
                  onClick={() => moveLesson(index, -1)}
                  className={iconButtonClassName}
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${lesson.title} down`}
                  title="Move down"
                  disabled={isBusy || index === lessons.length - 1}
                  onClick={() => moveLesson(index, 1)}
                  className={iconButtonClassName}
                >
                  <ArrowDown className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${lesson.title}`}
                  title="Remove lesson"
                  // A proposal always has a lesson
                  disabled={isBusy || lessons.length === 1}
                  onClick={() => removeLesson(index)}
                  className={iconButtonClassName}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <ul className="mt-2 list-disc space-y-0.5 pl-10 text-sm text-white/70">
                {lesson.objectives.map((objective, objectiveIndex) => (
                  <li key={objectiveIndex}>
                    <InlineField
                      label={`Lesson ${number}, objective ${objectiveIndex + 1}`}
                      value={objective}
                      // Left blank, the objective goes
                      onCommit={(text) =>
                        replaceLesson(index, {
                          ...lesson,
                          objectives: lesson.objectives
                            .map((current, i) =>
                              i === objectiveIndex ? text : current,
                            )
                            .filter(Boolean),
                        })
                      }
                      disabled={isBusy}
                      className="w-full text-white/80"
                    />
                  </li>
                ))}
              </ul>
              <AddField
                label={`New objective for ${lesson.title}`}
                buttonLabel={`Add objective to ${lesson.title}`}
                placeholder="Add an objective"
                onAdd={(objective) =>
                  replaceLesson(index, {
                    ...lesson,
                    objectives: [...lesson.objectives, objective],
                  })
                }
                disabled={isBusy}
                belongsTo={lesson.title}
                className="mt-1 pl-10 text-sm"
              />
            </li>
          );
        })}
      </ol>
      <AddField
        label="New lesson title"
        buttonLabel="Add lesson"
        placeholder="Add a lesson by its title"
        onAdd={(title) => save([...lessons, { title, objectives: [] }])}
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
