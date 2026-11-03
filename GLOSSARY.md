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

**Reverse Variant**:
An Accepted Variant of a card's front, accepted when a Reversible Deck is studied in Reverse. Each Study Direction has its own variants, so a Reverse Variant never counts Forward.
_Avoid_: Front variant, reverse alias

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

**Study Mode**:
How a Study Session mixes its cards: Study, balanced; Drill Weakest, mostly weak cards and no new ones; or Cram, more new cards and reviews before they're due. Every mode schedules answers the same way.
_Avoid_: Session type (that's its length: Quick, Standard or Deep)

**Retry**:
A missed card brought back at the end of the same Study Session for practice, at most twice. Its answer is recorded, but never changes when the card is next reviewed: the first answer already did. It isn't a Counted Answer.
_Avoid_: Relearn, repeat, reappearance

**Lifecycle State**:
Where one Study Direction of a card is in its life: New, Learning, Reinforcing or Retired. It says what kind of review the card gets, not how well it's known.
_Avoid_: Status, stage

**New**:
A card the learner hasn't yet answered in that Study Direction, or hasn't since an edit reset it.
_Avoid_: Unseen, fresh

**Learning**:
A card being learned: answered, but not yet right often enough, across separate Study Sessions or days, to graduate. It comes back at short intervals, and misses are expected.
_Avoid_: Relearning

**Reinforcing**:
A card that has graduated from Learning and comes back at growing intervals to strengthen it. A Reinforcing card that keeps being missed falls back to Learning.
_Avoid_: Stable, mastered, known

**Retired**:
A card taken out of normal review because the learner has mastered it: suggested by the app, confirmed by the learner, and undone at any time, with its mastery and history kept.
_Avoid_: Suspended, archived, deleted

**Lifecycle Mark**:
Something the learner does to one Study Direction of a card's lifecycle that isn't an answer: marking it known, retiring it or unretiring it. Each takes effect at its moment among the card's Counted Answers, so grading an answer again never undoes one, and an edit that resets the card clears them as it clears its Counted Answers.
_Avoid_: Lifecycle event, override, manual transition

**Counted Answer**:
An answer the scheduler takes into account: given since the card's progress in that Study Direction last reset, and not a Retry. Other answers are kept as history but count toward nothing, in scheduling or stats.
_Avoid_: Valid attempt, scored answer

**Due**:
A card in review is due when its next review time has come. Cram counts a card due sooner, so it comes round more often before the learner needs it.
_Avoid_: Scheduled, overdue (that's how late a due card is)

**Weak**:
A Reinforcing card that's slipping: low mastery, or repeated misses among its recent Counted Answers, though not yet enough to send it back to Learning. Weakness is instability, not urgency: a well-known card can be due without being Weak, and a card Marked Known since it was last answered isn't Weak.
_Avoid_: Struggling, difficult, hard card

**Card Standing**:
Where one Study Direction of a card stands for the learner: its Lifecycle State, and whether it's due or Weak, as its schedule and Counted Answers show. Reverse has none while its deck isn't reversible.
_Avoid_: Card status, card progress

**Reversible Deck**:
A deck its author has marked as studyable in both Study Directions, because its fronts can be typed from their answers. A deck that isn't reversible is studied Forward only.
_Avoid_: Two-way deck, reverse deck (there is no second deck)

**Study Direction**:
Which way a card is asked: Forward, the front prompting its canonical answer, or Reverse, the canonical answer prompting its front. Each direction of a card is learned, scheduled and graded on its own.
_Avoid_: Normal/reversed, recognition/production, front-first

**Direction Label**:
What a reversible deck calls one of its Study Directions, such as "Capitals from states" and "States from capitals". Forward and Reverse stand in when a deck has none.
_Avoid_: Mode name (Study Mode is something else)

**Shared Answer**:
A primary answer that two or more cards of a Reversible Deck have, as grading compares answers, so Reverse shows them the same prompt. In Reverse each accepts any of their fronts, but not one already given correctly for another of them in the Study Session (ADR-0012).
_Avoid_: Duplicate answer, ambiguous card

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
One generated rendition of a lesson: its instructional content, exercises and lesson summary. It never changes once created; regenerating a lesson produces a new version. Versions are numbered from 1 in the order they were written. The newest is the lesson's current version, the only one the learner answers or asks the tutor about; earlier versions are kept to read back. Exercise attempts and tutor threads are learner state about a version, not part of it.
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
