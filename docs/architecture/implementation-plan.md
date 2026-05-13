# Flashcard App — Implementation Plan (TDD-Oriented)

## Project Summary

Build a modern full-stack flashcard study web app where users can:

- create an account
- upload a CSV of flashcards
- browse decks and cards
- study a deck
- record study results
- view simple performance stats
- later evolve toward spaced repetition

This project is optimized for:

- practicing full-stack product engineering
- using a modern 2026-relevant stack
- making the project an exercise in test-driven development
- keeping initial scope small enough to finish
- leaving room for future portfolio expansion

---

## Chosen Stack

### Frontend

- React
- TypeScript
- Vite
- React Router
- Tailwind CSS
- shadcn/ui
- TanStack Query

### Backend

- Node.js
- TypeScript
- tRPC
- Prisma

### Database

- SQLite (local dev, via better-sqlite3 adapter)
- PostgreSQL (future production target)

### Repo / Package Management

- pnpm workspaces

---

## Why This Stack

- **Vite + React + TypeScript** gives a fast, modern SPA workflow.
- **React Router** is the standard routing choice for a Vite React app.
- **TanStack Query** handles server state, caching, loading states, and mutations.
- **tRPC** gives end-to-end type safety without GraphQL ceremony.
- **Prisma + SQLite** gives zero-config local dev; Postgres remains the production target.
- **pnpm workspaces** keeps frontend and backend in one repo with clean boundaries.

We are explicitly **not** using:

- GraphQL
- Relay
- Redux
- Next.js
- multiple repos

The goal is a clean, practical full-stack architecture, not maximum framework complexity.

---

## Repo Strategy

Use a single pnpm monorepo.

### Proposed Structure

```text
flashcards/
  apps/
    web/
    api/
  prisma/
  tests/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md
  .gitignore
```

### Directory Roles

#### `apps/web`

- Vite React SPA
- routes
- pages
- components
- API client wiring
- query client wiring

#### `apps/api`

- Node server
- tRPC routers
- auth/session logic
- business logic
- CSV import logic

#### `prisma`

- schema
- migrations
- seed script

#### `tests`

- integration-style tests
- cross-layer tests
- shared test helpers if needed

We intentionally avoid premature packages like:

```text
packages/ui
packages/types
packages/config
apps/worker
```

Those can be added later if real reuse appears.

---

## Architecture Overview

```text
React SPA (apps/web)
  -> tRPC client + TanStack Query
  -> Node API (apps/api)
  -> Prisma
  -> PostgreSQL
```

### Responsibilities

#### Frontend

Owns:

- routing
- page layout
- auth screens
- deck browsing UI
- import UI
- study UI
- stats UI
- calling typed tRPC procedures

#### Backend

Owns:

- auth and session logic
- input validation
- CSV parsing and validation
- deck/card CRUD
- study session writes
- stats queries
- all DB access

#### Database

Owns:

- schema
- migrations
- relational integrity

---

## Product Scope

### MVP Features

User can:

- sign up
- log in
- create decks
- upload a CSV of cards
- browse decks
- open a deck
- study cards one at a time
- type an answer and submit it
- see whether the answer was correct (via normalized string matching)
- view the correct answer after submitting
- view simple performance stats

### Explicitly Out of Scope for MVP

Do **not** build these in the first version:

- advanced spaced repetition algorithm
- collaboration
- deck sharing
- public deck marketplace
- AI card generation
- offline mode
- mobile app
- heavy analytics
- notifications

---

## Routing Plan

Use React Router.

### Initial Routes

```text
/                       Deck list (home page)
/login                  Login
/signup                 Signup
/decks/:deckId          Study view for a deck (default deck view)
/decks/:deckId/stats    Stats view for a deck
/import                 Import flow
/stats                  Overall stats
```

### Route Structure Guidance

- the deck list _is_ the home page — no separate dashboard
- selecting a deck takes you to the study view by default
- study and stats are sibling routes under a deck, toggled via navigation (not UI state) so the browser back button works naturally
- a persistent top nav bar with Home and Stats links is always visible
- public auth routes live outside the main authenticated shell
- app routes live inside a shared authenticated layout
- keep route count small in MVP

---

## Data Model

Start simple.

### User

```text
id
email
passwordHash
createdAt
updatedAt
```

### Deck

```text
id
userId
name
description nullable
createdAt
updatedAt
```

### Card

```text
id
deckId
front
back
createdAt
updatedAt
```

### StudySession

```text
id
userId
deckId
startedAt
endedAt nullable
```

### CardAttempt

```text
id
studySessionId
cardId
userAnswer
result
attemptNumber
createdAt
```

Multiple CardAttempts per card per session are allowed. When the study flow re-queues
an incorrect card, each retry creates a new CardAttempt with an incrementing
`attemptNumber`. This enables tracking how many attempts it takes to master each card.

### Relationships

- User has many Decks
- Deck has many Cards
- User has many StudySessions
- Deck has many StudySessions
- StudySession has many CardAttempts (multiple per card allowed)
- Card has many CardAttempts

### Future Model, Not MVP

Later, if spaced repetition becomes real, add something like:

```text
CardProgress
```

That could track:

- ease
- streak
- dueAt
- miss count
- last reviewed time

Do not add this now.

---

## CSV Format

### Accepted MVP Format

```csv
front,back
Capital of France,Paris
2 + 2,4
```

### CSV Rules

- require a header row
- require exactly `front` and `back`
- ignore blank rows
- trim whitespace
- reject rows missing either field
- return clear validation errors

### Later Nice-to-Haves

- ~~import preview before commit~~ → PR 19
- alternate headers
- multiline support
- duplicate detection
- optional tags column

---

## API Design

Use tRPC routers organized by domain.

### Routers

```text
authRouter
deckRouter
cardRouter
studyRouter
statsRouter
```

### Example Procedures

#### `authRouter`

```text
signup
login
logout
me
```

#### `deckRouter`

```text
list
getById
create
update
delete
```

#### `cardRouter`

```text
listByDeck
create
update
delete
importCsv
```

#### `studyRouter`

```text
startSession
submitAttempt
finishSession
getSession
```

#### `statsRouter`

```text
deckStats
overallStats
```

### API Principles

- validate all inputs with Zod
- keep procedures narrow and explicit
- require auth where appropriate
- enforce ownership checks server-side
- keep DB access on the server only
- prefer server-derived stats over duplicated client computation

---

## Frontend State Strategy

### Use TanStack Query For

- current user bootstrap
- deck list fetching
- deck detail fetching
- CSV import mutation
- study session start / finish
- card attempt submission
- stats fetching

### Use Local Component State For

- current card index
- reveal/hide answer state
- form inputs
- local UI toggles
- transient errors

### Avoid

- Redux
- custom global stores
- mirroring server state in local state unnecessarily

---

## Authentication Plan

Use simple email/password auth with cookie sessions.

### Flow

1. user signs up with email + password
2. backend hashes password
3. backend creates session
4. session stored in HTTP-only cookie
5. frontend calls `auth.me` to bootstrap current user

### Auth Rules

- protect all deck/study/stats routes
- users only access their own decks and study data
- never trust user IDs from the frontend
- all authorization checks happen on the server

---

## UI Plan

Use Tailwind + shadcn/ui.

### Navigation

#### Top Nav Bar (always visible)

- Home link (deck list)
- Overall Stats link

#### Deck-Level Navigation

- when viewing a deck, toggle between Study and Stats views
- toggle uses route navigation (`/decks/:deckId` ↔ `/decks/:deckId/stats`) so browser back button works

### Initial Pages

#### Deck List Page (`/` — home)

- list of decks with high-level stats per deck (accuracy, cards needing work, last studied)
- stats guide the user toward their weakest deck
- create deck action
- import action

#### Deck Study View (`/decks/:deckId`)

- show one card at a time (front/question only)
- text input for typing an answer
- submit answer (button or Enter)
- show result (correct/incorrect) with the correct answer displayed
- next card button
- simple progress indicator
- toggle to switch to deck stats view

#### Deck Stats View (`/decks/:deckId/stats`)

- per-deck stats: total attempts, first-try accuracy, overall accuracy
- per-card breakdown with attempts-to-correct
- highlight weak cards needing more practice
- toggle to switch back to study view

#### Import Page (`/import`)

- create or choose deck
- upload CSV
- validation messages
- import success/failure state

#### Overall Stats Page (`/stats`)

- aggregate stats across all decks
- per-deck summary table
- weak cards across all decks

### UI Priorities

- clean and simple
- obvious empty states
- obvious loading states
- obvious error states
- good usability over visual flourish

Do not overdesign the visual system in MVP.

---

## Folder Structure Details

### `apps/web`

```text
apps/web/
  src/
    app/
    components/
    features/
      auth/
      decks/
      import/
      study/
      stats/
    hooks/
    lib/
    pages/
    routes/
    main.tsx
    App.tsx
```

### Suggested `apps/web` Conventions

- `features/` holds domain-specific UI + hooks
- `components/` holds reusable generic UI
- `lib/` holds helpers, query client, API client, utils
- `pages/` holds route-level components
- `routes/` holds router config

### `apps/api`

```text
apps/api/
  src/
    server.ts
    app.ts
    routers/
      index.ts
      auth.ts
      deck.ts
      card.ts
      study.ts
      stats.ts
    middleware/
    services/
    auth/
    lib/
```

### Suggested `apps/api` Conventions

- `routers/` for tRPC route definitions
- `services/` for reusable business logic
- `auth/` for password/session code
- `middleware/` for auth guards and request context
- `lib/` for general helpers

### `prisma`

```text
prisma/
  schema.prisma
  migrations/
  seed.ts
```

### `tests`

```text
tests/
  integration/
  e2e/
  helpers/
```

Keep this lightweight. Do not over-architect the test folders.

---

## TDD Strategy

This project should be implemented as an exercise in test-driven development.

### TDD Loop

```text
1. Write a failing test
2. Implement the smallest amount of code to pass
3. Refactor while keeping tests green
```

### TDD Philosophy for This Project

- write tests before implementation whenever practical
- focus first on business logic and boundaries
- do not let TDD become ceremony for trivial presentational code
- prioritize tests around behavior, not implementation details
- keep the red-green-refactor cycle tight

### Where TDD Is Most Valuable Here

TDD is especially valuable for:

- CSV parsing
- auth helpers
- permission/ownership rules
- study session logic
- stats calculations
- API procedure behavior
- critical route protection

### Where TDD Can Be Lighter

Be more pragmatic for:

- static presentational components
- simple wrappers
- trivial layout code
- shadcn/Tailwind composition with no real logic

---

## Testing Stack

Recommended tools:

- Vitest
- React Testing Library
- Supertest or HTTP-level API tests
- Prisma test database
- optionally Playwright later for a few critical end-to-end flows

### Test Types

#### Unit Tests

Test pure logic:

- CSV parsing and validation
- password helper behavior
- stats calculations
- study progression logic
- mapper/helper functions

#### API / Integration Tests

Test backend behavior:

- signup
- login
- protected procedure access
- deck creation
- CSV import
- study session flow
- stats retrieval
- ownership enforcement

#### Frontend Component / Flow Tests

Test UI behavior where it matters:

- login form submission
- protected route redirect
- import flow states
- study card reveal and answer marking

#### E2E Tests

Add a small number later for core user journeys:

- sign up
- create deck
- import CSV
- study a deck
- view stats

Do not begin with lots of E2E tests.

---

## TDD Test Priorities by Layer

### First Priority: Pure Domain Logic

Start with test-first development for the logic that is easiest to isolate and highest value:

1. CSV parser
2. answer grading / normalization
3. auth/password helpers
4. study result calculation
5. stats aggregation

### Second Priority: Backend Procedure Behavior

Then add tests for:

1. signup/login behavior
2. session enforcement
3. deck CRUD with ownership
4. CSV import into a deck
5. study session persistence

### Third Priority: Frontend User Flows

Then add tests for:

1. login redirect behavior
2. import page states
3. study interaction flow
4. stats page success/error/empty states

---

## Suggested TDD Conventions

### Naming

Use behavior-oriented test names, for example:

```text
returns validation errors when csv headers are incorrect
rejects deck access when the deck belongs to another user
marks session complete when finishSession is called
shows answer after reveal button is clicked
```

### Style

- one behavior per test when practical
- keep tests short and intention-revealing
- avoid asserting on incidental implementation details
- prefer black-box assertions over internal state peeking

### Test Data

Create small factories/builders for:

- user
- deck
- card
- study session

Keep them simple and explicit.

---

## Implementation Order — PR Breakdown

Build vertical slices in TDD fashion. Each PR should be a focused, reviewable unit.
Backend PRs land before their corresponding frontend PRs so the UI can build on real APIs.

Auth is deferred. The first pass builds a single-user app with no login — just decks, cards,
study, and stats working end-to-end. Auth wraps around it later.

The schema includes a User model from the start (to avoid a painful migration later), but
procedures don’t require authentication until the auth PRs land. A seed user is created on
first migration and used implicitly by all procedures.

---

### PR 1: Monorepo Skeleton

**Scope:** Repo infrastructure only — no app code yet.

- initialize git repo
- configure pnpm workspace
- root `package.json` with workspace scripts
- root `tsconfig.base.json`
- `.gitignore`
- `README.md` skeleton

**Definition of Done:**

- `pnpm install` works
- repo structure matches the plan

---

### PR 2: API App Scaffold

**Scope:** Minimal `apps/api` that starts and has a passing test.

- create `apps/api` with TypeScript + Vitest
- add a basic Express or standalone HTTP server entry point
- scaffold tRPC with a health check procedure
- add one passing test (health check returns OK)

**Definition of Done:**

- `pnpm dev:api` starts the server
- `pnpm --filter api test` passes

---

### PR 3: Web App Scaffold

**Scope:** Minimal `apps/web` that starts and has a passing test.

- create `apps/web` with Vite + React + TypeScript
- install Tailwind CSS and shadcn/ui
- install React Router, TanStack Query
- add Vitest + React Testing Library
- wire tRPC client to API
- add one passing test (app renders)

**Definition of Done:**

- `pnpm dev:web` starts the dev server
- `pnpm --filter web test` passes

---

### PR 4: Database + Prisma Setup

**Scope:** Prisma schema with all models, connected to SQLite (local dev). Seed data for pre-auth development
including a sample deck with cards so the study flow can be built immediately.

- add Prisma with `prisma.config.ts`
- define full schema (User, Deck, Card, StudySession, CardAttempt)
- run first migration
- add seed script that creates a default dev user, a sample deck, and sample cards
- wire Prisma client into API context
- add integration test proving DB connection works

**Definition of Done:**

- migration succeeds against local SQLite
- `pnpm db:seed` creates the dev user, a deck, and cards
- integration test passes

---

### PR 5: Study Flow — Backend

**Scope:** Study session and card attempt procedures on the API side. Uses the seed deck.
Also includes a minimal deck `getById` procedure so the study page can fetch deck + cards.

**TDD Sequence — write tests first for:**

1. fetching a deck by ID returns the deck with its cards
2. starting a session creates a StudySession record
3. submitting a correct answer (normalized match) stores CORRECT result
4. submitting an incorrect answer stores INCORRECT result
5. answer grading normalizes whitespace, case, and punctuation before comparing
6. finishing a session sets `endedAt`
7. `getSession` returns session with attempts

**Tasks:**

- implement `deckRouter.getById` (just this one procedure — full CRUD comes later)
- implement `studyRouter` with startSession/submitAttempt/finishSession/getSession
- implement answer grading service (`services/answerGrader.ts`) with normalized string matching (lowercase, trim, strip punctuation) — this is the deterministic Tier 1 from the future AI grading pipeline
- `submitAttempt` accepts `userAnswer` string, grades it server-side, and stores both the answer and the result
- hardcode the seed user ID in the tRPC context for now

**Definition of Done:**

- all study API tests pass
- attempts and sessions are persisted correctly
- can fetch a deck with its cards

---

### PR 6: Study Flow — Frontend

**Scope:** Study page UI for studying cards in a deck. Minimal navigation to reach it.

**Tasks:**

- create a simple home page that links to the seed deck
- create study page at `/decks/:deckId/study`
- show one card at a time (front/question only)
- text input for typing an answer
- submit via button or Enter key
- after submit, show correct/incorrect result with the correct answer
- next card button to advance
- progress indicator (e.g., "3 of 12")
- session complete state with summary

**Tests:**

- card front is shown initially, answer input is visible, correct answer is hidden
- submitting an answer shows the result and the correct answer
- next button advances to the next card

**Definition of Done:**

- user can study through all cards in the seed deck
- attempts are recorded
- session completes when all cards are done

**This is the naive MVP checkpoint.** At this point the core study loop works:
open app -> study seed deck -> record results.

---

### PR 7: Multi-Attempt Support + Stats — Backend

**Scope:** Allow multiple attempts per card per session (supporting the re-queue behavior),
add `attemptNumber` tracking, and build stats aggregation queries.

**TDD Sequence — write tests first for:**

1. `submitAttempt` allows multiple attempts for the same card in a session
2. `submitAttempt` assigns incrementing `attemptNumber` per card per session
3. `getSession` returns all attempts including retries
4. deck stats returns total attempts, first-try accuracy, and overall accuracy
5. deck stats returns per-card attempts-to-correct (number of attempts before first correct)
6. overall stats aggregates across all decks
7. stats handle zero-attempt case gracefully

**Tasks:**

- add `attemptNumber` field to CardAttempt in Prisma schema, run migration
- remove the duplicate-attempt rejection in `submitAttempt` — allow re-attempts for re-queued cards
- auto-assign `attemptNumber` based on existing attempts for that card in the session
- implement `statsRouter` with deckStats/overallStats procedures
- `deckStats` returns: total attempts, unique cards studied, first-try accuracy, overall accuracy, and per-card attempts-to-correct
- `overallStats` returns: aggregate totals across all decks, plus list of weak cards (highest avg attempts-to-correct)

**Definition of Done:**

- multiple attempts per card per session are persisted correctly
- all stats tests pass
- stats accurately reflect multi-attempt data

---

### PR 8: Stats — Frontend

**Scope:** Stats page UI leveraging multi-attempt data.

**Tasks:**

- create stats page at `/stats`
- show overall stats (total attempts, first-try accuracy, overall accuracy)
- show per-deck summary table with attempts-to-correct metrics
- highlight weak cards (cards that consistently require multiple attempts)
- empty state when no study sessions exist
- add nav links between home, study, and stats

**Tests:**

- stats page renders data correctly
- empty state renders when no data

**Definition of Done:**

- user can view their study performance including attempts-per-card insights
- stats page handles empty and populated states

---

### PR 9: Deck CRUD + Deck Stats Endpoint — Backend

**Scope:** Full deck creation, listing, update, and delete on the API side. Also add a
`deckRouter.list` variant that returns summary stats per deck for the home page.

**TDD Sequence — write tests first for:**

1. creating a deck
2. listing all decks (with summary stats: accuracy, cards needing work, last studied)
3. updating a deck
4. deleting a deck

**Tasks:**

- expand `deckRouter` with list/create/update/delete procedures
  (getById already exists from PR 5)
- `list` returns decks with lightweight summary stats (total attempts, accuracy, last studied timestamp)
  so the deck list page can guide users toward their weakest deck

**Definition of Done:**

- all deck CRUD tests pass
- deck list includes per-deck summary stats

---

### PR 10a: Deck List + Route Restructure + Deck Stats — Frontend

**Scope:** Replace the dashboard with a deck list home page. Restructure routes so studying
a deck and viewing deck stats are sibling routes under `/decks/:deckId`. Add create deck form.

**Tasks:**

- replace the dashboard page with a deck list at `/` showing decks with summary stats
  (accuracy, card count, last studied) to guide the user toward their weakest deck
- move study page route from `/decks/:deckId/study` to `/decks/:deckId`
- create deck stats page at `/decks/:deckId/stats` using existing `statsRouter.deckStats`
- add create deck form
- wire TanStack Query to deck procedures

**Tests:**

- deck list renders decks with summary stats
- empty state shows when no decks exist
- deck stats page renders per-deck stats
- create deck form calls mutation

**Definition of Done:**

- deck list is the home page with per-deck stats guiding deck selection
- user can create a deck and see it in the list
- clicking a deck goes to study view at `/decks/:deckId`
- user can view deck stats at `/decks/:deckId/stats`

---

### PR 10b: Persistent Nav Bar — Frontend

**Scope:** Add a persistent top nav bar visible on all pages. Add study/stats toggle
within deck views. Replace the current floating home button in Layout.

**Tasks:**

- add persistent top nav bar (Home + Stats links) visible on all pages
- add study/stats toggle within the deck view (uses route navigation, not UI state)
- replace the existing Layout floating home button with the nav bar

**Tests:**

- top nav links are present and functional
- study/stats toggle navigates between routes

**Definition of Done:**

- top nav with Home and Stats is always visible
- user can toggle between study and stats views for a deck
- browser back button works between study and stats views

---

### PR 11: CSV Import — Backend

**Scope:** CSV parser + import procedure on the API side.

**TDD Sequence — write tests first for:**

1. valid CSV with `front,back` headers parses successfully
2. CSV with wrong headers is rejected
3. rows missing `front` or `back` are rejected
4. blank rows are ignored
5. whitespace is trimmed
6. parsed rows are persisted as cards on a deck

**Tasks:**

- implement CSV parser as a pure function
- implement `cardRouter.importCsv` procedure
- implement `cardRouter.listByDeck` procedure

**Definition of Done:**

- CSV parser unit tests pass
- import procedure integration tests pass
- cards are persisted and retrievable by deck

---

### PR 12a: Single Card Creation — Backend

**Scope:** Add a `card.create` procedure for adding one card at a time.

**TDD Sequence — write tests first for:**

1. creating a card with front and back on a deck
2. created card is persisted and returned
3. rejects creation on a deck owned by another user
4. rejects creation on a nonexistent deck
5. rejects empty front or back

**Tasks:**

- add `card.create` mutation to `cardRouter` (input: deckId, front, back)
- ownership validation (deck must belong to current user)
- input validation (front and back must be non-empty strings)

**Definition of Done:**

- all card.create tests pass
- card is persisted and retrievable via listByDeck

---

### PR 12b: Deck Cards View — Frontend

**Scope:** New "Cards" tab within the deck view for managing cards. Replaces the
standalone `/import` page concept. Cards are managed in context of their deck.

**Tasks:**

- add route `/decks/:deckId/cards` with new `DeckCardsPage`
- add "Cards" tab to `DeckTabs` (Study | Cards | Stats)
- add-card form at top of page (front + back inputs, Add button) wired to `card.create`
- CSV upload section (file input + upload button) wired to `card.importCsv`
- validation error display for both single-card and CSV flows
- table of all cards below (front/back columns) using `card.listByDeck`
- update StudyPage empty state: replace plain text with link to Cards tab

**Tests:**

- add-card form creates a card and refreshes the list
- CSV upload imports cards and refreshes the list
- card table renders existing cards
- empty state renders when deck has no cards
- StudyPage empty state links to Cards tab
- validation errors display for bad input

**Definition of Done:**

- user can add cards one at a time from the Cards tab
- user can upload a CSV from the Cards tab
- all cards are visible in a table
- empty deck study view directs user to the Cards tab

---

### PR 13: Auth — Backend

**Scope:** Signup, login, logout, session management on the API side.

**TDD Sequence — write tests first for:**

1. password hashing helper (hash + verify)
2. signup creates a user and returns a session
3. login succeeds with correct credentials
4. login rejects invalid credentials
5. `me` procedure returns user when session is valid
6. protected procedure rejects requests without a session

**Tasks:**

- implement password hashing helpers (bcrypt or argon2)
- implement session cookie handling
- add `authRouter` with signup/login/logout/me procedures
- add auth middleware for protected procedures
- update all existing routers to use authenticated user from session instead of hardcoded seed user
- add ownership checks to deck, card, study, and stats procedures
- add ownership validation to `submitAttempt` (verify session belongs to user, card belongs to session's deck)
- add ownership validation to `getSession` (verify session belongs to user)

**Definition of Done:**

- all auth tests pass
- session cookie is set on signup/login
- protected procedures reject unauthenticated requests
- existing procedure tests still pass with auth wired in
- ownership is enforced (user A cannot access user B’s decks)

---

### PR 14: Auth — Frontend

**Scope:** Login and signup pages, protected route logic, auth state bootstrap.

**Tasks:**

- create login page
- create signup page
- add `auth.me` query to bootstrap current user on load
- add protected route wrapper (redirects to `/login` if unauthenticated)
- add authenticated layout shell with logout

**Tests:**

- login form submits credentials
- protected route redirects when unauthenticated

**Definition of Done:**

- user can sign up and log in through the UI
- refresh preserves session
- unauthenticated users are redirected to login

---

### PR 15: Card Update & Delete — Backend

**Scope:** Add `card.update` and `card.delete` procedures to the card router.

**TDD Sequence — write tests first for:**

1. updating a card's front and back text
2. partial update (only front or only back)
3. rejects update on a card belonging to another user's deck
4. rejects update on a nonexistent card
5. rejects empty front or back when provided
6. deleting a card
7. rejects deletion of a card belonging to another user's deck
8. rejects deletion of a nonexistent card
9. deleted card is no longer returned by listByDeck

**Tasks:**

- add `card.update` mutation to `cardRouter` (input: cardId, optional front, optional back)
- add `card.delete` mutation to `cardRouter` (input: cardId)
- ownership validation (card's deck must belong to current user)
- input validation (front and back must be non-empty when provided)

**Definition of Done:**

- all card.update and card.delete tests pass
- ownership is enforced for both procedures

---

### PR 16: Card & Deck Management — Frontend

**Scope:** Add edit/delete UI for cards and decks. Cards are managed from the
existing Cards tab; deck edit/delete is accessible from the deck view.

**Tasks:**

- add inline edit and delete actions to the card table on DeckCardsPage
- card edit: click to edit front/back in-place, save calls `card.update`, cancel restores original
- card delete: delete button with confirmation, calls `card.delete`
- add deck edit (rename/description) UI accessible from the deck view
- add deck delete with confirmation, calls `deck.delete`, redirects to home
- wire TanStack Query invalidation for all mutations

**Tests:**

- card edit saves changes and refreshes the list
- card delete removes the card and refreshes the list
- deck edit updates the deck name
- deck delete removes the deck and redirects to home
- confirmation is required before deleting a deck

**Definition of Done:**

- user can edit and delete individual cards from the Cards tab
- user can rename and delete a deck
- all mutations invalidate relevant queries

---

### PR 17: Polish — Loading, Empty, and Error States

**Scope:** Improve UX across all pages. Address known performance concerns.

**Tasks:**

- add loading skeletons/spinners to all data-fetching pages
- review and improve empty states (no decks, no cards, no sessions)
- add error boundaries or error messages for failed queries
- add toast notifications for mutations (create deck, import, etc.)
- optimize `deck.list` accuracy computation — currently loads all attempts in JS; replace with
  a raw aggregation query or denormalized counters as session/attempt counts grow

**Definition of Done:**

- every page handles loading, empty, and error states
- mutations give user feedback on success/failure

---

### PR 18: Seed Data and Documentation

**Scope:** Make the app easy to set up and demo.

**Tasks:**

- expand seed script with multiple decks, richer card data, and sample study sessions
- finalize README with setup instructions, env vars, scripts, CSV format
- verify fresh `git clone` -> setup -> working app flow

**Definition of Done:**

- `pnpm db:seed` populates full demo data
- README is complete and accurate
- a new developer can set up the project from the README alone

---

### PR 19: Import Preview

**Scope:** Frontend-driven CSV preview with a simplified backend mutation. CSV parsing,
validation, deduplication, and diff logic all move to the frontend — which already has
the deck's cards via `card.listByDeck`. The backend receives pre-categorized structured
data instead of raw CSV.

#### Backend Changes

Replace `card.importCsv` (accepts CSV string) with `card.importCards`:

```text
input: {
  deckId: string,
  new: { front: string, back: string }[],
  update: { cardId: string, back: string }[]
}
returns: { createdCount: number, updatedCount: number }
```

The backend just validates deck ownership, validates each updated card belongs to the
deck, runs `createMany` for new cards and individual updates for changed cards.

**TDD Sequence — write tests first for:**

1. `importCards` creates new cards on the deck
2. `importCards` updates existing cards' back text
3. `importCards` handles mixed new + update in one call
4. `importCards` rejects when deck not found / not owned
5. `importCards` rejects update for a card not belonging to the deck
6. `importCards` rejects empty front or back in new cards
7. `importCards` rejects empty back in update cards
8. `importCards` returns correct createdCount and updatedCount
9. existing `importCsv` tests are migrated to `importCards`

#### Frontend Changes

- install shadcn Dialog component (`npx shadcn@latest add dialog`)
- add client-side CSV parser utility (`lib/csvParser.ts`):
  - validates `front,back` header
  - trims whitespace, skips blank rows
  - returns valid rows and error rows (missing front/back) separately
  - dedupes within CSV (last occurrence wins, case-insensitive on front)
- add client-side diff utility (`lib/csvDiff.ts`):
  - compares parsed CSV rows against existing cards from `listByDeck` query cache
  - categorizes into: **new** (no front match), **update** (front match, different back),
    **duplicate** (exact front+back match), **error** (from parser)
- create `ImportPreviewDialog` component using shadcn Dialog + Table:
  - sticky header with title "Import Preview"
  - **"New cards" section**: columns Front (editable Input), Back (editable Input), Remove (Trash2 icon).
    Row count in section heading. Local state copy of rows for editing/removal.
  - **"Updating" section** (conditional): columns Front (read-only), Old Back (read-only, muted),
    New Back (editable Input), Remove. Shows which existing cards will have their back updated.
  - **"Skipped" section** (conditional, only if non-empty): columns Front, Back, Reason.
    Read-only, styled muted/dimmer. Covers exact duplicates and error rows.
  - sticky footer with "Cancel" (secondary) and "Import" (primary) buttons
  - scrollable content pane between sticky header and footer
  - Import button disabled when no new/update rows remain or when import is pending
- update `DeckCardsPage` CSV import flow:
  - after file select, parse CSV client-side and diff against cached cards
  - open `ImportPreviewDialog` with categorized results (no network call)
  - on dialog confirm, send `{ new, update }` to `card.importCards`
  - on dialog cancel, close dialog and reset state

**Tests (frontend):**

- CSV parser: valid CSV, wrong headers, missing fields, blank rows, whitespace trimming, deduplication
- CSV diff: new cards, updates, exact duplicates, error rows
- file upload opens preview dialog (no network call for preview)
- preview dialog shows new, updating, and skipped sections
- user can edit and remove rows in the preview
- Import button calls `importCards` with structured `{ new, update }` payload
- Cancel closes dialog without importing

**Definition of Done:**

- `card.importCsv` is replaced by `card.importCards`
- CSV parsing and diff logic lives on the frontend
- user can preview CSV contents before importing with instant feedback (no round-trip)
- can edit front/back values and remove rows in the preview
- new cards are created and changed-back cards are updated in one call
- exact duplicates and error rows are shown separately with reasons
- all backend and frontend tests pass

---

## Suggested Root Scripts

Example root `package.json` scripts:

```json
{
  "scripts": {
    "dev:web": "pnpm --filter web dev",
    "dev:api": "pnpm --filter api dev",
    "dev": "concurrently \"pnpm dev:api\" \"pnpm dev:web\"",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "test:watch": "pnpm -r test:watch",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:seed": "tsx prisma/seed.ts"
  }
}
```

Example `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
```

---

## Error Handling Expectations

### CSV Import

- invalid headers -> clear user message
- blank fields -> row-level or summarized validation error
- malformed file -> general import error
- wrong deck ownership -> authorization error

### Auth

- invalid credentials -> generic error message
- expired session -> redirect to login
- unauthorized API access -> standard auth error response

### Study Flow

- empty deck -> empty state
- empty answer submission -> validation error (require non-empty input)
- submit failure -> clear retry path
- re-queued card submission -> creates new CardAttempt with incremented attemptNumber
- duplicate finish -> handle safely if possible

---

## README Expectations

The README should eventually include:

- project purpose
- stack
- repo structure
- local setup
- environment variables
- how to run web/api
- how to run tests
- how to run Prisma migrations
- CSV format example
- deployment notes

---

## Engineering Principles

1. Optimize for finishability.
2. Prefer conventional patterns over clever abstractions.
3. Keep frontend/backend boundaries clear.
4. Use strong typing without type gymnastics.
5. Validate at boundaries.
6. Build vertical slices end-to-end.
7. Use TDD where it adds the most value.
8. Keep tests behavior-focused.
9. Keep ownership and auth checks server-side.

---

## Decisions Summary

### We are choosing

- one repo
- pnpm workspaces
- Vite + React + TypeScript
- React Router
- TanStack Query
- Node + tRPC
- Prisma + Postgres
- Tailwind + shadcn/ui
- TDD-oriented implementation

### We are not choosing

- two repos
- GraphQL
- Relay
- Next.js
- Redux
- premature shared packages
- excessive E2E coverage at the start

---

## Guidance for Claude Code

Implement this project with the following priorities:

1. Keep the codebase simple and readable.
2. Build vertical slices so usable features appear early.
3. Use test-driven development for business logic and API behavior.
4. Write failing tests before implementation whenever practical.
5. Prefer minimal implementations that satisfy the current test.
6. Refactor only after tests are green.
7. Do not prematurely create shared packages or abstractions.
8. Keep auth and ownership checks on the server.
9. Favor maintainability and finishability over theoretical ideal architecture.
10. Be pragmatic: not every presentational component needs heavy test coverage.

When in doubt, choose the simpler implementation that preserves clean boundaries, strong typing, and a fast feedback loop.

## Future Enhancement: AI-Assisted Answer Evaluation

### Problem

The MVP flashcard system evaluates answers using deterministic normalized string matching
(lowercase, trim whitespace, strip punctuation). This is implemented in `services/answerGrader.ts`
as the Tier 1 baseline. It works well for factual recall cards but fails when correct answers
are phrased differently than the canonical answer.

Examples:

Canonical: "Paris"  
User: "The capital of France is Paris"

Canonical: "Mitochondria produce ATP"  
User: "Mitochondria make ATP"

Exact string matching is too brittle for natural language answers.

---

## Goals

1. Accept semantically correct answers even if phrased differently.
2. Keep inference costs extremely low.
3. Avoid reliance on external APIs where possible.
4. Maintain fast evaluation latency.
5. Preserve deterministic behavior whenever possible.

---

## Architecture

Answer grading will use a three-tier pipeline:

1. Deterministic validation
2. Local embedding similarity
3. Local LLM fallback for ambiguous cases

Pipeline:

User Answer
↓
Deterministic Match
↓
Embedding Similarity
↓
LLM Adjudication (rare)

---

## Tier 1: Deterministic Validation

Performed for every answer.

Techniques include:

- lowercase normalization
- punctuation stripping
- whitespace normalization
- alias matching

Example:

canonical: "paris"

normalize("Paris.") → "paris"

Cards may store accepted aliases:

acceptedAliases = [
"capital of france",
"paris france"
]

If deterministic validation succeeds, the answer is accepted immediately.

---

## Tier 2: Local Embedding Similarity

For answers that fail deterministic validation, semantic similarity is computed.

Recommended embedding model:

sentence-transformers/all-MiniLM-L6-v2

Characteristics:

- small (~90MB)
- fast CPU inference
- excellent semantic similarity performance

Procedure:

1. Compute embedding for the user answer.
2. Compare against embeddings for canonical answer variants.
3. Use cosine similarity.

similarity = max cosine similarity across all variants.

Thresholds:

similarity ≥ 0.85 → correct  
similarity ≤ 0.60 → incorrect  
0.60 < similarity < 0.85 → escalate to Tier 3

---

## Canonical Answer Variants

To improve embedding reliability, each card may store multiple acceptable answer variants.

Example:

canonicalVariants = [
"Mitochondria produce ATP",
"Mitochondria make ATP",
"ATP is produced by mitochondria",
"The mitochondria generate ATP"
]

When grading, the maximum similarity against all variants is used.

Variants may originate from:

- automated generation during card creation
- manually added aliases
- user feedback when correct answers are rejected

This technique significantly improves grading accuracy without requiring an LLM.

---

## Tier 3: Local LLM Adjudication

Used only when similarity falls in a borderline range.

Recommended models:

- Qwen 2.5 (≈3B)
- Gemma 3 (1B–4B)

Run locally using Ollama or llama.cpp.

Example prompt:

Question:
What is the capital of France?

Correct answer:
Paris

User answer:
The capital is Paris.

Is the user answer correct, partially correct, or incorrect?

Respond with JSON:

{ "grade": "correct | partial | incorrect" }

Expected usage rate: <5% of answers.

---

## Service Design

A grading service will be added to the API layer.

Location:

apps/api/src/services/answerGrader.ts

Responsibilities:

- answer normalization
- alias matching
- embedding similarity scoring
- optional LLM adjudication

Example interface:

gradeAnswer({
question,
canonicalVariants,
userAnswer
}) → {
result: "correct" | "incorrect" | "partial",
confidence: number
}

---

## Data Model Additions

Cards may include:

canonicalAnswer
canonicalVariants[]
acceptedAliases[]
embeddingVectors[]

Embeddings for canonical answers may be precomputed when cards are created.

---

## Implementation Phases

Phase 1 — Deterministic Improvements  
Phase 2 — Embedding Similarity  
Phase 3 — LLM Fallback

---

## Cost Profile

Typical evaluation cost:

Deterministic checks → negligible  
Embedding similarity → ~1–5 ms  
LLM fallback → ~200–800 ms

Because the LLM is used rarely, the overall system remains fast and inexpensive.

---

## Future Extensions

Possible enhancements:

- adaptive similarity thresholds per deck
- answer variant expansion from user feedback
- logging and analysis of borderline cases
- optional fine-tuned grading models
