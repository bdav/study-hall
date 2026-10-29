import { useState } from 'react';
import { toast } from 'sonner';
import { Archive } from 'lucide-react';
import { arrayMove } from '@dnd-kit/sortable';
import { trpc } from '@/lib/trpc';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  AddField,
  EditableLessonList,
  type EditableLesson,
  type LessonFields,
} from '@/components/EditableLessonList';

type SyllabusLesson = LessonFields & { id: string };

function toItems(lessons: SyllabusLesson[]): EditableLesson[] {
  return lessons.map(({ id, title, objectives }) => ({
    id,
    lesson: { title, objectives },
  }));
}

function sameItems(a: EditableLesson[], b: EditableLesson[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * An accepted Syllabus edited in place: lessons renamed, dragged into a new
 * order, added by their title, and their objectives edited, each change
 * saved as it's made. Archiving a lesson takes it out of the Syllabus and
 * keeps its learning history (ADR-0003). None of it needs AI access.
 */
export function SyllabusEditor({
  courseId,
  lessons,
  onDone,
}: {
  courseId: string;
  lessons: SyllabusLesson[];
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [toArchive, setToArchive] = useState<EditableLesson | null>(null);

  // The lessons as the learner has left them, shown at once while each
  // change saves; they follow the Syllabus when it changes to something
  // else (adjust state during render, not in an effect)
  const [items, setItems] = useState(() => toItems(lessons));
  const [syncedLessons, setSyncedLessons] = useState(lessons);
  if (lessons !== syncedLessons) {
    setSyncedLessons(lessons);
    if (!sameItems(toItems(lessons), items)) {
      setItems(toItems(lessons));
    }
  }

  const saving = {
    onSuccess: () => {
      utils.course.getById.invalidate({ id: courseId });
    },
    onError: async (error: { message: string }) => {
      toast.error(error.message);
      // Back to the Syllabus as saved now, other edits saved meanwhile
      // included
      await utils.course.getById.invalidate({ id: courseId });
      const saved = utils.course.getById.getData({ id: courseId });
      if (saved) setItems(toItems(saved.lessons));
    },
  };
  const updateLesson = trpc.course.updateLesson.useMutation(saving);
  const reorderLessons = trpc.course.reorderLessons.useMutation(saving);
  const addLesson = trpc.course.addLesson.useMutation(saving);
  const archiveLesson = trpc.course.archiveLesson.useMutation(saving);

  function change(id: string, lesson: LessonFields) {
    const before = items.find((item) => item.id === id)?.lesson;
    if (!before) return;
    setItems(
      items.map((item) => (item.id === id ? { ...item, lesson } : item)),
    );
    updateLesson.mutate(
      lesson.title !== before.title
        ? { lessonId: id, title: lesson.title }
        : { lessonId: id, objectives: lesson.objectives },
    );
  }

  function move(from: number, to: number) {
    const next = arrayMove(items, from, to);
    setItems(next);
    reorderLessons.mutate({
      courseId,
      lessonIds: next.map((item) => item.id),
    });
  }

  function archive(item: EditableLesson) {
    setItems(items.filter((current) => current.id !== item.id));
    archiveLesson.mutate({ lessonId: item.id });
  }

  return (
    <>
      <EditableLessonList
        label="Syllabus"
        lessons={items}
        removal={{ verb: 'Archive', Icon: Archive }}
        // A Syllabus keeps a lesson; archiving the course is for the rest
        canRemove={items.length > 1}
        disabled={false}
        onMove={move}
        onChange={change}
        onRemove={(id) =>
          setToArchive(items.find((item) => item.id === id) ?? null)
        }
      />
      <AddField
        label="New lesson title"
        buttonLabel="Add lesson"
        placeholder="Add a lesson by its title"
        onAdd={(title) => addLesson.mutate({ courseId, title })}
        disabled={false}
        className="mt-3 rounded-xl border border-dashed border-white/30 p-4"
      />
      <button
        type="button"
        onClick={onDone}
        className="mt-6 w-full rounded-lg bg-white/20 py-2 text-white backdrop-blur-sm hover:bg-white/30"
      >
        Done
      </button>
      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => {
          if (!open) setToArchive(null);
        }}
        title="Archive lesson"
        description={`Archive "${toArchive?.lesson.title}"? It leaves the syllabus, and your work in it and the cards made from it are kept.`}
        confirmLabel="Archive"
        onConfirm={() => {
          if (toArchive) archive(toArchive);
        }}
      />
    </>
  );
}
