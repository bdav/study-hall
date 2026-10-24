---
status: accepted
---

# Only open exercises fall back to AI evaluation; lesson generation decides which are open

`courses-plan.md` sends a short answer to the model when it is "ambiguous", and #22 first read that as any answer that matches no expected answer. That spends a model call to tell a learner that "Sydney" is not the capital of Australia. We decided that every exercise is either closed (its expected answers are the complete list of right answers, so the deterministic check is final) or open (right answers can be phrased in ways no list covers, so a non-match goes to the model). Fill-in-the-blanks are always closed and free-form explanations always open; lesson generation marks each short answer closed or open, because the model writing the exercise knows whether it asked for a capital or a sentence to translate. A wrong answer to a closed exercise never makes a model call.

## Considered Options

- Any non-matching short answer goes to the model (#22 as first written): rejected because most wrong answers to closed questions are simply wrong, and each one would cost a call against the monthly cap.
- A per-course "deterministic only" setting: rejected as the default because one course mixes both kinds (vocabulary and sentence translation), and it asks the learner to decide before seeing any exercise. It may return later as an override on top of the generated marking.

## Consequences

- A right answer that a closed exercise doesn't list is marked incorrect, with no model to rescue it. Generation is asked to list every answer it would accept, and the learner can reveal the accepted answers after trying. A learner override like "My answer was correct" (#12, for cards) may follow for exercises if this proves common.
- Lesson Versions never change (ADR-0003), so short answers generated before this decision stay as they were generated and are treated as closed, which is how they have been checked so far. Free-form explanations were always open, so the migration that adds the marking records them as open; it changes no exercise's meaning.
