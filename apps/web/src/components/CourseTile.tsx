import type { ReactNode } from 'react';
import { Tile } from '@/components/Tile';

/**
 * A course's tile, as Courses and Home show it: its title, cut off only past
 * four lines, and its goal clamped to two (the full goal is on the course
 * page), then whatever the page adds below.
 */
export function CourseTile({
  course,
  wideOnPhones,
  children,
}: {
  course: { title: string; goal: string };
  wideOnPhones?: boolean;
  children?: ReactNode;
}) {
  return (
    <Tile wideOnPhones={wideOnPhones}>
      <p className="line-clamp-4 text-center text-lg font-bold break-words">
        {course.title}
      </p>
      <p className="mt-1 line-clamp-2 text-center text-sm break-words text-white/70">
        {course.goal}
      </p>
      {children}
    </Tile>
  );
}

/** A course's lessons complete out of its Syllabus, or its waiting proposal. */
export function CourseProgress({
  course,
}: {
  course: {
    syllabusAccepted: boolean;
    lessonCount: number;
    completedLessonCount: number;
  };
}) {
  return (
    <p className="mt-2 text-xs text-white/50">
      {course.syllabusAccepted
        ? `${course.completedLessonCount} of ${course.lessonCount} lessons complete`
        : 'Syllabus proposal ready'}
    </p>
  );
}
