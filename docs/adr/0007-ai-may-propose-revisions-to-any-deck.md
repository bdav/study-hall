---
status: accepted
---

# AI may propose revisions to any deck's cards, applied only when the learner approves

ADR-0001 kept generative AI out of standalone decks. But broad rewording of a deck's cards, such as "remove the hints from the fronts", is tedious by hand and something a model does well, and decks need it whether or not a course made them. So AI may propose edits to and deletions of any deck's cards from an instruction the learner writes. As with every AI proposal (ADR-0001), nothing changes until the learner approves it in a preview, and approved edits follow ADR-0004: progress resets and attempts are kept. ADR-0001's recall constraints are unchanged: cards stay Typed Recall, the learner never grades their own answers, and AI grades answers only as a fallback.

## Considered Options

- **Course Decks only:** rejected, because the problem is the cards, not where they came from.
- **Regenerate a deck from scratch:** rejected, because it throws away every card's progress and attempts, including the cards that were fine (ADR-0003).

## Consequences

- Revising a deck goes through `canUseAI` and the spending cap like other AI features. Standalone decks still work fully without AI.
- AI still never creates cards for a standalone deck from nothing; it only revises cards the learner already has.
