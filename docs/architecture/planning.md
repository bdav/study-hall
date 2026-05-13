Flashcard App v2 — Infra & Tech Stack Handoff v0.1

Purpose

This document is a focused handoff for future planning agents working on:

- infrastructure
- deployment topology
- database strategy
- background jobs
- observability
- AI model hosting
- queue-generation implementation
- schema/query performance
- operational architecture

It intentionally omits most product philosophy detail except where it directly affects technical decisions.

The canonical scheduler/product specification should still be treated as authoritative.

⸻

1. Existing MVP Status

This is NOT a greenfield rewrite.

A working full-stack flashcard app already exists.

Current features:

- account creation/login
- deck creation
- CSV import
- typed-answer studying
- deterministic grading
- retry-until-success study flow (to be replaced)
- stats pages
- session-cookie auth
- isolated testing infrastructure

v2 is an architectural evolution.

⸻

2. Existing Tech Stack

Layer Technology
Frontend React 19 + TypeScript + Vite 8
Routing React Router 7
State/Data TanStack Query 5 + tRPC
Styling Tailwind CSS 4 + shadcn/ui
Backend Node.js + Express 5 + tRPC 11
Validation Zod 4
Database Prisma 7 + SQLite (Postgres-ready)
Auth Session-cookie auth with DB-backed sessions
Testing Vitest + RTL + Supertest
Monorepo pnpm workspaces

Repo structure:

flashcards/
apps/
api/
web/
prisma/

⸻

3. Existing Architectural Assets

Already implemented:

- server-authoritative grading
- transactional imports
- ownership enforcement
- append-only CardAttempt persistence
- isolated test DBs per suite
- Prisma abstraction layer
- CSV diff/import logic
- deterministic normalization pipeline

Important existing modules:

- answerGrader.ts
- CSV parser/diff utilities
- deck/card/study/stats routers

⸻

4. Canonical Product Constraints

These should be treated as stable architectural constraints.

Core Product Direction

The app is:

- retrieval-first
- typed recall focused
- psychologically calm
- finite-session based
- anti-review-hell
- bounded-AI

The app is NOT:

- an AI tutor
- a social platform
- an infinite review queue system
- a heavy adaptive-memory research project

⸻

Critical Scheduler Constraints

Scheduler architecture

Hybrid:

- table-driven intervals
- bounded modifiers only

Explicitly NOT:

- FSRS-style adaptive modeling
- probabilistic forgetting curves
- opaque hidden scoring

⸻

Lifecycle states

NEW
LEARNING
STABLE
RETIRED

⸻

Sessions

Sessions are:

- finite
- time-targeted
- energy-budgeted
- chainable

Example session types:

Type Target
Quick ~5m
Standard ~10m
Deep ~20m

⸻

Queue generation philosophy

Queue generation is:

energy budgeting

not:

due-count fulfillment

Due backlog must NEVER monopolize sessions.

⸻

Retry semantics

Only MISSED cards receive same-session reappearances.

Rules:

- reinsert after ~5 cards
- cap at 2 reappearances
- failures never block session completion

⸻

New-card philosophy

New cards:

- sequential by import order
- never automatically reduced to 0 during backlog
- lightly interleaved into sessions

⸻

Study modes

Modes:

- Study
- Drill Weakest
- Cram All

All reuse the same scheduler primitives.

No separate scheduler architectures.

⸻

5. Scheduler Data Model Concepts

CardAttempt

Append-only immutable event log.

Stores things like:

- timestamp
- user answer
- recall grade
- grading method
- grading confidence
- session id
- latency

⸻

CardProgress

Mutable operational scheduler state.

Stores:

- lifecycleState
- masteryScore
- dueAt
- lastReviewedAt
- lastIntervalDays
- lapseCount

CardProgress is authoritative for live queue generation.

Conceptually rebuildable from attempts.

⸻

Freshness

Freshness is:

- derived
- not persisted
- separate from mastery

Derived from:

- dueAt
- lastReviewedAt
- lastIntervalDays

⸻

Weakness

Weak STABLE cards are defined by:

- low mastery
  OR
- recent misses

Weakness is intentionally separate from overdue status.

⸻

6. Important Operational Consequences

These product decisions have major infra/query implications.

Queue generation is dynamic

Queues are NOT precomputed giant review lists.

The backend must dynamically assemble bounded sessions from buckets like:

- Due LEARNING
- Due STABLE
- Weak STABLE
- New cards
- Same-session retries

This strongly affects:

- indexing strategy
- query design
- session orchestration

⸻

CardProgress is query-critical

Fast queue generation depends heavily on:

- dueAt indexes
- lifecycleState indexes
- user/card composite indexes
- weak-card querying

Likely heavy-query fields:

- userId
- dueAt
- lifecycleState
- masteryScore
- lastReviewedAt

⸻

Session-local retry state is ephemeral

Retry metadata should NOT be persisted into long-term learning state.

Likely candidates:

- in-memory session object
- Redis
- lightweight DB session blob

⸻

Time budgeting requires estimation

Queue generation likely needs:

- average answer duration estimates
- retry overhead estimates
- card complexity heuristics

May eventually require telemetry collection.

⸻

7. AI Grading Constraints

AI usage philosophy

AI grading must remain:

- bounded
- fallback-only
- operationally cheap

Target:

<1–5% hosted LLM adjudication

⸻

Grading pipeline

Intended pipeline:

1. deterministic exact/variant matching
2. local semantic similarity
3. hosted LLM fallback only for ambiguous cases

⸻

Open infra questions

Still unresolved:

- embeddings vs cross-encoder
- local vs hosted inference
- browser vs server inference
- model hosting strategy
- caching
- quota enforcement
- abuse prevention

⸻

8. Marketplace Constraints

Marketplace is:

- supporting utility
- not primary growth engine

Important simplification:

Forks are permanently independent.

No:

- live synchronization
- collaborative editing
- structural merging

Only upstream contribution type:

- accepted variant suggestions

This dramatically simplifies infra.

⸻

9. Likely Future Schema Areas

Expected new models/entities:

CardProgress
AcceptedVariant
CanonicalAnswer
ReverseDeckLink
MarketplaceDeck
DeckFork
ChangelogEvent
ContributionInbox

Likely existing model evolution:

Card
CardAttempt
StudySession
Deck

⸻

10. High-Value Technical Planning Areas

Future agents should focus on:

Schema redesign

Need:

- Prisma model redesign
- indexes
- query strategy
- migration plan

⸻

Queue-generation architecture

Need:

- candidate selection pipeline
- bucket weighting algorithm
- time-budget estimation
- retry insertion mechanics
- efficient due-card querying

⸻

Session orchestration

Need:

- session lifecycle
- ephemeral retry state
- optimistic UI strategy
- persistence boundaries

⸻

Infra topology

Need decisions for:

- deployment architecture
- hosting providers
- Postgres migration timing
- Redis need/scope
- background jobs
- cron/scheduled jobs
- observability stack
- notifications/reminders

⸻

AI grading infra

Need:

- model choice
- latency targets
- caching strategy
- cost modeling
- threshold tuning
- evaluation dataset strategy

⸻

11. Important Non-Goals for Technical Planning

Do NOT accidentally optimize for:

- infinite queue clearing
- ultra-complex adaptive scheduling
- heavy personalization systems
- collaborative Google-Docs-style editing
- AI tutoring infrastructure
- real-time multiplayer synchronization
- graph-style curriculum systems

Those are intentionally out of scope.

⸻

12. Recommended Next Deliverables

A future planning/coding agent should likely produce:

1. Prisma schema proposal
2. DB index strategy
3. Queue generation pseudocode
4. Session orchestration flow
5. API contract redesign
6. Redis/background-job justification
7. AI grading architecture proposal
8. Deployment topology recommendation
9. Observability/metrics plan
10. Migration strategy from current MVP

⸻

13. Guidance For Future Agents

Do not reopen settled scheduler philosophy unless identifying:

- concrete implementation contradictions
- scaling impossibilities
- operational dead ends

The current scheduler/lifecycle model is intentionally:

- understandable
- bounded
- psychologically calm
- operationally simpler than Anki/FSRS-style systems

Future work should preserve those properties.
