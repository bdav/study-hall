---
status: accepted
---

# A reversible deck is one deck studied two ways, not a linked reverse deck

The v2 plan (`updated-plan.md` §19) planned reverse decks as a second deck linked to the first (`ReverseDeckLink`): France → Paris in one deck, Paris → France in another, each with its own progress, Accepted Variants and stats. Two decks drift apart: an edit to a card in one has to be made again in the other, and keeping them in step needs syncing the plan never designed. So a reversible deck is one deck its author marks as studyable in both Study Directions. Forward asks a card's front for its canonical answer, as every deck does today; Reverse shows the card's primary canonical answer and asks for its front. Each direction of a card is learned, scheduled and graded on its own, as the plan required: its own card progress, attempts, stats and Accepted Variants, so knowing a capital says nothing about naming its state. A Study Session is in one direction. An edit that changes what a card asks (ADR-0004) changes both directions at once and resets both, starting one new Card Version (ADR-0008); choosing another primary answer resets neither.

## Considered Options

- **Linked reverse deck (`ReverseDeckLink`)**: rejected, because the two decks' cards drift apart and every edit has to be made twice.
- **One progress shared by both directions**: rejected, because recognising an answer and producing it are different abilities, and shared progress would schedule one by the other.
- **Every deck studyable both ways**: rejected, because many fronts are questions ("Fill in: Io \_\_\_ vent'anni") that can't be typed from their answers; the author chooses which decks reverse.
- **A separate Reverse prompt and answer on each card**: rejected, because a card with its own reverse prompt and answer is a second card in disguise, with the same drift.

## Consequences

- Progress, attempts and Study Sessions record their Study Direction; a card's Reverse progress starts NEW the first time it's studied in Reverse.
- Turning reversibility off hides Reverse and keeps its history (ADR-0003); turning it back on picks up where it left off.
- Cards that share a primary answer can't be told apart in Reverse, so the app warns about them rather than grading against another card's front. Superseded by ADR-0012: they accept each other's fronts in Reverse, once each per Study Session.
- Prompts that write cards for a reversible deck ask for fronts that can be typed from their answers.
