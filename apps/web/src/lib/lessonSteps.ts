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

/** The step the URL's query names, or the first when it names none of them. */
export function currentStepIndex(steps: LessonStep[], search: URLSearchParams) {
  return Math.max(
    0,
    steps.findIndex((step) => step.id === search.get('step')),
  );
}
