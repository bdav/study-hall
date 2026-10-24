---
status: accepted
---

# Explanations are judged against what the question asks, point by point

The AI judge marked correct explanations wrong for leaving out details the question never asked for. Lesson generation asked for "the points a good answer makes", which produced exhaustive model answers, and the judge was told an answer is "incorrect when it misses a point". We decided that a free-form explanation's rubric has one to three Essential Points, each something the question explicitly asks for, and optional Supplementary Points that never decide the evaluation; if a detail matters enough to require, the question must ask for it. The judge assesses each essential point as demonstrated, missing or wrong, in any wording, and lists misconceptions, and code derives the evaluation: Correct when every essential point is demonstrated with no misconception, Incorrect when none is, and Partially Correct otherwise. Nothing in this is specific to a subject.

## Considered Options

- Only rewrite the judge prompt to judge against the question: rejected because the judge would decide afresh, on every attempt, which points are essential, and a question whose key asks for more than its wording would still be misaligned.
- Let the judge choose the evaluation directly: rejected because a per-point assessment is easier for a small model to get right, gives the same answer the same evaluation, and leaves a record of why.
- Keep evaluations binary: rejected for explanations, because "you have the core rule but missed one part the question asks for" is a different result from "not quite", and saying so helps the learner. Short answers stay Correct or Incorrect.

## Consequences

- Explanations generated before this keep their flat expected points (ADR-0003). The judge treats those as reference only, works out from the question the one to three points it asks for, and assesses those. That is the option rejected above for new exercises, so the same answer to an older explanation can be judged differently on different attempts; regenerating a lesson gives it essential points.
- Feedback can mention a supplementary point only as an optional extra ("To go further"), never as a fault.
- A misconception keeps an answer from being Correct even when every essential point is there, so judging gets fairer without getting more lenient.
- The prompt can't be checked by the test suite, which uses a fake model, so a judge evaluation script runs fixed cases from more than one subject against real models. Its result decides which model judges: on 2026-10-23 Haiku and Sonnet both judged all 18 cases as expected, and Haiku cost about a fifteenth as much, so Haiku judges. Rerun it after changing a judge prompt, and add a case for any real answer it misjudges.
