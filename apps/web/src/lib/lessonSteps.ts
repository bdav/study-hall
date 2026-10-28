/**
 * The steps a written lesson is read in: one per content section, then
 * Examples, Practice and Wrap up. They come straight from the Lesson
 * Version, so a version needs nothing stored about its steps.
 */
export type LessonStep =
  | { id: string; kind: 'section'; title: string; sectionIndex: number }
  | { id: 'examples'; kind: 'examples'; title: 'Examples' }
  | { id: 'practice'; kind: 'practice'; title: 'Practice' }
  | { id: 'wrap-up'; kind: 'wrap-up'; title: 'Wrap up' };

export function lessonSteps(version: {
  content: { heading: string }[];
  examples: unknown[];
}): LessonStep[] {
  return [
    ...version.content.map(
      (block, index): LessonStep => ({
        id: `section-${index + 1}`,
        kind: 'section',
        title: block.heading,
        sectionIndex: index,
      }),
    ),
    // A version without examples has nothing to show on the step
    ...(version.examples.length > 0
      ? [{ id: 'examples', kind: 'examples', title: 'Examples' } as const]
      : []),
    { id: 'practice', kind: 'practice', title: 'Practice' },
    { id: 'wrap-up', kind: 'wrap-up', title: 'Wrap up' },
  ];
}

/** The query string that opens a step, for links and navigation alike. */
export function stepSearch(step: LessonStep) {
  return `?step=${step.id}`;
}

/** The query string that opens Practice at an exercise. */
export function exerciseSearch(exerciseId: string) {
  return `?step=practice&exercise=${exerciseId}`;
}

/** The exercise the URL's query opens Practice at, if any. */
export function currentExerciseId(search: URLSearchParams) {
  return search.get('exercise');
}

/** Where an exercise sits on the Practice step. */
export function exerciseElementId(exerciseId: string) {
  return `exercise-${exerciseId}`;
}

/** The step the URL's query names, or the first when it names none of them. */
export function currentStepIndex(steps: LessonStep[], search: URLSearchParams) {
  return Math.max(
    0,
    steps.findIndex((step) => step.id === search.get('step')),
  );
}

/**
 * How the reading steps (the sections and Examples) are shown: one at a
 * time, or all on one page so the browser's find works across the lesson.
 */
export const READING_VIEWS = [
  { value: 'by-section', label: 'By section' },
  { value: 'full', label: 'Full lesson' },
] as const;

export type ReadingView = (typeof READING_VIEWS)[number]['value'];

export function isReadingStep(step: LessonStep) {
  return step.kind === 'section' || step.kind === 'examples';
}

/**
 * The steps Previous and Next go to. In Full lesson the reading steps are
 * one page, so from any of them Next goes past them all.
 */
export function adjacentSteps(
  steps: LessonStep[],
  index: number,
  view: ReadingView,
) {
  if (view === 'full' && isReadingStep(steps[index])) {
    const firstReading = steps.findIndex(isReadingStep);
    return {
      previous: steps[firstReading - 1],
      next: steps.find((step, i) => i > index && !isReadingStep(step)),
    };
  }
  return { previous: steps[index - 1], next: steps[index + 1] };
}
