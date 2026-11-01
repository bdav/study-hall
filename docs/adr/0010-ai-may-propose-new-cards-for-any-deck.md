---
status: accepted
---

# AI may propose new cards for any deck, added only when the learner approves them

ADR-0001 kept generative AI out of standalone decks, and ADR-0007 let AI revise a deck's cards but never create cards for a standalone deck from nothing. That leaves a new deck to be filled by typing every card or preparing a CSV, which is the slowest part of starting one, while a model writes cards from a short description well, following the same card-writing rules as review cards and revisions. So AI may propose new cards for any deck, standalone or Course Deck, from the learner's description of the cards they want and how many. As with every AI proposal (ADR-0001), nothing is added until the learner approves the cards in a preview, where they edit, untick and refine them. Approved cards are ordinary NEW cards that record the model and prompt version that proposed them. ADR-0001's recall constraints are unchanged: cards stay Typed Recall, the learner never grades their own answers, and AI grades answers only as a fallback.

This supersedes ADR-0007's "AI still never creates cards for a standalone deck from nothing".

## Considered Options

- **Course Decks only:** rejected, because a standalone deck needs filling as much as any, and review cards already cover Course Decks from lessons.
- **Add the proposed cards at once, to be edited afterwards:** rejected, because unwanted cards would enter the queue and the learner's stats before they had looked at them.

## Consequences

- Generating cards goes through `canUseAI` and the spending cap like other AI features. Decks still work fully without AI.
- A proposal never holds more cards than the learner asked for, and at most 250 on any round.
- Generating cards from uploaded files or pasted material (#76) would build on this decision.
