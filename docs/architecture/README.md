# Planning docs

These docs hold Study Hall's design and decisions. Work and its status live in GitHub issues, and the order of work in `CLAUDE.md` (Implementation Order), so the docs point to issues rather than tracking status. Decisions made since a doc was written are recorded as ADRs in `docs/adr/`, with a dated note in the doc where it disagrees with what was built.

## Active

| Doc                               | Source of truth for                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `courses-plan.md`                 | Courses: syllabi, lessons and their layout, exercises, the tutor, review cards, the AI platform and its operations                                                                   |
| `updated-plan.md`                 | The v2 flashcard plan: product philosophy, locked constraints (§28), the grading pipeline, accepted variants, and what's parked (§29c). Written in May 2026 as one consolidated plan |
| `learning-model-and-scheduler.md` | The scheduler in detail: lifecycle, interval tables, weakness, queues, study modes. Where it and `updated-plan.md` overlap, this doc wins: scheduler decisions are recorded here     |

## Archive

`archive/` keeps docs whose work is done, for history. Don't plan from them.

| Doc                                 | What it was                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `archive/implementation-plan.md`    | The original flashcard MVP plan (March 2026), all 19 PRs delivered                        |
| `archive/planning.md`               | Infrastructure, tech stack and data model notes (May 2026), merged into `updated-plan.md` |
| `archive/v2-implementation-plan.md` | v2 broken into PRs 1–11, delivered or re-filed as issues #2–#12 and later tickets         |
| `archive/v2-schema-proposal.md`     | The Phase 1 v2 schema proposal; `prisma/schema.prisma` is the current schema              |
