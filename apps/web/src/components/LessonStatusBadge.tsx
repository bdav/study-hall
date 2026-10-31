import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { Circle, CircleCheck, CircleDot } from 'lucide-react';

export type LessonStatus =
  inferRouterOutputs<AppRouter>['course']['getById']['lessons'][number]['status'];

/** How each Lesson Completion status shows beside a lesson. */
const STATUSES: Record<
  LessonStatus,
  { label: string; Icon: typeof Circle; className: string }
> = {
  NOT_STARTED: {
    label: 'Not started',
    Icon: Circle,
    className: 'text-white/60',
  },
  OPENED: { label: 'Opened', Icon: CircleDot, className: 'text-white/60' },
  COMPLETE: { label: 'Complete', Icon: CircleCheck, className: 'text-white' },
};

/**
 * Where the learner is with a lesson: not started, opened or complete, as an
 * icon and a label, the icon alone on narrow screens.
 */
export function LessonStatusBadge({ status }: { status: LessonStatus }) {
  const { label, Icon, className } = STATUSES[status];
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 text-xs font-normal ${className}`}
    >
      <Icon className="size-4" aria-hidden />
      {/* The icon alone on narrow screens, for room */}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </span>
  );
}
