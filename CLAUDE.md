# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Study Hall, a learning app (flashcards with spaced repetition today; AI-assisted courses planned) — pnpm monorepo with a React frontend (`apps/web`) and Express/tRPC backend (`apps/api`), using Prisma with PostgreSQL (Docker Compose for local dev). The project follows a TDD-oriented development approach.

**Status:** MVP complete and running on the v2 schema (#2). The rest of v2 is tracked as GitHub issues #3–#13 and #44–#51, and courses (spec #1) as #14–#27, #37–#43 and #55–#57. See **Implementation Order** below for what's next, and `docs/architecture/updated-plan.md` for the canonical consolidated plan.

## Implementation Order

**Completed: 46/54 planned issues**

When picking the next ticket, work the first unchecked ticket in this list whose blockers are all closed. Check a ticket's box in the commit that closes it, and update the completed count above to match the boxes. The issue's state on GitHub is the truth: when a box disagrees with it, fix the box. The order gets one course usable end to end early, then groups the remaining work by area: cards, lesson layout, tutor, curriculum editing, then Study Sessions.

1. Core study loop
   - [x] #13 Spacing differences don't make an answer wrong
   - [x] #5 Study Session tracer bullet
   - [x] #6 Accent Mismatch grading
2. Usable course
   - [x] #14 Create a course from a generated Syllabus
   - [x] #29 Load the Anthropic key from 1Password in local dev (optional)
   - [x] #15 Monthly AI spending cap
   - [x] #30 Count AI calls that fail mid-flight toward the spending cap
   - [x] #28 See AI usage and spend against the monthly cap
   - [x] #18 Open a Lesson, generated on first open
   - [x] #20 Answer exercises (deterministic)
   - [x] #21 Accent Mismatch on exercises
   - [x] #22 AI-evaluated exercises
   - [x] #36 Grade explanations against what the question asks
   - [x] #35 Back links from a course and from AI usage to Courses
3. Learn → Review loop
   - [x] #25 Make review cards from a lesson
   - [x] #26 Lesson Completion and Continue
   - [x] #34 Start a lesson over
   - [x] #27 Course Review section
   - [x] #43 Better review card proposals
   - [x] #44 Edit or delete a card while studying
4. Cards and scheduling
   - [x] #4 Accepted Variants
   - [x] #12 "My answer was correct" during study
   - [x] #3 Cards with multiple Canonical Answers
   - [x] #49 Edit a card in place while studying
   - [x] #50 Save variants with the card's answers
   - [x] #47 Card versions: record what each attempt answered
   - [x] #48 Card history below the card while studying
   - [x] #51 Show an earlier Card Version's Accepted Variants
   - [x] #45 Revise a deck's cards with an instruction
   - [x] #52 Refine a deck revision with another instruction
   - [x] #7 Full card lifecycle
   - [x] #46 Mark cards as known, one at a time or in bulk
   - [x] #53 Show cards in full on the Cards tab, with edit pencils
   - [x] #54 View a card's version history and restore an earlier version
5. Lesson layout
   - [x] #37 Lesson steps and outline
   - [x] #38 By section / Full lesson view
   - [x] #39 Wrap up: finish a lesson
   - [x] #40 Practice: one at a time or all exercises
   - [x] #55 Examples: one at a time or all
   - [x] #56 Course page: pinned header and a compact, collapsible syllabus
   - [x] #57 Lighter lesson items: examples and exercises
   - [x] #59 Lesson step navigation polish
   - [x] #58 Site navigation fits on phones
   - [x] #60 Finish mobile responsiveness
6. Tutor
   - [x] #23 Ask the Tutor about a lesson
   - [x] #31 Price prompt-cache tokens in the AI cost estimate
   - [ ] #24 Tutor knows the current exercise and my attempts
7. Curriculum editing
   - [ ] #16 Edit and regenerate a Syllabus Proposal
   - [ ] #17 Edit the Syllabus; archive lessons and courses
   - [ ] #19 Regenerate a Lesson
8. Study sessions
   - [ ] #11 Missed cards come back in the same Study Session
   - [ ] #10 Resume and abandon Study Sessions
   - [ ] #8 Queue buckets and session types
   - [ ] #9 Study modes: Drill Weakest and Cram

New tickets join this list, unchecked, when they're created, unless labelled `needs-triage`.

Commit subjects stay plain sentences, with no issue-number prefix. Link a commit to its ticket with a trailer in the body: `Closes #N` on the commit that finishes it, and `Refs #N` on every other commit for it, including fixes after it's closed and planning commits (one `Refs` per issue).

## Commands

### Development

- `pnpm dev` — start both API (port 3001) and web (port 5173) concurrently; the API restarts on changes (`tsx watch`), and web hot-reloads. A restart while a lesson is being written leaves its generation claim held for up to 15 minutes
- `pnpm dev:op` — same, but the API runs under `op run` with secrets from the gitignored `.env.1password` (optional; see README)
- `pnpm dev:api` — start API server only
- `pnpm dev:web` — start web dev server only

### Testing

- `pnpm --filter web test` — run web Vitest tests
- `pnpm --filter web test:watch` — run web tests in watch mode
- `pnpm --filter api test` — run API Vitest tests
- `pnpm typecheck` — typecheck both apps, tests included (`tsx` and Vitest strip types without checking them)
- `pnpm judge-eval:op [model]` — run the exercise judge on fixed cases with real model calls (`ai/judgeEvalCases.ts`), to check the evaluation prompts and compare models. Not part of the test suite; costs a few cents, counted toward the cap as `dev@example.com` (`JUDGE_EVAL_EMAIL`)

### Web App (`apps/web`)

- `pnpm --filter web build` — production build (`tsc -b && vite build`)
- `pnpm --filter web lint` — run ESLint

### Database

- `docker compose up -d` — start local Postgres (required for `pnpm dev` and API tests)
- `pnpm prisma migrate dev` — run migrations
- `pnpm db:seed` — seed the dev database (log in as `dev@example.com` / `password`)
- `pnpm prisma generate` — regenerate Prisma client

### Environment Variables

- `DATABASE_URL` — Postgres connection string for the Docker Compose database, defined in `.env`
- `ANTHROPIC_API_KEY` — used by the Anthropic provider; only AI calls need it. Set it in `.env`, or as a 1Password secret reference in `.env.1password` for `pnpm dev:op`
- `AI_ALLOWED_EMAILS` — comma-separated allowlist read only by `canUseAI` (`apps/api/src/ai/access.ts`); unset means nobody can use AI features
- `AI_MONTHLY_CAP_USD` — monthly AI spending cap in US dollars, across all users (`apps/api/src/ai/spend.ts`); unset or invalid means AI is paused

## Architecture

**Frontend** (`apps/web/src/`): Vite + React 19 + TypeScript. Uses React Router for routing (`router.tsx`), TanStack Query for server state (`providers.tsx`), Tailwind CSS + shadcn/ui for styling. Path alias `@/*` maps to `src/*`.

**Backend** (`apps/api/src/`): Express 5 + tRPC + Zod validation. Entry point is `server.ts` (port 3001). Prisma client initialized in `db.ts` using the `@prisma/adapter-pg` driver adapter. All tRPC procedure inputs must be validated with Zod schemas.

**Database**: PostgreSQL via Prisma ORM, run locally with Docker Compose. Schema in `prisma/schema.prisma`, config in `prisma.config.ts`.

**Communication**: tRPC provides end-to-end type safety between frontend and backend. No REST API beyond the `/health` check endpoint.

**Both apps use ES modules** (`"type": "module"`). The API runs TypeScript directly via `tsx`.

## Lint Rules to Know

- **`react-hooks/set-state-in-effect`**: The ESLint config disallows calling `setState` synchronously inside `useEffect`. Instead of using an effect to reset/sync state, prefer deriving the value, computing it inline, or resetting state inside the event handler/callback that triggers the change.

## TDD Workflow

This project is an exercise in test-driven development. Follow the red-green-refactor cycle:

1. **Write a failing test** for the behavior you're about to implement
2. **Implement the minimal code** to make the test pass
3. **Refactor** while keeping tests green

TDD is most valuable for: CSV parsing, auth helpers, permission/ownership rules, study session logic, stats calculations, API procedure behavior. Be more pragmatic for static presentational components and trivial layout code.

## Current State (MVP Complete)

The full MVP from `implementation-plan.md` is implemented, plus PR 19 (Import Preview). All 19 planned PRs are delivered.

### Features

- **Auth**: Email/password signup & login, bcrypt password hashing, session cookies (HTTP-only), protected routes with redirect to `/login`
- **Decks**: Create, list (with summary stats: accuracy, card count, last studied), update name/description, delete with cascade
- **Cards**: Create single cards, CSV import with preview (client-side parsing, diff against existing cards, editable preview dialog, structured `importCards` mutation), update (partial), delete, list by deck. On the Cards tab, each tile shows its front and, flipped, its answer in full, the tile 3:2 at least and growing to fit, each with a pencil beside it at rest and underlined while it has focus, as the deck title is (`TileField` in `FlashCardTile.tsx`, #53); the answers summary below it wraps instead of cutting off, with a pencil after the answers
- **Several Canonical Answers** (#3): a card has one or more Canonical Answers, the first primary, kept in the order given (`CanonicalAnswer.position`); create, update and import take them as a list, and studying accepts any of them, the grade naming the one matched (`matchedAnswer`). An update gives the answers in full (`editCard` in `services/cards.ts`): each with its Accepted Variants' texts when listed (`acceptedVariants`); an existing answer by its id keeps its row when retyped, and an unlisted one keeps its variants unless retyped, one without an id but with an existing answer's text is that answer, answers grading can't tell apart are refused, and a removed answer's variants go with it. A change to the answers' texts resets progress; choosing another primary alone doesn't. "a || b" in a CSV's answer column makes separate answers (`splitAnswers`); typed answer fields never split, and take more answers through "Add answer". On the Cards tab, a summary below each card ("11, 13") opens in place into the answers form (`CardAnswers`, `AnswersEditor`, `useAnswersForm`), which the study card's edit mode uses too; there, answers and their variants save together with Save. The form explains in plain words how answers (different correct answers, each right on its own; changing them resets progress) differ from variants (other ways to write one answer; never reset). The import preview shows each row's answers and the variants an update would clear. Once a card is graded, the study screen shows the same summary below the learner's answer, read only; choosing it turns on the card's edit mode on its back, and says which answer matched when it wasn't the primary; "My answer was correct" on a card with several answers asks which one to add the variant to
- **Study**: Study Sessions (#5): a Standard queue of up to 25 due and NEW cards built at start, one graded answer per card (typed or "I don't know"), the card's progress updated by the scheduler after every answer, finish at the last card or early (remaining cards skipped), and a "nothing is due" state. Before a session starts, the title card says how many cards it would hold and how many the deck has, or that nothing is due and when the next card is (`study.queuePreview`, counted as the queue is); during one, it shows the session's size
- **Editing cards while studying** (#44, #49): the edit toggle on the study screen's card, the one in play or one reviewed with Back, turns on edit mode (`StudyCardEditor`): the front view edits the front and the back view the answers and variants, in place, the card growing to fit. Front, answers and variants save together with Save, as the Cards tab does (changing the front or the answers' texts resets progress and keeps attempts, ADR-0004; another primary or variants alone don't); The toggle is gone while editing: Cancel or moving to another card drops the edits. Delete, in edit mode and after a confirmation, deletes the card. An unanswered card's back shows only in edit mode. The session goes on with the edited card, or moves past a deleted one and leaves it out of the summary; deleting a card removes its Study Session item, so a session whose cards are all deleted finishes
- **Card history** (#48): once a card is answered, and on a card reviewed with Back, the study screen shows the learner's history with it below their answer (`CardHistory`, `card.history`): for the current Card Version, the five most recent answers with their final grades and dates, how many times it was answered and how many were right (NAILED or GOOD, as stats count them: `isCorrect`), its lifecycle state in plain words and when it's next due ("Next review in 2 days"), never the mastery score. A picker (shadcn `Select`) lists the versions by number, "Version 2 (current)" first, and "Before version 1" for attempts with no recorded version; choosing an earlier one shows it as a small block of its front and each answer with the Accepted Variants it ended with, or that they weren't recorded, above the answers given to it. It's read only, needs no AI access, is the deck owner's only, and refreshes after "My answer was correct" or an edit
- **Card version history** (#54): on the Cards tab, a tile's History action, or History in the study card's edit mode, opens the card's version history (`CardVersionsDialog`, from `card.history`): every Card Version, newest first, with when it started and ended, its front and each answer, primary first as it ended with them (the current version's as the card has them), with the Accepted Variants it ended with, or, when they weren't recorded, its answers as it started and a note saying so, how many times it was answered and how many right, and whether a revision of the deck started it or it restored an earlier one; then "Before version 1". An earlier version that asks something the card doesn't now (`canRestore`; `asksTheSame` in `services/cards.ts`: same front and answers in any order) has Restore, which after a confirmation edits the card back to it through `editCard` (`card.restoreVersion`, `restoreCardVersion`): its front and its answers as it ended with them, primary first, with their recorded variants, or, when none were recorded, as it started, an unchanged answer keeping its own variants and the others having none. That starts a new version recording `restoredFromNumber`, resets progress and keeps attempts (ADR-0004, ADR-0008). On the study screen, a restore leaves edit mode and the session goes on with the restored card, as after an edit. Owner only, no AI access needed
- **Accepted Variants** (#4, #50): the deck owner adds and removes a card's Accepted Variants, alternative phrasings of its Canonical Answer, in the answers form below each card on the Cards tab and on the back of the study card in edit mode, each answer's variants as chips below it, on any answer, new or retyped. They save with the form's Save, as each answer's `acceptedVariants` on `card.update` (`editCard` keeps the listed ones still there, adds the new and deletes the rest), and never reset progress or touch attempts (ADR-0004). A variant typed but not added is added on Save unless already accepted; a chip that grades the same as one of the answers is flagged and holds off Save. On the Cards tab, retyping a tile's answer that has variants asks which still fit, all ticked to start (`KeepVariantsDialog`; that answer saves when you leave it rather than as you type), and lists the ticked ones with the edit. A CSV import or a new card with the same front that replaces an answer clears its variants, and the import preview says so. A listed variant that `matchAnswer` finds exactly equal to one of the card's answers or an earlier variant of its answer is refused (`CONFLICT`, naming it); one differing only in accents isn't, so it can accept an unaccented form as exact. Studying grades an answer against each Canonical Answer and its variants (`gradeCardAnswer` in `services/cards.ts`): a variant grades as its answer would, an exact match beats an Accent Mismatch, and the result names the variant that matched
- **"My answer was correct"** (#12): after a typed answer graded MISSED, the study screen, on the card in play or one reviewed with Back, offers "My answer was correct" (`study.acceptAnswer`), unless the card was edited since. The answer becomes an Accepted Variant of the primary Canonical Answer (on a card with several, the one the learner picks), unless grading already accepts it, and is graded again. The attempt becomes the final one, keeping MISSED as its `initialSuggestedGrade` with `refinementApplied` and `REFINED_VARIANT`, and the card's progress is rebuilt by replaying its counted attempts from NEW (`replayAnswers` in `progressUpdater.ts`), so it reflects the new grade instead of the miss. Grading takes the best match across a card's canonical answers (`gradeCardAnswer`)
- **Revising cards** (#45, ADR-0007): on any deck's Cards tab, standalone or Course Deck, a learner who can use AI writes an instruction (up to 1,000 characters, such as "remove the hints from the fronts") under "Revise cards", and one Sonnet-class call (`ai/cardRevision.ts`, purpose `CARD_REVISION`, the card-writing rules shared with card proposals) proposes, for the cards it concerns, a new front and/or primary Canonical Answer, or a deletion, naming each card by its number in the prompt (`deck.proposeRevision`). Changes to cards the deck doesn't have, second changes to a card and edits that change nothing are left out. A deck with no cards or over 200 is refused before the call. Revising never adds cards (ADR-0007): when the instruction asks for something it can't do, or no card needs changing, the model says so in a note. The preview (`ReviseCardsDialog`) shows the instruction, the note, each edit as before and after, editable and wrapping, and each deletion, every one tickable, says how many cards will have their progress reset, and which retyped answers lose their Accepted Variants. Refine (#52) proposes again from a follow-up instruction, as often as the learner likes: each round is one call with every instruction so far, oldest first, and the proposal as the learner left it, their edits and which changes they unticked (`refining` on `deck.proposeRevision`, cards checked against the deck); the new proposal replaces the preview, which lists every instruction, and a failed round leaves it as it was. Nothing changes until the learner applies the ticked changes (`deck.applyRevision`, owner only, no AI access needed), in one transaction: edits through `editCard` (progress reset, attempts kept, ADR-0004; a new primary takes the old one's place, the other answers and their variants stay), each new Card Version recording the proposing model and prompt version, and deletions as the Cards tab deletes
- **Marking cards known** (#46, ADR-0009): the learner marks a card known, from the Mark known button on its tile on the Cards tab or on the study screen, below an answered card's grade (where it then says "Marked known" or "Already known") or in the card's edit mode, each offered only on a card not known already (`isKnown` in `progressUpdater.ts`: STABLE or RETIRED, given by `card.listByDeck` and `card.history`'s progress), or marks several at once: Select on the Cards tab ticks cards one by one or all, then Mark known or Delete acts on them after a confirmation that says how many (`CardSelectionBar`, `card.markKnown`, `card.deleteMany`). Marking known is a timing adjustment, not a grade (`markKnown` in `progressUpdater.ts`): no attempt is recorded, so stats ignore it; a NEW or LEARNING card becomes STABLE as if just graduated, mastery raised to at least 3 and due a STABLE GOOD interval away (5 days for a new or reset card), its last review and lapses unchanged; a card already STABLE or RETIRED is left as it is. Its items waiting in a Study Session under way are skipped, and `CardProgress.markedKnownAt` keeps the mark for `replayAnswers`, so "My answer was correct" doesn't undo it. On the study screen, the card in play marked known is moved past like a deleted one, and one reviewed with Back stays answered. Owner only, no AI access needed
- **Stats**: Per-deck stats (first-try accuracy, overall accuracy, per-card avg attempts-to-correct), overall stats (aggregates + weak cards), empty/loading/error states
- **Courses** (#14): Courses and Flashcards are peer top-level areas, with Courses as the landing page. The course form generates a Syllabus Proposal (Sonnet-class model); accepting it creates the Lessons and the Course Deck, listed in Flashcards with its course label. An unaccepted proposal can be discarded, which deletes the course (no learning history exists yet). Course creation is gated by `canUseAI`
- **Phones** (#60): every page and dialog fits from 320px, audited at 320, 390 and 768px (findings on #60). On the study page, below `md` Previous and Next sit in a row under the card, and swiping the card moves as they do, by the same rules (`swipeDirection` in `lib/swipe.ts`, `useSwipe`: a touch drag mostly across and far enough, not one starting on a control, a field or the card's editor; never in edit mode). Deck pages share `DeckHeader`, its tabs below the title below `md` and beside it from `md`, a long title wrapping rather than running under them; the Cards tab passes its editable title. The deck list is one deck per row below `sm` (`DeckCard` `wideOnPhones`), and the Cards tab's tiles one column below 360px. Tall dialogs (`tallDialogClassName` in `lib/utils.ts`) scroll as a whole on phones, their body alone from `sm`; the import preview's tables stack each row with its column names below `sm`. Fields are 16px below `md`, so iOS doesn't zoom into them. On touch screens (`pointer-coarse:`), controls shown only on hover are shown, and small icon controls get a 40px hit area (`touch-target` in `index.css`). Raising the 32px buttons and fields is #61
- **Site navigation** (#58): the bar above every signed-in page (`NavBar`) links Study Hall, the areas (Courses, Flashcards, Stats) with the current one marked, and Log out; below `sm` the areas and Log out are icons alone, padded to tap, their names kept for screen readers and the current area on a soft background, so it fits a 320px screen; its gutter switches with the page's (`PAGE_WIDTH`, `md`), so Study Hall lines up with the page
- **Course page** (#56): the course page shares the lesson page's pinned header (`PinnedHeader`, at `PAGE_WIDTH` in `lib/layout.ts`, so both pages' titles line up): the way back to Courses, the title, the goal (hidden on narrow screens) and "Continue: <lesson>", or "Every lesson is complete"; no ⋯ menu until it has an item. Review is one compact row below it. The accepted Syllabus is one list of rows, like a table of contents: each lesson's number, title (linking to it), Lesson Completion status (an icon and a label, the icon alone on narrow screens) and "Up next" on the lesson Continue goes to, with its objectives collapsed until opened, one lesson's at a time (opening another closes the first), sliding open and shut unless the learner prefers less motion. The page's content is centred, having no outline beside it. A Syllabus Proposal still lists its lessons with their objectives in full
- **Lessons** (#18): Syllabus lessons link to their lesson page. A lesson is generated the first time it's opened, behind a loading state, and stored as an immutable Lesson Version (content blocks, examples, Exercises and a Lesson Summary); reopening shows the same version without AI. Generation builds on the summaries of generated lessons earlier in syllabus order (`assembleLessonContext`). Every exercise is answered on the page and stored as an Exercise Attempt on its Lesson Version. Short answers and fill-in-the-blanks are checked with `matchAnswer` first, with no model call; an Accent Mismatch counts as correct, and the attempt records and shows the accented expected answer as a correction (ADR-0002). Generation marks each exercise closed or open (ADR-0005): only a free-form explanation, or an open short answer that matches no expected answer, goes to a Haiku-class model (`ai/exerciseEvaluation.ts`), which returns feedback the page shows, and the attempt records the model and prompt version that judged it; a closed exercise's answer never makes a model call. A short answer is judged Correct or Incorrect. An explanation is judged against what its question asks (ADR-0006): generation gives it one to three Essential Points and optional Supplementary Points, the judge assesses each essential point as demonstrated, missing or wrong and lists misconceptions, and `evaluateExplanation` derives Correct, Partially Correct or Incorrect; the attempt stores that assessment. Explanations generated before the split keep a flat `expectedPoints` list, which the judge treats as reference only. A learner without AI access doesn't see Open Exercises, only how many are hidden. Reopening shows each exercise's latest result, and after an attempt the learner can reveal the accepted answers, or an explanation's essential and supplementary points
- **Lesson steps** (#37): a written lesson is read as steps (`lessonSteps` in `lib/lessonSteps.ts`): one per content section, then Examples (left out when the version has none), Practice (the exercises) and Wrap up ("Make review cards" and Lesson Completion). Previous/Next and the ←/→ keys move between them, never while focus is in a field, dialog or menu or with a modifier held; each step starts at the top and the page scrolls. Moving with the keys or the outline takes focus to the new step's heading (`focusStepHeading`, no ring), so none is left behind and screen readers announce it; the footer's buttons keep focus. The footer is two halves, its two buttons alike (`TargetButton`): one to a step shows its direction above the step's title, and one to an item leaves that line empty, so the main text and arrows line up, and the footer rests at the bottom of the screen on a step shorter than it, its row tall enough for two lines, so paging doesn't move it (#59). The step is in the URL (`?step=section-2`, `examples`, `practice`, `wrap-up`), an unknown one opening the first. The frame (`LessonFrame`) has a header pinned to the top (back link, title, a Mark complete toggle (in the ⋯ menu below `sm`) and a ⋯ menu holding Start over), the outline on the left (`LessonOutline`: the steps, the current one marked, "N of M answered" beside Practice; always shown on desktop, a drawer from the menu button on mobile), the step at a reading width (70ch for prose, wider for examples), and a tutor region on the right that takes no space while empty. A lesson not yet written shows as before
- **Reading views** (#38): on the reading steps (sections and Examples), a By section / Full lesson control: in the pinned header beside Mark complete on a section or the Full lesson page, in the ⋯ menu on narrow screens and on the Examples step, whose header shows only its own view (the header only ever shows the view of what's on screen) (`READING_VIEWS` in `lib/lessonSteps.ts`), By section the default and the choice remembered by the browser (`useStoredChoice`, falling back when storage is unavailable). Full lesson shows every section and the Examples as one page, so the browser's find works across them; Practice and Wrap up stay their own steps, and Previous/Next and the keys treat the page as one step (`adjacentSteps`). The URL keeps the learner's section in both views: entering the page (switching views, Back, reloading, Previous from Practice) scrolls to the URL's section, outline links scroll to theirs, and as the learner scrolls the URL follows the section being read (`sectionBeingRead`: the last whose top has passed a line under the pinned header, or the last once the page is at its end), replacing rather than adding history entries
- **Examples views** (#55): in By section, the Examples step shows its examples One at a time (the default) or All examples, sharing Practice's remembered view, so choosing either in one step applies to both; the Examples view control is the Examples step's one control in the header, or in the ⋯ menu on narrow screens. One at a time shows the example as a textbook's, set off by a rule with its explanation beneath, at the reading width (70ch, so its count and the footer end where the explanation wraps), its count as numbers only ("2 / 8", `ItemCount`) beside the step's heading, and walks the examples with the footer's buttons and the ←/→ keys, as Practice does; the URL holds the example by its position from 1 (`?step=examples&example=2`, `exampleSearch`, `namedExampleIndex`), written on arriving or in place of one the lesson lacks. Reaching Examples or Practice going back, from the step after, opens its last item, as a stack of cards would. All examples is a table, each example beside its explanation (stacked on narrow screens), as is Full lesson, where Examples are all shown on the one page, with no Examples view to choose. Neither view uses cards (#57)
- **Practice views** (#40): the Practice step (`LessonPractice`) shows its exercises One at a time (the default) or All exercises (`pagingViews`), chosen in the pinned header as the reading view is, or the ⋯ menu on narrow screens. One at a time shows the one exercise on a light panel, its type and count ("3 / 6") at its top; All exercises numbers each in the margin, with hairlines between, and a rule down its side saying how its shown answer went, unmarked once that answer is edited (`data-result` in `LessonExercise`, #57). In both, a result is coloured text, and Check sits beside the answer: right of a short answer, whose one-line field grows taller as a long answer wraps (Enter, the keyboard's Go, still checks it), or on phones as a return arrow in the field's corner, at the end of a gap's sentence, and below an explanation. The footer's buttons and the ←/→ keys walk the exercises ("Previous exercise", "Next exercise"), reaching the previous or next step only past the first or last (a `Target` in `WrittenLesson`: a step, or an item of the step on screen, `Paging`); the exercise on screen is always in the URL (`?step=practice&exercise=…`, the first written on arriving), for the tutor (#24). Two independent toggles, a pair of switches in the header at wide widths (not a segmented control, which is for a view's options) and ⋯ menu checkboxes below, apply in both views: Show my answers (on by default) shows each exercise's latest answer and result, and off starts each blank so it can be retaken, answering making a new Exercise Attempt; Show answer key (off by default) shows every attempted exercise's accepted answers or points, an unattempted one saying to answer it first, its answers never requested before an attempt, and turning it either way closes answers opened one at a time. The view and toggles are remembered by the browser (`useStoredPagingView` and `useStoredPracticeToggles` in `hooks/useStoredLessonSettings.ts`, `useStoredFlag`), the view shared with Examples
- **Wrap up** (#39): a written lesson's last step (`LessonWrapUp`) ends it without going back to the course page, none of it needing AI access except review cards. It shows each shown exercise's latest result since any Start over ("Correct", "Partly right", "Incorrect" or "Not tried yet") and how many were right, a partly right one counting as missed; each missed one links to it in Practice (`?step=practice&exercise=…`, which scrolls to it). "Make review cards" is never disabled, and its guidance follows the attempts: the exercises it will focus on are the ones ever got wrong on the version, counted by the API as the proposal picks them, including misses since put right or before starting over (`version.missedExerciseCount` on `lesson.getById`); with none, it suggests trying the exercises first, or says nothing was missed. Once every shown exercise has an attempt and the lesson isn't complete, it suggests Lesson Completion, never setting it. "Continue: <title>" opens the next lesson: the first incomplete, non-archived lesson in syllabus order other than this one (`nextLesson` on `lesson.getById` and `lesson.generate`, `continueTarget` in `services/syllabus.ts`, which the course page's Continue uses too); with none, it says every other lesson is complete and links back to the course
- **Lesson Completion** (#26): the learner marks a lesson complete, and undoes it, from the lesson page, in any order, without AI access and whether or not it has been written (`Lesson.completedAt`). The Syllabus shows each lesson as not started, opened (from `firstOpenedAt`) or complete, and the course page's "Continue" goes to the first incomplete, non-archived lesson in syllabus order (`services/syllabus.ts`). Completion is progress through the Syllabus, never evidence of mastery
- **Course review** (#27): the course page's Review section shows how many Course Deck cards are due and new, counted with the same rules as a Study Session's queue (`countDueAndNewCards` in `studySessions.ts`), and "Study now" opens the deck's study flow. A Course Deck's study and stats pages link back to the course. No AI access is needed
- **Starting a lesson over** (#34): "Start over" on a written lesson, after a confirmation, sets `Lesson.resetAt` and clears Lesson Completion, without AI access. The lesson then shows only Exercise Attempts made since (`attemptsSinceReset` in `services/exercises.ts`), and revealing an exercise's answers needs an attempt since then; earlier attempts are kept (ADR-0003), and card proposals still use the full history. The reset time comes from the database clock, rounded up to the next millisecond, because attempts are timed by it to the microsecond (`nextResetTime`)
- **Review cards** (#25): a written lesson's "Make review cards" action, for learners who can use AI, makes one Sonnet-class call (`ai/cardProposal.ts`) that proposes cards from the current Lesson Version's content, examples and Lesson Summary, weighted toward that version's incorrect and partially correct Exercise Attempts, with the Course Deck's cards as input so it doesn't repeat them. Proposals are typed by card type, Typed Recall the only one (Card has no type column). They open in `ReviewCardsDialog`, the import preview for proposals, where the learner edits and deselects them; proposals whose front matches a Course Deck card (`duplicateFinder` in `csvDiff.ts`) are flagged and start deselected. Nothing is stored until the learner confirms; the confirmed cards are created in the Course Deck in one transaction through `createCards`, with the lesson as their Source Lesson and the proposing model and prompt version
- **Tutor** (#23): a learner who can use AI has the Tutor (`TutorPanel`), shown and hidden by a speech-bubble toggle ending the lesson page's header, which then runs to the window's right edge (`HEADER_BESIDE_PANEL`). From `lg` it is docked at the window's right edge, the lesson still lined up with the header (`PAGE_WIDTH_BESIDE_PANEL`), open to start and remembered by the browser, sliding in and out unless the learner prefers less motion, and filling the screen below the header without making the page taller (the outline then a drawer until `xl`); below `lg` it is a drawer from the right, closed to start. It stays open from step to step, and a reply in progress is kept when it closes. Each Lesson Version has one Tutor Thread, restored on reopening (`tutor.thread`, no AI access needed); a new version starts a fresh one and the old stays with its version. A message streams its reply back as it is written (`tutor.ask`, a mutation returning an async generator, sent over `httpBatchStreamLink` by `splitLink` in `providers.tsx`), and the message and reply are stored together once the reply is complete, so a failed or refused reply stores nothing and the message goes back in the box. The call runs to the end even if the learner leaves, so the reply is kept (`generateStreamed` in `ai/generate.ts`). The tutor knows the course setup, the active syllabus as an outline, the current version's sections and examples, and the thread, nothing from other lessons (`assembleTutorContext`, `buildTutorRequest` in `ai/tutor.ts`), and its system prompt adapts Claude Study Agent's tutor rules. One Sonnet-class call per message (purpose `TUTOR`, low effort), the rules and lesson prompt-cached; its cache writes and reads priced at their own rates (#31). Replies are plain text. The current exercise and attempts come in #24
- **AI usage** (#28): the Courses page shows this month's AI spend across all learners against the monthly cap, and whether AI is paused, to learners who can use AI. The AI usage page breaks the learner's own usage down by purpose and model for this month and totals each previous month
- **UX Polish**: Loading skeletons, Sonner toast notifications, error boundaries (app root + per-route), seed data (4 decks, 30 cards, 3 study sessions)

### Routes

| Path                   | Page                                                             | Auth      |
| ---------------------- | ---------------------------------------------------------------- | --------- |
| `/login`               | LoginPage                                                        | Public    |
| `/signup`              | SignupPage                                                       | Public    |
| `/`                    | Redirects to `/courses` (kept for a later view above both areas) | Protected |
| `/courses`             | CoursesPage                                                      | Protected |
| `/courses/new`         | NewCoursePage                                                    | Protected |
| `/courses/:courseId`   | CoursePage (proposal or Syllabus)                                | Protected |
| `/lessons/:lessonId`   | LessonPage (generated on first open)                             | Protected |
| `/ai-usage`            | AiUsagePage (the learner's AI usage and estimated cost)          | Protected |
| `/flashcards`          | DeckListPage                                                     | Protected |
| `/decks/:deckId`       | StudyPage                                                        | Protected |
| `/decks/:deckId/cards` | DeckCardsPage                                                    | Protected |
| `/decks/:deckId/stats` | DeckStatsPage                                                    | Protected |
| `/stats`               | StatsPage (overall)                                              | Protected |

### tRPC API

All procedures except `auth.*` and `healthCheck` require authentication via `protectedProcedure`. AI-backed procedures use `aiProcedure`, which also requires `canUseAI` and refuses with `TOO_MANY_REQUESTS` once the month's AI spend reaches the cap, before any model call. `aiAccessProcedure` is the `canUseAI` check alone, for AI information that stays readable while AI is paused. A procedure that needs AI only sometimes, like `exercise.submitAttempt`, stays a `protectedProcedure` and calls `assertCanUseAI` and `assertAiNotPaused` before its model call. All data procedures enforce ownership (user can only access their own decks/cards/sessions).

| Router     | Procedure                                                                                | Type     |
| ---------- | ---------------------------------------------------------------------------------------- | -------- |
| `aiUsage`  | `summary` (`aiAccessProcedure`), `report`                                                | query    |
| `auth`     | `signup`, `login`, `logout`                                                              | mutation |
| `auth`     | `me`                                                                                     | query    |
| `deck`     | `create`, `update`, `delete`, `proposeRevision` (AI), `applyRevision`                    | mutation |
| `deck`     | `getById`, `list`                                                                        | query    |
| `card`     | `create`, `update`, `delete`, `deleteMany`, `importCards`, `markKnown`, `restoreVersion` | mutation |
| `card`     | `listByDeck`, `history`                                                                  | query    |
| `course`   | `create` (AI, `aiProcedure`), `acceptProposal`, `discardProposal`                        | mutation |
| `course`   | `list`, `getById`                                                                        | query    |
| `exercise` | `submitAttempt` (AI only for open answers it can't settle)                               | mutation |
| `exercise` | `answers` (once the exercise has an attempt)                                             | query    |
| `lesson`   | `generate`, `proposeReviewCards` (AI, `aiProcedure`)                                     | mutation |
| `lesson`   | `createReviewCards`, `setCompleted`, `startOver`                                         | mutation |
| `lesson`   | `getById`                                                                                | query    |
| `study`    | `startSession`, `submitAnswer`, `dontKnow`, `finishSession`, `acceptAnswer`              | mutation |
| `study`    | `queuePreview`                                                                           | query    |
| `tutor`    | `ask` (AI, `aiProcedure`; streams the reply)                                             | mutation |
| `tutor`    | `thread`                                                                                 | query    |
| `stats`    | `deckStats`, `overallStats`                                                              | query    |

### Key Services

- **`answerGrader.ts`**: Tier 1 deterministic grading. `matchAnswer` is the one comparison for any correct answer: case, punctuation and extra whitespace never matter but the spaces between words do, and an answer wrong only in its accents is an Accent Mismatch, which `gradeAnswer` grades GOOD, never NAILED (ADR-0002). Designed for future extension with embedding similarity (Tier 2) and local LLM adjudication (Tier 3). See `implementation-plan.md` "Future Enhancement" section.

- **`progressUpdater.ts`**: The scheduler's pure update of a card's progress after one answer (`applyAnswer`), given the counted answers before it (`findCountedAnswers` in `studySessions.ts`), and the same as a replay of them all (`replayAnswers`), #7. Mastery changes by Recall Grade (0–10). NEW → LEARNING on the first answer; LEARNING → STABLE on a success (GOOD or NAILED) that makes 2 or more since the card entered LEARNING (`lifecycleChangedAt`), across 2 or more Study Sessions or UTC days; STABLE → LEARNING on a MISSED that makes 2 in the last 3 answers since it became STABLE; every STABLE MISSED counts a lapse; nothing retires. LEARNING cards are scheduled on the LEARNING table, a first-ever NAILED with GOOD's 1 day; STABLE cards on the band table by mastery before the answer, with a flat 1.25× lateness bonus, for a card already STABLE, on GOOD or NAILED at 1.5 or more intervals overdue, never past 90 days (decisions in `learning-model-and-scheduler.md`).
- **`studySessions.ts`**: Study Session lifecycle: builds the queue, applies each answer in one transaction (attempt, item, progress) and finishes sessions.

- **AI platform (`ai/`)**: every model call goes through the `AiProvider` on the tRPC context (`ctx.ai`): Anthropic in production, `createFakeAiProvider()` in tests, so no test makes a network call. `generateStructured` runs one call, writes its `AiUsage` record, validates the output with a Zod schema and returns it with the model and prompt version to store; a failed call or invalid output is a retryable `BAD_GATEWAY` error. A call that ends without a response (the provider throws `AiOutcomeUnknownError` on a timeout or dropped connection) may still be billed, so it is recorded as `failed`, with a generous token estimate when the provider has no counts; an API error response is not billed and not recorded. The Anthropic client has SDK retries off (`maxRetries: 0`), so each call is one attempt and one record. `generateStreamed` does the same for a reply streamed by the provider's `streamChat` (the tutor's), yielding its text as it arrives and storing it through `onComplete` once complete; it runs to the end even if the caller stops reading, and only the AI's failures become `BAD_GATEWAY`. `spend.ts` estimates each call's cost from a per-model price table (unknown models get the highest rates), pricing uncached input, 5-minute and 1-hour cache writes, cache reads and output each at the model's rate (#31); the provider reports cache writes by lifetime, counting any it can't attribute as 1-hour, and `AiUsage` stores them (`cacheWrite5mTokens`, `cacheWrite1hTokens`, `cacheReadTokens`). Haiku 5.5's long-prompt rate applies when a call's prompt, cached tokens included, is over 100K tokens, as Anthropic bills it. `spend.ts` also defines the AI month (UTC); the spending cap (`aiSpendStatus`) and the usage report (`usageReport.ts`) both price and group calls with it, and the report's input tokens count every input token, cached or not.

### Data Model

The v2 schema (`prisma/schema.prisma`, designed in `v2-schema-proposal.md`) has these models: `User`, `Session` (login sessions), `Deck`, `Card`, `CardVersion`, `CanonicalAnswer`, `AcceptedVariant`, `CardProgress`, `StudySession`, `StudySessionItem` and `CardAttempt`, plus `Course`, `SyllabusProposal`, `Lesson`, `LessonVersion`, `Exercise`, `ExerciseAttempt`, `TutorThread`, `TutorMessage` and `AiUsage` for courses. A lesson's newest `LessonVersion` is its current one; versions and their exercises are never updated once created (ADR-0003). A version has at most one `TutorThread` (#23), whose `TutorMessage`s are the learner's (`LEARNER`) and the tutor's (`TUTOR`, with the model and prompt version that wrote it). A Course Deck is a `Deck` with `courseId` set; it survives its course (`SetNull`). A card made from a lesson has `Card.sourceLessonId` (the Lesson, not the version; `SetNull`), plus the `sourceModel` and `sourcePromptVersion` that proposed it. A card has no single "back" field: its answers are `CanonicalAnswer` rows, and attempts record a `RecallGrade`. Cascade deletes on all parent relationships. `CardProgress.lifecycleChangedAt` is when the card last entered its lifecycle state, none for progress from before it was recorded (#7), and `markedKnownAt` when the learner last marked it known (#46, ADR-0009); a reset clears both. Card edits reset progress but keep attempts (ADR-0004): only attempts made since `CardProgress.resetAt` count toward stats, via `services/countedAttempts.ts`. A card has Card Versions (ADR-0008, #47): a `CardVersion` holds what it asked, its front and Canonical Answers' texts, primary first, from `startedAt`, numbered from 1. The first comes with the card and a new one with each progress reset, at the same moment; a change of primary or of Accepted Variants makes none. The version an edit ends records the variants its answers ended with (`CardVersion.acceptedVariants`, #51); the current version's are the card's own, and versions that ended before this have none. A version started by revising the deck records the model and prompt version that proposed the edit (`CardVersion.sourceModel`, `sourcePromptVersion`, #45), and one restoring an earlier version that version's number (`CardVersion.restoredFromNumber`, #54). The latest is the current version (`currentVersionId` in `services/cards.ts`), and each `CardAttempt` records the one it answered (`cardVersionId`); attempts from before versions were recorded and before the card's last reset have none. Cards are created and edited through `services/cards.ts`, which keeps each card's Canonical Answers (exactly one primary), NEW card progress and Card Versions in step.

### Testing Patterns

- **API tests** use isolated per-suite Postgres schemas via `apps/api/src/test-helpers.ts`: each test suite gets its own schema, Prisma client and tRPC caller. Docker Postgres must be running.
- **Web tests** use Vitest + React Testing Library with mocked tRPC hooks
- **Seed data** is idempotent (`deleteMany` before re-seeding)
- **AI in tests**: pass `ai: createFakeAiProvider()` in the caller context; queue outputs with `respondWith`, streamed replies with `streamReply` (pieces, optionally refused or failing after them), failures with `failWith('timeout' | 'connection-error' | 'api-error')`, and inspect `requests` (structured calls) and `chatRequests` (streamed ones). Stub `AI_ALLOWED_EMAILS` with `vi.stubEnv`
- **Test fixtures**: build decks with `createDeckWithCards` from `test-helpers.ts`, which creates cards the way the app does

## Planning Docs

All planning documents live in `docs/architecture/`. They hold the design and decisions. Work and its status are tracked in GitHub issues, so point to the issues instead of copying their status into these docs.

| Doc                               | Purpose                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `updated-plan.md`                 | **Canonical v2 plan** — consolidated handoff with locked constraints, open questions, and implementation order                                               |
| `learning-model-and-scheduler.md` | Scheduler philosophy, lifecycle model, interval tables, session/queue design                                                                                 |
| `planning.md`                     | Infra & tech stack decisions, deployment topology, data model concepts                                                                                       |
| `v2-implementation-plan.md`       | **v2 design by milestone** (PRs 1–11); work is tracked as issues #2–#12, mapped at the top of the doc                                                        |
| `v2-schema-proposal.md`           | Finalized Phase 1 Prisma schema for v2                                                                                                                       |
| `courses-plan.md`                 | **Courses plan** — AI courses, lessons, exercises and tutor on top of v2; slices A–C and the lesson layout, tracked as #14–#27, #37–#42 and #55–#57; spec #1 |
| `implementation-plan.md`          | Original MVP plan (PRs 1–19, all delivered) — historical reference                                                                                           |

### v2 Direction

v2 is an architectural evolution of the MVP, not a greenfield rewrite. Key changes:

- **Spaced repetition scheduler**: Explicit lifecycle states (NEW/LEARNING/STABLE/RETIRED), table-driven intervals, finite energy-budgeted sessions
- **AI answer grading**: 3-tier pipeline (deterministic → embeddings → hosted LLM fallback)
- **Postgres migration**: SQLite → Postgres (Railway), Docker Compose for local dev
- **Deployment**: Vercel (frontend) + Railway (API + Postgres)
- **New features**: Study modes (Study/Drill Weakest/Cram), reverse decks, marketplace (deferred scope)

See `docs/architecture/updated-plan.md` §28 for locked constraints and §29 for remaining open questions.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `bdav/study-hall`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
