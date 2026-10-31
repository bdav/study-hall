# Study Hall

A personal learning app: standalone flashcard decks with spaced repetition, plus AI-assisted courses that teach material and feed what was learned into the same review cycle.

## Learning content vs learner state

**Learning Content**:
Material that exists independently of how well anyone knows it: courses, syllabi, lessons, exercises, decks and cards.
_Avoid_: Data, material

**Learner State**:
Everything that records what the learner did or how well they know something: attempts, card progress, tutor threads.
_Avoid_: Progress data, history

## Flashcards and review

**Deck**:
A named collection of cards studied together. A deck is either standalone or a course deck.
_Avoid_: Set, collection

**Course Deck**:
The deck a course adds its confirmed cards to. It stays reviewable when its course is archived, and becomes a standalone deck with its review history intact if the course is permanently deleted.
_Avoid_: Lesson deck, generated deck

**Card**:
An item in a deck that the review scheduler brings back over time. Cards are the only thing that takes part in spaced-repetition review; how a card is answered and graded depends on its card type.
_Avoid_: Flashcard exercise, review item, note

**Card Type**:
The form a card takes and how answers to it are judged. Typed recall is currently the only card type.
_Avoid_: Card kind, card format

**Typed Recall**:
The card type where the learner types an answer to a prompt and it is judged against the card's canonical answers.
_Avoid_: Standard card, basic card, front/back card

**Source Lesson**:
The lesson a card was generated from, if any. It explains why the card exists; the card still belongs to its deck, not to the lesson.
_Avoid_: Origin, parent lesson

**Canonical Answer**:
An answer the deck author considers correct for a typed recall card. A card has one or more, all equally correct; one is primary, the answer the card shows. Editing one changes what the card asks for; choosing another primary doesn't.
_Avoid_: Back, solution

**Accepted Variant**:
An alternative phrasing accepted as equivalent to a canonical answer, without changing what the card asks for.
_Avoid_: Alias, synonym

**Card Version**:
What a card asked at one time: its front and canonical answers. A card gets a new version whenever an edit changes what it asks, which also resets its progress; changing accepted variants doesn't, though a version that has ended records the accepted variants it ended with. Restoring an earlier version is an edit like any other: it starts a new version asking what the earlier one asked, which names the version it restored. Each card attempt records the version it answered.
_Avoid_: Revision, edition

**Recall Grade**:
The system's judgement of one answer to a card: Missed, Partially Correct, Good or Nailed. The learner never assigns it.
_Avoid_: Score, result, rating

**Marked Known**:
A card the learner says they already know, so it moves on to review a few days out instead of coming back as new. It adjusts when the card is next reviewed, never its Recall Grades: no answer is recorded (ADR-0009).
_Avoid_: Mark correct, skip, mastered

**Accent Mismatch**:
An answer that matches a correct answer except for accent marks. It is accepted, but the correct accented form is always shown and it never counts as perfect recall.
_Avoid_: Typo, near miss

**Study Session**:
A finite, time-budgeted run through cards from one deck.
_Avoid_: Session (ambiguous with login sessions), review session

**Retry**:
A missed card brought back at the end of the same Study Session for practice, at most twice. Its answer is recorded, but never changes when the card is next reviewed: the first answer already did.
_Avoid_: Relearn, repeat, reappearance

## Courses

**Course**:
A learning goal plus an organized path toward it, such as "Italian: A1 to A2".
_Avoid_: Class, curriculum, track

**Archived Course**:
A course removed from the active courses list with its content and learning history kept intact.
_Avoid_: Deleted course, inactive course

**Course Setup**:
A course's confirmed brief: its title, topic, goal, prior knowledge, what the learner can already do, time per week, session length, an optional deadline, preferred depth, what to focus on and skip, materials they're following, and notes. Every generation call for the course (syllabus, lessons, tutor) builds on it.
_Avoid_: Setup answers, course settings

**Setup Interview**:
The short rounds of questions that draft a new course's Course Setup from what the learner says they want to learn and why. Each question but the placement checklist ("Which of these can you already do?", which starts unticked) comes with a suggested answer, and it asks only what is still open, for at most three rounds; the learner then checks the draft on the course form.
_Avoid_: Onboarding, questionnaire, wizard

**Syllabus**:
The ordered list of lessons that make up a course's path. Its order is the teaching sequence, regardless of the order in which the learner opens lessons or they are generated.
_Avoid_: Study plan, curriculum, outline

**Syllabus Proposal**:
A generated syllabus the learner can edit or regenerate before accepting it as the course's syllabus.
_Avoid_: Draft syllabus

**Lesson**:
A unit of instructional content within a syllabus — explanation, examples and exercises on one topic — that can be revisited without being regenerated.
_Avoid_: Module, chapter, day

**Lesson Version**:
One generated rendition of a lesson: its instructional content, exercises and lesson summary. It never changes once created; regenerating a lesson produces a new version. Exercise attempts and tutor threads are learner state about a version, not part of it.
_Avoid_: Revision, draft

**Lesson Summary**:
A compact record of the rules, vocabulary and material a lesson version introduced and practiced, so later lessons can build on it. It records what was taught, never what was learned.
_Avoid_: Recap, notes, mastery

**Archived Lesson**:
A lesson removed from the active syllabus. It no longer appears in navigation or progression, but its versions and all learning history attached to it are kept.
_Avoid_: Deleted lesson, hidden lesson

**Learning Objective**:
A short statement of what a lesson should enable the learner to do.
_Avoid_: Concept, skill, goal

**Lesson Completion**:
The learner's own mark that they are done with a lesson, settable in any order. It records where the learner is in the syllabus, never how well they know the material.
_Avoid_: Mastery, passed, finished

**Exercise**:
A one-off activity inside a lesson version, such as a translation or a free-form explanation. Exercises do not take part in spaced-repetition review.
_Avoid_: Question, activity, flashcard

**Closed Exercise**:
An exercise whose expected answers are the complete list of right answers, so an answer that matches none of them is wrong, without AI evaluation. Fill-in-the-blanks are always closed.
_Avoid_: Exact exercise, deterministic exercise

**Open Exercise**:
An exercise whose right answers can be phrased in ways no list covers, so an answer that matches no expected answer is evaluated by AI. Free-form explanations are always open; short answers can be either.
_Avoid_: Fuzzy exercise, AI exercise

**Essential Point**:
An idea a free-form explanation must show because its question explicitly asks for it. An explanation is judged on its essential points, in whatever words the learner uses.
_Avoid_: Required point, key point, expected point

**Supplementary Point**:
A related detail worth knowing that a free-form explanation's question doesn't ask for. Leaving it out never counts against an answer.
_Avoid_: Bonus point, extra credit

**Exercise Attempt**:
The learner's answer to an exercise and its evaluation, with written feedback when the exercise type calls for it.
_Avoid_: Submission, response

**Exercise Evaluation**:
The judgement of one exercise attempt: Correct, Partially Correct or Incorrect. Partially Correct applies only to free-form explanations that show some of their essential points, or all of them alongside a misconception.
_Avoid_: Score, grade (grades are for cards)

**Tutor**:
The AI assistant available alongside a lesson that answers questions, gives hints and checks understanding. What it knows can extend beyond the current lesson to the learner's state across the course.
_Avoid_: Chatbot, assistant, coach

**Tutor Thread**:
A persistent conversation between the learner and the tutor about one lesson version. A version can have several: the newest is its current thread, the only one the tutor sees. The learner starts a fresh one when the current one has grown long or gone off track, and starting the lesson over starts one too. Regenerating a lesson starts afresh on the new version. Earlier threads remain with their version, to read back.
_Avoid_: Chat, conversation, session
