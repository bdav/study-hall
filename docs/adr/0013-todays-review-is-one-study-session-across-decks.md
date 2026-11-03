---
status: accepted
---

# Today's Review is one Study Session across decks, its queue pooled by urgency

The v2 plan scoped a Study Session to exactly one deck (`updated-plan.md` §12.2), leaving cross-deck scheduling for later. A learner with several decks then has to open each to clear what's due, which Today (#92) is meant to end. So Today's Review is one Study Session across the decks the learner has ticked in Today: one queue, built from all their Card Standing at once, with the same buckets, shares, caps and ranking as a deck's, so the most overdue card comes first whatever its deck. New cards are taken from each deck in turn, each in its own deck order, so one big new deck can't fill the session. A deck's own study page still runs a session on that deck alone.

## Considered Options

- **Today as rows of links to each deck's study page**: rejected as the whole answer, because the learner still studies every deck in turn; kept beside Today's Review, for studying one deck.
- **Running each deck's session in turn**: rejected, because a session should be finite and bounded, and five decks would mean five sessions.
- **A share of the session for each deck**: rejected, because a small deck would fill its share with cards that aren't urgent while overdue ones elsewhere wait.

## Consequences

- A Study Session records the decks it was built from, and each item its Study Direction. Today's Review asks both directions of a Reversible Deck but each card in at most one, the more urgent (Forward on a tie), so a Reverse prompt never gives away the Forward answer in the same session; ADR-0011's one direction per session stays true of a deck's own sessions.
- Each deck's rules stay its own: Shared Answers (ADR-0012) are only within a deck, and under Cram each card counts as due by its own deck's Cram date (#87).
- Sessions that share a deck can't both be unfinished: starting one abandons the other, keeping its answers, as a stale session is abandoned now (#10). A learner has at most one unfinished Today's Review.
- A deck's stats and history count its cards' answers wherever they were given, and list a Today's Review that asked any of its cards as one of its sessions.
