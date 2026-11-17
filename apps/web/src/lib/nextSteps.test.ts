import { describe, expect, it } from 'vitest';
import {
  afterDeckSession,
  afterLesson,
  afterReview,
  type Today,
} from './nextSteps';

type ReviewDeck = Today['review']['decks'][number];
type CourseRow = Today['continueLearning'][number];

/** A deck as Today's Review lists it, ticked, with cards due. */
function deck(id: string, overrides: Partial<ReviewDeck> = {}): ReviewDeck {
  return {
    id,
    name: `Deck ${id}`,
    course: null,
    cardCount: 10,
    dueCount: 3,
    newCount: 0,
    cramUntil: null,
    ticked: true,
    ...overrides,
  };
}

/** A course whose next step is a lesson. */
function lessonRow(id: string, lesson: string): CourseRow {
  return {
    id,
    title: `Course ${id}`,
    goal: 'A goal',
    deadline: null,
    next: {
      kind: 'LESSON',
      lesson: { id: `${id}-lesson`, title: lesson, written: true },
    },
  };
}

/** A course whose Syllabus Proposal is waiting. */
function proposalRow(id: string): CourseRow {
  return {
    id,
    title: `Course ${id}`,
    goal: 'A goal',
    deadline: null,
    next: { kind: 'SYLLABUS_PROPOSAL' },
  };
}

/** What `today.get` gives, in Today's order. */
function today(
  decks: ReviewDeck[] = [],
  continueLearning: CourseRow[] = [],
): Today {
  return {
    review: {
      decks,
      nextDueAt: null,
      todaysReview: {
        dueCount: 0,
        newCount: 0,
        deckCount: 0,
        unfinished: null,
      },
    },
    continueLearning,
    previews: { decks: [], courses: [] },
    aiPaused: false,
  } as unknown as Today;
}

describe('afterDeckSession', () => {
  it("offers the first ticked deck in Today's order other than this one, and the first course's next step", () => {
    const steps = afterDeckSession(
      today(
        [
          deck('this', { dueCount: 9 }),
          deck('unticked', { dueCount: 8, ticked: false }),
          deck('next', { name: 'Capitals', dueCount: 4 }),
          deck('after'),
        ],
        [lessonRow('c1', 'Greetings'), lessonRow('c2', 'Numbers')],
      ),
      'this',
    );

    expect(steps).toEqual([
      { label: 'Next deck: Capitals (4 due)', to: '/decks/next' },
      { label: 'Continue: Greetings', to: '/lessons/c1-lesson' },
    ]);
  });

  it('counts a deck with nothing due by its new cards', () => {
    const [step] = afterDeckSession(
      today([deck('next', { name: 'Italian', dueCount: 0, newCount: 5 })]),
      'this',
    );

    expect(step.label).toBe('Next deck: Italian (5 new)');
  });

  it("continues to a course's Syllabus Proposal on its course page", () => {
    expect(afterDeckSession(today([], [proposalRow('c1')]), 'this')).toEqual([
      { label: 'Continue: Course c1', to: '/courses/c1' },
    ]);
  });

  it('leaves out each step there is none for', () => {
    expect(
      afterDeckSession(
        today([deck('this'), deck('unticked', { ticked: false })]),
        'this',
      ),
    ).toEqual([]);
  });
});

describe('afterReview', () => {
  it("offers the first course's next step alone", () => {
    expect(
      afterReview(today([deck('d1')], [lessonRow('c1', 'Greetings')])),
    ).toEqual([{ label: 'Continue: Greetings', to: '/lessons/c1-lesson' }]);
  });

  it('offers nothing with no course to continue', () => {
    expect(afterReview(today([deck('d1')]))).toEqual([]);
  });
});

describe('afterLesson', () => {
  const courseDeck = deck('italian-deck', {
    name: 'Italian',
    course: { id: 'this-course', title: 'Italian for travel' },
    dueCount: 2,
    // Unticked for Today's Review, but still the course's to review
    ticked: false,
  });

  it("offers this course's deck, back to the course from it, and another course's next step", () => {
    const steps = afterLesson(
      today(
        [deck('other'), courseDeck],
        [lessonRow('this-course', 'Lesson 3'), lessonRow('c2', 'Numbers')],
      ),
      'this-course',
    );

    expect(steps).toEqual([
      {
        label: 'Review: Italian (2 due)',
        to: '/decks/italian-deck',
        state: { fromCourseId: 'this-course' },
      },
      { label: 'Next course: Numbers', to: '/lessons/c2-lesson' },
    ]);
  });

  it("goes to another course's Syllabus Proposal on its course page", () => {
    expect(afterLesson(today([], [proposalRow('c2')]), 'this-course')).toEqual([
      { label: 'Next course: Course c2', to: '/courses/c2' },
    ]);
  });

  it('leaves out each step there is none for', () => {
    expect(
      afterLesson(
        today([deck('other')], [lessonRow('this-course', 'Lesson 3')]),
        'this-course',
      ),
    ).toEqual([]);
  });
});
