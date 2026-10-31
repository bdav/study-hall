Flashcard App v2 — Scheduler & Learning Model Spec v0.1

Stability Notes

The scheduler philosophy and lifecycle model in this document are considered relatively stable.

Future planning should prefer:

- implementation refinement
- operational tuning
- schema design
- queue generation details
- infrastructure planning

rather than reopening foundational scheduler philosophy unless intentionally changing product direction.

⸻

1. Product Philosophy

Core Product Direction

A retrieval-first spaced repetition flashcard app optimized for:

- typed recall
- psychologically sustainable studying
- finite sessions
- low operational cost
- bounded AI usage

Not:

- a tutoring agent
- a heavy AI product
- an infinite-review Anki clone
- a social platform

Core philosophy:

- calm UX
- momentum over guilt
- mastery over streaks
- finite sessions
- understandable behavior

⸻

Typed Recall Philosophy

Core interaction:

- typed free recall

No:

- multiple choice
- self-assessed correctness
- reveal-first learning

Exception:

- I don't know button

Behavior:

- counts as MISSED
- reveals answer
- may requeue card
- persists immediately

⸻

Motivation Philosophy

Avoid:

- punitive streaks
- guilt mechanics
- “don’t break your streak” framing

Allow:

- lightweight encouragement
- gentle momentum reinforcement

Examples:

- “Nice — 3 study days in a row.”
- “Great job coming back after a break.”

⸻

Anti-Review-Hell Principle

Core scheduler principle:

Recent weakness gets priority,
but no category of cards is allowed to monopolize sessions.

The app is NOT:

- inbox-zero review management
- due-count debt repayment

The app IS:

- guided ongoing study
- sustainable retrieval practice
- bounded progress

⸻

2. Existing MVP Snapshot

Current State

The app already exists and is functional.

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

v2 is an evolution, not a rewrite.

⸻

Existing Tech Stack

Layer Technology
Frontend React 19, TypeScript, Vite 8
Routing React Router 7
State/Data TanStack Query 5 + tRPC
Styling Tailwind CSS 4 + shadcn/ui
Backend Node.js + Express 5 + tRPC 11
Validation Zod 4
Database Prisma 7 + SQLite (Postgres-ready)
Auth Session-cookie auth with DB-backed sessions
Testing Vitest + React Testing Library + Supertest
Monorepo pnpm workspaces

⸻

Existing Repo Structure

flashcards/
apps/
api/
web/
prisma/

⸻

Existing Current Schema

User
Session
Deck
Card
StudySession
CardAttempt

Not yet implemented:

- CardProgress
- scheduler system
- mastery model
- reverse decks
- marketplace

⸻

Existing Architectural Strengths

Already aligned with future design:

- server-authoritative grading
- attempt persistence after every answer
- transactional imports
- ownership enforcement
- isolated test DBs
- Prisma abstraction layer
- CardAttempt audit history

⸻

3. Non-Goals (v1)

Explicitly NOT part of v1:

- full adaptive spaced repetition
- probabilistic forgetting models
- hidden confidence systems
- personalized learning-rate modeling
- AI-generated decks
- tutor/explainer mode
- collaborative editing
- live deck synchronization
- structural deck merging
- multiple-choice studying
- hard streak systems
- curriculum graphs
- infinite queue clearing
- infinite-interval scheduling
- media-heavy cards
- social/comment systems

⸻

4. Core Learning Model

Recall Grades

Internal enum:

MISSED
PARTIALLY_CORRECT
GOOD
NAILED

User-facing labels:

- Needs review
- Partially correct
- Good
- Nailed it

⸻

Grading Philosophy

Users may:

- add accepted variants
- refine canonical answers
- manually adjust review timing later if desired

Users may NOT:

- directly mark answers correct
- manually choose arbitrary grades

This preserves:

- scheduler trustworthiness
- grading consistency
- calmer UX

⸻

AI Grading Philosophy

Grading optimizes for:

- “good enough retrieval”

NOT:

- exhaustive textbook-perfect answers
- tutoring evaluation
- semantic over-analysis

Pipeline:

1. Deterministic matching
2. Local semantic similarity
3. Hosted LLM adjudication only for ambiguous cases

Hosted LLM fallback target:

<1–5% of answers

Grading internals remain invisible to users.

⸻

Canonical Answers vs Accepted Variants

Canonical answers:

- equally correct target answers
- destructive to edit
- editing resets progress/history

Accepted variants:

- paraphrases/surface forms
- non-destructive additions
- preserve progress/history/mastery

CSV delimiter for multiple canonical answers:

||

Example:

front,back
Prime between 10 and 20,"11 || 13 || 17 || 19"

⸻

masteryScore Philosophy

masteryScore represents:

- demonstrated historical confidence

It does NOT represent:

- freshness
- rustiness
- overdue status

Range:

0–10 integer

No continuous decimals in v1.

⸻

masteryScore Updates

MISSED:
mastery >= 7 → -2
else → -3
PARTIAL:
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

5. Lifecycle Model

Lifecycle States

type CardLifecycleState =
| "NEW"
| "LEARNING"
| "STABLE"
| "RETIRED";

⸻

NEW

Never successfully recalled yet.

Cards leave NEW on first exposure.

⸻

LEARNING

Early stabilization phase.

Characteristics:

- short intervals
- may recur in-session
- not yet eligible for long intervals
- not yet eligible for retirement

⸻

STABLE

Normal spaced repetition behavior.

Characteristics:

- table-based intervals
- bounded lateness bonus
- active interval cap around 90 days
- eligible for retirement after sustained high performance

⸻

RETIRED

Removed from active circulation.

Characteristics:

- not included in normal study queues
- preserves mastery/history
- reviewed only through optional retired-review mode
- missed retired cards may be offered for unretirement

Retirement is not suspension.

It means:

- likely mastered enough to leave active circulation

not:

- hidden/noisy/bad card.

⸻

6. Lifecycle Transition Rules

NEW → LEARNING

A card moves from NEW to LEARNING on first exposure.

This happens even if the first answer is missed.

Once shown, it is no longer new.

⸻

LEARNING → STABLE

A card moves from LEARNING to STABLE when:

- it has at least 2 successful recalls
- those successful recalls occur across at least 2 separate sessions or days
- as built (#7): only successes since the card last entered LEARNING count (`CardProgress.lifecycleChangedAt`), so a card that lapsed back needs 2 new ones; "days" are UTC days
- the latest result is successful

Successful means:

- GOOD
- NAILED

PARTIALLY_CORRECT does not count as successful for stabilization.

⸻

STABLE → LEARNING

A single miss does not demote a stable card.

On one miss:

- stay STABLE
- lower masteryScore
- increment lapseCount
- schedule soon

A STABLE card moves back to LEARNING only after:

- 2 MISSED results within the last 3 attempts

This keeps ordinary lapses from feeling punitive.

⸻

STABLE → RETIRED

Retirement is:

- system-suggested
- user-confirmed

A card becomes retirement-eligible when:

- lifecycleState = STABLE
- masteryScore >= 9
- latest result is NAILED
- lastIntervalDays >= 60

Retirement is never automatic.

⸻

RETIRED → STABLE

A retired card returns to STABLE only through explicit user action.

Examples:

- user manually unretires
- user misses it during retired-review mode and confirms “Unretire missed cards?”

Unretiring restores prior mastery/history.

It does not reset the card.

⸻

7. Scheduler Architecture

Interval Architecture

v1 uses a hybrid interval system:

- table-driven baseline intervals
- tightly bounded modifiers

This preserves:

- understandability
- tunability
- debuggability
- emotionally predictable behavior

while allowing:

- stabilization behavior
- lateness bonuses
- cram pacing overrides
- retirement eligibility

v1 explicitly does not use:

- full adaptive scheduling
- probabilistic forgetting curves
- opaque confidence systems

⸻

Allowed Interval Inputs

The interval calculation may only use:

- masteryScore
- recallGrade
- lifecycleState
- bounded lateness bonus

It must NOT use:

- streaks
- fatigue modeling
- session performance
- time-of-day effects
- hidden confidence metrics
- personalized learning rates
- deck-level intelligence

⸻

Active Interval Cap

Active-card intervals are capped around:

~90 days

Long-term dormant knowledge is handled via:

- RETIRED state

⸻

8. LEARNING Scheduler

LEARNING Intervals

recallGrade persisted next interval
MISSED 30m
PARTIALLY_CORRECT 1d
GOOD 1d
NAILED 2d

Rules:

- NEW cards become LEARNING on first exposure.
- First-ever attempts cannot produce NAILED's interval. As built (#7): a NEW card's first answer, including the first after a progress reset, keeps its NAILED Recall Grade but is scheduled with GOOD's 1-day interval.
- Same-session retries are separate from persisted intervals.
- MISSED may recur in-session.
- PARTIALLY_CORRECT does not trigger aggressive same-session retry.

⸻

LEARNING MISSED Behavior

A LEARNING MISSED result has two separate effects:

Queue behavior

The card may reappear later in the same session.

Persisted scheduler state

dueAt = now + 30m

These are intentionally separate systems.

⸻

9. STABLE Scheduler

Stable Interval Table Uses Mastery Bands

STABLE cards use mastery bands, not exact per-score interval rows.

This keeps v1:

- easier to reason about
- easier to tune
- less fake-precise
- easier to test

⸻

STABLE Baseline Intervals

mastery band score MISSED PARTIAL GOOD NAILED
fragile 0–2 1h 1d 2d 4d
developing 3–5 6h 2d 5d 10d
solid 6–8 1d 5d 14d 30d
mastered 9–10 3d 10d 45d 90d

MISSED interval values determine persisted dueAt after the attempt.

As built (#7): the band is the card's mastery before the answer (a MISSED never leaves a card in the mastered band, so banding after it would leave that column unused), and the table is that of the card's state after the answer: a card that graduates gets a STABLE interval, one that lapses back to LEARNING a LEARNING one.

Same-session retries are queue behavior, not interval behavior.

⸻

10. Same-Session Retry Rules

Only MISSED cards may recur aggressively within the same session.

PARTIALLY_CORRECT, GOOD, and NAILED cards do not receive same-session retry treatment.

When a card is marked MISSED:

- reinsert after roughly 5 other cards
- allow small random spacing variation
- cap at 2 same-session reappearances per card

Maximum appearances in one session:

- initial appearance
- reappearance #1
- reappearance #2

After the retry cap is reached:

- remove from active session queue
- rely on persisted dueAt
- allow the session to complete normally

Repeated failures never block session completion.

Same-session retries do not count toward stabilization requirements.

As built (#11): a missed card comes back at the end of the session instead, after every card and earlier retry, in the order missed, so the reinsertion spacing above is not used: a card missed early waits longer than ~5 cards, which strengthens the retrieval, and one missed late comes back as soon as it would have. A retry missed again goes to the end again, within the cap. The page counts the cards, then the retries on their own ("Retry 2 of 3"), a total that grows as more are missed. A retry item is a `StudySessionItem` with `isRetry`, so the reappearance count is the card's retry items in the session rather than an in-memory map. A retry's answer is a `CardAttempt` with `isRetry`, which never changes `CardProgress` and which the scheduler leaves out of the answers it counts. Accepting a missed answer ("My answer was correct") or marking the card known skips its waiting retry, as it was not missed after all, or needs no more practice. A card edited after its miss still comes back for practice, but its progress, reset to NEW by the edit (ADR-0004), waits for its next session's answer.

⸻

Session Retry Metadata

type SessionRetryState = {
cardId: string;
reappearancesThisSession: number;
};

This metadata is:

- session-local
- non-authoritative

It affects:

- temporary queue behavior

It does not affect:

- masteryScore
- lifecycleState
- stabilization tracking

⸻

11. Lateness Bonus

Successful recall after substantial overdue delay may slightly increase the next interval.

The lateness effect:

- applies only to interval calculation
- does not directly affect masteryScore
- is intentionally small and bounded
- is not exposed directly to users

⸻

Lateness Derivation

overdueRatio =
(now - dueAt) / lastIntervalDays

⸻

Lateness Rules

- no bonus until overdueRatio >= 1.5
- cap interval bonus around 1.25×
- apply only on GOOD or NAILED
- as built (#7): a flat 1.25× from an overdueRatio of 1.5, only for a card already STABLE (not on the answer that graduates it), never past the 90-day cap

Lateness is intentionally asymmetric:

- successful late recall may help slightly
- lateness alone never reduces mastery

⸻

12. Freshness Model

Freshness Philosophy

Freshness is a derived estimate of likely current recall strength.

Freshness is:

- derived, not persisted
- separate from masteryScore
- separate from weakness
- separate from lifecycleState

Freshness influences:

- queue prioritization
- deck sorting
- visual presentation

Freshness does NOT:

- directly modify masteryScore
- define weakness
- create punishment states
- act as lifecycle state machine

⸻

Freshness Derivation

Freshness is computed from:

- dueAt
- lastReviewedAt
- lastIntervalDays
- current time

Possible implementation:

overdueRatio =
(now - dueAt) / lastIntervalDays
freshness =
clamp(1 - overdueRatio, 0, 1)

⸻

Freshness UX Bands

Internally:

- continuous scalar

Externally:

- soft human-readable bands

state freshness
Fresh >= 0.75
Warming >= 0.40
Rusty >= 0.15
Cold < 0.15

These are:

- UX concepts only
- not scheduler states
- not punishment states

⸻

Freshness Presentation Philosophy

Freshness should be communicated primarily through:

- subtle visuals
- fading/emphasis
- lightweight language

Avoid harsh or judgmental terminology.

Prefer softer phrasing such as:

- Recently reviewed
- May be rusty
- Needs refreshing

⸻

13. Weak STABLE Definition

A STABLE card is considered weak if either:

- masteryScore <= 3
  OR
- it has 2 MISSED results within the last 5 attempts

Weakness is intentionally defined by:

- low demonstrated mastery
- recent retrieval instability

Weakness is NOT defined solely by:

- freshness
- overdue duration
- time since review

⸻

Weak STABLE Ranking

Weak STABLE cards are prioritized by:

1. recent lapse frequency
2. masteryScore ascending
3. overdue amount

⸻

Important Conceptual Distinction

Due STABLE
= scheduling urgency
Weak STABLE
= retrieval instability

A highly-mastered but overdue card is not automatically considered weak.

This preserves the distinction between:

“We haven’t checked this recently.”

and:

“You are struggling with this concept.”

⸻

14. Session Model

Session Philosophy

Sessions are:

- finite
- bounded
- chainable

Users do NOT:

- clear giant due queues
- choose arbitrary card counts

Users MAY:

- complete a bounded session
- optionally continue into another session

⸻

Session Definition

Sessions are:

- primarily time-targeted
- secondarily constrained by soft card-count bounds

The app optimizes for:

- sustainable study energy

not:

- raw throughput

⸻

Session Types

Session type Target duration
Quick ~5 minutes
Standard ~10 minutes
Deep ~20 minutes

Example internal bounds:

Session type Target Min cards Max cards
Quick ~5m 5 12
Standard ~10m 10 25
Deep ~20m 20 50

Users choose:

- Quick
- Standard
- Deep

No arbitrary sliders or card counts.

⸻

Session Queue Generation

Queue generation is:

energy budgeting

not:

due-count fulfillment

The queue generator may consider:

- estimated answer duration
- retry overhead
- card difficulty mix
- same-session reappearance likelihood

⸻

15. Study Mode Queue Buckets

Default Study mode builds sessions from these buckets:

1. Due LEARNING
2. Due STABLE
3. Weak STABLE
4. New cards
5. Same-session reappearances

Same-session reappearances are inserted dynamically.

⸻

Default Study Target Shares

bucket target share
Due LEARNING 20–30%
Due STABLE 40–60%
Weak STABLE 10–20%
New cards 10–20%

⸻

Caps

bucket cap
Due STABLE ~60%
Weak STABLE ~20%
New cards ~20%

Due LEARNING may exceed its target because early stabilization is fragile.

Unused budget redistributes.

⸻

Key Principle

Overdue reviews matter, but they are not allowed to monopolize Study mode.

This preserves:

- novelty
- motivation
- backlog recovery
- finite-session calmness

⸻

16. New Card Introduction

NEW cards are introduced:

- sequentially by import order
- without randomization in v1

Import order is treated as intentional deck structure.

Users who want custom ordering should reorder externally before import.

⸻

New-Card Presence During Backlog

NEW cards remain eligible during backlog periods.

The scheduler may:

- reduce new-card share during heavy instability
- prioritize Due LEARNING over NEW cards

But:

- NEW card share never automatically falls to 0
- unless the user explicitly chooses a no-new mode

This preserves:

- novelty
- motivation
- forward progress
- anti-review-hell behavior

⸻

Session Placement

NEW cards should be lightly interleaved throughout sessions.

Avoid:

- front-loading
- large new-card clusters

Interleaving creates smoother session energy.

⸻

17. Study Modes

Study Mode

Balanced long-term retention mode.

Optimizes:

- sustainability
- bounded progress
- balanced retrieval maintenance

⸻

Drill Weakest Mode

Drill Weakest reuses the same core scheduler systems as normal Study mode.

It changes:

- queue weighting
- bucket prioritization

It does NOT introduce:

- separate interval logic
- separate retry semantics
- separate lifecycle rules
- infinite remediation loops

⸻

Drill Weakest Queue Priorities

1. Weak STABLE
2. Due LEARNING
3. Due STABLE
4. New cards (disabled)

⸻

Drill Weakest Characteristics

- NEW cards disabled
- weak-card concentration heavily increased
- finite sessions preserved
- ordinary retry rules preserved
- ordinary interval rules preserved

⸻

Example Target Mix

bucket target share
Weak STABLE 60–80%
Due LEARNING 20–40%
Due STABLE minimal overflow only
New cards 0%

⸻

Key Philosophy

Drill Weakest is:

- focused remediation
- confidence rebuilding
- instability reinforcement

It is NOT:

- punishment
- backlog debt repayment
- mandatory cleanup

Even in Drill Weakest:

- sessions remain bounded
- failures never block completion
- weak cards are not required to reach correctness before continuing

⸻

Cram All Mode

Cram All reuses the same core scheduler systems as Study mode.

It preserves:

- lifecycle states
- retry rules
- interval tables
- mastery semantics
- bounded sessions

It adds:

- accelerated new-card pacing
- earlier review pressure
- denser exposure coverage

It does NOT:

- replace normal interval logic
- create infinite queues
- require completing all due cards
- permanently alter the scheduler model

⸻

Core Cram Rule

effectiveDueAt =
min(normalSrDueAt, cramPacingDueAt)

Normal SR still determines natural return timing.

Cram mode may pull cards earlier.

⸻

Cram Is Temporary

Cram behavior is:

- temporary
- deck-scoped
- target-date-driven

When cram ends:

- normal Study behavior resumes

Attempts still update:

- masteryScore
- lifecycleState
- dueAt
- lastIntervalDays

using ordinary scheduler primitives.

⸻

Example Queue Shift

bucket Study Cram All
New cards 10–20% 30–50%
Due LEARNING high high
Due STABLE moderate moderate/lower
Weak STABLE 10–20% lower unless due/learning

⸻

Cram Philosophy

Study optimizes:

- sustainable retention

Cram optimizes:

- timely exposure coverage

Both remain:

- bounded
- calm
- non-punitive

⸻

18. Attempt History vs Operational Progress

CardAttempt

CardAttempt is the append-only historical record.

Stores facts like:

- timestamp
- user answer
- final recall grade
- session id
- grading source/method
- grading confidence
- latency/response time
- whether refinement occurred before final grade save

⸻

CardProgress

CardProgress is mutable operational scheduler state.

Stores:

- lifecycleState
- masteryScore
- dueAt
- lastIntervalDays
- lastReviewedAt
- lapseCount

⸻

Source-of-Truth Principle

CardAttempt
= historical truth
CardProgress
= current scheduler projection

CardProgress is authoritative for live queue generation, but conceptually rebuildable from CardAttempt history.

⸻

Why This Architecture Is Correct

Benefits:

- fast due-card queries
- debuggable scheduler behavior
- scheduler migration/recomputation ability
- analytics flexibility
- AI grading auditability

without requiring full event sourcing.

⸻

Refinement-Aware Attempt Recording

When a user adds an accepted variant during review:

Scheduling/stats should use:

- corrected final grade only

The mistaken intermediate grade should NOT pollute mastery.

Optional audit metadata may still record:

- initialSuggestedGrade
- finalRecallGrade
- refinementApplied = true

⸻

19. Reverse Deck Model

Reverse decks are:

- conceptually linked
- independently studied
- independently graded

Example:

France → Paris
Paris → France

Separate:

- CardProgress
- accepted variants
- stats

Shared:

- conceptual linkage only

Accepted variants do NOT automatically transfer.

⸻

20. Marketplace Philosophy

Marketplace is:

- supporting utility
- not primary growth engine

Users may:

- publish decks
- clone/fork decks

Forks:

- never resync
- become permanent independent copies
- persist after source deletion

Deleted authors:

- anonymized/redacted

Possible provenance message:

Original source no longer available

⸻

Marketplace Contribution Scope

Only supported upstream contribution:

- accepted variant suggestions

Explicitly NOT supported:

- collaborative editing
- structural merging
- live synchronization
- card rewrites by contributors

⸻

Marketplace Changelog Events

Expected from the beginning:

- accepted variant added
- canonical answer updated
- card added/removed
- publish/unpublish

⸻

21. AI Deck Generation Philosophy

No built-in AI deck generation in v1.

Instead:

- provide prompts/templates for external LLMs

Suggested deck-size guidance:

10–30 focused review
30–75 topic/unit coverage
75–150 broad subject
150+ consider splitting decks

⸻

22. Locked Constraints

These decisions are considered stable unless intentionally revisited.

- No direct manual grading override
- Canonical edits are destructive
- Accepted variants are non-destructive
- Retry-until-success is removed
- Sessions are finite and chainable
- No “clear all reviews” philosophy
- Retirement is not suspension
- Historical mastery does not decay
- Freshness is derived, not persisted
- Active intervals capped around 90 days
- Reverse decks are independently graded
- Marketplace forks are permanently independent
- Marketplace contribution scope is intentionally narrow
- AI grading should remain mostly invisible
- Hosted LLM usage must remain tightly bounded
- CSV order determines introduction order
- New cards never automatically fall to 0 during backlog
- Queue generation is energy budgeting, not due fulfillment

⸻

23. Remaining Open Questions

These are implementation-level unresolved items.

Schema / Prisma Design

Need concrete models for:

- CardProgress
- AcceptedVariant
- CanonicalAnswer
- ReverseDeckLink
- MarketplaceDeck
- ChangelogEvent
- ContributionInbox
- Session-local retry state

⸻

Queue Generation Algorithm

Need:

- concrete candidate selection algorithm
- time-budget estimation
- queue assembly pseudocode
- retry insertion mechanics
- query/index strategy

⸻

API Surface Redesign

Need:

- session APIs
- grading/refinement APIs
- variant submission APIs
- marketplace APIs
- cram configuration APIs

⸻

AI Grading Infrastructure

Need decisions for:

- local semantic similarity implementation
- embedding vs cross-encoder
- model hosting
- thresholds
- cache strategy
- abuse protection
- evaluation datasets

⸻

Infra / Operations

Still unresolved:

- hosting topology
- DB hosting
- background jobs
- observability
- notifications
- quota enforcement
- signup restrictions
- moderation systems

⸻

24. Recommended Next Planning Phase

Future planning agents should focus on:

1. Prisma schema redesign
2. Queue generation pseudocode
3. Session orchestration flow
4. API evolution
5. Query/index strategy
6. AI grading architecture
7. Background jobs / infra
8. Marketplace schema
9. Analytics/event model
10. Home/dashboard UX

Avoid reopening scheduler philosophy unless identifying a concrete implementation contradiction.
