import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { AiSpendSummary } from '@/components/AiSpendSummary';
import { CenteredPage } from '@/components/CenteredPage';
import { CourseListSkeleton } from '@/components/PageSkeleton';
import { formatDate } from '@/lib/format';

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
      <div className="w-full max-w-2xl text-white">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Your Courses</h1>
          <Button asChild variant="secondary">
            <Link to="/courses/new">
              <Plus className="size-4" />
              New course
            </Link>
          </Button>
        </div>

        <AiSpendSummary />

        {courses.length === 0 ? (
          <p className="mt-6 text-white/60">
            {archived.length > 0
              ? 'No active courses. Start a new one, or restore one below.'
              : "No courses yet. Tell us what you want to learn and we'll propose a syllabus."}
          </p>
        ) : (
          <ul className="mt-6 space-y-3">
            {courses.map((course) => (
              <li key={course.id}>
                <Link
                  to={`/courses/${course.id}`}
                  className="block rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm transition-shadow hover:shadow-lg"
                >
                  <p className="text-lg font-bold">{course.title}</p>
                  <p className="text-sm text-white/70">{course.goal}</p>
                  <p className="mt-1 text-xs text-white/50">
                    {course.syllabusAccepted
                      ? `${course.lessonCount} lessons`
                      : 'Syllabus proposal ready'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <ArchivedCourses archived={archived} />
      </div>
    </CenteredPage>
  );
}
