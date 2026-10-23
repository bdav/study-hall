# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Study Hall, a learning app (flashcards with spaced repetition today; AI-assisted courses planned) — pnpm monorepo with a React frontend (`apps/web`) and Express/tRPC backend (`apps/api`), using Prisma with PostgreSQL (Docker Compose for local dev). The project follows a TDD-oriented development approach.

**Status:** MVP complete and running on the v2 schema (#2). The rest of v2 is tracked as GitHub issues #3–#13 and courses (spec #1) as #14–#27. See **Implementation Order** below for what's next, and `docs/architecture/updated-plan.md` for the canonical consolidated plan.

## Implementation Order

When picking the next ticket, work the first open issue in this list whose blockers are all closed. The order gets one course usable end to end early, then finishes the tutor and the rest of v2.

1. Core study loop: #13, #5, #6
2. Usable course: #14, #29, #15, #30, #28, #18, #20, #21, #22
3. Learn → Review loop: #25, #26, #27, #7
4. Syllabus editing and tutor: #16, #23, #31, #24
5. Rest of v2 and courses: #3, #4, #12, #10, #11, #8, #9, #17, #19

New tickets join this list when they're created, unless labelled `needs-triage`.

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
- **Study**: Study Sessions (#5): a Standard queue of up to 25 due and NEW cards built at start, one graded answer per card (typed or "I don't know"), the card's progress updated by the scheduler after every answer, finish at the last card or early (remaining cards skipped), and a "nothing is due" state
- **Stats**: Per-deck stats (first-try accuracy, overall accuracy, per-card avg attempts-to-correct), overall stats (aggregates + weak cards), empty/loading/error states
- **Courses** (#14): Courses and Flashcards are peer top-level areas, with Courses as the landing page. The course form generates a Syllabus Proposal (Sonnet-class model); accepting it creates the Lessons and the Course Deck, listed in Flashcards with its course label. An unaccepted proposal can be discarded, which deletes the course (no learning history exists yet). Course creation is gated by `canUseAI`
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
| `/ai-usage`            | AiUsagePage (the learner's AI usage and estimated cost)          | Protected |
| `/flashcards`          | DeckListPage                                                     | Protected |
| `/decks/:deckId`       | StudyPage                                                        | Protected |
| `/decks/:deckId/cards` | DeckCardsPage                                                    | Protected |
| `/decks/:deckId/stats` | DeckStatsPage                                                    | Protected |
| `/stats`               | StatsPage (overall)                                              | Protected |

### tRPC API

All procedures except `auth.*` and `healthCheck` require authentication via `protectedProcedure`. AI-backed procedures use `aiProcedure`, which also requires `canUseAI` and refuses with `TOO_MANY_REQUESTS` once the month's AI spend reaches the cap, before any model call. `aiAccessProcedure` is the `canUseAI` check alone, for AI information that stays readable while AI is paused. All data procedures enforce ownership (user can only access their own decks/cards/sessions).

| Router    | Procedure                                                         | Type     |
| --------- | ----------------------------------------------------------------- | -------- |
| `aiUsage` | `summary` (`aiAccessProcedure`), `report`                         | query    |
| `auth`    | `signup`, `login`, `logout`                                       | mutation |
| `auth`    | `me`                                                              | query    |
| `deck`    | `create`, `update`, `delete`                                      | mutation |
| `deck`    | `getById`, `list`                                                 | query    |
| `card`    | `create`, `update`, `delete`, `importCards`                       | mutation |
| `card`    | `listByDeck`                                                      | query    |
| `course`  | `create` (AI, `aiProcedure`), `acceptProposal`, `discardProposal` | mutation |
| `course`  | `list`, `getById`                                                 | query    |
| `study`   | `startSession`, `submitAnswer`, `dontKnow`, `finishSession`       | mutation |
| `stats`   | `deckStats`, `overallStats`                                       | query    |

### Key Services

- **`answerGrader.ts`**: Tier 1 deterministic grading. `matchAnswer` is the one comparison for any correct answer: case, punctuation and extra whitespace never matter but the spaces between words do, and an answer wrong only in its accents is an Accent Mismatch, which `gradeAnswer` grades GOOD, never NAILED (ADR-0002). Designed for future extension with embedding similarity (Tier 2) and local LLM adjudication (Tier 3). See `implementation-plan.md` "Future Enhancement" section.

- **`progressUpdater.ts`**: The scheduler's pure update of a card's progress after one answer: NEW → LEARNING, mastery change by Recall Grade (0–10), and the next due date from the LEARNING interval table.
- **`studySessions.ts`**: Study Session lifecycle: builds the queue, applies each answer in one transaction (attempt, item, progress) and finishes sessions.

- **AI platform (`ai/`)**: every model call goes through the `AiProvider` on the tRPC context (`ctx.ai`): Anthropic in production, `createFakeAiProvider()` in tests, so no test makes a network call. `generateStructured` runs one call, writes its `AiUsage` record, validates the output with a Zod schema and returns it with the model and prompt version to store; a failed call or invalid output is a retryable `BAD_GATEWAY` error. A call that ends without a response (the provider throws `AiOutcomeUnknownError` on a timeout or dropped connection) may still be billed, so it is recorded as `failed`, with a generous token estimate when the provider has no counts; an API error response is not billed and not recorded. The Anthropic client has SDK retries off (`maxRetries: 0`), so each call is one attempt and one record. `spend.ts` estimates each call's cost from a per-model price table (unknown models get the highest rate) and defines the AI month (UTC); the spending cap (`aiSpendStatus`) and the usage report (`usageReport.ts`) both price and group calls with it.

### Data Model

The v2 schema (`prisma/schema.prisma`, designed in `v2-schema-proposal.md`) has these models: `User`, `Session` (login sessions), `Deck`, `Card`, `CanonicalAnswer`, `AcceptedVariant`, `CardProgress`, `StudySession`, `StudySessionItem` and `CardAttempt`, plus `Course`, `SyllabusProposal`, `Lesson` and `AiUsage` for courses. A Course Deck is a `Deck` with `courseId` set; it survives its course (`SetNull`). A card has no single "back" field: its answers are `CanonicalAnswer` rows, and attempts record a `RecallGrade`. Cascade deletes on all parent relationships. Card edits reset progress but keep attempts (ADR-0004): only attempts made since `CardProgress.resetAt` count toward stats, via `services/countedAttempts.ts`. Cards are created and edited through `services/cards.ts`, which keeps each card's primary Canonical Answer and NEW card progress in step.

### Testing Patterns

- **API tests** use isolated per-suite Postgres schemas via `apps/api/src/test-helpers.ts`: each test suite gets its own schema, Prisma client and tRPC caller. Docker Postgres must be running.
- **Web tests** use Vitest + React Testing Library with mocked tRPC hooks
- **Seed data** is idempotent (`deleteMany` before re-seeding)
- **AI in tests**: pass `ai: createFakeAiProvider()` in the caller context; queue outputs with `respondWith`, failures with `failWith('timeout' | 'connection-error' | 'api-error')`, and inspect `requests`. Stub `AI_ALLOWED_EMAILS` with `vi.stubEnv`
- **Test fixtures**: build decks with `createDeckWithCards` from `test-helpers.ts`, which creates cards the way the app does

## Planning Docs

All planning documents live in `docs/architecture/`. They hold the design and decisions. Work and its status are tracked in GitHub issues, so point to the issues instead of copying their status into these docs.

| Doc                               | Purpose                                                                                                           |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `updated-plan.md`                 | **Canonical v2 plan** — consolidated handoff with locked constraints, open questions, and implementation order    |
| `learning-model-and-scheduler.md` | Scheduler philosophy, lifecycle model, interval tables, session/queue design                                      |
| `planning.md`                     | Infra & tech stack decisions, deployment topology, data model concepts                                            |
| `v2-implementation-plan.md`       | **v2 design by milestone** (PRs 1–11); work is tracked as issues #2–#12, mapped at the top of the doc             |
| `v2-schema-proposal.md`           | Finalized Phase 1 Prisma schema for v2                                                                            |
| `courses-plan.md`                 | **Courses plan** — AI courses, lessons, exercises and tutor on top of v2; slices A–C, tracked as #14–#27; spec #1 |
| `implementation-plan.md`          | Original MVP plan (PRs 1–19, all delivered) — historical reference                                                |

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
