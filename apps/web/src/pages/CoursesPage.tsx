import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { AiSpendSummary } from '@/components/AiSpendSummary';
import { CenteredPage } from '@/components/CenteredPage';
import { CourseListSkeleton } from '@/components/PageSkeleton';

export default function CoursesPage() {
  const coursesQuery = trpc.course.list.useQuery();

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
            No courses yet. Tell us what you want to learn and we'll propose a
            syllabus.
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
      </div>
    </CenteredPage>
  );
}
