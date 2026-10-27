---
status: accepted
---

# Marking a card known is a timing adjustment, not a grade

Learners have cards they already know: ones they learned elsewhere, and ones whose progress an edit or a revision reset (ADR-0004, ADR-0007) though they knew them well. Without a way to say so, those cards come back as new, every day at first. But "no direct manual grading override" is a locked constraint (`updated-plan.md` §22), and the grading philosophy allows manually adjusting review timing, never marking answers correct. So marking a card known adjusts its timing and records no answer. It creates no Card Attempt and no Recall Grade, and the scheduler's evidence stays the learner's real answers.

A NEW or LEARNING card marked known becomes STABLE as if it had just graduated (#7). Its mastery is raised to at least 3, where two good answers would leave a new card, and it is next due a STABLE GOOD interval away for its band: 5 days for a new or reset card. Its last-reviewed time and lapses don't change, because it wasn't reviewed. A wrong guess about knowing it is caught at that review, which moves it like any STABLE card: a miss is a lapse, and a second within three answers sends it back to LEARNING. A card already STABLE, or RETIRED, is left as it is, since marking it known would only move its next review.

## Considered Options

- **Leave mastery untouched, in the fragile band:** purest, since mastery would only ever come from answers, but a known card would come back every 2 days for its first few reviews, which is the problem this solves.
- **Raise mastery to the solid band (6), due in 14 days:** comes back least often, but a wrong guess goes uncaught for two weeks and mastery strays further from what answers have shown.
- **Record a synthetic NAILED attempt:** rejected, because it is a manual grade, and it would count in stats and history as an answer never given.

## Consequences

- Mastery is no longer only ever from answers: marking known can raise it to 3. That's the one exception, and no further than real answers would take a graduating card.
- Stats and history ignore marking known, since no attempt records it.
- Marking known starts the card's STABLE period (`lifecycleChangedAt`), so only answers after it count toward sending it back to LEARNING.
- Because no attempt records it, the card's progress records when it was last marked known (`markedKnownAt`), so rebuilding progress from its answers, as "My answer was correct" does, marks it again at that point. Only the latest mark is kept, and a progress reset clears it.
- Marking a card known skips it in any Study Session under way, as the study screen moves past it.
