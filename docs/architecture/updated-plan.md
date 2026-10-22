Here’s the synthesized single-doc version to use as the new canonical handoff.

# Flashcard App v2 — Consolidated Implementation Handoff v0.2

## Purpose

This document is the consolidated planning handoff for implementing Flashcard App v2.
It merges:

- existing MVP context
- scheduler/product philosophy
- infrastructure decisions
- AI grading decisions
- session orchestration decisions
- remaining unresolved implementation questions
  The goal is to give a future coding agent enough context to implement the next major chunks without reopening settled product philosophy.

---

# 1. Project Status

This is **not a greenfield rewrite**.
A working full-stack flashcard app already exists.
Current features:

- account creation/login
- deck creation
- CSV import
- typed-answer studying
- deterministic grading
- retry-until-success study flow
- stats pages
- session-cookie auth
- isolated testing infrastructure
  v2 is an architectural evolution.
  The existing retry-until-success flow should be replaced by the new finite-session scheduler model.

---

# 2. Existing Tech Stack

| Layer      | Technology                                  |
| ---------- | ------------------------------------------- |
| Frontend   | React 19 + TypeScript + Vite 8              |
| Routing    | React Router 7                              |
| State/Data | TanStack Query 5 + tRPC                     |
| Styling    | Tailwind CSS 4 + shadcn/ui                  |
| Backend    | Node.js + Express 5 + tRPC 11               |
| Validation | Zod 4                                       |
| ORM        | Prisma 7                                    |
| Current DB | SQLite, Postgres-ready                      |
| Target DB  | Postgres                                    |
| Auth       | Session-cookie auth with DB-backed sessions |
| Testing    | Vitest + React Testing Library + Supertest  |
| Monorepo   | pnpm workspaces                             |

Repo structure:

```txt
flashcards/
  apps/
    api/
    web/
  prisma/

Existing useful modules/assets:

* answerGrader.ts
* CSV parser/diff utilities
* deck/card/study/stats routers
* server-authoritative grading
* transactional imports
* ownership enforcement
* append-only CardAttempt persistence
* isolated test DBs
* Prisma abstraction layer
* deterministic normalization pipeline

⸻

3. Core Product Philosophy

> **Superseded in part (2026-10-21):** The app is evolving into a general learning app with courses, AI-generated lessons and a contextual tutor, so "not an AI tutor" no longer holds. The flashcard and review principles below still apply to cards. See `courses-plan.md` and `docs/adr/0001-generative-ai-for-courses-not-flashcards.md`.

The app is:

* retrieval-first
* typed recall focused
* psychologically calm
* finite-session based
* anti-review-hell
* bounded-AI
* understandable and debuggable

The app is not:

* an AI tutor
* a social platform
* an infinite review queue system
* an Anki/FSRS clone
* a heavy adaptive-memory research project
* a collaborative editing platform

Core UX principles:

* momentum over guilt
* mastery over streaks
* finite sessions over endless queues
* calm returnability after breaks
* no “review debt repayment” framing

Prefer language like:

Welcome back — let’s do a focused session.

Avoid language like:

You are 1,200 reviews behind.

⸻

4. Deployment / Infra Decisions

4.1 Target Deployment Posture

v2 is a:

production-minded portfolio app

It is meant for:

* personal study
* sharing with friends
* demonstrating engineering judgment to future employers

It is not expected to scale aggressively.

Implications:

* use real hosted deployment patterns
* avoid AWS/Kubernetes complexity
* avoid overbuilding SaaS/admin infra
* keep infra credible, maintainable, and easy to cap for cost

⸻

4.2 Hosting

Use:

Frontend: Vercel
API: Railway
Database: Railway managed Postgres

Rationale:

* Vite frontend fits Vercel well
* Express/tRPC API should remain a persistent Node service, not be adapted to Vercel serverless functions
* Railway is lower-friction for Express + managed Postgres
* this gives a credible portfolio deployment without turning the project into a DevOps exercise

Do not migrate from Express to Next.js/serverless for v2.

Keep:

Express
tRPC
Node
React/Vite

Move:

SQLite → Postgres

⸻

4.3 Database Environments

Postgres is canonical for v2.

Use:

Local dev: Docker Compose Postgres
Production: Railway managed Postgres

SQLite may remain temporarily only for legacy migration/reference purposes.

⸻

4.4 Environment Structure

Initially support:

Local
Production

Design configuration so staging can be added later.

Requirements:

* no hardcoded domains
* clean env var separation
* Prisma migration discipline
* deployment config isolated from app logic

⸻

4.5 Redis

Do not add Redis for v2.

Use:

Postgres only
single Railway API process
in-memory ephemeral retry state

Rationale:

* no meaningful horizontal scale requirement
* fewer moving parts
* lower cost
* easier implementation
* easier to explain: Redis deferred until there is a real need

Important caveat:

* auth sessions must remain DB-backed, not in-memory

Redis may be considered later for:

* rate limiting
* distributed session retry state
* job queues
* caching

But it is explicitly deferred.

⸻

4.6 Background Jobs

Do not introduce a background job system for v2.

No:

* BullMQ
* Redis queues
* worker services
* distributed job orchestration

Use synchronous request/response flows for:

* grading
* queue generation
* session progression
* scheduler updates

Future background jobs may eventually support:

* reminders/notifications
* analytics rollups
* async AI adjudication
* marketplace moderation

…but these are out of scope for v2.

⸻

5. Core Learning Model

5.1 Recall Grades

Internal enum:

type RecallGrade =
  | "MISSED"
  | "PARTIALLY_CORRECT"
  | "GOOD"
  | "NAILED";

User-facing labels:

Internal	User Label
MISSED	Needs review
PARTIALLY_CORRECT	Partially correct
GOOD	Good
NAILED	Nailed it

Users may not directly assign arbitrary grades.

They may:

* submit typed answers
* click “I don’t know”
* add accepted variants
* refine canonical answers through allowed flows
* possibly manually adjust timing later

⸻

5.2 “I Don’t Know”

“I don’t know” creates a finalized MISSED attempt directly.

It should:

* reveal the answer
* persist a CardAttempt
* update CardProgress
* possibly trigger same-session retry
* not skip scheduler state

⸻

5.3 masteryScore

Use a simple:

0–10 integer mastery scale

Interpretation:

Score	Meaning
0–2	highly unstable
3–4	weak
5–6	developing
7–8	strong
9–10	highly stable / retirement candidate

masteryScore represents demonstrated historical confidence.

It does not represent:

* freshness
* rustiness
* overdue status
* current memory probability

Initial update rules:

MISSED:
  mastery >= 7 → -2
  else → -3
PARTIALLY_CORRECT:
  mastery >= 7 → -1
  else → -2
GOOD:
  mastery <= 3 → +2
  else → +1
NAILED:
  mastery <= 6 → +2
  else → +1

Clamp:

0 <= masteryScore <= 10

⸻

6. Lifecycle Model

Lifecycle states are explicit persisted scheduler state:

type CardLifecycleState =
  | "NEW"
  | "LEARNING"
  | "STABLE"
  | "RETIRED";

Lifecycle state is not purely derived from masteryScore.

masteryScore may inform transitions, but transitions are handled by explicit state-machine logic.

⸻

6.1 NEW

A card is NEW until first exposure.

NEW cards:

* have never been shown in study
* are introduced sequentially by import order
* leave NEW on first finalized attempt, even if missed

⸻

6.2 LEARNING

Early stabilization phase.

Characteristics:

* short intervals
* more frequent review
* may receive same-session retries if MISSED
* not eligible for retirement
* not eligible for long intervals

⸻

6.3 STABLE

Normal spaced repetition phase.

Characteristics:

* table-based intervals
* bounded lateness bonus
* active interval cap around 90 days
* eligible for retirement after sustained high performance

⸻

6.4 RETIRED

Removed from normal active circulation.

Retirement means:

likely mastered enough to leave active circulation

It does not mean:

hidden, suspended, noisy, or bad card

RETIRED cards:

* preserve mastery/history
* are excluded from normal study queues
* may be reviewed through optional retired-review mode
* can be restored only by explicit user action

⸻

7. Lifecycle Transition Rules

v1 uses simple explicit transition rules with configurable constants.

7.1 NEW → LEARNING

On first finalized attempt.

This happens even if first answer is MISSED.

⸻

7.2 LEARNING → STABLE

Requirements:

* at least 2 successful finalized attempts
* across at least 2 separate sessions or days
* latest result is successful

Successful means:

GOOD
NAILED

PARTIALLY_CORRECT does not count toward stabilization.

Same-session retries do not count toward stabilization requirements.

⸻

7.3 STABLE → LEARNING

A single miss does not demote a stable card.

On one miss:

* remain STABLE
* reduce masteryScore
* increment lapseCount
* schedule soon

A STABLE card moves back to LEARNING only after:

2 MISSED results within the last 3 finalized attempts

This keeps ordinary lapses from feeling punitive.

⸻

7.4 STABLE → RETIRED

Retirement is:

* system-suggested
* user-confirmed
* never automatic

Eligibility:

* lifecycleState = STABLE
* masteryScore >= 9
* latest result = NAILED
* lastIntervalDays >= 60

⸻

7.5 RETIRED → STABLE

Only through explicit user action.

Examples:

* manual unretire
* missed during retired-review mode, then user confirms “Unretire missed cards?”

Unretiring restores prior mastery/history.

It does not reset the card.

⸻

8. Scheduler Architecture

8.1 Scheduler Ownership

Scheduler logic should live in centralized domain services.

Recommended structure:

SchedulerService
QueueGenerator
ProgressUpdater
SessionOrchestrator

Responsibilities:

QueueGenerator

* candidate retrieval orchestration
* bucket weighting
* queue assembly
* interleaving
* deterministic seeded ordering

ProgressUpdater

* lifecycle transitions
* interval updates
* mastery updates
* dueAt calculations
* lapse handling

SessionOrchestrator

* session creation
* session progression
* retry insertion
* completion/abandonment

Routers should remain thin:

* validate input
* call services
* return DTOs

Do not distribute scheduler logic across tRPC routers.

⸻

8.2 Interval Computation Style

v1 interval computation uses:

table-driven base intervals
+
small bounded modifiers

Conceptual shape:

baseInterval = lookupInterval(
  lifecycleState,
  masteryScore,
  recallGrade
);
adjustedInterval = applyBoundedModifiers(baseInterval, {
  latenessBonus,
  cramPacingOverride,
});
dueAt = now + adjustedInterval;

The scheduler must not use:

* FSRS-style adaptive modeling
* probabilistic forgetting curves
* personalized learning-rate models
* hidden confidence metrics
* opaque magic multipliers

Allowed interval inputs:

* lifecycleState
* masteryScore
* recallGrade
* bounded lateness bonus
* cram pacing override, when in Cram mode

Not allowed:

* streaks
* fatigue modeling
* time of day
* hidden confidence
* deck-level intelligence
* personalized learning-rate modeling

⸻

8.3 LEARNING Interval Table

Recall Grade	Next Interval
MISSED	30m
PARTIALLY_CORRECT	1d
GOOD	1d
NAILED	2d

Rules:

* first-ever attempts cannot produce NAILED
* same-session retry is separate from persisted interval
* MISSED may reappear in-session
* PARTIALLY_CORRECT does not trigger aggressive retry

⸻

8.4 STABLE Interval Table

Use mastery bands, not exact 0–10 rows.

Band	Score
fragile	0–2
developing	3–5
solid	6–8
mastered	9–10

Baseline intervals:

Band	MISSED	PARTIAL	GOOD	NAILED
fragile	1h	1d	2d	4d
developing	6h	2d	5d	10d
solid	1d	5d	14d	30d
mastered	3d	10d	45d	90d

Active-card intervals should be capped around:

~90 days

Long-term dormant knowledge is handled through RETIRED state.

⸻

8.5 Lateness Bonus

Successful recall after substantial overdue delay may slightly increase the next interval.

Lateness:

* affects interval only
* does not directly affect masteryScore
* is small and bounded
* is not exposed directly to the user

Possible derivation:

overdueRatio =
  (now - dueAt) / lastIntervalDays;

Rules:

* no bonus until overdueRatio >= 1.5
* cap interval bonus around 1.25x
* apply only on GOOD or NAILED
* lateness alone never reduces mastery

⸻

9. Freshness Model

Freshness is:

* derived
* not persisted
* separate from masteryScore
* separate from weakness
* separate from lifecycleState

Freshness may influence:

* queue prioritization
* deck sorting
* visual presentation

Freshness must not:

* modify masteryScore
* define weakness
* create punishment states
* act as lifecycle state

Possible implementation:

overdueRatio =
  (now - dueAt) / lastIntervalDays;
freshness =
  clamp(1 - overdueRatio, 0, 1);

User-facing bands:

Band	Freshness
Fresh	>= 0.75
Warming	>= 0.40
Rusty	>= 0.15
Cold	< 0.15

Use soft language:

* Recently reviewed
* May be rusty
* Needs refreshing

Avoid harsh/guilt-inducing labels.

⸻

10. Weak Cards

Weakness is not persisted as standalone truth.

Do not store:

isWeak: boolean
weaknessScore: number

A STABLE card is weak if:

lifecycleState === "STABLE" &&
(masteryScore <= 3 || recentMissCount >= 2)

Where recentMissCount means:

MISSED results within last 5 finalized attempts

Implementation guidance:

* start by deriving recent misses from CardAttempt
* only add rolling cache fields if queries become awkward or slow
* if added, recentMissCount or recentGradeWindow is a performance cache, not canonical truth

Conceptual distinction:

Due STABLE = scheduling urgency
Weak STABLE = retrieval instability

A highly mastered but overdue card is not automatically weak.

Weak STABLE ranking:

1. recent lapse frequency
2. masteryScore ascending
3. overdue amount

⸻

11. Attempt History vs Operational Progress

11.1 CardAttempt

CardAttempt is the append-only historical record of meaningful submitted study interactions.

It records final meaningful submitted attempts, not transient grading internals.

Persist:

* initial submitted answers
* same-session retry answers
* “I don’t know” submissions
* finalized MISSED / PARTIAL / GOOD / NAILED outcomes
* final corrected outcome after accepted-variant refinement
* AI grading metadata attached to attempt

Do not persist:

* keystrokes
* draft edits
* unsubmitted refinements
* transient grading previews
* every semantic comparison
* every internal grading pass

If the system initially suggests MISSED but the user adds the response as an accepted variant, create one final CardAttempt with refinement metadata.

Example fields:

initialSuggestedGrade?: RecallGrade;
finalRecallGrade: RecallGrade;
refinementApplied: boolean;
gradingMethod:
  | "deterministic"
  | "semantic"
  | "llm"
  | "refined_variant";
gradingConfidence?: number;
semanticScore?: number;
modelUsed?: string;
promptVersion?: string;
gradingPipelineVersion: string;
latencyMs?: number;

⸻

11.2 CardProgress

CardProgress is mutable operational scheduler state.

It is authoritative for live queue generation, but conceptually rebuildable from CardAttempt.

Stores:

* lifecycleState
* masteryScore
* dueAt
* lastReviewedAt
* lastIntervalDays
* lapseCount

Likely useful fields:

userId
deckId
cardId
lifecycleState
masteryScore
dueAt
lastReviewedAt
lastIntervalDays
lapseCount
createdAt
updatedAt

Invariant:

Every user-visible card has exactly one CardProgress row.

CardProgress rows are created eagerly at card creation/import time.

Queue generation should never need to handle missing scheduler state.

⸻

11.3 Atomic Scheduler Updates

When an answer is finalized:

1. persist CardAttempt
2. update CardProgress
3. update StudySession / StudySessionItem progression state

These should occur in one transaction.

Do not defer CardProgress updates until session completion.

⸻

12. Session Model

Sessions are:

* finite
* bounded
* chainable
* time-targeted
* energy-budgeted

Users do not clear giant due queues.

Users may:

* complete a bounded session
* optionally continue with another session

⸻

12.1 Session Types

Type	Target Duration	Min Cards	Max Cards
Quick	~5m	5	12
Standard	~10m	10	25
Deep	~20m	20	50

Users choose:

* Quick
* Standard
* Deep

No arbitrary sliders/card counts in v1.

⸻

12.2 Session Scope

v2 sessions are scoped to:

exactly one deck at a time

Cross-deck scheduling is deferred.

Avoid hard assumptions that make future multi-deck sessions impossible.

⸻

12.3 Session Persistence

Use a hybrid persistence model.

When a session starts, persist:

StudySession
StudySessionItem / SessionCard

Persist the initial bounded ordered queue.

This supports:

* stable sessions
* resumability
* analytics
* less confusing UX

But same-session retry metadata remains ephemeral/runtime-only in v2.

⸻

12.4 Session Resume Semantics

Resume incomplete sessions only if recent.

Initial rule:

24-hour resume window

If user returns within 24 hours:

* resume persisted session queue

If older:

* mark session abandoned
* preserve analytics
* generate a new session

Do not mutate stale historical queues.

⸻

13. Queue Generation

Queue generation is:

energy budgeting

not:

due-count fulfillment

Due backlog affects candidate priority, not session size.

⸻

13.1 Queue Generation Location

Use a mixed approach.

Postgres handles:

* filtering
* bounded candidate retrieval
* simple ordering
* index-backed bucket queries

Node/application code handles:

* bucket weighting
* session size/time budgeting
* interleaving
* retry spacing
* final queue assembly
* mode-specific composition

Do not implement queue generation as one giant clever SQL query.

⸻

13.2 Determinism

Queue generation should be:

deterministic by default
seeded-randomized where useful

Production may use seeded randomization to avoid repetitive order.

Tests must be reproducible.

Possible API shape:

generateQueue({
  userId,
  deckId,
  mode,
  sessionType,
  seed,
});

⸻

13.3 Default Study Buckets

Default Study mode builds from:

1. Due LEARNING
2. Due STABLE
3. Weak STABLE
4. New cards
5. Same-session reappearances

Same-session reappearances are inserted dynamically.

Target shares:

Bucket	Target Share
Due LEARNING	20–30%
Due STABLE	40–60%
Weak STABLE	10–20%
New cards	10–20%

Caps:

Bucket	Cap
Due STABLE	~60%
Weak STABLE	~20%
New cards	~20%

Due LEARNING may exceed target because early stabilization is fragile.

Unused budget redistributes.

⸻

13.4 Due Backlog Handling

Large due backlogs are handled through bounded session slices.

If a user returns to many overdue cards, do not show:

1,200 cards due — clear them all

Instead:

* continue offering normal bounded sessions
* prioritize due cards gradually
* sample backlog into sessions
* drain over time
* never allow backlog to monopolize experience

No separate recovery mode in v1.

⸻

14. New Card Introduction

NEW cards are introduced:

sequentially by import order

Recommended field:

Card.importOrder: number
// or
Card.position: number

NEW cards should not be randomized in v1.

Import order is treated as intentional deck structure.

⸻

14.1 New-Card Pacing

Use:

persistent minimum trickle
+
light dynamic throttling

Behavior:

* normal conditions: NEW ≈ 10–20% of session
* heavy instability: NEW drifts toward ~5–10%
* Drill Weakest: NEW = 0%

NEW cards should slow down under pressure, but not automatically fall to 0 unless:

* user explicitly chooses no-new mode
* user enters Drill Weakest

Avoid the feeling:

You are not allowed to learn new things until you repay debt.

⸻

14.2 New-Card Placement

NEW cards should be lightly interleaved throughout sessions.

Avoid:

* front-loading
* large clusters

⸻

15. Same-Session Retry Rules

Only MISSED cards receive same-session retry treatment.

PARTIALLY_CORRECT, GOOD, and NAILED do not.

When a card is MISSED:

* persist finalized CardAttempt
* update CardProgress
* update session-local retry metadata
* reinsert after roughly 5 intervening cards
* allow small random spacing variation
* cap at 2 same-session reappearances

Maximum appearances:

1. initial appearance
2. retry #1
3. retry #2

After cap:

* remove from current session flow
* rely on persisted dueAt
* allow session to complete normally

Repeated failures never block session completion.

⸻

15.1 Retry State

Same-session retry insertion uses ephemeral runtime injection.

Recommended shape:

type SessionRetryState = {
  cardId: string;
  reappearancesThisSession: number;
  eligibleAfterSeenCount: number;
};

Retry state affects:

* current session flow
* short-term reinforcement

Retry state does not directly affect:

* dueAt
* masteryScore
* lifecycleState
* lastIntervalDays

Those are already updated by the finalized attempt.

Do not persist a durable retry queue.

⸻

16. Study Modes

All study modes reuse the same scheduler primitives.

No separate scheduler architectures.

⸻

16.1 Study Mode

Balanced long-term retention mode.

Optimizes for:

* sustainability
* bounded progress
* balanced retrieval maintenance
* novelty preservation

⸻

16.2 Drill Weakest

Drill Weakest changes queue weighting only.

It does not introduce:

* separate interval logic
* separate retry semantics
* separate lifecycle rules
* infinite remediation loops

Priorities:

1. Weak STABLE
2. Due LEARNING
3. Due STABLE
4. New cards disabled

Target mix:

Bucket	Target
Weak STABLE	60–80%
Due LEARNING	20–40%
Due STABLE	minimal overflow
New cards	0%

Drill Weakest is focused remediation, not punishment.

⸻

16.3 Cram All

Cram All preserves:

* lifecycle states
* retry rules
* interval tables
* mastery semantics
* bounded sessions

It adds:

* accelerated new-card pacing
* earlier review pressure
* denser exposure coverage

Core rule:

effectiveDueAt =
  min(normalSrDueAt, cramPacingDueAt);

Cram is:

* temporary
* deck-scoped
* target-date-driven

Attempts still update ordinary scheduler state.

Example shift:

Bucket	Study	Cram All
New cards	10–20%	30–50%
Due LEARNING	high	high
Due STABLE	moderate	moderate/lower
Weak STABLE	10–20%	lower unless due/learning

⸻

17. AI Grading Architecture

AI grading is:

bounded
fallback-only
server-side
provider-abstracted
non-tutoring

⸻

17.1 Grading Philosophy

Optimize for balanced grading:

strict enough to preserve retrieval integrity,
lenient enough to avoid demoralizing false negatives

Not:

* exhaustive textbook grading
* tutoring
* semantic over-analysis

⸻

17.2 Pipeline

Primary grading pipeline:

1. deterministic normalization/exact/variant matching
2. embeddings cosine similarity
3. hosted LLM fallback for ambiguous edge cases only

Hosted LLM target:

<1–5% of answers

⸻

17.3 Semantic Layer

Use embeddings + cosine similarity initially.

Cross-encoder semantic scoring may be a future upgrade.

Semantic scoring runs on:

API server

not browser.

Avoid browser model loading in v1.

⸻

17.4 LLM Provider

> **Superseded (2026-10-21):** The initial implementation uses Anthropic Claude for all AI work (grading fallback, generation, tutoring), still behind a provider-abstracted interface. See `courses-plan.md`.

Use provider-abstracted interface.

Initial implementation:

OpenAI

But code should not be hard-wired to OpenAI at domain level.

⸻

17.5 LLM Usage Threshold

Hosted LLM grading happens only for ambiguous semantic edge cases.

Not frequent grading.

Not direct fallback after deterministic in all cases.

If AI is uncertain:

* do not invent certainty
* return ambiguity/refinement
* or treat as ambiguous outcome per UX rules

⸻

17.6 Latency

v1 waits synchronously for final grade.

This is simpler and less confusing than provisional grading + later correction.

If AI fails:

* fall back to deterministic/semantic only
* do not block grading

⸻

17.7 Cost Controls

Use:

operational budget
+
graceful fallback
+
concrete per-user quotas

Need implementation detail later for:

* per-user limits
* tier caps if any
* monthly app-wide cap
* fallback behavior once cap is reached

⸻

17.8 Grading Metadata

Persist:

* grading method
* grading confidence
* semantic score
* model used
* prompt version
* model version
* grading pipeline version
* refinement metadata

Prompt/model versions should be versioned for audit/debugging.

⸻

17.9 Deterministic Normalization

> **Amended (2026-10-21):** An answer that differs from a correct answer only in accents is still accepted, but the accented form is always shown and on cards it grades GOOD, never NAILED. See `docs/adr/0002-accent-mismatches-are-accepted-but-never-perfect.md`.
>
> **Amended (2026-10-22), then reversed the same day:** #13 briefly ignored spacing entirely, so "hyper text" matched "Hypertext". That was undone because the spaces between words can change the word: "por que" (why) is not "porque" (because), nor "a part" "apart". Whitespace normalization still collapses runs of spaces and trims the ends, but an answer that splits, joins or moves a word grades as a miss. The comparison is `matchAnswer` in `apps/api/src/services/answerGrader.ts`.

Include:

* case folding
* punctuation stripping
* whitespace normalization
* accent/diacritic normalization

Avoid in v1:

* article stripping
* stemming/lemmatization
* synonym tables

Reason:

* these can create surprising false positives

⸻

17.10 Multi-Answer Cards

Use explicit answer arrays initially.

Structured answer groups can wait.

CSV delimiter for multiple canonical answers:

||

Example:

front,back
Prime between 10 and 20,"11 || 13 || 17 || 19"

⸻

17.11 AI Cache

Cache grading results by something like:

(cardId, normalizedUserAnswer, answerVersion, gradingPipelineVersion)

Not merely raw answer/card.

Need decide exact schema later.

⸻

17.12 AI Boundary

> **Scope narrowed (2026-10-21):** This boundary now applies to card grading only. Tutoring, hints, explanation generation and AI-generated content are allowed in course features per `docs/adr/0001-generative-ai-for-courses-not-flashcards.md`.

v1 AI grading must explicitly avoid:

* tutoring
* coaching
* generated hints
* adaptive pedagogy
* explanation generation
* Socratic dialogue
* AI deck generation

AI grading should remain mostly invisible.

⸻

18. Canonical Answers and Accepted Variants

18.1 Canonical Answers

> **Decided (2026-10-21):** Editing a card's front or a Canonical Answer resets its progress to NEW and keeps its attempts. Only attempts made since the latest reset count toward stats and scheduling, and Accepted Variant edits never reset progress. See `docs/adr/0004-card-edits-reset-progress-but-keep-attempts.md`.

Canonical answers are equally correct target answers.

Editing canonical answers is potentially destructive and may reset or affect progress/history.

Need finalize exact reset policy during schema/API planning.

⸻

18.2 Accepted Variants

Accepted variants are:

* paraphrases/surface forms
* non-destructive
* card-local
* direction-local
* not global aliases

For user’s own deck:

* allow persisting as accepted variant

For marketplace/shared decks:

* suggest variant for deck owner approval

Accepted variants preserve:

* progress
* history
* mastery

They should not automatically transfer to reverse cards.

⸻

18.3 Variant Approval

Initial authority:

* deck owner approves variants

Future moderation workflow possible.

Marketplace contribution scope remains narrow:

accepted variant suggestions only

No collaborative editing or structural merging.

⸻

19. Reverse Deck Model

Reverse decks are:

* conceptually linked
* independently studied
* independently graded

Example:

France → Paris
Paris → France

Separate:

* CardProgress
* accepted variants
* stats

Shared:

* conceptual linkage only

Accepted variants do not automatically transfer.

⸻

20. Marketplace Model

Marketplace is a supporting utility, not the primary growth engine.

Users may:

* publish decks
* clone/fork decks

Forks are permanently independent.

No:

* live synchronization
* collaborative editing
* structural merging
* card rewrites by contributors

Source deletion behavior:

* forks persist
* deleted authors anonymized/redacted
* provenance may show: “Original source no longer available”

Expected changelog events:

* accepted variant added
* canonical answer updated
* card added/removed
* publish/unpublish

Only upstream contribution type:

accepted variant suggestion

⸻

21. AI Deck Generation

> **Superseded in part (2026-10-21):** Course lessons now propose cards via AI, which the learner confirms into the course deck (`courses-plan.md`, `docs/adr/0001-generative-ai-for-courses-not-flashcards.md`). Generating standalone decks from scratch is still not built in.

No built-in AI deck generation in v1.

Instead, provide prompts/templates for external LLMs.

Suggested deck-size guidance:

Size	Use
10–30	focused review
30–75	topic/unit coverage
75–150	broad subject
150+	consider splitting decks

⸻

22. Likely Schema Areas

Need concrete Prisma model design for:

* User
* Session
* Deck
* Card
* CanonicalAnswer
* AcceptedVariant
* CardProgress
* CardAttempt
* StudySession
* StudySessionItem
* ReverseDeckLink
* MarketplaceDeck
* DeckFork
* ChangelogEvent
* ContributionInbox
* AIGradingCache, maybe
* AIUsageLog, maybe

⸻

23. Index / Query Strategy

CardProgress is the hot scheduler table.

Likely heavy-query fields:

* userId
* deckId
* cardId
* lifecycleState
* dueAt
* masteryScore
* lastReviewedAt
* lastIntervalDays

Likely indexes:

(userId, deckId, lifecycleState, dueAt)
(userId, deckId, lifecycleState, masteryScore)
(userId, deckId, dueAt)
(userId, deckId, cardId) UNIQUE
(userId, deckId, lifecycleState, lastReviewedAt)

Postgres partial indexes may be useful later, especially excluding RETIRED cards.

Do not over-optimize until query shape is finalized.

⸻

24. API Surface Areas Needed

Need concrete tRPC/API design for:

Session APIs

* start session
* resume session
* abandon stale session
* get current session
* submit answer
* submit “I don’t know”
* complete session
* continue with another session

Grading APIs

* submit answer
* return final grade
* return refinement affordance if ambiguous
* accept/add variant
* finalize corrected outcome

Variant APIs

* add accepted variant to own deck
* suggest variant to marketplace deck owner
* approve/reject variant suggestion

Deck/Card APIs

* canonical answer editing
* accepted variant editing
* card ordering/import order
* reverse deck linking

Cram APIs

* configure cram target date
* start cram session
* clear cram mode

Marketplace APIs

* publish/unpublish deck
* fork deck
* submit variant suggestion
* view changelog/provenance

⸻

25. Testing Strategy Needed

Need implementation plan for:

* Scheduler unit tests
* Queue generation golden tests
* deterministic seeded queue tests
* ProgressUpdater tests
* lifecycle transition tests
* interval table tests
* lateness bonus tests
* retry insertion tests
* session resume/abandon tests
* CardAttempt/CardProgress transaction tests
* AI grading pipeline tests with mocked providers
* AI cache tests
* Postgres integration tests
* migration tests from SQLite/current schema

Important:

Queue generation must be deterministic in tests.

⸻

26. Observability / Analytics Needed

Need final observability plan.

Likely events/metrics:

Scheduler/Session

* session_started
* session_completed
* session_abandoned
* session_resumed
* queue_generated
* queue_bucket_composition
* card_answered
* card_retried_same_session
* card_transitioned_lifecycle
* card_retired
* card_unretired

Grading

* grading_method_used
* semantic_score_distribution
* llm_fallback_rate
* grading_refinement_applied
* accepted_variant_added
* ai_failure_fallback

Product Health

* session completion rate
* average time per card
* retry frequency
* due backlog trend
* weak card count
* new card introduction rate

Errors

* Sentry for API/frontend errors
* structured logs for scheduler decisions
* Railway logs initially

Need decide:

* whether to add analytics provider
* whether simple DB event logging is enough
* whether portfolio app needs Amplitude/PostHog/etc.

⸻

27. Migration Strategy Needed

Need a concrete migration plan from current MVP.

Major steps likely:

1. migrate DB from SQLite to Postgres
2. introduce CardProgress eagerly for existing cards
3. backfill CardProgress from existing CardAttempt history where possible
4. introduce CanonicalAnswer/AcceptedVariant model
5. migrate existing Card answer fields
6. replace retry-until-success study flow with StudySession/StudySessionItem
7. introduce new scheduler services
8. migrate stats pages to use new CardAttempt/CardProgress model
9. add AI grading pipeline behind a feature flag
10. deploy incrementally

Need decide whether existing data must be preserved perfectly or can be reset for portfolio/local use.

⸻

28. Locked Constraints

Do not reopen unless a concrete implementation contradiction appears.

> **Amended (2026-10-21):** These constraints still govern flashcards and the review scheduler, with these exceptions. "No multiple choice" and the AI-grading bullets apply to cards only; course features (courses, lessons, exercises, tutor) may use generative AI per `docs/adr/0001-generative-ai-for-courses-not-flashcards.md`. Accent handling in grading is amended by `docs/adr/0002-accent-mismatches-are-accepted-but-never-perfect.md`. See `courses-plan.md`.

* Not a greenfield rewrite
* Keep React/Vite frontend
* Keep Express/tRPC API
* Move SQLite → Postgres
* Deploy frontend to Vercel
* Deploy API/Postgres to Railway
* No Redis in v2
* No background jobs in v2
* Local dev uses Docker Postgres
* Local + production only initially
* Session-cookie auth remains DB-backed
* No direct manual grading override
* No multiple choice
* No reveal-first learning
* “I don’t know” creates MISSED attempt
* Sessions are finite and chainable
* Queue generation is energy budgeting, not due fulfillment
* Due backlog must not monopolize sessions
* Retry-until-success is removed
* Only MISSED receives same-session retry
* Same-session retry capped at 2 reappearances
* Same-session retry state is ephemeral
* New cards are sequential by import order
* New cards never automatically fall to 0 during backlog
* Study sessions are one deck at a time
* CardProgress created eagerly
* CardProgress is authoritative for live queue generation
* CardAttempt is append-only historical truth
* CardAttempt and CardProgress update atomically
* Lifecycle state is explicit persisted state
* Retirement is user-confirmed, never automatic
* Freshness is derived, not persisted
* Weakness is derived, not standalone persisted truth
* masteryScore is 0–10 integer
* Intervals are table-driven with bounded modifiers
* Active intervals capped around 90 days
* Reverse decks are independently graded
* Marketplace forks are permanently independent
* Marketplace contribution scope is accepted variant suggestions only
* AI grading is bounded and fallback-only
* AI grading is not tutoring/coaching
* Hosted LLM fallback only for ambiguous cases
* AI prompt/model versions are persisted
* AI failures fall back gracefully

⸻

29. Resolved Decisions

A. Prisma Schema — Phase 1 Scope

**Decision:** Reset all existing data. No migration of MVP attempt history.

Phase 1 models (implement now):

* CardProgress (new) — mutable scheduler state
* StudySessionItem (new) — persisted ordered queue items
* CanonicalAnswer (new) — explicit canonical answer model
* AcceptedVariant (new) — user-added accepted paraphrases
* CardAttempt (modified) — expand with RecallGrade enum + grading metadata
* StudySession (modified) — add status enum, sessionType, study mode
* Card (modified) — add position/importOrder field

Deferred models (implement in later phases):

* ReverseDeckLink — reverse deck feature
* MarketplaceDeck, DeckFork, ChangelogEvent, ContributionInbox — marketplace phase
* AIGradingCache, AIUsageLog — AI grading phase

RecallGrade enum: `MISSED | PARTIALLY_CORRECT | GOOD | NAILED`
Replaces MVP `AttemptResult` enum (`CORRECT | INCORRECT`). No migration needed — data is reset.

CardProgress: created eagerly at card creation/import time. All existing cards get
`lifecycleState: NEW, masteryScore: 0` via fresh seed data (not backfill migration).

⸻

C. Session Orchestration — Resolved

**StudySession status enum:** `ACTIVE | COMPLETED | ABANDONED`

**StudySessionItem status enum:** `PENDING | COMPLETED | SKIPPED`

SKIPPED means: card was part of the planned session queue but was not reached before
the session ended or expired. NOT "user chose to skip the question."

**Resume behavior:**
* ACTIVE session with recent activity (<24h based on updatedAt/last activity) → resume
* ACTIVE session with stale activity (>24h) → mark ABANDONED, create new session
* No active session → show Quick / Standard / Deep session type picker

Resume window is based on **updatedAt / last activity timestamp**, not startedAt.

**Retry state:** Ephemeral (in-memory only) for v1.

If user refreshes mid-session, retry state is lost but the persisted session queue
(StudySessionItems) remains. Missed cards that were pending retry won't get retried
in that session, but CardAttempt + CardProgress were already updated atomically, so
the card will return via normal scheduling. No learning truth is lost.

This is consistent with "queue behavior does not contaminate scheduler truth."

⸻

G. Migration — Resolved

**Data:** Reset. Nuke existing data and decks. Fresh Postgres migration with new seed data.

**Database:** Clean break to Postgres now.
* Local dev: Docker Compose Postgres
* Tests: Docker-backed Postgres
* Production: Railway managed Postgres

No more SQLite anywhere. Avoids SQLite/Postgres drift, especially important for
v2 scheduler query complexity.

**Testing pattern:** Isolated per-suite Postgres schemas inside a Docker-backed test database.

Pattern:
* One local/test Postgres instance (Docker)
* Each test suite creates a unique schema
* Run migrations into that schema
* Point Prisma to that schema via DATABASE_URL
* After suite, drop schema cascade

Rationale for per-suite schemas over transaction rollback:
* tRPC/API tests span multiple calls
* session cookies/auth flows are awkward across transaction boundaries
* Prisma transaction wrapping can become brittle
* parallel-test friendly, no shared state

⸻

29b. Remaining Open Questions

D. AI Grading Details

Deferred to AI grading phase. Philosophy is settled (deterministic → embeddings →
hosted LLM fallback). Thresholds, models, and caching details remain open.

⸻

E. API Contract

Need tRPC router redesign for:

* sessions (start, resume, abandon, submit, complete, continue)
* grading (submit answer, return grade, refinement affordance)
* variants (add accepted variant to own deck)
* cards (canonical answer editing, import order)
* decks (existing CRUD remains)
* cram mode (configure target date, start cram session, clear)
* stats/dashboard (adapt to new CardProgress/CardAttempt model)

Need decide DTO shapes and optimistic UI boundaries.

⸻

F. Observability

Deferred. Use Railway logs + Sentry initially. Analytics provider decision can wait.

⸻

H. Marketplace Scope

Deferred to marketplace phase. Philosophy is settled (forks are independent,
contribution scope is accepted variant suggestions only).

⸻

I. Signup / Access Control

Open. Need decide: open signup, invite-only, or allowlist for portfolio app.

The current email/password auth (bcrypt, DB-backed sessions, HttpOnly
SameSite=Lax cookie) is sound for local use. If other people ever sign up,
choose between:

* keeping passwords: add password reset and email verification (needs an
  email provider)
* adding Google sign-in through a library (Arctic, Better Auth): no password
  reset or stored passwords, and users get Google's two-factor sign-in

⸻

J. Hosting Readiness

Open, and only relevant if the app is ever hosted. Before a public deployment:

* Cookies across domains: on default Vercel and Railway domains the web app
  and API are different sites, so the SameSite=Lax session cookie is never
  sent. Put both on one custom domain (app. and api.), or switch to
  SameSite=None; Secure
* Rate limiting on login and signup
* Cleanup of expired sessions (TODO in apps/api/src/context.ts)
* The seed account (dev@example.com / password) must not exist in production

⸻

30. Recommended Next Implementation Planning Order

Recommended next steps for a coding agent:

1. Prisma schema proposal
2. Postgres migration plan
3. CardProgress backfill strategy
4. Queue generation pseudocode
5. Session orchestration flow
6. tRPC API contract redesign
7. Scheduler service/module structure
8. AI grading pipeline implementation plan
9. Observability/event plan
10. Testing strategy
11. Marketplace schema/scope
12. Deployment docs for Vercel + Railway

Avoid reopening product philosophy unless implementation reveals a real contradiction.

⸻

31. One-Sentence Architecture Summary

Flashcard App v2 is a production-minded portfolio-grade typed-recall spaced repetition app with explicit lifecycle states, finite energy-budgeted sessions, Postgres-backed scheduler state, append-only attempt history, bounded fallback AI grading, and intentionally calm anti-review-hell queue generation.
```
