import { type Lesson } from '@prisma/client';

/**
 * Where the learner is with a lesson. Opened comes from the first-opened
 * time; complete is Lesson Completion, the learner's own mark, which
 * records progress through the syllabus and never mastery.
 */
export type LessonStatus = 'NOT_STARTED' | 'OPENED' | 'COMPLETE';

export function lessonStatus(
  lesson: Pick<Lesson, 'firstOpenedAt' | 'completedAt'>,
): LessonStatus {
  if (lesson.completedAt) return 'COMPLETE';
  return lesson.firstOpenedAt ? 'OPENED' : 'NOT_STARTED';
}

/**
 * Where Continue goes: the first incomplete lesson in syllabus order, or
 * null once every lesson is complete. Takes the syllabus's lessons, which
 * leave out archived ones.
 */
export function lessonToContinue<
  SyllabusLesson extends Pick<Lesson, 'position' | 'completedAt'>,
>(lessons: SyllabusLesson[]): SyllabusLesson | null {
  return (
    lessons
      .toSorted((a, b) => a.position - b.position)
      .find((lesson) => !lesson.completedAt) ?? null
  );
}

/** Where Continue goes, as the pages link to it, or null when nowhere. */
export function continueTarget(
  lessons: Pick<Lesson, 'id' | 'title' | 'position' | 'completedAt'>[],
): { id: string; title: string } | null {
  const next = lessonToContinue(lessons);
  return next && { id: next.id, title: next.title };
}
