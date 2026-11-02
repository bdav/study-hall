# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Study Hall, a learning app: flashcard decks with spaced repetition, and AI-assisted courses whose lessons feed the same review. A pnpm monorepo with a React frontend (`apps/web`) and Express/tRPC backend (`apps/api`), using Prisma with PostgreSQL (Docker Compose for local dev). The project follows a TDD-oriented development approach.

What the app does, area by area, is in `docs/features.md`; the plans and decisions behind it are in `docs/architecture/` and `docs/adr/`.

## Implementation Order

**Completed: 6/14 planned issues**

When picking the next ticket, work the first unchecked ticket in this list whose blockers are all closed. Check a ticket's box in the commit that closes it, and update the completed count above to match the boxes. The issue's state on GitHub is the truth: when a box disagrees with it, fix the box. The list started afresh on 2026-11-01; checked tickets are cleared out now and then, and earlier work is in closed issues and git history.

1. Polish
   - [x] #80 Show courses as tiles, as Flashcards shows decks
   - [x] #93 Start another session from the title card, with its options
   - [x] #94 Make the glow on a control mean Enter will press it
   - [x] #95 Show edit pencils on hover and focus, not at rest
2. Reversible decks
   - [x] #82 Reversible decks: study a deck in either direction
   - [x] #83 AI-suggested Direction Labels for a reversible deck
   - [ ] #84 Card-writing rule for reversible decks
3. Go live: tickets join here once the design (#91) has a spec
4. Review and scheduling
   - [ ] #85 Stats on the scheduler's terms
   - [ ] #86 Suggest retiring mastered cards, and unretire them
   - [ ] #87 Cram toward a target date
5. Courses
   - [ ] #88 View a lesson's earlier versions, read only
   - [ ] #89 Permanently delete archived courses and lessons
   - [ ] #70 Evaluation script for the Setup Interview and syllabus prompts
   - [ ] #90 Seed data for courses and every card state

**Waiting on design or triage**, outside the order until a session readies them:

- Design
  - #91 Go live: deploy, access, observability
  - #92 A Today view with review across decks
  - #71 Adapt a course to what the learner does
- Triage
  - #41 Concept checks and examples within lesson sections
  - #42 Rich lesson content blocks
  - #61 Touch-sized controls on phones
  - #76 Generate cards from uploaded files
- Exploration
  - #32 Switchable visual themes, from palettes to immersive worlds

Work planned and deliberately not being built is listed under Parked in `docs/architecture/updated-plan.md`.

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

## How the code works

Before changing how an existing feature behaves, read its entry in `docs/features.md`, and update that entry in the same commit. It also maps the routes and every tRPC procedure.

All procedures except `auth.*` and `healthCheck` require authentication via `protectedProcedure`. AI-backed procedures use `aiProcedure`, which also requires `canUseAI` and refuses with `TOO_MANY_REQUESTS` once the month's AI spend reaches the cap, before any model call. `aiAccessProcedure` is the `canUseAI` check alone, for AI information that stays readable while AI is paused. A procedure that needs AI only sometimes, like `exercise.submitAttempt`, stays a `protectedProcedure` and calls `assertCanUseAI` and `assertAiNotPaused` before its model call. All data procedures enforce ownership (user can only access their own decks/cards/sessions).

### Key Services

- **`answerGrader.ts`**: Tier 1 deterministic grading. `matchAnswer` is the one comparison for any correct answer: case, punctuation and extra whitespace never matter but the spaces between words do, and an answer wrong only in its accents is an Accent Mismatch, which `gradeAnswer` grades GOOD, never NAILED (ADR-0002). AI grading tiers for typed card answers (embedding similarity, then a model fallback) are parked (`updated-plan.md` §29c).

- **`progressUpdater.ts`**: The scheduler's pure update of a card's progress after one answer (`applyAnswer`), given the counted answers before it (`findCountedAnswers` in `studySessions.ts`, which leaves out same-session retries, #11), and the same as a replay of them all (`replayAnswers`), #7. Mastery changes by Recall Grade (0–10). NEW → LEARNING on the first answer; LEARNING → STABLE on a success (GOOD or NAILED) that makes 2 or more since the card entered LEARNING (`lifecycleChangedAt`), across 2 or more Study Sessions or UTC days; STABLE → LEARNING on a MISSED that makes 2 in the last 3 answers since it became STABLE; every STABLE MISSED counts a lapse; nothing retires. LEARNING cards are scheduled on the LEARNING table, a first-ever NAILED with GOOD's 1 day; STABLE cards on the band table by mastery before the answer, with a flat 1.25× lateness bonus, for a card already STABLE, on GOOD or NAILED at 1.5 or more intervals overdue, never past 90 days (decisions in `learning-model-and-scheduler.md`).
- **`queueGenerator.ts`**: A Study Session's queue (#8): `findQueueCandidates` fetches each bucket's cards, deriving weakness from attempts, and `composeQueue`, pure and seeded, sizes and mixes them by session type and study mode; golden tests in `queueGenerator.test.ts`.
- **`studySessions.ts`**: Study Session lifecycle: builds the queue (`queueGenerator.ts`), applies each answer in one transaction (attempt, item, progress) and finishes sessions.

- **AI platform (`ai/`)**: every model call goes through the `AiProvider` on the tRPC context (`ctx.ai`): Anthropic in production, `createFakeAiProvider()` in tests, so no test makes a network call. `generateStructured` runs one call, writes its `AiUsage` record, validates the output with a Zod schema and returns it with the model and prompt version to store; a failed call or invalid output is a retryable `BAD_GATEWAY` error. A call that ends without a response (the provider throws `AiOutcomeUnknownError` on a timeout or dropped connection) may still be billed, so it is recorded as `failed`, with a generous token estimate when the provider has no counts; an API error response is not billed and not recorded. The Anthropic client has SDK retries off (`maxRetries: 0`), so each call is one attempt and one record. `generateStreamed` does the same for a reply streamed by the provider's `streamChat` (the tutor's), yielding its text as it arrives and storing it through `onComplete` once complete; it runs to the end even if the caller stops reading, and only the AI's failures become `BAD_GATEWAY`. `spend.ts` estimates each call's cost from a per-model price table (unknown models get the highest rates), pricing uncached input, 5-minute and 1-hour cache writes, cache reads and output each at the model's rate (#31); the provider reports cache writes by lifetime, counting any it can't attribute as 1-hour, and `AiUsage` stores them (`cacheWrite5mTokens`, `cacheWrite1hTokens`, `cacheReadTokens`). Haiku 5.5's long-prompt rate applies when a call's prompt, cached tokens included, is over 100K tokens, as Anthropic bills it. `spend.ts` also defines the AI month (UTC); the spending cap (`aiSpendStatus`) and the usage report (`usageReport.ts`) both price and group calls with it, and the report's input tokens count every input token, cached or not.

### Data Model

The v2 schema (`prisma/schema.prisma`, designed in `docs/architecture/archive/v2-schema-proposal.md`) has these models: `User`, `Session` (login sessions), `Deck`, `Card`, `CardVersion`, `CanonicalAnswer`, `AcceptedVariant`, `ReverseVariant`, `CardProgress`, `StudySession`, `StudySessionItem` and `CardAttempt`, plus `Course`, `SyllabusProposal`, `Lesson`, `LessonVersion`, `Exercise`, `ExerciseAttempt`, `TutorThread`, `TutorMessage` and `AiUsage` for courses. A lesson's newest `LessonVersion` is its current one; versions and their exercises are never updated once created (ADR-0003). A version written by regenerating records what the learner asked for, its chips (`LessonVersion.feedbackChips`) and words (`feedback`, #19), none on a first open. A version has `TutorThread`s numbered from 1 (#23, #62), the highest its current one, whose `TutorMessage`s are the learner's (`LEARNER`) and the tutor's (`TUTOR`, with the model and prompt version that wrote it). A `SyllabusProposal` holds its lessons as JSON, as the learner left them (a lesson they added may have no objectives), and the feedback of each regeneration as JSON rounds, `{ chips, text }`, oldest first (`feedback`, #16, #74). A Course Deck is a `Deck` with `courseId` set; it survives its course (`SetNull`). A deck is archived, never deleted at once, with `Deck.archivedAt` (#77). A Reversible Deck (`Deck.reversible`, ADR-0011, #82) is studied in either Study Direction, named by its Direction Labels (`forwardLabel`, `reverseLabel`, each flagged when it's the AI's suggestion, which a later one may replace, #83): every card has `CardProgress` in each direction (`direction`, unique per user, card and direction), and Study Sessions and attempts record theirs; Reverse asks for the front, accepting its `ReverseVariant`s, which a Card Version records when it ends (`CardVersion.reverseVariants`). A card made from a lesson has `Card.sourceLessonId` (the Lesson, not the version; `SetNull`), plus the `sourceModel` and `sourcePromptVersion` that proposed it; a card generated for a deck (#75) has the model and prompt version but no Source Lesson. A card has no single "back" field: its answers are `CanonicalAnswer` rows, and attempts record a `RecallGrade`. Cascade deletes on all parent relationships. `CardProgress.lifecycleChangedAt` is when the card last entered its lifecycle state, none for progress from before it was recorded (#7), and `markedKnownAt` when the learner last marked it known (#46, ADR-0009); a reset clears both. Card edits reset progress but keep attempts (ADR-0004): only attempts made since `CardProgress.resetAt` count toward stats, via `services/countedAttempts.ts`. A card has Card Versions (ADR-0008, #47): a `CardVersion` holds what it asked, its front and Canonical Answers' texts, primary first, from `startedAt`, numbered from 1. The first comes with the card and a new one with each progress reset, at the same moment; a change of primary or of Accepted Variants makes none. The version an edit ends records the variants its answers ended with (`CardVersion.acceptedVariants`, #51); the current version's are the card's own, and versions that ended before this have none. A version started by revising the deck records the model and prompt version that proposed the edit (`CardVersion.sourceModel`, `sourcePromptVersion`, #45), and one restoring an earlier version that version's number (`CardVersion.restoredFromNumber`, #54). The latest is the current version (`currentVersionId` in `services/cards.ts`), and each `CardAttempt` records the one it answered (`cardVersionId`); attempts from before versions were recorded and before the card's last reset have none. Cards are created and edited through `services/cards.ts`, which keeps each card's Canonical Answers (exactly one primary), NEW card progress and Card Versions in step.

### Testing Patterns

- **API tests** use isolated per-suite Postgres schemas via `apps/api/src/test-helpers.ts`: each test suite gets its own schema, Prisma client and tRPC caller. Docker Postgres must be running.
- **Web tests** use Vitest + React Testing Library with mocked tRPC hooks
- **Seed data** is idempotent (`deleteMany` before re-seeding)
- **AI in tests**: pass `ai: createFakeAiProvider()` in the caller context; queue outputs with `respondWith`, streamed replies with `streamReply` (pieces, optionally refused, failing after them or held open until `holdUntil` settles), failures with `failWith('timeout' | 'connection-error' | 'api-error')`, and inspect `requests` (structured calls) and `chatRequests` (streamed ones). Stub `AI_ALLOWED_EMAILS` with `vi.stubEnv`
- **Test fixtures**: build decks with `createDeckWithCards` from `test-helpers.ts`, which creates cards the way the app does

## Planning Docs

All planning documents live in `docs/architecture/`, whose `README.md` says which doc is the source of truth for what. They hold the design and decisions. Work and its status are tracked in GitHub issues, so point to the issues instead of copying their status into these docs.

| Doc                               | Purpose                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `courses-plan.md`                 | **Courses plan**: AI courses, lessons, exercises, tutor and the AI platform on top of v2; spec #1                           |
| `updated-plan.md`                 | **Canonical v2 plan**: product philosophy, locked constraints (§28), grading, accepted variants, and what's parked (§29c)   |
| `learning-model-and-scheduler.md` | The scheduler in detail: lifecycle, interval tables, weakness, queues, study modes; it wins over `updated-plan.md` on these |
| `archive/`                        | Done or superseded, for history only: the MVP plan, the May infra notes, the v2 PR breakdown and the v2 schema proposal     |

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `bdav/study-hall`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
