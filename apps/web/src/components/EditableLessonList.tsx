import {
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { GripVertical, Plus, type LucideIcon } from 'lucide-react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/** What the learner edits of a lesson: its title and learning objectives. */
export type LessonFields = { title: string; objectives: string[] };

/** A lesson in the list, with an id that stays with it as it moves. */
export type EditableLesson = { id: string; lesson: LessonFields };

/** How a lesson leaves the list: removed from a proposal, or archived. */
type Removal = { verb: string; Icon: LucideIcon };

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
export function AddField({
  label,
  buttonLabel,
  placeholder,
  onAdd,
  disabled,
  className = '',
}: {
  label: string;
  buttonLabel: string;
  placeholder: string;
  onAdd: (text: string) => void;
  disabled: boolean;
  className?: string;
}) {
  const [text, setText] = useState('');
  const trimmed = text.trim();

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

/** Lessons move up and down only. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

/** One lesson, dragged by its handle to a new place. */
function SortableLesson({
  id,
  number,
  lesson,
  aside,
  removal,
  canRemove,
  disabled,
  onChange,
  onRemove,
}: {
  id: string;
  number: number;
  lesson: LessonFields;
  aside?: ReactNode;
  removal: Removal;
  canRemove: boolean;
  disabled: boolean;
  onChange: (lesson: LessonFields) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <li
      ref={setNodeRef}
      aria-label={`Lesson ${number}: ${lesson.title}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative rounded-xl border bg-white/10 p-4 backdrop-blur-sm ${
        isDragging
          ? 'z-10 border-white/70 bg-white/20 shadow-lg shadow-black/30'
          : 'border-white/30'
      }`}
    >
      <div className="flex items-center gap-1 font-semibold">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${lesson.title} to reorder`}
          title="Drag to reorder"
          disabled={disabled}
          // touch-none: a drag on a touch screen moves the lesson, not the
          // page
          className={`${iconButtonClassName} -ml-1 cursor-grab touch-none active:cursor-grabbing`}
        >
          <GripVertical className="size-4" />
        </button>
        <span className="mr-1 text-white/50">{number}.</span>
        <InlineField
          label={`Lesson ${number} title`}
          value={lesson.title}
          onCommit={(title) => onChange({ ...lesson, title })}
          required
          disabled={disabled}
          className="flex-1"
        />
        {aside}
        <button
          type="button"
          aria-label={`${removal.verb} ${lesson.title}`}
          title={`${removal.verb} lesson`}
          disabled={disabled || !canRemove}
          onClick={onRemove}
          className={iconButtonClassName}
        >
          <removal.Icon className="size-4" />
        </button>
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-14 text-sm text-white/70">
        {lesson.objectives.map((objective, objectiveIndex) => (
          <li key={objectiveIndex}>
            <InlineField
              label={`Lesson ${number}, objective ${objectiveIndex + 1}`}
              value={objective}
              // Left blank, the objective goes
              onCommit={(text) =>
                onChange({
                  ...lesson,
                  objectives: lesson.objectives
                    .map((current, i) =>
                      i === objectiveIndex ? text : current,
                    )
                    .filter(Boolean),
                })
              }
              disabled={disabled}
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
          onChange({ ...lesson, objectives: [...lesson.objectives, objective] })
        }
        disabled={disabled}
        className="mt-1 pl-14 text-sm"
      />
    </li>
  );
}

/**
 * Lessons edited in place, as a Syllabus Proposal or an accepted Syllabus:
 * each renamed, its objectives edited or added, removed, or dragged by its
 * handle to a new place, by mouse, touch or keyboard. The owner saves each
 * change; the list shows the lessons it's given.
 */
export function EditableLessonList({
  label,
  lessons,
  aside,
  removal,
  canRemove,
  disabled,
  onMove,
  onChange,
  onRemove,
}: {
  label: string;
  lessons: EditableLesson[];
  removal: Removal;
  canRemove: boolean;
  disabled: boolean;
  /** Shown beside a lesson's title, by its id, such as its status. */
  aside?: (id: string) => ReactNode;
  onMove: (from: number, to: number) => void;
  onChange: (id: string, lesson: LessonFields) => void;
  onRemove: (id: string) => void;
}) {
  const sensors = useSensors(
    // A few pixels of movement before a drag, so a click on the handle
    // stays a click
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function positionOf(id: UniqueIdentifier) {
    return lessons.findIndex((item) => item.id === id);
  }

  function titleOf(id: UniqueIdentifier) {
    return lessons[positionOf(id)]?.lesson.title ?? 'the lesson';
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onMove(positionOf(active.id), positionOf(over.id));
  }

  // What screen readers hear, in the lessons' own words
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${titleOf(active.id)}, lesson ${positionOf(active.id) + 1} of ${lessons.length}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${titleOf(active.id)} is now in position ${positionOf(over.id) + 1} of ${lessons.length}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${titleOf(active.id)} in position ${positionOf(over.id) + 1} of ${lessons.length}.`
        : undefined,
    onDragCancel: ({ active }) =>
      `Cancelled. ${titleOf(active.id)} is back in position ${positionOf(active.id) + 1}.`,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            'To move a lesson, press Space or Enter, then the up and down arrows. Press Space or Enter again to drop it, or Escape to put it back.',
        },
      }}
    >
      <SortableContext
        items={lessons.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol aria-label={label} className="mt-4 space-y-3">
          {lessons.map((item, index) => (
            <SortableLesson
              key={item.id}
              id={item.id}
              number={index + 1}
              lesson={item.lesson}
              aside={aside?.(item.id)}
              removal={removal}
              canRemove={canRemove}
              disabled={disabled}
              onChange={(lesson) => onChange(item.id, lesson)}
              onRemove={() => onRemove(item.id)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
