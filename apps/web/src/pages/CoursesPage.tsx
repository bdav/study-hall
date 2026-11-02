import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { AiSpendSummary } from '@/components/AiSpendSummary';
import { CenteredPage } from '@/components/CenteredPage';
import { CourseListSkeleton } from '@/components/PageSkeleton';
import { Tile } from '@/components/Tile';
import { formatDate } from '@/lib/format';
import { TILE_GRID } from '@/lib/layout';

/**
 * Archived courses, out of the way below the active ones: collapsed to
 * start, each linking to its page, where it can be restored.
 */
function ArchivedCourses({
  archived,
}: {
  archived: { id: string; title: string; archivedAt: Date | string | null }[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (archived.length === 0) return null;

  return (
    <section aria-label="Archived courses" className="mt-10">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="archived-courses"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1 text-sm text-white/60 hover:text-white"
      >
        <ChevronRight
          className={`size-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          aria-hidden
        />
        Archived ({archived.length})
      </button>
      {/* Kept in the page while closed, so the toggle's aria-controls
          always points at it */}
      <div id="archived-courses" hidden={!isOpen}>
        <ul className="mt-3 space-y-2">
          {archived.map((course) => (
            <li key={course.id}>
              <Link
                to={`/courses/${course.id}`}
                className="flex items-baseline justify-between gap-4 rounded-xl border border-white/20 bg-white/5 px-4 py-3 hover:bg-white/10"
              >
                <span className="font-medium">{course.title}</span>
                {course.archivedAt && (
                  <span className="shrink-0 text-xs text-white/50">
                    Archived {formatDate(course.archivedAt)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function CoursesPage() {
  const coursesQuery = trpc.course.list.useQuery();
  const archived = trpc.course.listArchived.useQuery().data ?? [];

  if (coursesQuery.isLoading) {
    return <CourseListSkeleton />;
  }

  if (coursesQuery.isError) {
    return (
      <CenteredPage centered>
        <p className="text-destructive">Error loading courses.</p>
      </CenteredPage>
    );
  }

  const courses = coursesQuery.data ?? [];

  return (
    <CenteredPage>
      <div className="w-full max-w-4xl text-white">
        <h1 className="text-2xl font-bold">Your Courses</h1>

        <AiSpendSummary />

        {courses.length === 0 && (
          <p className="mt-6 text-white/60">
            {archived.length > 0
              ? 'No active courses. Start a new one, or restore one below.'
              : "No courses yet. Tell us what you want to learn and we'll propose a syllabus."}
          </p>
        )}

        <ul aria-label="Active courses" className={`mt-6 ${TILE_GRID}`}>
          <li>
            <Link
              to="/courses/new"
              className="flex h-full transition-shadow hover:shadow-lg"
            >
              <Tile wideOnPhones>
                <Plus className="h-10 w-10 text-white/60" aria-hidden />
                <p className="mt-2 text-sm font-medium text-white/60">
                  New course
                </p>
              </Tile>
            </Link>
          </li>
          {courses.map((course) => (
            <li key={course.id}>
              {/* As tall as its row, which a long title or goal can make
                  taller than a tile's shape */}
              <Link
                to={`/courses/${course.id}`}
                className="flex h-full transition-shadow hover:shadow-lg"
              >
                <Tile wideOnPhones>
                  <p className="line-clamp-2 text-center text-lg font-bold break-words">
                    {course.title}
                  </p>
                  {/* The full goal is on the course page */}
                  <p className="mt-1 line-clamp-2 text-center text-sm break-words text-white/70">
                    {course.goal}
                  </p>
                  <p className="mt-2 text-xs text-white/50">
                    {course.syllabusAccepted
                      ? `${course.completedLessonCount} of ${course.lessonCount} lessons complete`
                      : 'Syllabus proposal ready'}
                  </p>
                </Tile>
              </Link>
            </li>
          ))}
        </ul>

        <ArchivedCourses archived={archived} />
      </div>
    </CenteredPage>
  );
}
