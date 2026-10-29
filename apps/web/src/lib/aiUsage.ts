/**
 * Router state for opening AI usage from the Courses page, which it then
 * links back to. Opened from the site's navigation, it has no way back:
 * it's an area of its own.
 */
export const FROM_COURSES = { from: 'courses' } as const;

/** Whether AI usage was opened from the Courses page. */
export function openedFromCourses(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    state.from === FROM_COURSES.from
  );
}
