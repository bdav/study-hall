# Flashcard App v2 — Implementation Plan

## Overview

This document defines the v2 milestone breakdown — a sequence of PRs that implements v2
incrementally. Each PR is a focused, reviewable vertical slice. Backend PRs land before
corresponding frontend PRs. All PRs follow the TDD workflow described in CLAUDE.md.

**Prerequisites:**

- MVP is complete (PRs 1–19 delivered)
- Canonical v2 plan finalized (`updated-plan.md`)
- v2 Prisma schema finalized (`v2-schema-proposal.md`)
- All blocking open questions resolved (`updated-plan.md` §29)

**Key decisions already made:**

- Reset all data — fresh Postgres migration, no MVP data preservation
- Docker Compose Postgres for local dev + tests
- Per-suite isolated Postgres schemas for API tests
- Phase 1 schema: CardProgress, StudySessionItem, CanonicalAnswer, AcceptedVariant,
  expanded CardAttempt/StudySession/Card
- Marketplace, reverse decks, and AI grading infra models are deferred

---

## PR Sequence

### PR 1: Postgres Infrastructure + v2 Schema

**Scope:** Switch from SQLite to Postgres, apply the full Phase 1 v2 schema, and create
baseline seed data.

- Add `docker-compose.yml` with Postgres service
- Switch Prisma datasource from `sqlite` to `postgresql`
- Delete all MVP migrations — fresh migration history
- Apply full v2 schema: new enums (`RecallGrade`, `CardLifecycleState`,
  `StudySessionStatus`, `StudySessionItemStatus`, `SessionType`, `StudyMode`,
  `GradingMethod`), new models (`CardProgress`, `StudySessionItem`, `CanonicalAnswer`,
  `AcceptedVariant`), modified models (`Card` — remove `back`, add `position`;
  `StudySession` — add status/type/mode; `CardAttempt` — RecallGrade + grading metadata)
- Update `.env` and connection strings
- Basic seed script: demo user, sample decks, cards with `CanonicalAnswer` rows,
  eagerly-created `CardProgress` rows (all `NEW`, mastery 0)
- Update `prisma.config.ts`, `db.ts` — remove better-sqlite3 adapter, use standard Postgres
- Verify `pnpm dev` starts against Docker Postgres

**Tests:** Schema applies cleanly, seed runs without error.

**Why first:** Everything depends on Postgres + v2 schema. No intermediate
SQLite-on-new-schema state.

---

### PR 2: Test Infrastructure for Postgres

**Scope:** Migrate the per-suite isolated test database pattern from SQLite to Postgres
schemas.

- Update `apps/api/src/test-helpers.ts`: each test suite creates a unique Postgres schema,
  runs migrations into it, points Prisma at it, drops schema on teardown
- Ensure Docker Postgres is available for test runs (same container as dev, or
  test-specific compose profile)
- Update all existing API test suites to use new helpers
- Verify all existing tests pass (adapted for schema changes — e.g., `Card.back` →
  `CanonicalAnswer`, `AttemptResult` → `RecallGrade`)

**Tests:** All existing API tests green on Postgres.

**Why second:** Tests must work before TDD on new features can begin.

---

### PR 3: Canonical Answers + Accepted Variants — Backend

**Scope:** CRUD for the new answer model, grading pipeline update, and card mutation updates.

- `card.create` / `card.update`: create/update `CanonicalAnswer` rows instead of `back`
  field. `card.create` requires at least one canonical answer. `isPrimary` logic.
- `card.importCards`: parse `||` delimiter for multi-answer cards, create `CanonicalAnswer`
  rows, assign `position` based on import order
- `card.listByDeck`: include canonical answers + accepted variants in response
- New procedures: `card.addVariant`, `card.removeVariant`
- Update `answerGrader.ts`: check user answer against all canonical answers + accepted
  variants (normalized). Return which answer matched and grading method.
- `card.delete`: cascade already handled by schema

**Tests:** TDD for multi-answer grading, variant matching, import with `||`, position
assignment, CRUD operations.

**Why here:** Study flow, session orchestration, and stats all depend on the new answer
model and grading pipeline.

---

### PR 4: ProgressUpdater Service — Backend

**Scope:** Core scheduler state machine — lifecycle transitions, mastery updates, interval
computation.

- New service: `apps/api/src/services/progressUpdater.ts`
- Mastery update rules (§5.3): grade-based delta with clamping 0–10
- Lifecycle transitions:
  - NEW → LEARNING (first finalized attempt)
  - LEARNING → STABLE (2+ successes across 2+ sessions/days, latest successful)
  - STABLE → LEARNING (2 MISSED in last 3 finalized)
  - STABLE → RETIRED (eligibility check — system suggests, not auto)
  - RETIRED → STABLE (explicit user action only)
- Interval tables: LEARNING table (§8.3) + STABLE band table (§8.4)
- Lateness bonus (§8.5): overdueRatio >= 1.5, cap 1.25x, GOOD/NAILED only
- Lapse counting
- `dueAt` computation
- All updates return the new `CardProgress` state for atomic persistence

**Tests:** TDD for every transition edge case, mastery clamping, interval lookup per
band/grade combo, lateness bonus boundaries. These are pure-logic unit tests — no DB
needed for most.

**Why here:** QueueGenerator and SessionOrchestrator both consume ProgressUpdater output.

**Note:** PRs 3 and 4 can be developed in parallel — both depend only on PR 2 with no
interdependency.

---

### PR 5: QueueGenerator Service — Backend

**Scope:** Session queue assembly from CardProgress data.

- New service: `apps/api/src/services/queueGenerator.ts`
- Candidate retrieval: query CardProgress for due LEARNING, due STABLE, weak STABLE,
  NEW cards
- Weak card derivation (§10): `masteryScore <= 3 || recentMissCount >= 2` (derived from
  recent CardAttempts)
- Bucket weighting + caps (§13.3): target shares and max caps per bucket
- Session size bounds from SessionType (§12.1): Quick 5–12, Standard 10–25, Deep 20–50
- Study mode composition:
  - **Study** — default bucket weights
  - **Drill Weakest** — 60–80% weak, no new cards
  - **Cram** — accelerated pacing, 30–50% new cards
- Interleaving: NEW cards distributed throughout, not front-loaded
- Seeded randomization: deterministic ordering from seed parameter
- Returns ordered list of `cardId`s for session creation

**Tests:** Golden tests with seeded queues. Test bucket composition for each mode. Test
cap enforcement. Test empty/sparse deck edge cases. Test NEW card interleaving.

**Why here:** SessionOrchestrator uses QueueGenerator to build sessions.

---

### PR 6: Session Orchestration — Backend

**Scope:** Full session lifecycle — tRPC procedures wired to domain services.

- New service: `apps/api/src/services/sessionOrchestrator.ts`
- **Start session:** check for resumable ACTIVE session → if none, call QueueGenerator,
  create `StudySession` + `StudySessionItem` rows, return first card
- **Resume session:** 24h window based on `updatedAt`. Stale → mark ABANDONED, offer
  new session
- **Get current card:** return next PENDING `StudySessionItem` with card + canonical answers
- **Submit answer:** grade answer (via updated answerGrader), create `CardAttempt`, update
  `CardProgress` (via ProgressUpdater), update `StudySessionItem` to COMPLETED — all in
  one transaction. If MISSED, insert retry `StudySessionItem` (ephemeral retry state
  tracks count + spacing)
- **"I don't know":** finalized MISSED attempt, same flow as submit
- **Complete session:** mark remaining PENDING items as SKIPPED, set status COMPLETED,
  set `endedAt`
- **Abandon session:** mark ABANDONED, set `endedAt`
- Same-session retry: ephemeral `Map<cardId, retryState>`, cap at 2 reappearances,
  ~5 intervening cards
- New/updated tRPC procedures on study router replacing MVP study flow

**Tests:** Integration tests for full session lifecycle. Resume/abandon edge cases. Retry
cap enforcement. Atomic transaction verification. Concurrent session prevention.

**Why here:** This is the central orchestration layer that ties scheduler services together
and exposes them via tRPC.

---

### PR 7: Study Flow — Frontend

**Scope:** Complete rewrite of the study UI for the v2 session model.

- **Session picker:** when no active session, show Quick / Standard / Deep selector +
  Study / Drill Weakest / Cram mode
- **Study UI:** display card front → user types answer → submit → show grade + correct
  answer(s) → next card. "I don't know" button. No more retry-until-success loop.
- **Grade display:** show RecallGrade result with appropriate styling
  (MISSED / PARTIALLY_CORRECT / GOOD / NAILED)
- **Session progress:** indicator showing position within session (e.g., "Card 7 of 20")
- **Session completion:** summary screen with option to start another session
  ("Continue studying")
- **Resume flow:** if active session exists, show "Resume session?" prompt
- **Accepted variant affordance:** when graded MISSED, offer "My answer was correct" →
  add as accepted variant, re-grade

**Tests:** Component tests for session picker, study card, grade display, session
completion. Mock tRPC hooks.

**Why here:** Core user-facing feature. Backend is complete; this makes it usable.

---

### PR 8: Card Management Updates — Frontend

**Scope:** Update card management UI for canonical answers + variants.

- **Card creation form:** replace single `back` field with canonical answer input. Support
  adding multiple canonical answers (one marked primary). Support `||` delimiter in
  single input.
- **Card editing:** edit canonical answers, manage accepted variants per answer
- **Accepted variant UI:** list variants per canonical answer, add/remove
- **Import preview:** update to show parsed canonical answers (from `||` delimiter),
  position assignment
- **Card list view:** display primary canonical answer, indicate multi-answer cards

**Tests:** Component tests for new form inputs, variant management, import preview updates.

**Why here:** Content management needs to reflect the new answer model. Non-blocking for
study flow, but needed for full content lifecycle. Can begin as soon as PR 3 lands,
independent of PRs 4–6.

---

### PR 9: Stats Rewrite — Backend

**Scope:** Rebuild stats queries against the v2 data model.

- `stats.deckStats`: mastery distribution (histogram by band), lifecycle state breakdown,
  accuracy by RecallGrade, per-card average mastery, weak card list, cards studied / not
  yet studied counts
- `stats.overallStats`: aggregate mastery across decks, total cards by lifecycle state,
  overall grade distribution, weakest cards across all decks, study streak / session history
- Deprecate/remove MVP stats logic that relied on `CORRECT`/`INCORRECT` enum

**Tests:** TDD with varied CardProgress + CardAttempt data. Test empty deck, single card,
full deck scenarios.

---

### PR 10: Stats Rewrite — Frontend

**Scope:** Updated stats pages using v2 data.

- **Deck stats page:** mastery distribution visualization, lifecycle state breakdown,
  accuracy breakdown by grade, weak cards list
- **Overall stats page:** cross-deck aggregates, lifecycle overview, weakest cards
- Adapt loading skeletons and empty states for new data shapes

**Tests:** Component tests with mocked stats data.

---

### PR 11: Seed Data, Polish, and Cleanup

**Scope:** Rich demo data and UX polish pass.

- **Seed data:** multiple decks with varied content, CardProgress in varied lifecycle
  states (NEW/LEARNING/STABLE/RETIRED), varied mastery scores, sample completed +
  abandoned sessions, realistic CardAttempt history with mixed grades
- **Polish:** loading states for new session flow, error boundaries for session errors,
  toast notifications for session events, smooth transitions between session states
- **Cleanup:** remove any dead MVP code paths (old study flow, old stats logic, SQLite
  references), update CLAUDE.md for v2 current state

**Tests:** Seed script runs cleanly, produces expected data shape.

---

## Dependency Graph

```
PR 1: Postgres + v2 Schema
  └── PR 2: Test Infrastructure
        ├── PR 3: Canonical Answers — Backend ──────── PR 8: Card Management — Frontend
        │     │
        └── PR 4: ProgressUpdater Service ─┐
              │                             │
              PR 5: QueueGenerator ─────────┘
              │
              PR 6: Session Orchestration ── PR 7: Study Flow — Frontend
              │
              PR 9: Stats — Backend ──────── PR 10: Stats — Frontend
                                                      │
                                              PR 11: Seed + Polish + Cleanup
```

PRs 3 and 4 can be developed in parallel. PR 8 can begin once PR 3 lands, independent
of PRs 4–6.

---

## Summary Table

| PR  | Title                                  | Layer      | Depends On |
| --- | -------------------------------------- | ---------- | ---------- |
| 1   | Postgres Infrastructure + v2 Schema    | Infra      | —          |
| 2   | Test Infrastructure for Postgres       | Infra      | 1          |
| 3   | Canonical Answers + Variants — Backend | Backend    | 2          |
| 4   | ProgressUpdater Service                | Backend    | 2          |
| 5   | QueueGenerator Service                 | Backend    | 4          |
| 6   | Session Orchestration — Backend        | Backend    | 3, 4, 5    |
| 7   | Study Flow — Frontend                  | Frontend   | 6          |
| 8   | Card Management Updates — Frontend     | Frontend   | 3          |
| 9   | Stats Rewrite — Backend                | Backend    | 6          |
| 10  | Stats Rewrite — Frontend               | Frontend   | 9          |
| 11  | Seed Data, Polish, Cleanup             | Full-stack | 7, 8, 10   |

---

## Deferred (Future Phases)

These are explicitly out of scope for this PR sequence:

- **Reverse decks** — ReverseDeckLink model + UI
- **Marketplace** — publish/fork/contribute (MarketplaceDeck, DeckFork, ChangelogEvent,
  ContributionInbox)
- **AI grading** — embeddings tier, LLM fallback, AIGradingCache, AIUsageLog
- **Deployment** — Vercel + Railway setup
- **Cram target date** — cram mode queue weighting is in PR 5, but date-driven pacing
  config is deferred
- **Retirement flow UI** — system suggests → user confirms
- **Observability** — structured logging, analytics events
- **Signup / access control** — open signup vs invite-only vs allowlist
