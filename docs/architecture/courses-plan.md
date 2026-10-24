# Courses — Plan

> **Tracked in GitHub issues (2026-10-21):** This document remains the design reference for courses, and tickets cite its sections. Work and status now live in GitHub issues #14–#27, sub-issues of the spec #1, which re-slice A1–C3 into end-to-end tickets with native blocking links. Course tickets are blocked only by the v2 tickets they need (#21 by #6, #27 by #5), so they interleave with the remaining v2 tickets rather than waiting for all of #2–#12 as **Sequencing** below says.
>
> | PR  | Tickets       |
> | --- | ------------- |
> | A1  | #14, #15      |
> | A2  | #14, #16, #17 |
> | A3  | #14, #16, #17 |
> | A4  | #18, #19      |
> | A5  | #20, #21, #22 |
> | A6  | #18, #20, #22 |
> | B1  | #23, #24      |
> | B2  | #23, #24      |
> | C1  | #25           |
> | C2  | #25           |
> | C3  | #26, #27      |

## Overview

This plan evolves the flashcard app into a general learning app: AI-assisted **courses** that teach material through generated lessons, exercises and a contextual tutor, and feed what was learned into the existing flashcard review cycle. Standalone decks stay first-class. The motivating use case is learning Italian alongside Duolingo; nothing in the design is language-specific except where noted.

The learning loop is **Learn → Practice → Assess → Review → Adapt**. This plan covers the first four for a single course; adaptation (mastery, weak spots, syllabus suggestions) is deliberately deferred.

**Related docs:**

- `GLOSSARY.md` (repo root): canonical domain terms used throughout this plan
- `docs/adr/0001-generative-ai-for-courses-not-flashcards.md`
- `docs/adr/0002-accent-mismatches-are-accepted-but-never-perfect.md`
- `docs/adr/0003-curriculum-is-editable-learning-history-is-durable.md`
- `docs/adr/0005-only-open-exercises-fall-back-to-ai-evaluation.md`
- `updated-plan.md` and `v2-implementation-plan.md`: the v2 flashcard and scheduler plan this builds on. Sections superseded by this plan carry dated notes.

**Status:** Design agreed 2026-10-21. Not started.

---

## Sequencing

1. **Finish v2 PRs 2–8** from `v2-implementation-plan.md`, tracked as GitHub issues #2–#12: Postgres test infrastructure, canonical answers, ProgressUpdater, QueueGenerator, session orchestration, the study flow UI and card management. The API does not currently build against the v2 schema (routers still use `Card.back` and `AttemptResult`), so this comes first regardless (#2).
2. **Course slices A → B → C** (below), each a short sequence of PRs.
3. **v2 PRs 9–11** (stats, seed, polish) are redesigned once course progress exists, rather than built as originally specified.

### Changes to the v2 PRs

- **PR 3 (canonical answers and grading), tracked as #6:** implement accent mismatches per ADR-0002. Normalization still strips diacritics for matching, but the grader reports when the only difference is accents, so the UI can show the accented form and the card grade is capped at GOOD.
- No other v2 PR changes. Schema additions for courses (`Deck` → course link, `Card.sourceLessonId`) land in the course slices, because they reference course models.

---

## Decisions

### Positioning

- Course features may use generative AI (generation, tutoring, LLM evaluation). Flashcards keep v2's recall rules: typed recall, no multiple choice, no self-grading, and AI grading only as a fallback (ADR-0001).
- AI proposes significant changes to persistent state (syllabi, cards); application code applies them only after the learner approves.
- Application code owns persistence, progression and scheduling. AI is called for specific operations (below), never as an autonomous agent over app state.

### AI platform

- **Provider:** Anthropic Claude for all AI work, including the v2 card-grading fallback, behind a small provider interface so domain code doesn't depend on the SDK. Starting points: a Sonnet-class model (`claude-sonnet-5-5`) for syllabus and lesson generation and the tutor, and a Haiku-class model (`claude-haiku-5-5`) for answer evaluation.
- **Structured output:** every generation and evaluation result is validated with a Zod schema before it is stored.
- **Access:** a central `canUseAI(user)` check gates every AI-backed capability. v1 implements it as an email allowlist from an environment variable. Domain code calls the check and never reads the allowlist. Standalone flashcards are available to everyone. Course creation is gated only because it is AI-backed in v1.
- **Cost and traceability:**
  - Every model call writes an AI usage record: purpose, model, input and output tokens, and the user.
  - A monthly cap from an environment variable disables AI features with a clear message once it's reached.
  - Every generated item (Syllabus Proposal, Lesson Version, card proposal) records the model and prompt version that produced it.
  - Tutor calls use prompt caching for the lesson content.
- **Latency:** tutor replies stream. Syllabus and lesson generation are single requests with a loading state. No background jobs (v2 constraint unchanged).

### Domain model

All terms are defined in `GLOSSARY.md`. The shape:

```
Course ──1:1 (v1 convention)── Course Deck ── Cards (existing v2 model)
  │                                              ▲
  └── Syllabus: ordered Lessons                  │ sourceLessonId (nullable)
        └── Lesson ──────────────────────────────┘
              └── Lesson Versions (immutable)
                    ├── content: explanation, examples   ┐
                    ├── Exercises                         ├ learning content
                    ├── Lesson Summary                    ┘
                    ├── Exercise Attempts   ┐
                    └── Tutor Thread        ┘ learner state about the version
```

**Learning content vs learner state:**

| Learning content                                         | Learner state                                     |
| -------------------------------------------------------- | ------------------------------------------------- |
| Course (setup answers, goal)                             | Lesson first-opened time, Lesson Completion       |
| Syllabus Proposal, Syllabus, Lesson, learning objectives | Exercise Attempts (evaluation, optional feedback) |
| Lesson Version: content, Exercises, Lesson Summary       | Tutor Thread and its messages                     |
| Deck, Card, Canonical Answer, Accepted Variant           | CardProgress, CardAttempt, Study Sessions (v2)    |

Rules:

- **No Concept model yet.** Learning objectives are plain text on each Lesson. Progress is grouped by lesson. Promote objectives to Concepts when one objective needs to be shared across lessons.
- **Cards are the only thing that takes part in spaced-repetition review.** Exercises are one-off and never enter the review scheduler. Lessons produce cards only through the confirmed "Make review cards" flow.
- **Typed recall is the current card type, not a universal Card shape.** Card proposals are typed as one of several card types, currently with a single member, so other card types (for example LLM-graded open-ended recall) can be added without reworking the flow. No `type` column on Card yet.
- **One Course Deck per course** is a v1 convention, not a domain invariant.
- **Card provenance:** `Card.sourceLessonId` is nullable and set when a card comes from a lesson. It points at the Lesson, not the version. It is set to null only if the lesson is permanently deleted.
- **Lesson Versions never change.** Regenerating creates a new current version. Exercise Attempts and the Tutor Thread belong to the version they were made against. Old versions are kept as historical snapshots.
- **Curriculum is editable; learning history is durable (ADR-0003).**
  - Lessons and courses are archived, not deleted.
  - An archived lesson is excluded from navigation, "Continue" and progression, but keeps its versions, attempts, threads and card provenance.
  - An archived course leaves the Courses area, and its deck stays reviewable from Flashcards, still linked to the course.
  - Permanent deletion is a separate, explicitly destructive action deferred past v1. When it exists, it removes course content and course learner state, while the deck, cards and review history survive as standalone flashcard data.
- **Lesson Completion** is set by the learner, in any order, and nothing is locked. It is navigation and progress state only and never evidence of mastery. "Opened" is derived from a first-opened timestamp; there is no lesson status state machine.

### Experience

- **Navigation:** Courses and Flashcards are peer top-level areas, with Courses as the default landing page. Inside a course, its deck appears as **Review** (cards due, start a study session), reusing the v2 study flow, so the learner never has to go through the Decks area. Course decks are also listed in Flashcards, labelled with their course. Structure the routes so a later "Today" view can sit above both areas.
- **Course creation:**
  - A structured form: topic, goal or target level, prior knowledge, time per week, preferred depth and free-text notes.
  - One generation call then produces a **Syllabus Proposal**.
  - While it's a proposal, the learner can rename, reorder, add and remove lessons, edit learning objectives, and regenerate with written feedback.
  - Accepting it creates the Syllabus and Lessons. After that, edits are by hand only; AI-suggested syllabus changes come later.
- **Lessons are lesson-driven:** stored, structured content the learner works through, with the tutor in a side panel. A lesson is generated the first time it's opened. Revisiting it never regenerates.
- **Lesson generation context:**
  - The course setup answers.
  - The full syllabus outline with every lesson's learning objectives.
  - The Lesson Summaries of already-generated lessons that come **earlier in syllabus order**.
  - The current lesson's objectives.

  Summaries of later lessons are never included, so the syllabus, not generation order, decides what a lesson builds on. Learners can jump around freely without making the curriculum depend on that order. Summaries record what was _taught_, never what was _learned_.

- **Lesson Summary:** produced by the same lesson-generation call as part of its structured output, so it needs no extra model call.
- **Exercises (v1 types):**
  - Short answer / translation: deterministic match against expected answers first. Lesson generation marks each one closed or open (ADR-0005): an answer to an Open Exercise that matches no expected answer goes to LLM evaluation, while a Closed Exercise (a capital, a date, a single word) is settled by the deterministic check alone.
  - Fill-in-the-blank: deterministic (always closed).
  - Free-form explanation: LLM evaluation against expected points (always open).

  Every attempt stores its evaluation. Written feedback is optional: deterministically correct answers make no model call, while LLM-evaluated answers generally get useful feedback. Accent mismatches count as correct, with a correction note (ADR-0002). Multiple choice is deferred.

- **Tutor:**
  - One persistent Tutor Thread per Lesson Version, restored when the lesson is reopened. Regenerating the lesson starts a fresh thread. The old thread stays with the old version, and a summary handed over from it can be added later if continuity proves valuable.
  - Context: the course goal, the syllabus outline, the current Lesson Version's content, the current exercise, that version's attempts, and the thread's history. In v1 it knows nothing from other lessons. The long-term model is that a thread covers one lesson version, while what the tutor knows covers the learner and course. Context from other lessons will come from distilled learner state, not from earlier threads.
  - Behavior is adapted from Claude Study Agent's tutor rules: ask before telling, offer progressively more explicit hints, push back on vague answers, check understanding with follow-ups, and never reveal an exercise's expected answer before the learner has attempted it.
- **Make review cards:**
  - An explicit action in the lesson.
  - One AI call proposes cards from the lesson's important material, weighted toward exercises the learner got wrong.
  - Proposals open in the existing import preview flow (`ImportPreviewDialog`, `csvDiff`), where the learner edits, deselects and gets duplicate detection against the course deck.
  - Confirmed cards are created in the course deck with `sourceLessonId` set.
  - Tutor-initiated card suggestions are deferred.

---

## AI Operations

| Operation                  | Trigger                                                        | Inputs                                                                                                | Output (Zod-validated)                                                 | Stored as                                  |
| -------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| Syllabus generation        | Course form submitted; regenerate with feedback                | Setup answers, optional feedback, previous proposal                                                   | Ordered lessons with titles and objectives                             | Syllabus Proposal (+ model/prompt version) |
| Lesson generation          | First open of a lesson; explicit regenerate                    | Setup answers, syllabus outline, earlier generated Lesson Summaries, lesson objectives                | Content blocks, exercises with expected answers/points, Lesson Summary | Lesson Version (+ model/prompt version)    |
| Exercise evaluation        | Open Exercise attempt not settled deterministically (ADR-0005) | Exercise, expected answers/points, learner answer                                                     | Evaluation + feedback                                                  | Exercise Attempt                           |
| Tutoring                   | Learner message in the tutor panel                             | Tutor context (above)                                                                                 | Streamed text                                                          | Tutor Thread messages                      |
| Card proposal              | "Make review cards"                                            | Lesson Version content, Lesson Summary, that version's incorrect attempts, existing course-deck cards | List of card proposals typed by card type                              | Nothing until confirmed; then Cards        |
| Card grading fallback (v2) | Ambiguous typed-recall answer                                  | Per `updated-plan.md` §17                                                                             | Recall Grade                                                           | CardAttempt grading metadata               |

Every row writes an AI usage record and goes through `canUseAI`.

---

## PR Sequence

All PRs follow the TDD workflow in `CLAUDE.md`. Backend PRs land before their frontend PRs. Spec: GitHub issue #1.

Test seams:

- **The tRPC router (main seam):** behavior is tested through a tRPC caller against an isolated Postgres schema, as the existing suites do.
- **The AI provider on the tRPC context (the one new seam):** tests supply a fake that returns fixtures and records its inputs, so no test calls a real model. Every output schema is tested against both valid and invalid fixture outputs.
- **Pure-function unit tests:** only for context assembly and accent-mismatch detection.
- **Web tests:** mock the tRPC hooks.

### Slice A — Course → Lesson

**A1: AI platform foundation (backend)**

- Provider interface with an Anthropic implementation and a fake implementation for tests.
- `canUseAI(user)` with the email allowlist from an environment variable, plus a protected procedure variant that requires it.
- AI usage records, the monthly cap check, and a helper for recording model/prompt versions.

Tests: `canUseAI` cases, cap enforcement, usage recording and schema validation failures.

**A2: Courses and Syllabus Proposals (backend)**

- Course model with setup answers and an archived timestamp.
- The course deck is created alongside the course (Deck gets an optional course link).
- Syllabus Proposal generation, proposal edits, regenerate with feedback, and accept, which creates Lessons with position and objectives.
- Archiving lessons and courses; active-syllabus queries exclude archived records.

Tests: ownership, proposal edit operations, the accept transaction, archive filtering, and `canUseAI` gating.

**A3: Navigation and course UI (frontend)**

- Courses and Flashcards as peer areas, with Courses as the default page.
- Course list, the course creation form, the Syllabus Proposal editor, and the syllabus view.
- Course decks labelled in the Flashcards area.

**A4: Lesson generation (backend)**

- Lesson Version model holding content, exercises, Lesson Summary and model/prompt version.
- Generate on first open; regenerate creates a new current version.
- First-opened timestamp.
- Context assembly is a pure, unit-tested function: earlier generated summaries in syllabus order only, with archived lessons excluded.

**A5: Exercises and attempts (backend)**

- Exercise Attempt model attached to a Lesson Version.
- Deterministic evaluation reusing `normalizeAnswer`, with accent-mismatch detection.
- LLM evaluation for Open Exercises only: free-form explanations, and open short answers that match no expected answer (ADR-0005).
- Feedback is optional per evaluation path.

Tests: TDD for each exercise type's deterministic path, accent mismatch, and the decision of when to call the LLM.

**A6: Lesson page (frontend)**

- Renders content blocks and examples.
- Exercise inputs for the three types, with results and feedback display.
- Loading state while a lesson is generated.

### Slice B — Tutor

**B1: Tutor backend**

- Tutor Thread per Lesson Version, with messages.
- Context assembly as a pure function, plus the system prompt built from the Study Agent tutor rules.
- Streaming through a tRPC subscription, so streaming is tested through the same tRPC caller as everything else.
- Prompt caching for lesson content; usage records.

**B2: Tutor panel (frontend)**

- Side panel on the lesson page with streamed replies.
- The thread is restored on reopen.
- The panel knows the current exercise.

### Slice C — Review integration and progress

**C1: Card proposals (backend)**

- Card proposal call: output typed by card type (typed recall only for now), weighted toward incorrect attempts.
- Confirm procedure: creates cards in the course deck with `sourceLessonId`, in one transaction, with CardProgress created eagerly as v2 requires.
- `Card.sourceLessonId` migration.

**C2: Make review cards (frontend)**

- Adapts `ImportPreviewDialog` and `csvDiff` to card proposals: edit, deselect, and duplicate detection against the course deck.

**C3: Completion, Continue and course Review**

- Lesson Completion and Continue (first incomplete, non-archived lesson in syllabus order).
- Syllabus status display, with "opened" derived from the first-opened timestamp.
- The course page's Review section: cards due, and starting a study session on the course deck.

### After Slice C

- Read-only history of previous versions: content, attempts and thread per old Lesson Version.
- Redesigned stats, seed data and polish (replacing v2 PRs 9–11), now aware of courses.

---

## Deferred

- Concept model and mastery tracking per concept or lesson; weak-spot detection
- Cross-lesson tutor context (from distilled learner state)
- Open-ended, LLM-graded recall cards (revisit when a non-language course needs them)
- Tutor-suggested cards and tutor- or AI-suggested syllabus changes (with approval)
- Handoff summaries between a lesson's old and new tutor threads
- Permanent deletion of courses and lessons
- A per-deck accent-sensitive grading setting
- Multiple choice exercises and other exercise types
- Units, or other grouping above lessons
- A unified Today dashboard and cross-course review
- Voice and pronunciation practice
- Tutor-driven or learner-directed lesson modes (e.g. "quiz me on this lesson")
