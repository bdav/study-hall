---
status: accepted
---

# Generative AI is allowed in course features; flashcards keep the v2 grading constraints

The v2 plan positioned the app as "not an AI tutor" and ruled out tutoring, generated explanations and hints, AI deck generation, curricula and multiple choice (`updated-plan.md` §3, §17.12, §21, §28; `learning-model-and-scheduler.md` §3; `planning.md` §11). We are evolving the app into a general learning environment with courses, AI-generated syllabi and lessons, lesson exercises and a contextual tutor, so those non-goals are superseded — but only for course features. Standalone decks and cards keep every v2 recall constraint: typed recall only, no multiple choice or reveal-first, no learner self-grading, and AI used for card grading only as a fallback for ambiguous answers. This keeps the scheduler's inputs trustworthy while letting lessons use whatever exercise formats suit the subject.

## Consequences

- Lesson exercises may use formats cards cannot (e.g. multiple choice, free-form explanation graded by an LLM); their attempts do not feed card scheduling.
- Course material enters long-term review only by producing ordinary cards, which the learner confirms before they are created.
- AI proposes changes to persistent learner-facing structure (syllabi, cards); application code applies them only after the learner approves.
