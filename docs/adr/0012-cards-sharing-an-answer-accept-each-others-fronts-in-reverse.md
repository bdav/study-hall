---
status: accepted
---

# Cards sharing an answer accept each other's fronts in Reverse, once each per session

Reverse shows a card's primary answer and asks for its front (ADR-0011). Cards whose primary answers grade the same show the same prompt: Aruba and Sint Eustatius both show "Oranjestad", and Basseterre and Basse-Terre grade the same. ADR-0011 left each card graded against its own front, with a warning on the Cards tab, so the learner had to guess which card was wanted and was marked wrong half the time through no fault of their recall. Those misses then scheduled the cards, though they say nothing about what the learner recalls.

So in Reverse a card with a Shared Answer accepts its own front or any other front sharing its answer, with their Reverse Variants, graded as its own front would be; an exact match on any of them wins over a match but for the accents. The grade is the card shown's: its attempt, progress and Retry. To keep one answer from passing every card that shares it, a front already given correctly for another of those cards in the same Study Session is refused without a grade ("Aruba already correctly guessed. Give a different answer."), and the learner answers again. This supersedes ADR-0011's consequence that the app "warns about them rather than grading against another card's front".

## Considered Options

- **Grade each against its own front, with a warning (ADR-0011)**: rejected, because the learner can't tell the cards apart, so half their right answers are marked wrong and scheduled as misses.
- **Accept any of their fronts with no limit**: rejected, because one answer would pass every card that shares it, and the learner would never have to recall the others.
- **Remember fronts given across sessions**: rejected, because the learner would have to remember which front they gave last time, which isn't what the card tests; each session starts fresh.
- **Make the cards' answers distinct**: rejected as the app's job, because the answers are genuinely the same; the learner can still edit or delete a card.

## Consequences

- A refused answer creates no Card Attempt and changes no progress; the card stays in play.
- Forward is unchanged: the cards' fronts differ, so Forward always knew which answer was wanted.
- The Cards tab notes the cards sharing an answer instead of warning about them.
- "My answer was correct" still adds a Reverse Variant to the card shown's own front. A near miss of the other card's front accepted that way becomes this card's variant, and counts from then on as this card's front given.
