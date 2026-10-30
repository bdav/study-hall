import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/app';
import { countOf, formatMinutes } from '@/lib/format';

export type Pacing = NonNullable<
  inferRouterOutputs<AppRouter>['course']['getById']['pacing']
>;

/**
 * How a Syllabus Proposal fits the learner's time, so they can judge at a
 * glance: "12 lessons · about 30 minutes each · about 4 weeks at 2 hours a
 * week, before your deadline".
 */
export function PacingLine({ pacing }: { pacing: Pacing }) {
  const { lessons, sessionMinutes, minutesPerWeek, weeks, deadline } = pacing;
  const byDeadline = deadline
    ? deadline.finishesBefore
      ? ', before your deadline'
      : `, ${countOf(deadline.weeksOver, 'week')} past your deadline`
    : '';

  return (
    <p className="mt-3 text-sm font-medium text-white/85">
      {`${countOf(lessons, 'lesson')} · about ${formatMinutes(sessionMinutes)} each · about ${countOf(weeks, 'week')} at ${formatMinutes(minutesPerWeek)} a week${byDeadline}`}
    </p>
  );
}
