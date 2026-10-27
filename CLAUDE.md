# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Study Hall, a learning app (flashcards with spaced repetition today; AI-assisted courses planned) — pnpm monorepo with a React frontend (`apps/web`) and Express/tRPC backend (`apps/api`), using Prisma with PostgreSQL (Docker Compose for local dev). The project follows a TDD-oriented development approach.

**Status:** MVP complete and running on the v2 schema (#2). The rest of v2 is tracked as GitHub issues #3–#13 and #44–#51, and courses (spec #1) as #14–#27 and #37–#43. See **Implementation Order** below for what's next, and `docs/architecture/updated-plan.md` for the canonical consolidated plan.

## Implementation Order

**Completed: 30/47 planned issues**

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
   - [ ] #7 Full card lifecycle
   - [ ] #46 Mark cards as known, one at a time or in bulk
   - [ ] #53 Show cards in full on the Cards tab, with edit pencils
5. Lesson layout
   - [ ] #37 Lesson steps and outline
   - [ ] #38 By section / Full lesson view
   - [ ] #39 Wrap up: finish a lesson
   - [ ] #40 Practice: one at a time or all exercises
6. Tutor
   - [ ] #23 Ask the Tutor about a lesson
   - [ ] #31 Price prompt-cache tokens in the AI cost estimate
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

## Commands

### Development

- `pnpm dev` — start both API (port 3001) and web (port 5173) concurrently
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
- **Cards**: Create single cards, CSV import with preview (client-side parsing, diff against existing cards, editable preview dialog, structured `importCards` mutation), update (partial), delete, list by deck
- **Several Canonical Answers** (#3): a card has one or more Canonical Answers, the first primary, kept in the order given (`CanonicalAnswer.position`); create, update and import take them as a list, and studying accepts any of them, the grade naming the one matched (`matchedAnswer`). An update gives the answers in full (`editCard` in `services/cards.ts`): each with its Accepted Variants' texts when listed (`acceptedVariants`); an existing answer by its id keeps its row when retyped, and an unlisted one keeps its variants unless retyped, one without an id but with an existing answer's text is that answer, answers grading can't tell apart are refused, and a removed answer's variants go with it. A change to the answers' texts resets progress; choosing another primary alone doesn't. "a || b" in a CSV's answer column makes separate answers (`splitAnswers`); typed answer fields never split, and take more answers through "Add answer". On the Cards tab, a summary below each card ("11, 13") opens in place into the answers form (`CardAnswers`, `AnswersEditor`, `useAnswersForm`), which the study card's edit mode uses too; there, answers and their variants save together with Save. The form explains in plain words how answers (different correct answers, each right on its own; changing them resets progress) differ from variants (other ways to write one answer; never reset). The import preview shows each row's answers and the variants an update would clear. Once a card is graded, the study screen shows the same summary below the learner's answer, read only; choosing it turns on the card's edit mode on its back, and says which answer matched when it wasn't the primary; "My answer was correct" on a card with several answers asks which one to add the variant to
- **Study**: Study Sessions (#5): a Standard queue of up to 25 due and NEW cards built at start, one graded answer per card (typed or "I don't know"), the card's progress updated by the scheduler after every answer, finish at the last card or early (remaining cards skipped), and a "nothing is due" state. Before a session starts, the title card says how many cards it would hold and how many the deck has, or that nothing is due and when the next card is (`study.queuePreview`, counted as the queue is); during one, it shows the session's size
- **Editing cards while studying** (#44, #49): the edit toggle on the study screen's card, the one in play or one reviewed with Back, turns on edit mode (`StudyCardEditor`): the front view edits the front and the back view the answers and variants, in place, the card growing to fit. Front, answers and variants save together with Save, as the Cards tab does (changing the front or the answers' texts resets progress and keeps attempts, ADR-0004; another primary or variants alone don't); Cancel, turning edit mode off or moving to another card drops the edits. Delete, in edit mode and after a confirmation, deletes the card. An unanswered card's back shows only in edit mode. The session goes on with the edited card, or moves past a deleted one and leaves it out of the summary; deleting a card removes its Study Session item, so a session whose cards are all deleted finishes
- **Card history** (#48): once a card is answered, and on a card reviewed with Back, the study screen shows the learner's history with it below their answer (`CardHistory`, `card.history`): for the current Card Version, the five most recent answers with their final grades and dates, how many times it was answered and how many were right (NAILED or GOOD, as stats count them: `isCorrect`), its lifecycle state in plain words and when it's next due ("Next review in 2 days"), never the mastery score. A picker (shadcn `Select`) lists the versions by number, "Version 2 (current)" first, and "Before version 1" for attempts with no recorded version; choosing an earlier one shows it as a small block of its front and each answer with the Accepted Variants it ended with, or that they weren't recorded, above the answers given to it. It's read only, needs no AI access, is the deck owner's only, and refreshes after "My answer was correct" or an edit
- **Accepted Variants** (#4, #50): the deck owner adds and removes a card's Accepted Variants, alternative phrasings of its Canonical Answer, in the answers form below each card on the Cards tab and on the back of the study card in edit mode, each answer's variants as chips below it, on any answer, new or retyped. They save with the form's Save, as each answer's `acceptedVariants` on `card.update` (`editCard` keeps the listed ones still there, adds the new and deletes the rest), and never reset progress or touch attempts (ADR-0004). A variant typed but not added is added on Save unless already accepted; a chip that grades the same as one of the answers is flagged and holds off Save. On the Cards tab, retyping a tile's answer that has variants asks which still fit, all ticked to start (`KeepVariantsDialog`; that answer saves when you leave it rather than as you type), and lists the ticked ones with the edit. A CSV import or a new card with the same front that replaces an answer clears its variants, and the import preview says so. A listed variant that `matchAnswer` finds exactly equal to one of the card's answers or an earlier variant of its answer is refused (`CONFLICT`, naming it); one differing only in accents isn't, so it can accept an unaccented form as exact. Studying grades an answer against each Canonical Answer and its variants (`gradeCardAnswer` in `services/cards.ts`): a variant grades as its answer would, an exact match beats an Accent Mismatch, and the result names the variant that matched
- **"My answer was correct"** (#12): after a typed answer graded MISSED, the study screen, on the card in play or one reviewed with Back, offers "My answer was correct" (`study.acceptAnswer`), unless the card was edited since. The answer becomes an Accepted Variant of the primary Canonical Answer (on a card with several, the one the learner picks), unless grading already accepts it, and is graded again. The attempt becomes the final one, keeping MISSED as its `initialSuggestedGrade` with `refinementApplied` and `REFINED_VARIANT`, and the card's progress is rebuilt by replaying its counted attempts from NEW (`replayAnswers` in `progressUpdater.ts`), so it reflects the new grade instead of the miss. Grading takes the best match across a card's canonical answers (`gradeCardAnswer`)
- **Revising cards** (#45, ADR-0007): on any deck's Cards tab, standalone or Course Deck, a learner who can use AI writes an instruction (up to 1,000 characters, such as "remove the hints from the fronts") under "Revise cards", and one Sonnet-class call (`ai/cardRevision.ts`, purpose `CARD_REVISION`, the card-writing rules shared with card proposals) proposes, for the cards it concerns, a new front and/or primary Canonical Answer, or a deletion, naming each card by its number in the prompt (`deck.proposeRevision`). Changes to cards the deck doesn't have, second changes to a card and edits that change nothing are left out. A deck with no cards or over 200 is refused before the call. Revising never adds cards (ADR-0007): when the instruction asks for something it can't do, or no card needs changing, the model says so in a note. The preview (`ReviseCardsDialog`) shows the instruction, the note, each edit as before and after, editable and wrapping, and each deletion, every one tickable, says how many cards will have their progress reset, and which retyped answers lose their Accepted Variants. Refine (#52) proposes again from a follow-up instruction, as often as the learner likes: each round is one call with every instruction so far, oldest first, and the proposal as the learner left it, their edits and which changes they unticked (`refining` on `deck.proposeRevision`, cards checked against the deck); the new proposal replaces the preview, which lists every instruction, and a failed round leaves it as it was. Nothing changes until the learner applies the ticked changes (`deck.applyRevision`, owner only, no AI access needed), in one transaction: edits through `editCard` (progress reset, attempts kept, ADR-0004; a new primary takes the old one's place, the other answers and their variants stay), each new Card Version recording the proposing model and prompt version, and deletions as the Cards tab deletes
- **Stats**: Per-deck stats (first-try accuracy, overall accuracy, per-card avg attempts-to-correct), overall stats (aggregates + weak cards), empty/loading/error states
- **Courses** (#14): Courses and Flashcards are peer top-level areas, with Courses as the landing page. The course form generates a Syllabus Proposal (Sonnet-class model); accepting it creates the Lessons and the Course Deck, listed in Flashcards with its course label. An unaccepted proposal can be discarded, which deletes the course (no learning history exists yet). Course creation is gated by `canUseAI`
- **Lessons** (#18): Syllabus lessons link to their lesson page. A lesson is generated the first time it's opened, behind a loading state, and stored as an immutable Lesson Version (content blocks, examples, Exercises and a Lesson Summary); reopening shows the same version without AI. Generation builds on the summaries of generated lessons earlier in syllabus order (`assembleLessonContext`). Every exercise is answered on the page and stored as an Exercise Attempt on its Lesson Version. Short answers and fill-in-the-blanks are checked with `matchAnswer` first, with no model call; an Accent Mismatch counts as correct, and the attempt records and shows the accented expected answer as a correction (ADR-0002). Generation marks each exercise closed or open (ADR-0005): only a free-form explanation, or an open short answer that matches no expected answer, goes to a Haiku-class model (`ai/exerciseEvaluation.ts`), which returns feedback the page shows, and the attempt records the model and prompt version that judged it; a closed exercise's answer never makes a model call. A short answer is judged Correct or Incorrect. An explanation is judged against what its question asks (ADR-0006): generation gives it one to three Essential Points and optional Supplementary Points, the judge assesses each essential point as demonstrated, missing or wrong and lists misconceptions, and `evaluateExplanation` derives Correct, Partially Correct or Incorrect; the attempt stores that assessment. Explanations generated before the split keep a flat `expectedPoints` list, which the judge treats as reference only. A learner without AI access doesn't see Open Exercises, only how many are hidden. Reopening shows each exercise's latest result, and after an attempt the learner can reveal the accepted answers, or an explanation's essential and supplementary points
- **Lesson Completion** (#26): the learner marks a lesson complete, and undoes it, from the lesson page, in any order, without AI access and whether or not it has been written (`Lesson.completedAt`). The Syllabus shows each lesson as not started, opened (from `firstOpenedAt`) or complete, and the course page's "Continue" goes to the first incomplete, non-archived lesson in syllabus order (`services/syllabus.ts`). Completion is progress through the Syllabus, never evidence of mastery
- **Course review** (#27): the course page's Review section shows how many Course Deck cards are due and new, counted with the same rules as a Study Session's queue (`countDueAndNewCards` in `studySessions.ts`), and "Study now" opens the deck's study flow. A Course Deck's study and stats pages link back to the course. No AI access is needed
- **Starting a lesson over** (#34): "Start over" on a written lesson, after a confirmation, sets `Lesson.resetAt` and clears Lesson Completion, without AI access. The lesson then shows only Exercise Attempts made since (`attemptsSinceReset` in `services/exercises.ts`), and revealing an exercise's answers needs an attempt since then; earlier attempts are kept (ADR-0003), and card proposals still use the full history. The reset time comes from the database clock, rounded up to the next millisecond, because attempts are timed by it to the microsecond (`nextResetTime`)
- **Review cards** (#25): a written lesson's "Make review cards" action, for learners who can use AI, makes one Sonnet-class call (`ai/cardProposal.ts`) that proposes cards from the current Lesson Version's content, examples and Lesson Summary, weighted toward that version's incorrect and partially correct Exercise Attempts, with the Course Deck's cards as input so it doesn't repeat them. Proposals are typed by card type, Typed Recall the only one (Card has no type column). They open in `ReviewCardsDialog`, the import preview for proposals, where the learner edits and deselects them; proposals whose front matches a Course Deck card (`duplicateFinder` in `csvDiff.ts`) are flagged and start deselected. Nothing is stored until the learner confirms; the confirmed cards are created in the Course Deck in one transaction through `createCards`, with the lesson as their Source Lesson and the proposing model and prompt version
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

| Router     | Procedure                                                                   | Type     |
| ---------- | --------------------------------------------------------------------------- | -------- |
| `aiUsage`  | `summary` (`aiAccessProcedure`), `report`                                   | query    |
| `auth`     | `signup`, `login`, `logout`                                                 | mutation |
| `auth`     | `me`                                                                        | query    |
| `deck`     | `create`, `update`, `delete`, `proposeRevision` (AI), `applyRevision`       | mutation |
| `deck`     | `getById`, `list`                                                           | query    |
| `card`     | `create`, `update`, `delete`, `importCards`                                 | mutation |
| `card`     | `listByDeck`, `history`                                                     | query    |
| `course`   | `create` (AI, `aiProcedure`), `acceptProposal`, `discardProposal`           | mutation |
| `course`   | `list`, `getById`                                                           | query    |
| `exercise` | `submitAttempt` (AI only for open answers it can't settle)                  | mutation |
| `exercise` | `answers` (once the exercise has an attempt)                                | query    |
| `lesson`   | `generate`, `proposeReviewCards` (AI, `aiProcedure`)                        | mutation |
| `lesson`   | `createReviewCards`, `setCompleted`, `startOver`                            | mutation |
| `lesson`   | `getById`                                                                   | query    |
| `study`    | `startSession`, `submitAnswer`, `dontKnow`, `finishSession`, `acceptAnswer` | mutation |
| `study`    | `queuePreview`                                                              | query    |
| `stats`    | `deckStats`, `overallStats`                                                 | query    |

### Key Services

- **`answerGrader.ts`**: Tier 1 deterministic grading. `matchAnswer` is the one comparison for any correct answer: case, punctuation and extra whitespace never matter but the spaces between words do, and an answer wrong only in its accents is an Accent Mismatch, which `gradeAnswer` grades GOOD, never NAILED (ADR-0002). Designed for future extension with embedding similarity (Tier 2) and local LLM adjudication (Tier 3). See `implementation-plan.md` "Future Enhancement" section.

- **`progressUpdater.ts`**: The scheduler's pure update of a card's progress after one answer: NEW → LEARNING, mastery change by Recall Grade (0–10), and the next due date from the LEARNING interval table.
- **`studySessions.ts`**: Study Session lifecycle: builds the queue, applies each answer in one transaction (attempt, item, progress) and finishes sessions.

- **AI platform (`ai/`)**: every model call goes through the `AiProvider` on the tRPC context (`ctx.ai`): Anthropic in production, `createFakeAiProvider()` in tests, so no test makes a network call. `generateStructured` runs one call, writes its `AiUsage` record, validates the output with a Zod schema and returns it with the model and prompt version to store; a failed call or invalid output is a retryable `BAD_GATEWAY` error. A call that ends without a response (the provider throws `AiOutcomeUnknownError` on a timeout or dropped connection) may still be billed, so it is recorded as `failed`, with a generous token estimate when the provider has no counts; an API error response is not billed and not recorded. The Anthropic client has SDK retries off (`maxRetries: 0`), so each call is one attempt and one record. `spend.ts` estimates each call's cost from a per-model price table (unknown models get the highest rate) and defines the AI month (UTC); the spending cap (`aiSpendStatus`) and the usage report (`usageReport.ts`) both price and group calls with it.

### Data Model

The v2 schema (`prisma/schema.prisma`, designed in `v2-schema-proposal.md`) has these models: `User`, `Session` (login sessions), `Deck`, `Card`, `CardVersion`, `CanonicalAnswer`, `AcceptedVariant`, `CardProgress`, `StudySession`, `StudySessionItem` and `CardAttempt`, plus `Course`, `SyllabusProposal`, `Lesson`, `LessonVersion`, `Exercise`, `ExerciseAttempt` and `AiUsage` for courses. A lesson's newest `LessonVersion` is its current one; versions and their exercises are never updated once created (ADR-0003). A Course Deck is a `Deck` with `courseId` set; it survives its course (`SetNull`). A card made from a lesson has `Card.sourceLessonId` (the Lesson, not the version; `SetNull`), plus the `sourceModel` and `sourcePromptVersion` that proposed it. A card has no single "back" field: its answers are `CanonicalAnswer` rows, and attempts record a `RecallGrade`. Cascade deletes on all parent relationships. Card edits reset progress but keep attempts (ADR-0004): only attempts made since `CardProgress.resetAt` count toward stats, via `services/countedAttempts.ts`. A card has Card Versions (ADR-0008, #47): a `CardVersion` holds what it asked, its front and Canonical Answers' texts, primary first, from `startedAt`, numbered from 1. The first comes with the card and a new one with each progress reset, at the same moment; a change of primary or of Accepted Variants makes none. The version an edit ends records the variants its answers ended with (`CardVersion.acceptedVariants`, #51); the current version's are the card's own, and versions that ended before this have none. A version started by revising the deck records the model and prompt version that proposed the edit (`CardVersion.sourceModel`, `sourcePromptVersion`, #45). The latest is the current version (`currentVersionId` in `services/cards.ts`), and each `CardAttempt` records the one it answered (`cardVersionId`); attempts from before versions were recorded and before the card's last reset have none. Cards are created and edited through `services/cards.ts`, which keeps each card's Canonical Answers (exactly one primary), NEW card progress and Card Versions in step.

### Testing Patterns

- **API tests** use isolated per-suite Postgres schemas via `apps/api/src/test-helpers.ts`: each test suite gets its own schema, Prisma client and tRPC caller. Docker Postgres must be running.
- **Web tests** use Vitest + React Testing Library with mocked tRPC hooks
- **Seed data** is idempotent (`deleteMany` before re-seeding)
- **AI in tests**: pass `ai: createFakeAiProvider()` in the caller context; queue outputs with `respondWith`, failures with `failWith('timeout' | 'connection-error' | 'api-error')`, and inspect `requests`. Stub `AI_ALLOWED_EMAILS` with `vi.stubEnv`
- **Test fixtures**: build decks with `createDeckWithCards` from `test-helpers.ts`, which creates cards the way the app does

## Planning Docs

All planning documents live in `docs/architecture/`. They hold the design and decisions. Work and its status are tracked in GitHub issues, so point to the issues instead of copying their status into these docs.

| Doc                               | Purpose                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updated-plan.md`                 | **Canonical v2 plan** — consolidated handoff with locked constraints, open questions, and implementation order                                      |
| `learning-model-and-scheduler.md` | Scheduler philosophy, lifecycle model, interval tables, session/queue design                                                                        |
| `planning.md`                     | Infra & tech stack decisions, deployment topology, data model concepts                                                                              |
| `v2-implementation-plan.md`       | **v2 design by milestone** (PRs 1–11); work is tracked as issues #2–#12, mapped at the top of the doc                                               |
| `v2-schema-proposal.md`           | Finalized Phase 1 Prisma schema for v2                                                                                                              |
| `courses-plan.md`                 | **Courses plan** — AI courses, lessons, exercises and tutor on top of v2; slices A–C and the lesson layout, tracked as #14–#27 and #37–#42; spec #1 |
| `implementation-plan.md`          | Original MVP plan (PRs 1–19, all delivered) — historical reference                                                                                  |

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
